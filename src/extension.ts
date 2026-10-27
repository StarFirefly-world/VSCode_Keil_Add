import * as vscode from 'vscode';

import { VSCodeConfig } from './adapters/config';
import { ProjectRepository } from './adapters/projectRepository';
import { ProjectWriter } from './adapters/projectWriter';
import { SourceFileService } from './adapters/sourceFiles';
import { WorkspaceState } from './adapters/state';
import { VSCodeUi } from './adapters/ui';
import { KeilCommands, type CommandDependencies } from './commands';
import { KeilProjectError } from './core/errors';
import { t } from './i18n';
import { ProjectFilesViewProvider } from './views/projectFilesView';

export interface ExtensionApi {
  commands: KeilCommands;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = vscode.window.createOutputChannel('Keil Project Files');
  context.subscriptions.push(output);

  const ui = new VSCodeUi();
  const state = new WorkspaceState(context.workspaceState);
  const config = new VSCodeConfig();
  const repository = new ProjectRepository();
  const dependencies: CommandDependencies = {
    repository,
    writer: new ProjectWriter(context.globalStorageUri),
    sourceFiles: new SourceFileService(),
    state,
    config,
    ui,
  };
  const commands = new KeilCommands(dependencies);

  const viewProvider = new ProjectFilesViewProvider(state, config, repository);
  context.subscriptions.push(
    vscode.window.createTreeView('keilProjectFiles.home', {
      treeDataProvider: viewProvider,
      showCollapseAll: false,
    }),
  );

  const register = (command: string, handler: () => Promise<void>): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        void handler().then(
          () => viewProvider.refresh(),
          (error: unknown) => {
            viewProvider.refresh();
            if (error instanceof KeilProjectError && error.code === 'cancelled') {
              return;
            }
            output.appendLine(`[${new Date().toISOString()}] ${command} failed`);
            output.appendLine(
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
            ui.showError(
              error instanceof KeilProjectError
                ? error.message
                : t.commands.operationFailed(
                    error instanceof Error ? error.message : String(error),
                  ),
            );
          },
        );
      }),
    );
  };

  register('keilProject.addNewC', () => commands.addNewC());
  register('keilProject.addNewH', () => commands.addNewH());
  register('keilProject.addExistingFiles', () => commands.addExistingFiles());
  register('keilProject.addModule', () => commands.addModule());
  register('keilProject.deleteModule', () => commands.deleteModule());
  register('keilProject.setProjectRoot', () => commands.setProjectRoot());
  register('keilProject.selectProject', () => commands.selectProject());
  register('keilProject.createGroup', () => commands.createGroup());

  context.subscriptions.push(
    vscode.commands.registerCommand('keilProject.refreshView', () => {
      viewProvider.refresh();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('keilProject')) {
        viewProvider.refresh();
      }
    }),
  );

  return { commands };
}

export function deactivate(): void {
  // No background resources to clean up.
}
