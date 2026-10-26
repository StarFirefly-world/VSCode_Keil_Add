import * as path from 'node:path';
import * as vscode from 'vscode';

import type { ConfigPort } from '../adapters/config';
import type { ProjectRepositoryPort } from '../adapters/projectRepository';
import type { StatePort } from '../adapters/state';
import { t } from '../i18n';

/**
 * A small action/status panel in the activity bar. This is deliberately not a
 * second project tree: it only exposes the commands that are otherwise hidden
 * behind Explorer context menus.
 */
export class ProjectFilesViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeTreeData = this.emitter.event;

  public constructor(
    private readonly state: StatePort,
    private readonly config: ConfigPort,
    private readonly repository: ProjectRepositoryPort,
  ) {}

  public refresh(): void {
    this.emitter.fire();
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) {
      return [];
    }

    const projectPath = this.currentProjectPath();
    if (!projectPath) {
      return [this.noProjectItem(), ...this.actionItems()];
    }

    const exists = await this.repository.exists(projectPath);
    if (!exists) {
      return [this.missingProjectItem(projectPath), ...this.actionItems()];
    }

    return [
      this.projectItem(projectPath),
      this.targetItem(projectPath),
      ...this.actionItems(),
    ];
  }

  private currentProjectPath(): string | undefined {
    const configured = this.config.getProjectFile();
    if (configured.length > 0) {
      return this.repository.resolveConfiguredPath(configured);
    }
    return this.state.getCurrentProject();
  }

  private projectItem(projectPath: string): vscode.TreeItem {
    const item = new vscode.TreeItem(
      t.view.currentProject,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = path.win32.basename(projectPath);
    item.tooltip = projectPath;
    item.iconPath = new vscode.ThemeIcon('project');
    item.command = {
      command: 'keilProject.selectProject',
      title: t.view.selectProject,
    };
    return item;
  }

  private missingProjectItem(projectPath: string): vscode.TreeItem {
    const item = new vscode.TreeItem(
      t.view.missingProject,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = projectPath;
    item.tooltip = projectPath;
    item.iconPath = new vscode.ThemeIcon('warning');
    item.command = {
      command: 'keilProject.selectProject',
      title: t.view.selectProject,
    };
    return item;
  }

  private noProjectItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      t.view.noProject,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = t.view.selectProjectHint;
    item.iconPath = new vscode.ThemeIcon('warning');
    item.command = {
      command: 'keilProject.selectProject',
      title: t.view.selectProject,
    };
    return item;
  }

  private targetItem(projectPath: string): vscode.TreeItem {
    const lastTarget = this.state.getLastTarget(projectPath);
    const item = new vscode.TreeItem(
      t.view.currentTarget,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = lastTarget ?? t.view.targetOnDemand;
    item.iconPath = new vscode.ThemeIcon('symbol-namespace');
    return item;
  }

  private actionItems(): vscode.TreeItem[] {
    return [
      this.action(t.view.newC, 'new-file', 'keilProject.addNewC'),
      this.action(t.view.newH, 'new-file', 'keilProject.addNewH'),
      this.action(t.view.addModule, 'symbol-module', 'keilProject.addModule'),
      this.action(t.view.addExisting, 'files', 'keilProject.addExistingFiles'),
      this.action(t.view.createGroup, 'add', 'keilProject.createGroup'),
      this.action(t.view.selectProject, 'folder-opened', 'keilProject.selectProject'),
    ];
  }

  private action(label: string, icon: string, command: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(icon);
    item.command = { command, title: label };
    return item;
  }
}
