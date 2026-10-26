import { SaxesParser } from 'saxes';

import { KeilProjectError } from './errors';
import type {
  Eol,
  FileNode,
  GroupNode,
  ProjectCharset,
  ProjectDocument,
  TargetNode,
} from './model';

interface ElementFrame {
  name: string;
  selfClosing: boolean;
}

interface MutableFile {
  name: string;
  fileType: number;
  path: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectEol(text: string): Eol {
  const newline = text.indexOf('\n');
  if (newline > 0 && text[newline - 1] === '\r') {
    return '\r\n';
  }
  return '\n';
}

function detectIndentUnit(text: string): string {
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['Target', 'TargetName'],
    ['Group', 'GroupName'],
    ['Files', 'File'],
    ['File', 'FileName'],
  ];

  for (const [parent, child] of pairs) {
    const parentMatch = new RegExp(`\\n([ \\t]*)<${parent}(?:\\s|>)`).exec(text);
    const childMatch = new RegExp(`\\n([ \\t]*)<${child}(?:\\s|>)`).exec(text);
    if (!parentMatch || !childMatch) {
      continue;
    }
    const parentIndent = parentMatch[1];
    const childIndent = childMatch[1];
    if (
      childIndent.length > parentIndent.length &&
      childIndent.startsWith(parentIndent)
    ) {
      return childIndent.slice(parentIndent.length);
    }
  }

  const indents = new Set<string>();
  const indentPattern = /\n([ \t]+)</g;
  let match: RegExpExecArray | null;
  while ((match = indentPattern.exec(text)) !== null) {
    indents.add(match[1]);
  }
  const ordered = [...indents].sort((a, b) => a.length - b.length);
  for (let i = 1; i < ordered.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (ordered[i].length > ordered[j].length && ordered[i].startsWith(ordered[j])) {
        return ordered[i].slice(ordered[j].length);
      }
    }
  }
  return '  ';
}

function findCloseTagStart(text: string, position: number, tagName: string): number {
  const escaped = escapeRegExp(tagName);
  const closePattern = new RegExp(`^<\\/\\s*${escaped}\\s*>$`);
  for (
    let candidate = text.lastIndexOf('</', position - 1);
    candidate >= 0;
    candidate = text.lastIndexOf('</', candidate - 1)
  ) {
    if (closePattern.test(text.slice(candidate, position))) {
      return candidate;
    }
  }
  throw new KeilProjectError('parse', `无法定位 </${tagName}> 的字符位置。`);
}

/**
 * Parses a `.uvprojx` document and records the positions needed for minimal
 * text insertions. The parser never attempts to repair malformed XML.
 */
