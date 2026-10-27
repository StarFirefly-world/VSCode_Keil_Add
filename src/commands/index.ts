import { addExistingFiles } from './addExistingFiles';
import { addModule } from './addModule';
import { addNewFile } from './addNewFile';
import { createGroup, selectProject } from './selectProject';
import { setProjectRoot } from './setProjectRoot';
import type { CommandDependencies } from './common';

export class KeilCommands {
  public constructor(private readonly deps: CommandDependencies) {}

  public addNewC(): Promise<void> {
    return addNewFile(this.deps, 'c');
  }

  public addNewH(): Promise<void> {
    return addNewFile(this.deps, 'h');
  }

  public addExistingFiles(): Promise<void> {
    return addExistingFiles(this.deps);
  }

  public addModule(): Promise<void> {
    return addModule(this.deps);
  }

  public setProjectRoot(): Promise<void> {
    return setProjectRoot(this.deps);
  }

  public selectProject(): Promise<void> {
    return selectProject(this.deps);
  }

  public createGroup(): Promise<void> {
    return createGroup(this.deps);
  }
}

export type { CommandDependencies } from './common';
