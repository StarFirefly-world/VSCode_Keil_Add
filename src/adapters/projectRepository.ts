import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { decodeProjectBytes } from '../core/encoding';
import { KeilProjectError, isNodeError } from '../core/errors';
import type { ProjectDocument } from '../core/model';
import { parseProject } from '../core/parseProject';

export interface ProjectSnapshot {
  path: string;
  bytes: Buffer;
  hash: string;
  mtimeMs: number;
  mode: number;
  document: ProjectDocument;
}

export interface ProjectRepositoryPort {
  discover(): Promise<string[]>;
  read(projectPath: string): Promise<ProjectSnapshot>;
  exists(projectPath: string): Promise<boolean>;
  resolveConfiguredPath(configuredPath: string): string;
}

function mapIoError(error: unknown, action: string): KeilProjectError {
  if (isNodeError(error)) {
    if (error.code === 'ENOENT') {
      return new KeilProjectError('io', `工程文件不存在：${action}`, error);
    }
    if (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES') {
      return new KeilProjectError(
        'busy',
        '工程文件被占用或没有访问权限。请关闭 Keil 或检查文件只读属性后重试。',
        error,
      );
    }
  }
  return new KeilProjectError(
    'io',
    `读取工程文件失败：${error instanceof Error ? error.message : String(error)}`,
    error,
  );
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class ProjectRepository implements ProjectRepositoryPort {
  public resolveConfiguredPath(configuredPath: string): string {
    const value = configuredPath.trim();
    if (path.isAbsolute(value)) {
      return path.resolve(value);
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      return path.resolve(folder.uri.fsPath, value);
    }
    return path.resolve(value);
  }

  public async discover(): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.uvprojx',
      '**/{node_modules,.git,.vscode-test,out,dist}/**',
      500,
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const uri of uris) {
      const key = uri.fsPath.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(uri.fsPath);
      }
    }
    result.sort((a, b) => a.localeCompare(b));
    return result;
  }

  public async exists(projectPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(projectPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  public async read(projectPath: string): Promise<ProjectSnapshot> {
    const absolutePath = path.resolve(projectPath);
    if (path.extname(absolutePath).toLowerCase() !== '.uvprojx') {
      throw new KeilProjectError(
        'invalid-project',
        `不是 .uvprojx 工程文件：${absolutePath}`,
      );
    }

    let bytes: Buffer;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      [bytes, stat] = await Promise.all([
        fs.readFile(absolutePath),
        fs.stat(absolutePath),
      ]);
    } catch (error) {
      throw mapIoError(error, absolutePath);
    }

    const decoded = decodeProjectBytes(bytes);
    const document = parseProject(decoded.text, absolutePath, decoded.charset);
    return {
      path: absolutePath,
      bytes,
      hash: hashBytes(bytes),
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      document,
    };
  }
}

export function snapshotHash(bytes: Uint8Array): string {
  return hashBytes(bytes);
}
