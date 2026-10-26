import { KeilProjectError } from './errors';
import type {
  AddFilesRequest,
  AddFilesResult,
  GroupAddition,
  ProjectDocument,
  TargetNode,
  TextInsertion,
} from './model';
import { findGroup, findTarget } from './parseProject';
import { canonicalFileKey, xmlEscape } from './paths';
import { validateAddFilesResult } from './validate';

interface CloseLine {
  indent: string;
  formatted: boolean;
}

function closeLineInfo(text: string, closeOffset: number): CloseLine {
  const lineStart = text.lastIndexOf('\n', closeOffset - 1) + 1;
  const beforeClose = text.slice(lineStart, closeOffset);
  if (/^[ \t]*$/.test(beforeClose)) {
    return { indent: beforeClose, formatted: true };
  }
  const leading = /^[ \t]*/.exec(beforeClose)?.[0] ?? '';
  return { indent: leading, formatted: false };
}

function buildInsertion(
  closeOffset: number,
  close: CloseLine,
  eol: string,
  blockLines: string[],
): TextInsertion {
  const block = `${blockLines.join(eol)}${eol}${close.indent}`;
  if (close.formatted) {
    return {
      offset: closeOffset,
      text: block.slice(close.indent.length),
    };
  }
  return { offset: closeOffset, text: `${eol}${block}` };
}

function selfClosingTagLength(text: string, start: number): number {
  const match = /^<[^>]+\/>/.exec(text.slice(start));
  if (!match) {
    throw new KeilProjectError('validation', '生成的插入位置不是自闭合标签。');
  }
  return match[0].length;
}

function buildSelfClosingReplacement(
  closeOffset: number,
  close: CloseLine,
  eol: string,
  blockLines: string[],
  text: string,
  tagName: string,
): TextInsertion {
  const length = selfClosingTagLength(text, closeOffset);
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  if (close.formatted) {
    const block = `${blockLines.join(eol)}${eol}${close.indent}`;
    return {
      offset: closeOffset,
      length,
      text: `${openTag}${block.slice(close.indent.length)}${closeTag}`,
    };
  }
  return {
    offset: closeOffset,
    length,
    text: `${openTag}${eol}${blockLines.join(eol)}${eol}${closeTag}`,
  };
}

function fileBlock(
  file: { fileName: string; path: string; fileType: number },
  indent: string,
  unit: string,
): string[] {
  return [
    `${indent}<File>`,
    `${indent}${unit}<FileName>${xmlEscape(file.fileName)}</FileName>`,
    `${indent}${unit}<FileType>${file.fileType}</FileType>`,
    `${indent}${unit}<FilePath>${xmlEscape(file.path)}</FilePath>`,
    `${indent}</File>`,
  ];
}

function filesBlock(
  files: AddFilesRequest['groups'][number]['files'],
  filesIndent: string,
  unit: string,
): string[] {
  const fileIndent = filesIndent + unit;
  const lines = [`${filesIndent}<Files>`];
  for (const file of files) {
    lines.push(...fileBlock(file, fileIndent, unit));
  }
  lines.push(`${filesIndent}</Files>`);
  return lines;
}

function groupBlock(group: GroupAddition, groupIndent: string, unit: string): string[] {
  const childIndent = groupIndent + unit;
  const lines = [
    `${groupIndent}<Group>`,
    `${childIndent}<GroupName>${xmlEscape(group.groupName)}</GroupName>`,
  ];
  lines.push(...filesBlock(group.files, childIndent, unit));
  lines.push(`${groupIndent}</Group>`);
  return lines;
}

function mergeGroups(groups: GroupAddition[]): GroupAddition[] {
  const merged = new Map<string, GroupAddition>();
  for (const group of groups) {
    const existing = merged.get(group.groupName);
    if (existing) {
      existing.files.push(...group.files);
    } else {
      merged.set(group.groupName, {
        groupName: group.groupName,
        files: [...group.files],
      });
    }
  }
  return [...merged.values()];
}

function assertNoDuplicatePaths(
  project: ProjectDocument,
  target: TargetNode,
  groups: GroupAddition[],
): void {
  const existingKeys = new Set<string>();
  for (const group of target.groups) {
    for (const file of group.files) {
      if (file.path.length > 0) {
        existingKeys.add(canonicalFileKey(project.path, file.path));
      }
    }
  }

  const seen = new Set<string>();
  for (const group of groups) {
    for (const file of group.files) {
      const key = canonicalFileKey(project.path, file.path);
      if (existingKeys.has(key) || seen.has(key)) {
        throw new KeilProjectError(
          'duplicate-file',
          `文件 "${file.fileName}" 已存在于 Target "${target.name}" 中。`,
        );
      }
      seen.add(key);
    }
  }
}

