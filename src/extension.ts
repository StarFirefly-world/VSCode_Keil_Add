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

export interface ExtensionApi {
  commands: KeilCommands;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = vscode.window.createOutputChannel('Keil Project Files');
  context.subscriptions.push(output);

  const ui = new VSCodeUi();
  const dependencies: CommandDependencies = {
    repository: new ProjectRepository(),
    writer: new ProjectWriter(context.globalStorageUri),
    sourceFiles: new SourceFileService(),
    state: new WorkspaceState(context.workspaceState),
    config: new VSCodeConfig(),
    ui,
  };
  const commands = new KeilCommands(dependencies);

  const register = (
    command: string,
    handler: (...args: unknown[]) => Promise<void>,
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args: unknown[]) => {
        void handler(...args).catch((error: unknown) => {
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
        });
      }),
    );
  };

  register('keilProject.addNewC', (uri) =>
    commands.addNewC(uri as vscode.Uri | undefined),
  );
  register('keilProject.addNewH', (uri) =>
    commands.addNewH(uri as vscode.Uri | undefined),
  );
  register('keilProject.addExistingFiles', (uri, selectedUris) =>
    commands.addExistingFiles(
      uri as vscode.Uri | undefined,
      selectedUris as vscode.Uri[] | undefined,
    ),
  );
  register('keilProject.selectProject', () => commands.selectProject());
  register('keilProject.createGroup', () => commands.createGroup());

  return { commands };
}

export function deactivate(): void {
  // No background resources to clean up.
}
