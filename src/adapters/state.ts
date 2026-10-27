import type * as vscode from 'vscode';

import type { SourceCharset } from '../core/model';

export interface StatePort {
  getCurrentProject(): string | undefined;
  setCurrentProject(projectPath: string): Promise<void>;
  getLastTarget(projectPath: string): string | undefined;
  setLastTarget(projectPath: string, targetName: string): Promise<void>;
  getDirectoryEncoding(directoryPath: string): SourceCharset | undefined;
  setDirectoryEncoding(directoryPath: string, charset: SourceCharset): Promise<void>;
  getProjectRoot(projectPath: string): string | undefined;
  setProjectRoot(projectPath: string, rootPath: string | undefined): Promise<void>;
}

function targetKey(projectPath: string): string {
  return `keilProject.lastTarget:${projectPath.toLowerCase()}`;
}

function encodingKey(directoryPath: string): string {
  return `keilProject.encoding:${directoryPath.toLowerCase()}`;
}

function projectRootKey(projectPath: string): string {
  return `keilProject.projectRoot:${projectPath.toLowerCase()}`;
}

export class WorkspaceState implements StatePort {
  public constructor(private readonly memento: vscode.Memento) {}

  public getCurrentProject(): string | undefined {
    return this.memento.get<string>('keilProject.currentProject');
  }

  public async setCurrentProject(projectPath: string): Promise<void> {
    await this.memento.update('keilProject.currentProject', projectPath);
  }

  public getLastTarget(projectPath: string): string | undefined {
    return this.memento.get<string>(targetKey(projectPath));
  }

  public async setLastTarget(projectPath: string, targetName: string): Promise<void> {
    await this.memento.update(targetKey(projectPath), targetName);
  }

  public getDirectoryEncoding(directoryPath: string): SourceCharset | undefined {
    return this.memento.get<SourceCharset>(encodingKey(directoryPath));
  }

  public async setDirectoryEncoding(
    directoryPath: string,
    charset: SourceCharset,
  ): Promise<void> {
    await this.memento.update(encodingKey(directoryPath), charset);
  }

  public getProjectRoot(projectPath: string): string | undefined {
    return this.memento.get<string>(projectRootKey(projectPath));
  }

  public async setProjectRoot(
    projectPath: string,
    rootPath: string | undefined,
  ): Promise<void> {
    await this.memento.update(projectRootKey(projectPath), rootPath);
  }
}
