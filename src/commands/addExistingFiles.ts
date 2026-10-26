import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';

import { addFiles } from '../core/addFiles';
import { KeilProjectError } from '../core/errors';
import type { FileToAdd } from '../core/model';
import { fileTypeForPath, SUPPORTED_EXTENSIONS } from '../core/fileTypes';
import { findTarget } from '../core/parseProject';
import { resolveProjectEntryPath, toKeilPath } from '../core/paths';
import { t } from '../i18n';
import { ProjectSession, targetFileKeys, type CommandDependencies } from './common';

interface Candidate {
  fileName: string;
  file: FileToAdd;
}

function uniqueUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const result: vscode.Uri[] = [];
  for (const uri of uris) {
    const key = uri.fsPath.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(uri);
    }
  }
  return result;
}

export async function addExistingFiles(
  deps: CommandDependencies,
  uri?: vscode.Uri,
  selectedUris?: vscode.Uri[],
): Promise<void> {
  const session = new ProjectSession(deps);
  const snapshot = await session.resolveProject();
  if (!snapshot) {
    return;
  }
  const project = snapshot.document;
  const targetName = await session.pickTarget(project);
  if (!targetName) {
    return;
  }
  const target = findTarget(project, targetName);
  if (!target) {
    throw new KeilProjectError('target-not-found', t.commands.targetNotFound(targetName));
  }
  const groupName = await session.pickGroup(target);
  if (!groupName) {
    return;
  }

  let uris: vscode.Uri[] | undefined;
  if (selectedUris && selectedUris.length > 0) {
    uris = [...selectedUris];
    if (uri) {
      uris.push(uri);
    }
  } else if (uri) {
    uris = [uri];
  } else {
    uris = await deps.ui.pickExistingFiles();
  }
  if (!uris || uris.length === 0) {
    return;
  }

  const existingKeys = targetFileKeys(project, target);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const skipped: Array<{ fileName: string; reason: string }> = [];
  const warnings: string[] = [];

  for (const selected of uniqueUris(uris)) {
    const fileName = path.win32.basename(selected.fsPath);
    try {
      const stat = await fs.stat(selected.fsPath);
      if (stat.isDirectory()) {
        skipped.push({
          fileName,
          reason: t.commands.folderSkip,
        });
        continue;
      }
      if (!stat.isFile()) {
        skipped.push({ fileName, reason: t.commands.notAFile });
        continue;
      }
    } catch {
      skipped.push({ fileName, reason: t.commands.missingFile });
      continue;
    }

    const fileType = fileTypeForPath(selected.fsPath);
    if (fileType === undefined) {
      skipped.push({
        fileName,
        reason: t.commands.unsupportedExtension(SUPPORTED_EXTENSIONS.join('、')),
      });
      continue;
    }

    const keilPathInfo = toKeilPath(project.path, selected.fsPath);
    const key = resolveProjectEntryPath(project.path, keilPathInfo.path).toLowerCase();
    if (existingKeys.has(key)) {
      skipped.push({
        fileName,
        reason: t.commands.duplicateExisting,
      });
      continue;
    }
    if (seen.has(key)) {
      skipped.push({ fileName, reason: t.commands.duplicateSelection });
      continue;
    }
    seen.add(key);

    if (keilPathInfo.differentDrive) {
      warnings.push(t.commands.differentDrivePreview(selected.fsPath));
    } else if (keilPathInfo.outsideProject) {
      warnings.push(t.commands.outsideProjectPreview(selected.fsPath));
    }

    candidates.push({
      fileName,
      file: {
        fileName,
        path: keilPathInfo.path,
        fileType,
      },
    });
  }

  if (candidates.length === 0) {
    const details = skipped
      .slice(0, 6)
      .map((item) => `${item.fileName}：${item.reason}`)
      .join('\n');
    deps.ui.showWarning(t.commands.noAddableFiles(details));
    return;
  }

  const confirmed = await deps.ui.confirmAddFiles({
    targetName,
    groupName,
    files: candidates.map((candidate) => ({
      fileName: candidate.fileName,
      path: candidate.file.path,
    })),
    skipped,
    warnings,
  });
  if (!confirmed) {
    return;
  }

  const result = addFiles(project, {
    targetName,
    groups: [
      {
        groupName,
        files: candidates.map((candidate) => candidate.file),
      },
    ],
  });

  await deps.writer.write(snapshot, result, deps.config.getBackupProjectFile());

  const skippedNote = skipped.length > 0 ? t.commands.skippedNote(skipped.length) : '';
  deps.ui.showInfo(
    t.commands.addedFiles(targetName, groupName, candidates.length, skippedNote),
  );

  const hasHeader = candidates.some((candidate) =>
    candidate.fileName.toLowerCase().endsWith('.h'),
  );
  if (hasHeader) {
    deps.ui.showWarning(t.commands.includePathWarning);
  }
}
