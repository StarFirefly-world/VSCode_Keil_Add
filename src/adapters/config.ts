import * as vscode from 'vscode';

export type NewFileEncodingSetting = 'auto' | 'utf8' | 'gb2312';
export type AutoOpenSetting = 'always' | 'never' | 'utf8-only';

export interface ConfigPort {
  getProjectFile(): string;
  getNewFileEncoding(): NewFileEncodingSetting;
  getAutoOpenNewFile(): AutoOpenSetting;
  getBackupProjectFile(): boolean;
  getTemplate(kind: 'c' | 'h'): string;
}

export class VSCodeConfig implements ConfigPort {
  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(
      'keilProject',
      vscode.workspace.workspaceFolders?.[0]?.uri,
    );
  }

  public getProjectFile(): string {
    return this.configuration().get<string>('projectFile', '').trim();
  }

  public getNewFileEncoding(): NewFileEncodingSetting {
    return this.configuration().get<NewFileEncodingSetting>('newFileEncoding', 'auto');
  }

  public getAutoOpenNewFile(): AutoOpenSetting {
    return this.configuration().get<AutoOpenSetting>('autoOpenNewFile', 'utf8-only');
  }

  public getBackupProjectFile(): boolean {
    return this.configuration().get<boolean>('backupProjectFile', true);
  }

  public getTemplate(kind: 'c' | 'h'): string {
    return this.configuration().get<string>(`template.${kind}`, '');
  }
}
