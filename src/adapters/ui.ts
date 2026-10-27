import * as path from 'node:path';
import * as vscode from 'vscode';

import type {
  EncodingRecommendation,
  RemovedFileEntry,
  SourceCharset,
} from '../core/model';
import { validateModuleName } from '../core/moduleTemplates';
import { encodingCountsLabel } from '../core/sourceEncoding';
import { t } from '../i18n';

export type GroupPick = { kind: 'existing'; name: string } | { kind: 'create' };

export interface AddPreview {
  targetName: string;
  groupName: string;
  files: Array<{ fileName: string; path: string }>;
  skipped: Array<{ fileName: string; reason: string }>;
  warnings: string[];
}

export interface ModuleDeleteCandidate {
  directoryPath: string;
  moduleName: string;
  targetNames: string[];
  groupNames: string[];
  fileCount: number;
}

export interface DeleteModulePreview {
  moduleName: string;
  directoryPath: string;
  /** Paths relative to the module directory. */
  files: string[];
  entries: RemovedFileEntry[];
}

export interface UiPort {
  pickProject(paths: string[], allowBrowse: boolean): Promise<string | undefined>;
  pickProjectFile(): Promise<string | undefined>;
  pickExistingFiles(): Promise<vscode.Uri[] | undefined>;
  pickTarget(targetNames: string[], lastTarget?: string): Promise<string | undefined>;
  pickGroup(groupNames: string[], targetName: string): Promise<GroupPick | undefined>;
  inputGroupName(
    existingNames: string[],
    targetName: string,
  ): Promise<string | undefined>;
  pickDirectory(
    defaultDirectory: vscode.Uri,
    projectDirectory: vscode.Uri,
    mode?: 'file' | 'module',
  ): Promise<vscode.Uri | undefined>;
  pickProjectRoot(
    currentRoot: string | undefined,
    inferredRoot: string,
  ): Promise<string | null | undefined>;
  pickModuleToDelete(
    candidates: ModuleDeleteCandidate[],
    defaultDirectory: string,
  ): Promise<string | undefined>;
  confirmDeleteModule(preview: DeleteModulePreview): Promise<boolean>;
  inputFileName(extension: '.c' | '.h'): Promise<string | undefined>;
  inputModuleName(): Promise<string | undefined>;
  pickEncoding(
    recommendation: EncodingRecommendation,
    directoryPath: string,
  ): Promise<SourceCharset | undefined>;
  confirmAddFiles(preview: AddPreview): Promise<boolean>;
  showInfo(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
}

interface ProjectItem extends vscode.QuickPickItem {
  projectPath?: string;
  browse?: boolean;
}

interface GroupItem extends vscode.QuickPickItem {
  groupName?: string;
  create?: boolean;
}

interface DirectoryItem extends vscode.QuickPickItem {
  directory?: vscode.Uri;
  browse?: boolean;
}

interface ProjectRootItem extends vscode.QuickPickItem {
  action?: 'choose' | 'auto';
}

interface ModuleDeleteItem extends vscode.QuickPickItem {
  directoryPath?: string;
  browse?: boolean;
}

interface EncodingItem extends vscode.QuickPickItem {
  charset?: SourceCharset;
}

function relativeProjectLabel(projectPath: string): string {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const relative = path.relative(folder.uri.fsPath, projectPath);
    if (relative.length > 0 && !relative.startsWith('..')) {
      return relative.replace(/\\/g, '/');
    }
  }
  return projectPath;
}

function recommendationSourceLabel(recommendation: EncodingRecommendation): string {
  if (recommendation.fromMemory) {
    return t.encoding.remembered;
  }
  switch (recommendation.source) {
    case 'setting':
      return t.encoding.sourceSetting;
    case 'folder':
      return t.encoding.sourceFolder;
    case 'group':
      return t.encoding.sourceGroup;
    case 'project':
      return t.encoding.sourceProject;
    case 'ask':
      return recommendation.ambiguous ? t.encoding.sourceMixed : t.encoding.sourceAsk;
  }
}

export class VSCodeUi implements UiPort {
  public async pickProject(
    paths: string[],
    allowBrowse: boolean,
  ): Promise<string | undefined> {
    const items: ProjectItem[] = paths.map((projectPath) => ({
      label: relativeProjectLabel(projectPath),
      description: path.dirname(projectPath),
      projectPath,
    }));
    if (allowBrowse) {
      items.push({
        label: t.project.browse,
        browse: true,
      });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: t.project.pickTitle,
      placeHolder: t.project.pickPlaceholder,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.browse) {
      return this.pickProjectFile();
    }
    return picked.projectPath;
  }

