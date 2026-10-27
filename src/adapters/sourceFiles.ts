import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

import { decodeSourceText, encodeSourceText } from '../core/encoding';
import { KeilProjectError, isNodeError } from '../core/errors';
import type { SourceCharset, SourceFileSample } from '../core/model';
import { t } from '../i18n';

const MAX_SAMPLE_SIZE = 5 * 1024 * 1024;
const MAX_DIRECTORY_SAMPLES = 500;
const MAX_PROJECT_SAMPLES = 1000;
const MAX_MODULE_FILES = 2000;
const READ_BATCH_SIZE = 32;

export interface CreatedSourceFile {
  path: string;
  bytes: Buffer;
}

export interface SourceFilesPort {
  createDirectory(directoryPath: string): Promise<void>;
  removeDirectoryIfEmpty(directoryPath: string): Promise<boolean>;
  listFilesRecursive(directoryPath: string): Promise<string[]>;
  deleteDirectory(directoryPath: string): Promise<void>;
  createFile(
    filePath: string,
    text: string,
    charset: SourceCharset,
  ): Promise<CreatedSourceFile>;
  deleteCreatedFile(filePath: string, expectedBytes: Buffer): Promise<boolean>;
  collectDirectorySamples(directoryPath: string): Promise<SourceFileSample[]>;
  collectSamples(filePaths: readonly string[]): Promise<SourceFileSample[]>;
}

function isSourceExtension(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.c' || extension === '.h';
}

async function readSample(filePath: string): Promise<SourceFileSample | undefined> {
  if (!isSourceExtension(filePath)) {
    return undefined;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_SAMPLE_SIZE) {
      return undefined;
    }
    return { path: filePath, bytes: await fs.readFile(filePath) };
  } catch {
    return undefined;
  }
}

async function readInBatches(filePaths: readonly string[]): Promise<SourceFileSample[]> {
  const samples: SourceFileSample[] = [];
  for (let index = 0; index < filePaths.length; index += READ_BATCH_SIZE) {
    const batch = filePaths.slice(index, index + READ_BATCH_SIZE);
    const results = await Promise.all(batch.map((file) => readSample(file)));
    for (const sample of results) {
      if (sample) {
        samples.push(sample);
      }
    }
  }
  return samples;
}

export class SourceFileService implements SourceFilesPort {
  public async createDirectory(directoryPath: string): Promise<void> {
    try {
      await fs.mkdir(directoryPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new KeilProjectError('io', t.module.folderExists(directoryPath), error);
      }
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new KeilProjectError(
          'io',
          `父目录不存在：${path.dirname(directoryPath)}`,
          error,
        );
      }
      throw new KeilProjectError('io', `创建目录失败：${directoryPath}`, error);
    }
  }

  public async removeDirectoryIfEmpty(directoryPath: string): Promise<boolean> {
    try {
      await fs.rmdir(directoryPath);
      return true;
    } catch (error) {
      return isNodeError(error) && error.code === 'ENOENT';
    }
  }

  public async listFilesRecursive(directoryPath: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (current: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (error) {
        throw new KeilProjectError('io', `读取模块目录失败：${current}`, error);
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else {
          files.push(entryPath);
        }
        if (files.length > MAX_MODULE_FILES) {
          throw new KeilProjectError(
            'io',
            `模块目录中的文件过多（超过 ${MAX_MODULE_FILES} 个），已中止。`,
          );
        }
      }
    };
    await visit(directoryPath);
    files.sort((a, b) => a.localeCompare(b));
    return files;
  }

  public async deleteDirectory(directoryPath: string): Promise<void> {
    try {
      await fs.rm(directoryPath, {
        recursive: true,
        force: false,
        maxRetries: 2,
        retryDelay: 150,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      if (
        isNodeError(error) &&
        (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        throw new KeilProjectError(
          'busy',
          `无法删除模块文件夹（被占用或只读）：${directoryPath}`,
          error,
        );
      }
      throw new KeilProjectError('io', `删除模块文件夹失败：${directoryPath}`, error);
    }
  }

  public async createFile(
    filePath: string,
    text: string,
    charset: SourceCharset,
  ): Promise<CreatedSourceFile> {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(path.dirname(filePath));
    } catch (error) {
      throw new KeilProjectError(
        'io',
        `目标目录不存在：${path.dirname(filePath)}`,
        error,
      );
    }
    if (!stat.isDirectory()) {
      throw new KeilProjectError('io', `目标路径不是目录：${path.dirname(filePath)}`);
    }

    const bytes = encodeSourceText(text, charset);
    try {
      await fs.writeFile(filePath, bytes, { flag: 'wx' });
    } catch (error) {
      if (isNodeError(error) && error.code === 'EEXIST') {
        throw new KeilProjectError('io', `文件已存在，未覆盖：${filePath}`, error);
      }
      if (
        isNodeError(error) &&
        (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        throw new KeilProjectError(
          'busy',
          `无法写入文件（被占用或只读）：${filePath}`,
          error,
        );
      }
      throw new KeilProjectError(
        'io',
        `创建文件失败：${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    const readBack = await fs.readFile(filePath);
    if (!readBack.equals(bytes)) {
      await fs.unlink(filePath).catch(() => undefined);
      throw new KeilProjectError(
        'encoding',
        '新文件写回后的字节与预期不一致，已删除该文件。',
      );
    }
    const decoded = decodeSourceText(readBack, charset);
    if (decoded !== text) {
      await fs.unlink(filePath).catch(() => undefined);
      throw new KeilProjectError(
        'encoding',
        '新文件写回后的内容与预期不一致，已删除该文件。',
      );
    }

    return { path: filePath, bytes };
  }

  public async deleteCreatedFile(
    filePath: string,
    expectedBytes: Buffer,
  ): Promise<boolean> {
    try {
      const current = await fs.readFile(filePath);
      if (!current.equals(expectedBytes)) {
        return false;
      }
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      return isNodeError(error) && error.code === 'ENOENT';
    }
  }

  public async collectDirectorySamples(
    directoryPath: string,
  ): Promise<SourceFileSample[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const files = entries
      .filter((entry) => entry.isFile() && isSourceExtension(entry.name))
      .slice(0, MAX_DIRECTORY_SAMPLES)
      .map((entry) => path.join(directoryPath, entry.name));
    return readInBatches(files);
  }

  public async collectSamples(filePaths: readonly string[]): Promise<SourceFileSample[]> {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const filePath of filePaths) {
      if (!isSourceExtension(filePath)) {
        continue;
      }
      const key = path.resolve(filePath).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(filePath);
      }
      if (unique.length >= MAX_PROJECT_SAMPLES) {
        break;
      }
    }
    return readInBatches(unique);
  }
}
