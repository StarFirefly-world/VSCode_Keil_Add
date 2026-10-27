import * as path from 'node:path';

import { t } from '../i18n';
import {
  ensureExistingDirectory,
  ProjectSession,
  type CommandDependencies,
} from './common';

export async function setProjectRoot(deps: CommandDependencies): Promise<void> {
  const session = new ProjectSession(deps);
  const snapshot = await session.resolveProject();
  if (!snapshot) {
    return;
  }

  const project = snapshot.document;
  const configuredRoot = deps.state.getProjectRoot(project.path);
  const inferredRoot = session.inferredProjectRoot(project);
  const selected = await deps.ui.pickProjectRoot(configuredRoot, inferredRoot);
  if (selected === undefined) {
    return;
  }

  if (selected === null) {
    await deps.state.setProjectRoot(project.path, undefined);
    deps.ui.showInfo(t.projectRoot.cleared(inferredRoot));
    return;
  }

  const absoluteRoot = path.resolve(selected);
  await ensureExistingDirectory(absoluteRoot);
  await deps.state.setProjectRoot(project.path, absoluteRoot);
  deps.ui.showInfo(t.projectRoot.saved(absoluteRoot));
}
