import * as path from 'node:path';
import * as vscode from 'vscode';

import type {
  ProjectDocument,
  SourceCharset,
  SourceFileSample,
  TargetNode,
} from '../core/model';
import { findGroup } from '../core/parseProject';
import { commonDirectory, resolveProjectEntryPath } from '../core/paths';
import { countSourceEncodings, recommendSourceEncoding } from '../core/sourceEncoding';
import type { ConfigPort } from '../adapters/config';
import type {
  ProjectRepositoryPort,
  ProjectSnapshot,
} from '../adapters/projectRepository';
import type { ProjectWriterPort } from '../adapters/projectWriter';
import type { SourceFilesPort } from '../adapters/sourceFiles';
import type { StatePort } from '../adapters/state';
import type { UiPort } from '../adapters/ui';
import { t } from '../i18n';

export interface CommandDependencies {
  repository: ProjectRepositoryPort;
  writer: ProjectWriterPort;
  sourceFiles: SourceFilesPort;
  state: StatePort;
  config: ConfigPort;
  ui: UiPort;
}

export class ProjectSession {
  public constructor(private readonly deps: CommandDependencies) {}

  public async resolveProject(): Promise<ProjectSnapshot | undefined> {
    const configured = this.deps.config.getProjectFile();
    if (configured.length > 0) {
      const configuredPath = this.deps.repository.resolveConfiguredPath(configured);
      const snapshot = await this.deps.repository.read(configuredPath);
      await this.deps.state.setCurrentProject(snapshot.path);
      return snapshot;
    }

    const remembered = this.deps.state.getCurrentProject();
    if (remembered && (await this.deps.repository.exists(remembered))) {
      const snapshot = await this.deps.repository.read(remembered);
      await this.deps.state.setCurrentProject(snapshot.path);
      return snapshot;
    }

    const discovered = await this.deps.repository.discover();
    let selected: string | undefined;
    if (discovered.length === 0) {
      selected = await this.deps.ui.pickProjectFile();
    } else if (discovered.length === 1) {
      selected = discovered[0];
    } else {
      selected = await this.deps.ui.pickProject(discovered, true);
    }
    if (!selected) {
      return undefined;
    }

    const snapshot = await this.deps.repository.read(selected);
    await this.deps.state.setCurrentProject(snapshot.path);
    return snapshot;
  }

  public async pickTarget(project: ProjectDocument): Promise<string | undefined> {
    const names = project.targets.map((target) => target.name);
    if (names.length === 1) {
      await this.deps.state.setLastTarget(project.path, names[0]);
      return names[0];
    }
    const last = this.deps.state.getLastTarget(project.path);
    const selected = await this.deps.ui.pickTarget(names, last);
    if (!selected) {
      return undefined;
    }
    await this.deps.state.setLastTarget(project.path, selected);
    return selected;
  }

  public async pickGroup(target: TargetNode): Promise<string | undefined> {
    const existing = target.groups.map((group) => group.name);
    if (existing.length === 0) {
      return this.promptNewGroup(existing, target.name);
    }

    const picked = await this.deps.ui.pickGroup(existing, target.name);
    if (!picked) {
      return undefined;
    }
    if (picked.kind === 'existing') {
      return picked.name;
    }
    return this.promptNewGroup(existing, target.name);
  }

  public async promptNewGroup(
    existing: string[],
    targetName: string,
  ): Promise<string | undefined> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const input = await this.deps.ui.inputGroupName(existing, targetName);
      if (input === undefined) {
        return undefined;
      }
      const name = input.trim();
      if (name.length === 0) {
        this.deps.ui.showError(t.group.emptyError);
        continue;
      }
      if (/[\u0000-\u001f]/.test(name)) {
        this.deps.ui.showError(t.group.controlError);
        continue;
      }
      if (existing.includes(name)) {
        this.deps.ui.showError(t.group.existsError(name));
        continue;
      }
      return name;
    }
    return undefined;
  }

  public async defaultDirectory(
    project: ProjectDocument,
    target: TargetNode,
    groupName: string,
  ): Promise<string> {
    const group = findGroup(target, groupName);
    if (group) {
      const directories = group.files
        .filter((file) => file.path.length > 0)
        .map((file) => resolveProjectEntryPath(project.path, file.path));
      const common = commonDirectory(directories);
      if (common) {
        return common;
      }
    }

    return path.dirname(project.path);
  }
}

export function projectDirectoryUri(project: ProjectDocument): vscode.Uri {
  return vscode.Uri.file(path.dirname(project.path));
}

export function targetFileKeys(
  project: ProjectDocument,
  target: TargetNode,
): Set<string> {
  const keys = new Set<string>();
  for (const group of target.groups) {
    for (const file of group.files) {
      if (file.path.length > 0) {
        keys.add(resolveProjectEntryPath(project.path, file.path).toLowerCase());
      }
    }
  }
  return keys;
}

export function groupFilePaths(
  project: ProjectDocument,
  groupName: string,
  target: TargetNode,
): string[] {
  const group = findGroup(target, groupName);
  if (!group) {
    return [];
  }
  return group.files
    .filter((file) => file.path.length > 0)
    .map((file) => resolveProjectEntryPath(project.path, file.path));
}

export function allProjectSourcePaths(project: ProjectDocument): string[] {
  const paths: string[] = [];
  for (const target of project.targets) {
    for (const group of target.groups) {
      for (const file of group.files) {
        if (file.path.length > 0) {
          paths.push(resolveProjectEntryPath(project.path, file.path));
        }
      }
    }
  }
  return paths;
}

/**
 * Recommends and confirms the encoding for a new source file or module.
 * Sampling stops as soon as the target folder has a decisive vote.
 */
export async function chooseSourceEncoding(
  deps: CommandDependencies,
  project: ProjectDocument,
  target: TargetNode,
  groupName: string,
  directoryPath: string,
): Promise<SourceCharset | undefined> {
  const setting = deps.config.getNewFileEncoding();
  const remembered = deps.state.getDirectoryEncoding(directoryPath);

  let folderSamples: SourceFileSample[] = [];
  let groupSamples: SourceFileSample[] = [];
  let projectSamples: SourceFileSample[] = [];
  if (setting === 'auto') {
    folderSamples = await deps.sourceFiles.collectDirectorySamples(directoryPath);
    const folderVotes = countSourceEncodings(folderSamples);
    const hasFolderVotes = folderVotes.utf8 + folderVotes.gb > 0;

    if (!remembered && !hasFolderVotes) {
      groupSamples = await deps.sourceFiles.collectSamples(
        groupFilePaths(project, groupName, target),
      );
      const groupVotes = countSourceEncodings(groupSamples);
      const hasGroupVotes = groupVotes.utf8 + groupVotes.gb > 0;
      if (!hasGroupVotes) {
        projectSamples = await deps.sourceFiles.collectSamples(
          allProjectSourcePaths(project),
        );
      }
    }
  }

  const recommendation = recommendSourceEncoding({
    setting,
    remembered,
    folderSamples,
    groupSamples,
    projectSamples,
  });
  const chosen = await deps.ui.pickEncoding(recommendation, directoryPath);
  if (!chosen) {
    return undefined;
  }
  await deps.state.setDirectoryEncoding(directoryPath, chosen);
  return chosen;
}