export function parseProject(
  sourceText: string,
  projectPath: string,
  charset: ProjectCharset = 'utf8',
): ProjectDocument {
  const text = sourceText.startsWith('\uFEFF') ? sourceText.slice(1) : sourceText;
  const eol = detectEol(text);
  const indentUnit = detectIndentUnit(text);

  const targets: TargetNode[] = [];
  const frames: ElementFrame[] = [];
  let currentTarget: TargetNode | undefined;
  let currentGroup: GroupNode | undefined;
  let currentFile: MutableFile | undefined;
  let currentFileField: 'name' | 'fileType' | 'path' | null = null;
  let fileTypeText = '';
  let targetName: string | undefined;
  let groupName: string | undefined;
  let parsingError: Error | undefined;

  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', (error) => {
    parsingError = error;
  });

  const isSelfClosingAt = (position: number): boolean => {
    let index = position - 2;
    while (index >= 0 && /\s/.test(text[index])) {
      index -= 1;
    }
    return text[index] === '/';
  };

  parser.on('opentag', (tag) => {
    const selfClosing = isSelfClosingAt(parser.position);
    frames.push({ name: tag.name, selfClosing });

    if (tag.name === 'Target') {
      currentTarget = {
        name: '',
        groups: [],
        targetClose: -1,
      };
      currentGroup = undefined;
      currentFile = undefined;
      targetName = undefined;
    } else if (tag.name === 'TargetName' && currentTarget) {
      targetName = '';
    } else if (tag.name === 'Group' && currentTarget) {
      currentGroup = {
        name: '',
        files: [],
        groupClose: -1,
      };
      currentFile = undefined;
      groupName = undefined;
    } else if (tag.name === 'GroupName' && currentGroup) {
      groupName = '';
    } else if (tag.name === 'File' && currentGroup) {
      currentFile = { name: '', fileType: 5, path: '' };
      currentFileField = null;
    } else if (tag.name === 'FileName' && currentFile) {
      currentFileField = 'name';
    } else if (tag.name === 'FileType' && currentFile) {
      currentFileField = 'fileType';
    } else if (tag.name === 'FilePath' && currentFile) {
      currentFileField = 'path';
    }
  });

  parser.on('text', (value) => {
    if (targetName !== undefined && currentTarget && !currentGroup) {
      targetName += value;
    }
    if (groupName !== undefined && currentGroup) {
      groupName += value;
    }
    if (currentFile && currentFileField === 'name') {
      currentFile.name += value;
    } else if (currentFile && currentFileField === 'fileType') {
      fileTypeText += value;
    } else if (currentFile && currentFileField === 'path') {
      currentFile.path += value;
    }
  });

  parser.on('cdata', (value) => {
    if (targetName !== undefined && currentTarget && !currentGroup) {
      targetName += value;
    }
    if (groupName !== undefined && currentGroup) {
      groupName += value;
    }
    if (currentFile && currentFileField === 'name') {
      currentFile.name += value;
    } else if (currentFile && currentFileField === 'fileType') {
      fileTypeText += value;
    } else if (currentFile && currentFileField === 'path') {
      currentFile.path += value;
    }
  });

  parser.on('closetag', (tag) => {
    const frame = frames.pop();
    const closeStart =
      frame && !frame.selfClosing
        ? findCloseTagStart(text, parser.position, tag.name)
        : -1;

    if (tag.name === 'FileName' && currentFile) {
      currentFileField = null;
    } else if (tag.name === 'FileType' && currentFile) {
      const parsed = Number.parseInt(fileTypeText.trim(), 10);
      currentFile.fileType = Number.isFinite(parsed) ? parsed : 5;
      fileTypeText = '';
      currentFileField = null;
    } else if (tag.name === 'FilePath' && currentFile) {
      currentFileField = null;
    } else if (tag.name === 'TargetName' && currentTarget) {
      currentTarget.name = (targetName ?? '').trim();
      targetName = undefined;
    } else if (tag.name === 'GroupName' && currentGroup) {
      currentGroup.name = (groupName ?? '').trim();
      groupName = undefined;
    } else if (tag.name === 'File' && currentFile && currentGroup) {
      currentGroup.files.push({
        name: currentFile.name.trim(),
        fileType: currentFile.fileType,
        path: currentFile.path.trim(),
      } satisfies FileNode);
      currentFile = undefined;
      currentFileField = null;
      fileTypeText = '';
    } else if (tag.name === 'Files' && currentGroup) {
      currentGroup.filesClose = closeStart >= 0 ? closeStart : undefined;
    } else if (tag.name === 'Group' && currentGroup && currentTarget) {
      currentGroup.groupClose = closeStart;
      if (currentGroup.name.length === 0) {
        currentGroup.name = `Group ${currentTarget.groups.length + 1}`;
      }
      currentTarget.groups.push(currentGroup);
      currentGroup = undefined;
    } else if (tag.name === 'Groups' && currentTarget) {
      currentTarget.groupsClose = closeStart >= 0 ? closeStart : undefined;
    } else if (tag.name === 'Target' && currentTarget) {
      currentTarget.targetClose = closeStart;
      if (currentTarget.name.length === 0) {
        currentTarget.name = `Target ${targets.length + 1}`;
      }
      targets.push(currentTarget);
      currentTarget = undefined;
    }

    if (tag.name === 'Target') {
      currentGroup = undefined;
      currentFile = undefined;
    }
  });

  try {
    parser.write(text).close();
  } catch (error) {
    throw new KeilProjectError(
      'parse',
      `工程文件 XML 解析失败：${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  if (parsingError) {
    throw new KeilProjectError(
      'parse',
      `工程文件 XML 解析失败：${parsingError.message}`,
      parsingError,
    );
  }

  if (targets.length === 0) {
    throw new KeilProjectError('invalid-project', '工程文件中没有找到任何 Target。');
  }

  for (const target of targets) {
    if (target.targetClose < 0) {
      throw new KeilProjectError(
        'invalid-project',
        `Target "${target.name}" 缺少结束标签。`,
      );
    }
    for (const group of target.groups) {
      if (group.groupClose < 0) {
        throw new KeilProjectError(
          'invalid-project',
          `Group "${group.name}" 缺少结束标签。`,
        );
      }
    }
  }

  return {
    path: projectPath,
    text,
    charset,
    eol,
    indentUnit,
    targets,
  };
}

export function findTarget(
  project: ProjectDocument,
  targetName: string,
): TargetNode | undefined {
  return project.targets.find((target) => target.name === targetName);
}

export function findGroup(target: TargetNode, groupName: string): GroupNode | undefined {
  return target.groups.find((group) => group.name === groupName);
}
