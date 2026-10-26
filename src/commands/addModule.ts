import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { addFiles } from '../core/addFiles';
import { KeilProjectError } from '../core/errors';
import type { ProjectDocument, TargetNode } from '../core/model';
import {
  moduleFileSet,
  renderModuleHeader,
  renderModuleSource,
  validateModuleName,
} from '../core/moduleTemplates';
import { findTarget } from '../core/parseProject';
import { overallProjectRoot, resolveProjectEntryPath, toKeilPath } from '../core/paths';
import { t } from '../i18n';
import {
  chooseSourceEncoding,
  ProjectSession,
  targetFileKeys,
  type CommandDependencies,
} from './common';
import type { CreatedSourceFile } from '../adapters/sourceFiles';

function moduleRootForProject(projectPath: string): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(projectPath),
  );
  return overallProjectRoot(projectPath, workspaceFolder?.uri.fsPath);
}

async function ensureDirectory(directoryUri: vscode.Uri): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(directoryUri.fsPath);
  } catch (error) {
    throw new KeilProjectError(
      'io',
      t.commands.directoryMissing(directoryUri.fsPath),
      error,
    );
  }
  if (!stat.isDirectory()) {
    throw new KeilProjectError(
      'io',
      t.commands.directoryNotDirectory(directoryUri.fsPath),
    );
  }
}

async function chooseModuleName(
  deps: CommandDependencies,
  project: ProjectDocument,
  target: TargetNode,
  parentDirectory: string,
): Promise<string | undefined> {
  const existingKeys = targetFileKeys(project, target);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const input = await deps.ui.inputModuleName();
    if (input === undefined) {
      return undefined;
    }
    const validation = validateModuleName(input);
    if (!validation.name) {
      deps.ui.showError(validation.error ?? t.commands.noFileName);
      continue;
    }

    const fileSet = moduleFileSet(validation.name);
    const moduleDirectory = path.win32.join(parentDirectory, fileSet.folderName);
    const sourcePath = path.win32.join(moduleDirectory, fileSet.sourceFileName);
    const sourceKey = resolveProjectEntryPath(project.path, sourcePath).toLowerCase();
    if (existingKeys.has(sourceKey)) {
      deps.ui.showError(t.module.duplicateSource(fileSet.sourceFileName));
      continue;
    }

    try {
      await fs.stat(moduleDirectory);
      deps.ui.showError(t.module.folderExists(moduleDirectory));
      continue;
    } catch {
      // The module folder should not exist yet.
    }

    return fileSet.moduleName;
  }
  return undefined;
}

async function cleanupModule(
  deps: CommandDependencies,
  directoryPath: string,
  files: Array<{ path: string; bytes: Buffer }>,
): Promise<boolean> {
  let complete = true;
  for (const file of files) {
    const deleted = await deps.sourceFiles.deleteCreatedFile(file.path, file.bytes);
    if (!deleted) {
      complete = false;
    }
  }
  const directoryRemoved = await deps.sourceFiles.removeDirectoryIfEmpty(directoryPath);
  return complete && directoryRemoved;
}

export async function addModule(
  deps: CommandDependencies,
  contextUri?: vscode.Uri,
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

  // Keil Group and the module's disk folder are chosen independently.
  const groupName = await session.pickGroup(target);
  if (!groupName) {
    return;
  }

  const defaultDirectory = await session.defaultDirectory(
    project,
    target,
    groupName,
    contextUri,
  );
  const moduleRoot = moduleRootForProject(project.path);
  const parentDirectoryUri = await deps.ui.pickDirectory(
    vscode.Uri.file(defaultDirectory),
    vscode.Uri.file(moduleRoot),
    'module',
  );
  if (!parentDirectoryUri) {
    return;
  }
  await ensureDirectory(parentDirectoryUri);

  const moduleName = await chooseModuleName(
    deps,
    project,
    target,
    parentDirectoryUri.fsPath,
  );
  if (!moduleName) {
    return;
  }
  const fileSet = moduleFileSet(moduleName);
  const moduleDirectory = path.win32.join(parentDirectoryUri.fsPath, fileSet.folderName);
  const headerPath = path.win32.join(moduleDirectory, fileSet.headerFileName);
  const sourcePath = path.win32.join(moduleDirectory, fileSet.sourceFileName);

  const charset = await chooseSourceEncoding(
    deps,
    project,
    target,
    groupName,
    parentDirectoryUri.fsPath,
  );
  if (!charset) {
    return;
  }

  const headerText = renderModuleHeader(moduleName, project.eol);
  const sourceText = renderModuleSource(moduleName, project.eol);
  const keilPathInfo = toKeilPath(project.path, sourcePath);
  if (keilPathInfo.differentDrive) {
    deps.ui.showWarning(t.module.differentDriveWarning(sourcePath));
  } else if (keilPathInfo.outsideProject) {
    deps.ui.showWarning(t.module.outsideProjectWarning(sourcePath));
  }
  const result = addFiles(project, {
    targetName,
    groups: [
      {
        groupName,
        files: [
          {
            fileName: fileSet.sourceFileName,
            path: keilPathInfo.path,
            fileType: 1,
          },
        ],
      },
    ],
  });

  await deps.sourceFiles.createDirectory(moduleDirectory);
  let headerFile: CreatedSourceFile | undefined;
  let sourceFile: CreatedSourceFile | undefined;
  try {
    headerFile = await deps.sourceFiles.createFile(headerPath, headerText, charset);
    sourceFile = await deps.sourceFiles.createFile(sourcePath, sourceText, charset);
  } catch (error) {
    const created = [
      ...(headerFile ? [{ path: headerPath, bytes: headerFile.bytes }] : []),
      ...(sourceFile ? [{ path: sourcePath, bytes: sourceFile.bytes }] : []),
    ];
    const cleaned = await cleanupModule(deps, moduleDirectory, created);
    if (!cleaned) {
      deps.ui.showWarning(t.module.rollbackIncomplete(moduleDirectory));
    }
    throw error;
  }
  if (!headerFile || !sourceFile) {
    throw new KeilProjectError('io', t.module.internalState);
  }

  try {
    await deps.writer.write(snapshot, result, deps.config.getBackupProjectFile());
  } catch (error) {
    const cleaned = await cleanupModule(deps, moduleDirectory, [
      { path: sourcePath, bytes: sourceFile.bytes },
      { path: headerPath, bytes: headerFile.bytes },
    ]);
    if (!cleaned) {
      deps.ui.showWarning(t.module.rollbackIncomplete(moduleDirectory));
    }
    throw error;
  }

  deps.ui.showInfo(t.module.created(moduleName, targetName, groupName, moduleDirectory));

  const autoOpen = deps.config.getAutoOpenNewFile();
  const shouldOpen =
    autoOpen === 'always' || (autoOpen === 'utf8-only' && charset === 'utf8');
  if (shouldOpen) {
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(sourcePath), {
        preview: false,
      });
    } catch (error) {
      deps.ui.showWarning(
        t.module.autoOpenFailed(error instanceof Error ? error.message : String(error)),
      );
    }
    if (charset !== 'utf8') {
      deps.ui.showWarning(t.commands.gbAutoOpenWarning);
    }
  } else if (charset !== 'utf8') {
    deps.ui.showInfo(t.commands.gbClosedInfo);
  }
}