  public async pickProjectFile(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      title: t.project.fileDialogTitle,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { [t.project.fileFilter]: ['uvprojx'] },
    });
    return picked?.[0]?.fsPath;
  }

  public async pickExistingFiles(): Promise<vscode.Uri[] | undefined> {
    return vscode.window.showOpenDialog({
      title: t.project.existingFilesDialogTitle,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: {
        [t.project.sourceFilesFilter]: ['c', 'h', 'cpp', 's', 'asm', 'lib', 'txt'],
        [t.project.allFilesFilter]: ['*'],
      },
    });
  }

  public async pickTarget(
    targetNames: string[],
    lastTarget?: string,
  ): Promise<string | undefined> {
    if (targetNames.length === 1) {
      return targetNames[0];
    }
    const ordered = [
      ...targetNames.filter((name) => name === lastTarget),
      ...targetNames.filter((name) => name !== lastTarget),
    ];
    const items: vscode.QuickPickItem[] = ordered.map((name) => ({
      label: name,
      description: name === lastTarget ? t.target.lastUsed : undefined,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: t.target.pickTitle,
      placeHolder: t.target.pickPlaceholder,
      ignoreFocusOut: true,
    });
    return picked?.label;
  }

  public async pickGroup(
    groupNames: string[],
    targetName: string,
  ): Promise<GroupPick | undefined> {
    const items: GroupItem[] = [
      ...groupNames.map((name) => ({ label: name, groupName: name })),
      {
        label: t.group.createLabel,
        description: t.group.createDescription(targetName),
        create: true,
      },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t.group.pickTitle(targetName),
      placeHolder: t.group.pickPlaceholder,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.create) {
      return { kind: 'create' };
    }
    return picked.groupName ? { kind: 'existing', name: picked.groupName } : undefined;
  }

  public async inputGroupName(
    existingNames: string[],
    targetName: string,
  ): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({
      title: t.group.inputTitle(targetName),
      prompt: t.group.inputPrompt,
      placeHolder: t.group.inputPlaceholder,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return t.group.emptyError;
        }
        if (/[\u0000-\u001f]/.test(trimmed)) {
          return t.group.controlError;
        }
        if (existingNames.includes(trimmed)) {
          return t.group.existsError(trimmed);
        }
        return undefined;
      },
    });
    return name?.trim();
  }

  public async pickDirectory(
    defaultDirectory: vscode.Uri,
    projectDirectory: vscode.Uri,
    mode: 'file' | 'module' = 'file',
  ): Promise<vscode.Uri | undefined> {
    const moduleMode = mode === 'module';
    const items: DirectoryItem[] = [
      {
        label: t.directory.defaultLabel,
        description: defaultDirectory.fsPath,
        detail: moduleMode ? t.directory.moduleDefaultDetail : t.directory.defaultDetail,
        directory: defaultDirectory,
      },
    ];
    if (defaultDirectory.fsPath.toLowerCase() !== projectDirectory.fsPath.toLowerCase()) {
      items.push({
        label: t.directory.projectRootLabel,
        description: projectDirectory.fsPath,
        directory: projectDirectory,
      });
    }
    items.push({
      label: t.directory.browseLabel,
      browse: true,
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: moduleMode ? t.directory.modulePickTitle : t.directory.pickTitle,
      placeHolder: moduleMode
        ? t.directory.modulePickPlaceholder
        : t.directory.pickPlaceholder,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.browse) {
      const folders = await vscode.window.showOpenDialog({
        title: moduleMode ? t.directory.moduleBrowseTitle : t.directory.browseTitle,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: defaultDirectory,
      });
      return folders?.[0];
    }
    return picked.directory;
  }

  public async pickProjectRoot(
    currentRoot: string | undefined,
    inferredRoot: string,
  ): Promise<string | null | undefined> {
    const items: ProjectRootItem[] = [
      {
        label: t.projectRoot.chooseLabel,
        description: currentRoot
          ? t.projectRoot.current(currentRoot)
          : t.projectRoot.autoCurrent(inferredRoot),
        action: 'choose',
      },
    ];
    if (currentRoot) {
      items.push({
        label: t.projectRoot.autoLabel,
        description: t.projectRoot.autoDescription(inferredRoot),
        action: 'auto',
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: t.projectRoot.setTitle,
      placeHolder: t.projectRoot.placeholder,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.action === 'auto') {
      return null;
    }

    const folders = await vscode.window.showOpenDialog({
      title: t.projectRoot.dialogTitle,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(currentRoot ?? inferredRoot),
    });
    return folders?.[0]?.fsPath;
  }

  public async pickModuleToDelete(
    candidates: ModuleDeleteCandidate[],
    defaultDirectory: string,
  ): Promise<string | undefined> {
    const items: ModuleDeleteItem[] = candidates.map((candidate) => ({
      label: path.win32.basename(candidate.directoryPath) || candidate.directoryPath,
      description: t.module.deleteCandidateDescription(
        candidate.targetNames.join('、'),
        candidate.groupNames.join('、'),
      ),
      detail: t.module.deleteCandidateDetail(
        candidate.directoryPath,
        candidate.fileCount,
      ),
      directoryPath: candidate.directoryPath,
    }));
    items.push({
      label: t.module.deleteBrowseLabel,
      browse: true,
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: t.module.deletePickTitle,
      placeHolder: t.module.deletePickPlaceholder,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.browse) {
      const folders = await vscode.window.showOpenDialog({
        title: t.module.deleteDialogTitle,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(defaultDirectory),
      });
      return folders?.[0]?.fsPath;
    }
    return picked.directoryPath;
  }

  public async confirmDeleteModule(preview: DeleteModulePreview): Promise<boolean> {
    const lines: string[] = [
      t.module.deleteConfirmFolder(preview.directoryPath),
      '',
      t.module.deleteFilesHeader(preview.files.length),
    ];
    for (const file of preview.files.slice(0, 40)) {
      lines.push(`  ✗ ${file}`);
    }
    if (preview.files.length > 40) {
      lines.push(`  … 其余 ${preview.files.length - 40} 个文件`);
    }
    lines.push('');
    if (preview.entries.length === 0) {
      lines.push(t.module.deleteNoEntries);
    } else {
      lines.push(t.module.deleteEntriesHeader(preview.entries.length));
      for (const entry of preview.entries.slice(0, 30)) {
        lines.push(`  ${entry.targetName} / ${entry.groupName}: ${entry.projectPath}`);
      }
      if (preview.entries.length > 30) {
        lines.push(`  … 其余 ${preview.entries.length - 30} 个工程条目`);
      }
    }
    lines.push('', t.module.deleteWarning);

    const answer = await vscode.window.showWarningMessage(
      t.module.deleteConfirmTitle(preview.moduleName),
      { modal: true, detail: lines.join('\n') },
      t.buttons.deleteModule,
    );
    return answer === t.buttons.deleteModule;
  }

  public async inputFileName(extension: '.c' | '.h'): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({
      title: t.file.inputTitle(extension),
      prompt: t.file.inputPrompt(extension),
      placeHolder: t.file.inputPlaceholder(extension),
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (value.trim().length === 0) {
          return t.file.emptyError;
        }
        return undefined;
      },
    });
    return name?.trim();
  }

  public async inputModuleName(): Promise<string | undefined> {
    const name = await vscode.window.showInputBox({
      title: t.module.inputTitle,
      prompt: t.module.inputPrompt,
      placeHolder: t.module.inputPlaceholder,
      ignoreFocusOut: true,
      validateInput: (value) => {
        return validateModuleName(value).error;
      },
    });
    return name?.trim();
  }

  public async pickEncoding(
    recommendation: EncodingRecommendation,
    directoryPath: string,
  ): Promise<SourceCharset | undefined> {
    const counts = encodingCountsLabel(recommendation.counts);
    const items: EncodingItem[] = [
      {
        label: t.encoding.utf8Label,
        description:
          recommendation.charset === 'utf8' ? t.encoding.recommended : undefined,
        detail: t.encoding.utf8Detail,
        charset: 'utf8',
      },
      {
        label: t.encoding.gbLabel,
        description:
          recommendation.charset !== 'utf8' ? t.encoding.recommended : undefined,
        detail: t.encoding.gbDetail,
        charset: 'gb2312',
      },
    ];
    const recommended = items.find((item) => item.charset === recommendation.charset);
    const detailParts = [
      `${t.encoding.directoryPrefix}：${directoryPath}`,
      `${t.encoding.countsPrefix}：${counts}`,
      recommendationSourceLabel(recommendation),
    ];
    if (recommendation.ambiguous) {
      detailParts.push(t.encoding.mixedNotice);
    }
    if (recommended) {
      detailParts.push(`${t.encoding.recommendedPrefix}：${recommended.label}`);
    }

    const picked = await vscode.window.showQuickPick(items, {
      title: t.encoding.pickTitle,
      placeHolder: detailParts.join(' · '),
      ignoreFocusOut: true,
    });
    return picked?.charset;
  }

  public async confirmAddFiles(preview: AddPreview): Promise<boolean> {
    const lines: string[] = [];
    lines.push(`${t.preview.targetLabel}: ${preview.targetName}`);
    lines.push(`${t.preview.groupLabel}: ${preview.groupName}`);
    lines.push('');
    lines.push(t.preview.addHeader(preview.files.length));
    for (const file of preview.files) {
      lines.push(`  ✓ ${file.path}`);
    }
    if (preview.skipped.length > 0) {
      lines.push('');
      lines.push(t.preview.skipHeader(preview.skipped.length));
      for (const skipped of preview.skipped) {
        lines.push(`  ✗ ${skipped.fileName}：${skipped.reason}`);
      }
    }
    if (preview.warnings.length > 0) {
      lines.push('');
      lines.push(t.preview.warningHeader);
      for (const warning of preview.warnings) {
        lines.push(`  ! ${warning}`);
      }
    }

    const answer = await vscode.window.showWarningMessage(
      t.preview.title(preview.files.length),
      { modal: true, detail: lines.join('\n') },
      t.buttons.continueAdd,
    );
    return answer === t.buttons.continueAdd;
  }

  public showInfo(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  public showWarning(message: string): void {
    void vscode.window.showWarningMessage(message);
  }

  public showError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}