function applyInsertions(text: string, insertions: TextInsertion[]): string {
  const keys = new Set<string>();
  for (const insertion of insertions) {
    const length = insertion.length ?? 0;
    if (
      insertion.offset < 0 ||
      insertion.offset > text.length ||
      insertion.offset + length > text.length
    ) {
      throw new KeilProjectError('validation', '生成的插入位置无效或发生重叠。');
    }
    const key = `${insertion.offset}:${length}`;
    if (keys.has(key)) {
      throw new KeilProjectError('validation', '生成的插入位置无效或发生重叠。');
    }
    keys.add(key);
  }

  let result = text;
  const descending = [...insertions].sort((a, b) => b.offset - a.offset);
  for (const insertion of descending) {
    const length = insertion.length ?? 0;
    result =
      result.slice(0, insertion.offset) +
      insertion.text +
      result.slice(insertion.offset + length);
  }
  return result;
}

/**
 * Produces a new project text containing the requested files with the smallest
 * possible text edits. The returned insertions refer to the original text so
 * the caller can apply them with `WorkspaceEdit`.
 */
export function addFiles(
  project: ProjectDocument,
  request: AddFilesRequest,
): AddFilesResult {
  const target = findTarget(project, request.targetName);
  if (!target) {
    throw new KeilProjectError(
      'target-not-found',
      `未找到 Target "${request.targetName}"。`,
    );
  }

  const groups = mergeGroups(request.groups);
  assertNoDuplicatePaths(project, target, groups);

  const insertions: TextInsertion[] = [];
  const groupsCreated: string[] = [];
  const newGroups: GroupAddition[] = [];
  let filesAdded = 0;

  for (const group of groups) {
    const existingGroup = findGroup(target, group.groupName);
    if (!existingGroup) {
      newGroups.push(group);
      groupsCreated.push(group.groupName);
      filesAdded += group.files.length;
      continue;
    }
    if (group.files.length === 0) {
      continue;
    }

    filesAdded += group.files.length;
    if (existingGroup.filesClose !== undefined) {
      const close = closeLineInfo(project.text, existingGroup.filesClose);
      const fileIndent = close.indent + project.indentUnit;
      const lines: string[] = [];
      for (const file of group.files) {
        lines.push(...fileBlock(file, fileIndent, project.indentUnit));
      }
      if (existingGroup.filesIsSelfClosing) {
        insertions.push(
          buildSelfClosingReplacement(
            existingGroup.filesClose,
            close,
            project.eol,
            lines,
            project.text,
            'Files',
          ),
        );
      } else {
        insertions.push(
          buildInsertion(existingGroup.filesClose, close, project.eol, lines),
        );
      }
    } else {
      const close = closeLineInfo(project.text, existingGroup.groupClose);
      const filesIndent = close.indent + project.indentUnit;
      insertions.push(
        buildInsertion(
          existingGroup.groupClose,
          close,
          project.eol,
          filesBlock(group.files, filesIndent, project.indentUnit),
        ),
      );
    }
  }

  if (newGroups.length > 0) {
    if (target.groupsClose !== undefined) {
      const close = closeLineInfo(project.text, target.groupsClose);
      const groupIndent = close.indent + project.indentUnit;
      const lines: string[] = [];
      for (const group of newGroups) {
        lines.push(...groupBlock(group, groupIndent, project.indentUnit));
      }
      if (target.groupsIsSelfClosing) {
        insertions.push(
          buildSelfClosingReplacement(
            target.groupsClose,
            close,
            project.eol,
            lines,
            project.text,
            'Groups',
          ),
        );
      } else {
        insertions.push(buildInsertion(target.groupsClose, close, project.eol, lines));
      }
    } else {
      const close = closeLineInfo(project.text, target.targetClose);
      const groupsIndent = close.indent + project.indentUnit;
      const groupIndent = groupsIndent + project.indentUnit;
      const lines = [`${groupsIndent}<Groups>`];
      for (const group of newGroups) {
        lines.push(...groupBlock(group, groupIndent, project.indentUnit));
      }
      lines.push(`${groupsIndent}</Groups>`);
      insertions.push(buildInsertion(target.targetClose, close, project.eol, lines));
    }
  }

  const text = applyInsertions(project.text, insertions);
  const result: AddFilesResult = {
    text,
    insertions: [...insertions].sort((a, b) => a.offset - b.offset),
    groupsCreated,
    filesAdded,
  };
  validateAddFilesResult(project, result, request);
  return result;
}
