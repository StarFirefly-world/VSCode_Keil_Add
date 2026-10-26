import * as path from 'node:path';

const WIN = path.win32;

const ILLEGAL_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface KeilPathInfo {
  /** Path as it should be written into `.uvprojx`. */
  path: string;
  /** The file is outside the directory containing the project. */
  outsideProject: boolean;
  /** The file is on a different drive and is therefore stored as an absolute path. */
  differentDrive: boolean;
}

export interface FileNameValidation {
  name?: string;
  error?: string;
}

export function normalizeAbsolutePath(filePath: string): string {
  const normalized = WIN.normalize(filePath);
  if (normalized.length > 3 && /[\\/]$/.test(normalized)) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function resolveProjectEntryPath(
  projectFilePath: string,
  entryPath: string,
): string {
  const projectDir = WIN.dirname(normalizeAbsolutePath(projectFilePath));
  if (WIN.isAbsolute(entryPath)) {
    return normalizeAbsolutePath(entryPath);
  }
  return normalizeAbsolutePath(WIN.resolve(projectDir, entryPath));
}

export function canonicalFileKey(projectFilePath: string, entryPath: string): string {
  return resolveProjectEntryPath(projectFilePath, entryPath).toLowerCase();
}

export function canonicalAbsolutePath(filePath: string): string {
  return normalizeAbsolutePath(filePath).toLowerCase();
}

export function isSamePath(a: string, b: string): boolean {
  return canonicalAbsolutePath(a) === canonicalAbsolutePath(b);
}

/**
 * Determines the overall project root used for module folder containment.
 *
 * Normally this is the workspace folder that contains the .uvprojx. When the
 * workspace is the project directory itself, its parent is treated as the
 * overall project root so sibling folders such as HARDWARE remain valid. Drive
 * roots are never used as that fallback.
 */
export function overallProjectRoot(projectPath: string, workspaceRoot?: string): string {
  const projectDirectory = WIN.dirname(normalizeAbsolutePath(projectPath));
  if (!workspaceRoot) {
    return projectDirectory;
  }
  const workspace = normalizeAbsolutePath(workspaceRoot);
  if (!isSamePath(workspace, projectDirectory)) {
    return workspace;
  }

  const parent = WIN.dirname(projectDirectory);
  const driveRoot = WIN.parse(parent).root;
  if (isSamePath(parent, driveRoot)) {
    return projectDirectory;
  }
  return parent;
}

export function isPathInside(projectFilePath: string, filePath: string): boolean {
  const projectDir = WIN.dirname(normalizeAbsolutePath(projectFilePath)).toLowerCase();
  const absolute = normalizeAbsolutePath(filePath).toLowerCase();
  const relative = WIN.relative(projectDir, absolute);
  return relative === '' || (!relative.startsWith('..') && !WIN.isAbsolute(relative));
}

/** Returns true when `filePath` is the directory or one of its descendants. */
export function isPathInsideDirectory(directoryPath: string, filePath: string): boolean {
  const root = normalizeAbsolutePath(directoryPath).toLowerCase();
  const absolute = normalizeAbsolutePath(filePath).toLowerCase();
  const relative = WIN.relative(root, absolute);
  return relative === '' || (!relative.startsWith('..') && !WIN.isAbsolute(relative));
}

/**
 * Returns the deepest directory shared by all given files, or undefined when
 * the files span different drives.
 */
export function commonDirectory(filePaths: readonly string[]): string | undefined {
  if (filePaths.length === 0) {
    return undefined;
  }
  const directories = [
    ...new Set(filePaths.map((file) => WIN.dirname(normalizeAbsolutePath(file)))),
  ];
  const root = WIN.parse(directories[0]).root;
  if (
    directories.some(
      (directory) => WIN.parse(directory).root.toLowerCase() !== root.toLowerCase(),
    )
  ) {
    return undefined;
  }
  const split = directories.map((directory) =>
    WIN.relative(root, directory)
      .split('\\')
      .filter((part) => part.length > 0),
  );

  const common: string[] = [];
  const shortest = Math.min(...split.map((parts) => parts.length));
  for (let index = 0; index < shortest; index += 1) {
    const candidate = split[0][index];
    if (split.every((parts) => parts[index].toLowerCase() === candidate.toLowerCase())) {
      common.push(candidate);
    } else {
      break;
    }
  }
  return `${root}${common.join('\\')}`;
}

export function toKeilPath(
  projectFilePath: string,
  absoluteFilePath: string,
): KeilPathInfo {
  const projectDir = WIN.dirname(normalizeAbsolutePath(projectFilePath));
  const absolute = normalizeAbsolutePath(absoluteFilePath);
  const projectRoot = WIN.parse(projectDir).root.toLowerCase();
  const fileRoot = WIN.parse(absolute).root.toLowerCase();

  if (projectRoot !== fileRoot) {
    return {
      path: absolute,
      outsideProject: true,
      differentDrive: true,
    };
  }

  const relative = WIN.relative(projectDir, absolute);
  if (relative === '') {
    return {
      path: `.\\${WIN.basename(absolute)}`,
      outsideProject: false,
      differentDrive: false,
    };
  }

  const outsideProject = relative.startsWith('..');
  if (outsideProject) {
    return {
      path: relative,
      outsideProject: true,
      differentDrive: false,
    };
  }

  return {
    path: `.\\${relative}`,
    outsideProject: false,
    differentDrive: false,
  };
}

export function validateFileName(
  input: string,
  expectedExtension?: '.c' | '.h',
): FileNameValidation {
  let name = input.trim();
  if (name.length === 0) {
    return { error: '文件名不能为空。' };
  }
  if (ILLEGAL_FILE_NAME.test(name)) {
    return { error: '文件名不能包含 < > : " / \\ | ? * 或控制字符。' };
  }
  if (name === '.' || name === '..' || /[. ]$/.test(name)) {
    return { error: '文件名不能以点或空格结尾。' };
  }

  if (expectedExtension) {
    const ext = WIN.extname(name);
    if (ext.length === 0) {
      name += expectedExtension;
    } else if (ext.toLowerCase() !== expectedExtension) {
      return { error: `扩展名必须为 ${expectedExtension}。` };
    }
  }

  if (name.length > 255) {
    return { error: '文件名过长（最多 255 个字符）。' };
  }
  if (WINDOWS_RESERVED.test(name)) {
    return {
      error: '该文件名是 Windows 保留名称（如 CON、NUL、COM1），不能使用。',
    };
  }

  return { name };
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
