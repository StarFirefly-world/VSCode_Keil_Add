import { KeilProjectError } from './errors';
import type {
  FileNode,
  ProjectDocument,
  RemoveFilesResult,
  RemovedFileEntry,
  TextInsertion,
} from './model';
import { parseProject } from './parseProject';
import {
  canonicalFileKey,
  isPathInsideDirectory,
  resolveProjectEntryPath,
} from './paths';

interface FileMatch {
  file: FileNode;
  entry: RemovedFileEntry;
}

interface RemovalRange {
  offset: number;
  length: number;
}

function collectMatches(project: ProjectDocument, directoryPath: string): FileMatch[] {
  const matches: FileMatch[] = [];
  for (const target of project.targets) {
    for (const group of target.groups) {
      for (const file of group.files) {
        if (file.path.length === 0) {
          continue;
        }
        const absolutePath = resolveProjectEntryPath(project.path, file.path);
        if (!isPathInsideDirectory(directoryPath, absolutePath)) {
          continue;
        }
        matches.push({
          file,
          entry: {
            targetName: target.name,
            groupName: group.name,
            fileName: file.name,
            projectPath: file.path,
            absolutePath,
          },
        });
      }
    }
  }
  return matches;
}

function removalRange(text: string, file: FileNode): RemovalRange {
  if (file.start < 0 || file.end <= file.start || file.end > text.length) {
    throw new KeilProjectError(
      'validation',
      `无法定位工程文件条目 "${file.path}" 的删除范围。`,
    );
  }

  const lineStart = text.lastIndexOf('\n', file.start - 1) + 1;
  const before = text.slice(lineStart, file.start);
  const newline = text.indexOf('\n', file.end);
  const contentEnd =
    newline < 0
      ? text.length
      : newline > 0 && text[newline - 1] === '\r'
        ? newline - 1
        : newline;
  const after = text.slice(file.end, contentEnd);

  if (/^[ \t]*$/.test(before) && /^[ \t]*$/.test(after)) {
    const removeEnd = newline < 0 ? text.length : newline + 1;
    return { offset: lineStart, length: removeEnd - lineStart };
  }
  return { offset: file.start, length: file.end - file.start };
}

function applyRemovals(text: string, ranges: RemovalRange[]): string {
  const ascending = [...ranges].sort((a, b) => a.offset - b.offset);
  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1];
    if (previous.offset + previous.length > ascending[index].offset) {
      throw new KeilProjectError('validation', '删除范围发生重叠。');
    }
  }

  let result = text;
  for (const range of [...ranges].sort((a, b) => b.offset - a.offset)) {
    result = result.slice(0, range.offset) + result.slice(range.offset + range.length);
  }
  return result;
}

function validateResult(
  original: ProjectDocument,
  updated: ProjectDocument,
  matches: FileMatch[],
): void {
  if (updated.eol !== original.eol) {
    throw new KeilProjectError('validation', '删除后工程文件换行符发生变化。');
  }

  const removed = new Set<FileNode>(matches.map((match) => match.file));
  const originalCount = original.targets.reduce(
    (total, target) =>
      total +
      target.groups.reduce(
        (groupTotal, group) =>
          groupTotal + group.files.filter((file) => file.path.length > 0).length,
        0,
      ),
    0,
  );
  const updatedCount = updated.targets.reduce(
    (total, target) =>
      total +
      target.groups.reduce(
        (groupTotal, group) =>
          groupTotal + group.files.filter((file) => file.path.length > 0).length,
        0,
      ),
    0,
  );
  if (updatedCount !== originalCount - matches.length) {
    throw new KeilProjectError(
      'validation',
      `删除后的文件条目数量不正确（期望 ${originalCount - matches.length}，实际 ${updatedCount}）。`,
    );
  }

  for (const originalTarget of original.targets) {
    const updatedTarget = updated.targets.find(
      (target) => target.name === originalTarget.name,
    );
    if (!updatedTarget) {
      throw new KeilProjectError(
        'validation',
        `删除后丢失了 Target "${originalTarget.name}"。`,
      );
    }
    for (const originalGroup of originalTarget.groups) {
      const matchingGroups = updatedTarget.groups.filter(
        (group) => group.name === originalGroup.name,
      );
      if (matchingGroups.length === 0) {
        throw new KeilProjectError(
          'validation',
          `删除后丢失了 Group "${originalGroup.name}"。`,
        );
      }
      for (const originalFile of originalGroup.files) {
        if (removed.has(originalFile) || originalFile.path.length === 0) {
          continue;
        }
        const key = canonicalFileKey(original.path, originalFile.path);
        const present = matchingGroups.some((group) =>
          group.files.some(
            (file) =>
              file.path.length > 0 && canonicalFileKey(updated.path, file.path) === key,
          ),
        );
        if (!present) {
          throw new KeilProjectError(
            'validation',
            `删除后丢失了原有文件条目：${originalFile.path}`,
          );
        }
      }
    }
  }
}

/**
 * Removes every `<File>` entry whose resolved path is inside `directoryPath`.
 * The search spans all targets and groups so deleting a module does not leave
 * dangling references in another target.
 */
export function removeFilesInDirectory(
  project: ProjectDocument,
  directoryPath: string,
): RemoveFilesResult {
  const matches = collectMatches(project, directoryPath);
  if (matches.length === 0) {
    return {
      text: project.text,
      insertions: [],
      filesRemoved: 0,
      entries: [],
    };
  }

  const replacements: RemovalRange[] = matches.map((match) =>
    removalRange(project.text, match.file),
  );
  const text = applyRemovals(project.text, replacements);
  const updated = parseProject(text, project.path, project.charset);
  if (
    updated.targets.some((target) =>
      target.groups.some((group) =>
        group.files.some(
          (file) =>
            file.path.length > 0 &&
            isPathInsideDirectory(
              directoryPath,
              resolveProjectEntryPath(project.path, file.path),
            ),
        ),
      ),
    )
  ) {
    throw new KeilProjectError('validation', '删除后工程文件中仍存在该模块目录的引用。');
  }
  validateResult(project, updated, matches);

  const insertions: TextInsertion[] = [...replacements]
    .sort((a, b) => a.offset - b.offset)
    .map((range) => ({
      offset: range.offset,
      length: range.length,
      text: '',
    }));

  return {
    text,
    insertions,
    filesRemoved: matches.length,
    entries: matches.map((match) => match.entry),
  };
}
