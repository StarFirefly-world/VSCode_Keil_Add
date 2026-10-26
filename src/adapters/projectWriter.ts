import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import writeFileAtomic from 'write-file-atomic';

import {
  decodeProjectBytes,
  encodeProjectText,
  isGbProjectCharset,
} from '../core/encoding';
import { KeilProjectError, isNodeError } from '../core/errors';
import type { AddFilesResult } from '../core/model';
import { parseProject } from '../core/parseProject';
import { isSamePath } from '../core/paths';
import { t } from '../i18n';
import type { ProjectSnapshot } from './projectRepository';
import { snapshotHash } from './projectRepository';

export interface WriteResult {
  backupPath?: string;
}

export interface ProjectWriterPort {
  write(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
    backupEnabled: boolean,
  ): Promise<WriteResult>;
}

const MAX_BACKUPS = 20;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isBusyError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
  );
}

async function readFileMapped(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isBusyError(error)) {
      throw new KeilProjectError(
        'busy',
        '工程文件被占用或没有访问权限。请关闭 Keil 或检查只读属性后重试。',
        error,
      );
    }
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new KeilProjectError('io', '工程文件不存在，可能已被移动或删除。', error);
    }
    throw new KeilProjectError(
      'io',
      `读取工程文件失败：${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
}

export class ProjectWriter implements ProjectWriterPort {
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly globalStorageUri: vscode.Uri) {}

  public write(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
    backupEnabled: boolean,
  ): Promise<WriteResult> {
    const operation = this.writeQueue.then(() =>
      this.writeInternal(snapshot, result, backupEnabled),
    );
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async writeInternal(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
    backupEnabled: boolean,
  ): Promise<WriteResult> {
    const openDocument = this.findOpenDocument(snapshot.path);
    const gbProject = isGbProjectCharset(snapshot.document.charset);

    if (gbProject && openDocument) {
      throw new KeilProjectError(
        'conflict',
        'GB2312/GBK 工程文件已在 VS Code 中打开。请先关闭该文件，再重新执行操作，避免编辑器覆盖编码正确的工程文件。',
      );
    }

    await this.assertUnchanged(snapshot);
    if (openDocument && !gbProject) {
      await this.saveDirtyDocument(openDocument);
      await this.assertUnchanged(snapshot);
    }
    const activeDocument =
      openDocument && !openDocument.isClosed ? openDocument : undefined;
    if (activeDocument && activeDocument.getText() !== snapshot.document.text) {
      throw new KeilProjectError(
        'conflict',
        '编辑器中的工程内容与磁盘内容不一致。请关闭工程文件后重新执行操作。',
      );
    }

    let backupPath: string | undefined;
    if (backupEnabled) {
      backupPath = await this.createBackup(snapshot);
    }

    try {
      if (gbProject) {
        await this.writeBytes(snapshot, result);
      } else {
        await this.writeWithWorkspaceEdit(snapshot, result, activeDocument);
      }
      await this.verifyWrittenFile(snapshot, result);
      return { backupPath };
    } catch (error) {
      const rollbackError = await this.rollbackIfNeeded(
        snapshot,
        result,
        backupPath,
      ).then(
        () => undefined,
        (rollback: unknown) => rollback,
      );
      if (rollbackError) {
        throw new KeilProjectError(
          'io',
          `写入工程文件失败，且自动恢复未完成。${
            backupPath ? `备份文件：${backupPath}` : '请从版本控制恢复工程文件。'
          } 原因：${error instanceof Error ? error.message : String(error)}；恢复失败原因：${
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }`,
          rollbackError,
        );
      }
      throw error;
    }
  }

  private findOpenDocument(filePath: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(
      (document) =>
        document.uri.scheme === 'file' && isSamePath(document.uri.fsPath, filePath),
    );
  }

  private async saveDirtyDocument(document: vscode.TextDocument): Promise<void> {
    if (!document.isDirty) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      '工程文件在编辑器中有未保存的修改。为避免覆盖，请先保存或取消本次操作。',
      { modal: true },
      t.buttons.saveAndContinue,
    );
    if (answer !== t.buttons.saveAndContinue) {
      throw new KeilProjectError('cancelled', '工程文件有未保存的修改，操作已取消。');
    }
    const saved = await this.saveWithRetry(document);
    if (!saved) {
      throw new KeilProjectError('io', '保存工程文件失败。');
    }
  }

  private async saveWithRetry(document: vscode.TextDocument): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (await document.save()) {
          return true;
        }
      } catch (error) {
        if (attempt === 2) {
          throw new KeilProjectError(
            'io',
            `保存工程文件失败：${
              error instanceof Error ? error.message : String(error)
            }。若 Keil 正在使用该工程，请关闭工程后重试。`,
            error,
          );
        }
      }
      if (attempt < 2) {
        await delay(200);
      }
    }
    return false;
  }

  private async assertUnchanged(snapshot: ProjectSnapshot): Promise<void> {
    const current = await readFileMapped(snapshot.path);
    if (snapshotHash(current) !== snapshot.hash) {
      throw new KeilProjectError(
        'conflict',
        '工程文件已被 Keil 或其他程序修改。为避免覆盖，已中止本次操作。请重新执行命令以读取最新内容。',
      );
    }
  }

  private async writeWithWorkspaceEdit(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
    openDocument: vscode.TextDocument | undefined,
  ): Promise<void> {
    const uri = vscode.Uri.file(snapshot.path);
    const document = openDocument ?? (await vscode.workspace.openTextDocument(uri));
    if (document.getText() !== snapshot.document.text) {
      throw new KeilProjectError(
        'conflict',
        '编辑器中的工程内容与磁盘内容不一致，已中止写入。',
      );
    }
    if (result.insertions.length === 0) {
      return;
    }

    // Re-check immediately before applying the in-memory edit so an external
    // save that happened while the document was being opened is not overwritten.
    await this.assertUnchanged(snapshot);

    const edit = new vscode.WorkspaceEdit();
    for (const insertion of result.insertions) {
      const start = document.positionAt(insertion.offset);
      if (insertion.length && insertion.length > 0) {
        const end = document.positionAt(insertion.offset + insertion.length);
        edit.replace(uri, new vscode.Range(start, end), insertion.text);
      } else {
        edit.insert(uri, start, insertion.text);
      }
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new KeilProjectError('io', '应用工程文件编辑失败。');
    }
    const saved = await this.saveWithRetry(document);
    if (!saved) {
      throw new KeilProjectError(
        'io',
        '保存工程文件失败。若 Keil 正在使用该工程，请关闭工程后重试。',
      );
    }
  }

  private async writeBytes(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
  ): Promise<void> {
    // Re-check right before overwriting so a change that happened after the
    // verification in writeInternal (e.g. while the backup was written) is
    // not silently clobbered by the byte write.
    await this.assertUnchanged(snapshot);
    const bytes = encodeProjectText(result.text, snapshot.document.charset);
    await this.atomicWrite(snapshot.path, bytes, snapshot.mode);
  }

  private async atomicWrite(
    filePath: string,
    bytes: Buffer,
    mode: number,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await writeFileAtomic(filePath, bytes, {
          mode,
          fsync: true,
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isBusyError(error) || attempt === 2) {
          break;
        }
        await delay(200);
      }
    }
    if (isBusyError(lastError)) {
      throw new KeilProjectError(
        'busy',
        '工程文件被占用或只读。请关闭 Keil 或取消文件只读属性后重试。',
        lastError,
      );
    }
    throw new KeilProjectError(
      'io',
      `写入工程文件失败：${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      lastError,
    );
  }

  private async verifyWrittenFile(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
  ): Promise<void> {
    const bytes = await readFileMapped(snapshot.path);
    const decoded = decodeProjectBytes(bytes);
    if (decoded.charset !== snapshot.document.charset) {
      throw new KeilProjectError(
        'validation',
        `写回后工程文件编码发生变化（原 ${snapshot.document.charset}，现 ${decoded.charset}）。`,
      );
    }
    if (decoded.text !== result.text) {
      throw new KeilProjectError(
        'validation',
        '写回后的工程文件内容与预期不一致，已触发自动恢复。',
      );
    }
    const reparsed = parseProject(decoded.text, snapshot.path, decoded.charset);
    if (reparsed.eol !== snapshot.document.eol) {
      throw new KeilProjectError(
        'validation',
        '写回后工程文件换行符发生变化，已触发自动恢复。',
      );
    }
  }

  private async createBackup(snapshot: ProjectSnapshot): Promise<string> {
    const backupDirectory = path.join(this.globalStorageUri.fsPath, 'backups');
    try {
      await fs.mkdir(backupDirectory, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = `${timestamp}-${randomUUID().slice(0, 8)}-${path.basename(
        snapshot.path,
      )}`;
      const backupPath = path.join(backupDirectory, backupName);
      await fs.writeFile(backupPath, snapshot.bytes);
      await this.pruneBackups(backupDirectory);
      return backupPath;
    } catch (error) {
      throw new KeilProjectError(
        'io',
        `备份工程文件失败，已中止修改：${
          error instanceof Error ? error.message : String(error)
        }`,
        error,
      );
    }
  }

  private async pruneBackups(backupDirectory: string): Promise<void> {
    try {
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const files = entries.filter((entry) => entry.isFile());
      const withTimes = await Promise.all(
        files.map(async (entry) => {
          const filePath = path.join(backupDirectory, entry.name);
          const stat = await fs.stat(filePath);
          return { filePath, mtimeMs: stat.mtimeMs };
        }),
      );
      withTimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
      await Promise.all(
        withTimes
          .slice(MAX_BACKUPS)
          .map((entry) => fs.unlink(entry.filePath).catch(() => undefined)),
      );
    } catch {
      // Backup pruning must never fail the write.
    }
  }

  private async rollbackIfNeeded(
    snapshot: ProjectSnapshot,
    result: AddFilesResult,
    backupPath: string | undefined,
  ): Promise<void> {
    let current: Buffer;
    try {
      current = await fs.readFile(snapshot.path);
    } catch (error) {
      throw new KeilProjectError(
        'conflict',
        '写入失败后工程文件已不存在，未自动重新创建，请检查备份或版本控制。',
        error,
      );
    }

    if (snapshotHash(current) === snapshot.hash) {
      await this.revertOpenDocument(snapshot.path);
      return;
    }

    let currentText: string;
    try {
      currentText = decodeProjectBytes(current).text;
    } catch (error) {
      await this.revertOpenDocument(snapshot.path);
      throw new KeilProjectError(
        'conflict',
        '写入失败后工程文件内容已无法识别，可能被其他程序修改，未自动覆盖。',
        error,
      );
    }

    if (currentText !== result.text && currentText !== snapshot.document.text) {
      await this.revertOpenDocument(snapshot.path);
      throw new KeilProjectError(
        'conflict',
        '写入失败后检测到工程文件被其他程序修改，未自动回滚，以免覆盖外部修改。',
      );
    }

    // Text equality alone is not enough: the bytes may still diverge (for
    // example a lost UTF-8 BOM), so the original bytes are always restored.
    let bytes = snapshot.bytes;
    if (backupPath) {
      try {
        bytes = await fs.readFile(backupPath);
      } catch {
        // Fall back to the in-memory original bytes.
      }
    }
    await this.atomicWrite(snapshot.path, bytes, snapshot.mode);
    await this.revertOpenDocument(snapshot.path);
  }

  private async revertOpenDocument(filePath: string): Promise<void> {
    const document = this.findOpenDocument(filePath);
    if (!document || !document.isDirty) {
      return;
    }
    try {
      await vscode.commands.executeCommand('workbench.action.files.revert', document.uri);
    } catch {
      // The user can reload the document manually if revert is unavailable.
    }
  }
}
