import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { addFiles } from '../core/addFiles';
import { KeilProjectError } from '../core/errors';
import { fileTypeForPath } from '../core/fileTypes';
import { findTarget } from '../core/parseProject';
import { resolveProjectEntryPath, toKeilPath, validateFileName } from '../core/paths';
import { renderSourceTemplate, type TemplateKind } from '../core/templates';
import { t } from '../i18n';
import {
  chooseSourceEncoding,
  projectDirectoryUri,
  ProjectSession,
  targetFileKeys,
  type CommandDependencies,
} from './common';

interface FileNameChoice {
  fileName: string;
  filePath: string;
}

async function chooseFileName(
  deps: CommandDependencies,
  projectPath: string,
  directoryPath: string,
  extension: '.c' | '.h',
  existingKeys: Set<string>,
): Promise<FileNameChoice | undefined> {
  for (;;) {
    const input = await deps.ui.inputFileName(extension);
    if (input === undefined) {
      return undefined;
    }
    const validation = validateFileName(input, extension);
    if (!validation.name) {
      deps.ui.showError(validation.error ?? t.commands.noFileName);
      continue;
    }
    const fileName = validation.name;
    const filePath = path.win32.join(directoryPath, fileName);

    const key = resolveProjectEntryPath(projectPath, filePath).toLowerCase();
    if (existingKeys.has(key)) {
      deps.ui.showError(t.commands.duplicateTargetFile(fileName));
      continue;
    }
    try {
      await fs.stat(filePath);
      deps.ui.showError(t.commands.fileExists(filePath));
      continue;
    } catch {
      // The file does not exist; this is the expected case.
    }
    return { fileName, filePath };
  }
}

export async function addNewFile(
  deps: CommandDependencies,
  kind: TemplateKind,
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
  const directoryUri = await deps.ui.pickDirectory(
    vscode.Uri.file(defaultDirectory),
    projectDirectoryUri(project),
  );
  if (!directoryUri) {
    return;
  }
  let directoryStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    directoryStat = await fs.stat(directoryUri.fsPath);
  } catch (error) {
    throw new KeilProjectError(
      'io',
      t.commands.directoryMissing(directoryUri.fsPath),
      error,
    );
  }
  if (!directoryStat.isDirectory()) {
    throw new KeilProjectError(
      'io',
      t.commands.directoryNotDirectory(directoryUri.fsPath),
    );
  }

  const extension = kind === 'c' ? '.c' : '.h';
  const fileChoice = await chooseFileName(
    deps,
    project.path,
    directoryUri.fsPath,
    extension,
    targetFileKeys(project, target),
  );
  if (!fileChoice) {
    return;
  }

  const keilPathInfo = toKeilPath(project.path, fileChoice.filePath);
  if (keilPathInfo.differentDrive) {
    deps.ui.showWarning(t.commands.differentDrive);
  } else if (keilPathInfo.outsideProject) {
    deps.ui.showWarning(t.commands.outsideProject);
  }

  const charset = await chooseSourceEncoding(
    deps,
    project,
    target,
    groupName,
    directoryUri.fsPath,
  );
  if (!charset) {
    return;
  }

  const fileType = fileTypeForPath(fileChoice.filePath);
  if (fileType === undefined) {
    throw new KeilProjectError(
      'unsupported-file',
      t.commands.unsupportedFile(fileChoice.fileName),
    );
  }

  const template = renderSourceTemplate({
    kind,
    fileName: fileChoice.fileName,
    eol: project.eol,
    customTemplate: deps.config.getTemplate(kind),
  });

  const result = addFiles(project, {
    targetName,
    groups: [
      {
        groupName,
        files: [
          {
            fileName: fileChoice.fileName,
            path: keilPathInfo.path,
            fileType,
          },
        ],
      },
    ],
  });

  const created = await deps.sourceFiles.createFile(
    fileChoice.filePath,
    template,
    charset,
  );

  try {
    await deps.writer.write(snapshot, result, deps.config.getBackupProjectFile());
  } catch (error) {
    const deleted = await deps.sourceFiles.deleteCreatedFile(
      fileChoice.filePath,
      created.bytes,
    );
    if (!deleted) {
      deps.ui.showWarning(t.commands.deleteAfterFailure(fileChoice.filePath));
    }
    throw error;
  }

  const headerNote = kind === 'h' ? t.commands.headerNotIncluded : '';
  deps.ui.showInfo(
    t.commands.createdFile(fileChoice.fileName, targetName, groupName, headerNote),
  );

  const autoOpen = deps.config.getAutoOpenNewFile();
  const shouldOpen =
    autoOpen === 'always' || (autoOpen === 'utf8-only' && charset === 'utf8');
  if (shouldOpen) {
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(fileChoice.filePath), {
        preview: false,
      });
    } catch (error) {
      deps.ui.showWarning(
        t.commands.autoOpenFailed(error instanceof Error ? error.message : String(error)),
      );
    }
    if (charset !== 'utf8') {
      deps.ui.showWarning(t.commands.gbAutoOpenWarning);
    }
  } else if (charset !== 'utf8') {
    deps.ui.showInfo(t.commands.gbClosedInfo);
  }
}
