import { addFiles } from '../core/addFiles';
import { KeilProjectError } from '../core/errors';
import { findTarget } from '../core/parseProject';
import { isSamePath } from '../core/paths';
import { t } from '../i18n';
import { ProjectSession, type CommandDependencies } from './common';

export async function selectProject(deps: CommandDependencies): Promise<void> {
  const discovered = await deps.repository.discover();
  const candidates = [...discovered];
  const extras = [
    deps.state.getCurrentProject(),
    deps.config.getProjectFile().length > 0
      ? deps.repository.resolveConfiguredPath(deps.config.getProjectFile())
      : undefined,
  ];
  for (const extra of extras) {
    if (
      extra &&
      (await deps.repository.exists(extra)) &&
      !candidates.some((candidate) => isSamePath(candidate, extra))
    ) {
      candidates.push(extra);
    }
  }

  const selected = await deps.ui.pickProject(candidates, true);
  if (!selected) {
    return;
  }
  const snapshot = await deps.repository.read(selected);
  await deps.state.setCurrentProject(snapshot.path);

  const configured = deps.config.getProjectFile();
  if (configured.length > 0) {
    const configuredPath = deps.repository.resolveConfiguredPath(configured);
    if (!isSamePath(configuredPath, snapshot.path)) {
      deps.ui.showWarning(t.commands.configuredProjectWarning(configuredPath));
      return;
    }
  }
  deps.ui.showInfo(t.commands.projectSelected(snapshot.path));
}

export async function createGroup(deps: CommandDependencies): Promise<void> {
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

  const existing = target.groups.map((group) => group.name);
  const groupName = await session.promptNewGroup(existing, targetName);
  if (!groupName) {
    return;
  }

  const result = addFiles(project, {
    targetName,
    groups: [{ groupName, files: [] }],
  });
  await deps.writer.write(snapshot, result, deps.config.getBackupProjectFile());

  deps.ui.showInfo(t.commands.groupCreated(targetName, groupName));
}
