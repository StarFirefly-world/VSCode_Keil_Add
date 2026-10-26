import type * as vscode from 'vscode';

import { addExistingFiles } from './addExistingFiles';
import { addModule } from './addModule';
import { addNewFile } from './addNewFile';
import { createGroup, selectProject } from './selectProject';
import type { CommandDependencies } from './common';

export class KeilCommands {
  public constructor(private readonly deps: CommandDependencies) {}

  public addNewC(contextUri?: vscode.Uri): Promise<void> {
    return addNewFile(this.deps, 'c', contextUri);
  }

  public addNewH(contextUri?: vscode.Uri): Promise<void> {
    return addNewFile(this.deps, 'h', contextUri);
  }

  public addExistingFiles(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): Promise<void> {
    return addExistingFiles(this.deps, uri, selectedUris);
  }

  public addModule(contextUri?: vscode.Uri): Promise<void> {
    return addModule(this.deps, contextUri);
  }

  public selectProject(): Promise<void> {
    return selectProject(this.deps);
  }

  public createGroup(): Promise<void> {
    return createGroup(this.deps);
  }
}

export type { CommandDependencies } from './common';
