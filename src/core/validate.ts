import { KeilProjectError } from './errors';
import type { AddFilesRequest, AddFilesResult, ProjectDocument } from './model';
import { findGroup, findTarget, parseProject } from './parseProject';
import { canonicalFileKey } from './paths';

function fileKey(project: ProjectDocument, filePath: string): string {
  return canonicalFileKey(project.path, filePath);
}

function countTargetFileKey(
  project: ProjectDocument,
  targetName: string,
  expectedKey: string,
): number {
  const target = findTarget(project, targetName);
  if (!target) {
    return 0;
  }
  let count = 0;
  for (const group of target.groups) {
    for (const file of group.files) {
      if (file.path.length > 0 && fileKey(project, file.path) === expectedKey) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Validates the generated text after an in-memory insertion. The original file
 * entries must all still exist, the expected additions must be present, and no
 * duplicate paths may appear in the selected target.
 */
export function validateAddFilesResult(
  original: ProjectDocument,
  result: AddFilesResult,
  request: AddFilesRequest,
): void {
  let updated: ProjectDocument;
  try {
    updated = parseProject(result.text, original.path, original.charset);
  } catch (error) {
    throw new KeilProjectError(
      'validation',
      `生成的工程文件无法重新解析：${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  if (updated.eol !== original.eol) {
    throw new KeilProjectError('validation', '生成的工程文件换行符发生变化。');
  }

  for (const originalTarget of original.targets) {
    const updatedTarget = findTarget(updated, originalTarget.name);
    if (!updatedTarget) {
      throw new KeilProjectError(
        'validation',
        `生成结果丢失了 Target "${originalTarget.name}"。`,
      );
    }
    for (const originalGroup of originalTarget.groups) {
      const matchingGroups = updatedTarget.groups.filter(
        (group) => group.name === originalGroup.name,
      );
      for (const originalFile of originalGroup.files) {
        if (originalFile.path.length === 0) {
          continue;
        }
        const key = fileKey(original, originalFile.path);
        const stillPresent = matchingGroups.some((group) =>
          group.files.some(
            (file) => file.path.length > 0 && fileKey(updated, file.path) === key,
          ),
        );
        if (!stillPresent) {
          throw new KeilProjectError(
            'validation',
            `生成结果丢失了原有文件条目：${originalFile.path}`,
          );
        }
      }
    }
  }

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
  if (updatedCount !== originalCount + result.filesAdded) {
    throw new KeilProjectError(
      'validation',
      `生成结果的文件条目数量不正确（期望 ${originalCount + result.filesAdded}，实际 ${updatedCount}）。`,
    );
  }

  const target = findTarget(updated, request.targetName);
  if (!target) {
    throw new KeilProjectError(
      'validation',
      `生成结果中缺少 Target "${request.targetName}"。`,
    );
  }

  for (const requestedGroup of request.groups) {
    const group = findGroup(target, requestedGroup.groupName);
    if (!group) {
      throw new KeilProjectError(
        'validation',
        `生成结果中缺少 Group "${requestedGroup.groupName}"。`,
      );
    }
    if (requestedGroup.files.length === 0) {
      continue;
    }
    for (const file of requestedGroup.files) {
      const expectedKey = fileKey(original, file.path);
      const found = target.groups.some((candidate) =>
        candidate.files.some(
          (candidateFile) =>
            candidateFile.path.length > 0 &&
            fileKey(updated, candidateFile.path) === expectedKey,
        ),
      );
      if (!found) {
        throw new KeilProjectError(
          'validation',
          `生成结果中缺少文件 "${file.fileName}"。`,
        );
      }
      if (
        !group.files.some(
          (candidateFile) =>
            candidateFile.path.length > 0 &&
            fileKey(updated, candidateFile.path) === expectedKey,
        )
      ) {
        throw new KeilProjectError(
          'validation',
          `文件 "${file.fileName}" 未进入 Group "${requestedGroup.groupName}"。`,
        );
      }
      const before = countTargetFileKey(original, request.targetName, expectedKey);
      const after = countTargetFileKey(updated, request.targetName, expectedKey);
      if (after !== before + 1) {
        throw new KeilProjectError(
          'validation',
          `文件 "${file.fileName}" 的工程条目数量不正确（${before} → ${after}）。`,
        );
      }
    }
  }
}

/** Checks the text read back from disk after a write. */
export function validateWrittenText(writtenText: string, expected: AddFilesResult): void {
  if (writtenText !== expected.text) {
    throw new KeilProjectError('validation', '写回后的工程文件内容与预期不一致。');
  }
}
