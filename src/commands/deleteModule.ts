import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

import { KeilProjectError } from '../core/errors';
import type { ProjectDocument } from '../core/model';
import { isPathInsideDirectory, resolveProjectEntryPath } from '../core/paths';
import { removeFilesInDirectory } from '../core/removeFiles';
import { t } from '../i18n';
import type { ModuleDeleteCandidate } from '../adapters/ui';
import {
  ensureExistingDirectory,
  ProjectSession,
  type CommandDependencies,
} from './common';

function collectModuleCandidates(project: ProjectDocument): ModuleDeleteCandidate[] {
  const markers = new Map<string, { directoryPath: string; moduleName: string }>();
  for (const target of project.targets) {
    for (const group of target.groups) {
      for (const file of group.files) {
        if (file.path.length === 0) {
          continue;
        }
        const absolutePath = resolveProjectEntryPath(project.path, file.path);
        const directoryPath = path.win32.dirname(absolutePath);
        const folderName = path.win32.basename(directoryPath);
        const stem = path.win32.basename(absolutePath, path.win32.extname(absolutePath));
        if (folderName.length > 0 && stem.toLowerCase() === folderName.toLowerCase()) {
          markers.set(directoryPath.toLowerCase(), {
            directoryPath,
            moduleName: folderName,
          });
        }
      }
    }
  }

  return [...markers.values()]
    .map((marker) => {
      const targetNames = new Set<string>();
      const groupNames = new Set<string>();
      let fileCount = 0;
      for (const target of project.targets) {
        for (const group of target.groups) {
          for (const file of group.files) {
            if (file.path.length === 0) {
              continue;
            }
            const absolutePath = resolveProjectEntryPath(project.path, file.path);
            if (isPathInsideDirectory(marker.directoryPath, absolutePath)) {
              targetNames.add(target.name);
              groupNames.add(group.name);
              fileCount += 1;
            }
          }
        }
      }
      return {
        directoryPath: marker.directoryPath,
        moduleName: marker.moduleName,
        targetNames: [...targetNames].sort(),
        groupNames: [...groupNames].sort(),
        fileCount,
      };
    })
    .sort((a, b) => a.moduleName.localeCompare(b.moduleName));
}

async function validateModuleDirectory(
  project: ProjectDocument,
  directoryPath: string,
): Promise<void> {
  await ensureExistingDirectory(directoryPath);
  if (isPathInsideDirectory(directoryPath, project.path)) {
    throw new KeilProjectError(
      'invalid-project',
      t.module.deleteUnsafeFolder(directoryPath),
    );
  }

  const folderName = path.win32.basename(directoryPath);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    throw new KeilProjectError('io', `读取模块文件夹失败：${directoryPath}`, error);
  }
  const expected = new Set([
    `${folderName}.c`.toLowerCase(),
    `${folderName}.h`.toLowerCase(),
  ]);
  const isModule = entries.some(
    (entry) => entry.isFile() && expected.has(entry.name.toLowerCase()),
  );
  if (!isModule) {
    throw new KeilProjectError(
      'validation',
      t.module.deleteNotModuleFolder(directoryPath),
    );
  }
}

export async function deleteModule(deps: CommandDependencies): Promise<void> {
  const session = new ProjectSession(deps);
  const snapshot = await session.resolveProject();
  if (!snapshot) {
    return;
  }
  const project = snapshot.document;

  const candidates = collectModuleCandidates(project);
  const selected = await deps.ui.pickModuleToDelete(
    candidates,
    session.projectRoot(project),
  );
  if (!selected) {
    return;
  }

  const moduleDirectory = path.resolve(selected);
  await validateModuleDirectory(project, moduleDirectory);
  const files = await deps.sourceFiles.listFilesRecursive(moduleDirectory);
  if (files.length === 0) {
    throw new KeilProjectError('io', `模块文件夹为空：${moduleDirectory}`);
  }

  const removal = removeFilesInDirectory(project, moduleDirectory);
  const confirmed = await deps.ui.confirmDeleteModule({
    moduleName: path.win32.basename(moduleDirectory),
    directoryPath: moduleDirectory,
    files: files.map((file) => path.relative(moduleDirectory, file)),
    entries: removal.entries,
  });
  if (!confirmed) {
    return;
  }

  if (removal.filesRemoved > 0) {
    await deps.writer.write(snapshot, removal, deps.config.getBackupProjectFile());
  }

  try {
    await deps.sourceFiles.deleteDirectory(moduleDirectory);
  } catch (error) {
    throw new KeilProjectError(
      'io',
      t.module.deleteFolderFailed(
        moduleDirectory,
        error instanceof Error ? error.message : String(error),
      ),
      error,
    );
  }

  deps.ui.showInfo(
    t.module.deleted(
      path.win32.basename(moduleDirectory),
      files.length,
      removal.filesRemoved,
    ),
  );
}
