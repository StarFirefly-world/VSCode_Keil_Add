import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { ConfigPort } from '../../src/adapters/config';
import {
  ProjectRepository,
  type ProjectSnapshot,
} from '../../src/adapters/projectRepository';
import { ProjectWriter, type ProjectWriterPort } from '../../src/adapters/projectWriter';
import { SourceFileService } from '../../src/adapters/sourceFiles';
import type { StatePort } from '../../src/adapters/state';
import type {
  AddPreview,
  DeleteModulePreview,
  GroupPick,
  ModuleDeleteCandidate,
  UiPort,
} from '../../src/adapters/ui';
import { KeilCommands, type CommandDependencies } from '../../src/commands';
import { addFiles } from '../../src/core/addFiles';
import {
  decodeProjectBytes,
  decodeSourceText,
  encodeProjectText,
} from '../../src/core/encoding';
import { KeilProjectError } from '../../src/core/errors';
import type { SourceCharset } from '../../src/core/model';
import { parseProject } from '../../src/core/parseProject';
import { t } from '../../src/i18n';
import { ProjectFilesViewProvider } from '../../src/views/projectFilesView';

const EMPTY_FILES_BLOCK = '<Files>\n          </Files>';

interface TempProject {
  root: string;
  projectPath: string;
  appDirectory: string;
  projectText: string;
}

function projectText(charset: 'utf8' | 'gb2312'): string {
  const encoding = charset === 'utf8' ? 'UTF-8' : 'GB2312';
  return `<?xml version="1.0" encoding="${encoding}"?>
<Project>
  <!-- 中文注释：必须保持原样 -->
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups>
        <Group>
          <GroupName>App</GroupName>
          <Files>
            <File>
              <FileName>main.c</FileName>
              <FileType>1</FileType>
              <FilePath>.\\App\\main.c</FilePath>
            </File>
          </Files>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;
}

async function createTempProject(charset: 'utf8' | 'gb2312'): Promise<TempProject> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keil-project-files-'));
  const appDirectory = path.join(root, 'App');
  await fs.mkdir(appDirectory, { recursive: true });
  await fs.writeFile(path.join(appDirectory, 'main.c'), 'int main(void) { return 0; }\n');
  const text = projectText(charset);
  const projectPath = path.join(root, 'demo.uvprojx');
  await fs.writeFile(projectPath, encodeProjectText(text, charset));
  return { root, projectPath, appDirectory, projectText: text };
}

class FakeConfig implements ConfigPort {
  public projectFile = '';
  public encoding: 'auto' | 'utf8' | 'gb2312' = 'utf8';
  public autoOpen: 'always' | 'never' | 'utf8-only' = 'never';
  public backup = true;
  public templates: Record<'c' | 'h', string> = { c: '', h: '' };

  public constructor(projectFile: string) {
    this.projectFile = projectFile;
  }

  public getProjectFile(): string {
    return this.projectFile;
  }

  public getNewFileEncoding(): 'auto' | 'utf8' | 'gb2312' {
    return this.encoding;
  }

  public getAutoOpenNewFile(): 'always' | 'never' | 'utf8-only' {
    return this.autoOpen;
  }

  public getBackupProjectFile(): boolean {
    return this.backup;
  }

  public getTemplate(kind: 'c' | 'h'): string {
    return this.templates[kind];
  }
}

class MemoryState implements StatePort {
  private current: string | undefined;
  private readonly targets = new Map<string, string>();
  private readonly encodings = new Map<string, SourceCharset>();
  private readonly projectRoots = new Map<string, string>();

  public getCurrentProject(): string | undefined {
    return this.current;
  }

  public async setCurrentProject(projectPath: string): Promise<void> {
    this.current = projectPath;
  }

  public getLastTarget(projectPath: string): string | undefined {
    return this.targets.get(projectPath.toLowerCase());
  }

  public async setLastTarget(projectPath: string, targetName: string): Promise<void> {
    this.targets.set(projectPath.toLowerCase(), targetName);
  }

  public getDirectoryEncoding(directoryPath: string): SourceCharset | undefined {
    return this.encodings.get(directoryPath.toLowerCase());
  }

  public async setDirectoryEncoding(
    directoryPath: string,
    charset: SourceCharset,
  ): Promise<void> {
    this.encodings.set(directoryPath.toLowerCase(), charset);
  }

  public getProjectRoot(projectPath: string): string | undefined {
    return this.projectRoots.get(projectPath.toLowerCase());
  }

  public async setProjectRoot(
    projectPath: string,
    rootPath: string | undefined,
  ): Promise<void> {
    const key = projectPath.toLowerCase();
    if (rootPath === undefined) {
      this.projectRoots.delete(key);
    } else {
      this.projectRoots.set(key, rootPath);
    }
  }
}

interface FakeUiOptions {
  directory?: vscode.Uri;
  fileName?: string;
  moduleName?: string;
  moduleNames?: string[];
  existingFiles?: vscode.Uri[];
  charset?: SourceCharset;
  confirm?: boolean;
  groupChoice?: GroupPick;
  newGroupName?: string;
  projectRootChoice?: string | null;
  moduleDeleteChoice?: string;
  confirmDelete?: boolean;
}

class FakeUi implements UiPort {
  public readonly infos: string[] = [];
  public readonly warnings: string[] = [];
  public readonly errors: string[] = [];
  public readonly previews: AddPreview[] = [];
  public readonly deletePreviews: DeleteModulePreview[] = [];
  public readonly deleteCandidates: ModuleDeleteCandidate[][] = [];
  public projectRootChoice: string | null | undefined;
  public moduleDeleteChoice: string | undefined;
  public confirmDeleteResult: boolean;
  public lastDefaultDirectory: string | undefined;
  public lastRootDirectory: string | undefined;

  public constructor(private readonly options: FakeUiOptions = {}) {
    this.projectRootChoice = options.projectRootChoice;
    this.moduleDeleteChoice = options.moduleDeleteChoice;
    this.confirmDeleteResult = options.confirmDelete ?? true;
  }

  public async pickProject(): Promise<string | undefined> {
    return undefined;
  }

  public async pickProjectFile(): Promise<string | undefined> {
    return undefined;
  }

  public async pickExistingFiles(): Promise<vscode.Uri[] | undefined> {
    return this.options.existingFiles;
  }

  public async pickTarget(): Promise<string | undefined> {
    return 'Debug';
  }

  public async pickGroup(groupNames: string[]): Promise<GroupPick | undefined> {
    return (
      this.options.groupChoice ?? {
        kind: 'existing',
        name: groupNames[0],
      }
    );
  }

  public async inputGroupName(): Promise<string | undefined> {
    return this.options.newGroupName;
  }

  public async pickDirectory(
    defaultDirectory: vscode.Uri,
    projectDirectory: vscode.Uri,
    _mode?: 'file' | 'module',
  ): Promise<vscode.Uri | undefined> {
    this.lastDefaultDirectory = defaultDirectory.fsPath;
    this.lastRootDirectory = projectDirectory.fsPath;
    return this.options.directory ?? defaultDirectory;
  }

  public async pickProjectRoot(): Promise<string | null | undefined> {
    return this.projectRootChoice;
  }

  public async pickModuleToDelete(
    candidates: ModuleDeleteCandidate[],
  ): Promise<string | undefined> {
    this.deleteCandidates.push(candidates);
    return this.moduleDeleteChoice ?? candidates[0]?.directoryPath;
  }

  public async confirmDeleteModule(preview: DeleteModulePreview): Promise<boolean> {
    this.deletePreviews.push(preview);
    return this.confirmDeleteResult;
  }

  public async inputFileName(): Promise<string | undefined> {
    return this.options.fileName;
  }

  public async inputModuleName(): Promise<string | undefined> {
    if (this.options.moduleNames && this.options.moduleNames.length > 0) {
      return this.options.moduleNames.shift();
    }
    return this.options.moduleName;
  }

  public async pickEncoding(recommendation: {
    charset: SourceCharset;
  }): Promise<SourceCharset | undefined> {
    return this.options.charset ?? recommendation.charset;
  }

  public async confirmAddFiles(preview: AddPreview): Promise<boolean> {
    this.previews.push(preview);
    return this.options.confirm ?? true;
  }

  public showInfo(message: string): void {
    this.infos.push(message);
  }

  public showWarning(message: string): void {
    this.warnings.push(message);
  }

  public showError(message: string): void {
    this.errors.push(message);
  }
}

class FailingWriter implements ProjectWriterPort {
  public async write(): Promise<{ backupPath?: string }> {
    throw new KeilProjectError('io', '模拟工程写入失败');
  }
}

interface TestEnvironment {
  deps: CommandDependencies;
  ui: FakeUi;
  config: FakeConfig;
  state: MemoryState;
  storage: string;
}

interface ViewContainerContribution {
  id: string;
  title: string;
  icon: string;
}

interface ViewContribution {
  id: string;
  name: string;
}

interface ExtensionManifest {
  contributes?: {
    viewsContainers?: {
      activitybar?: ViewContainerContribution[];
    };
    views?: Record<string, ViewContribution[]>;
    menus?: {
      'view/title'?: Array<{ command: string }>;
      'explorer/context'?: Array<{ command: string }>;
    };
  };
}

function treeItemLabel(item: vscode.TreeItem): string {
  return typeof item.label === 'string' ? item.label : (item.label?.label ?? '');
}

function createEnvironment(
  projectPath: string,
  options: FakeUiOptions = {},
  writer?: ProjectWriterPort,
): TestEnvironment {
  const storage = path.join(os.tmpdir(), `keil-storage-${Date.now()}-${Math.random()}`);
  const config = new FakeConfig(projectPath);
  const state = new MemoryState();
  const ui = new FakeUi(options);
  return {
    deps: {
      repository: new ProjectRepository(),
      writer: writer ?? new ProjectWriter(vscode.Uri.file(storage)),
      sourceFiles: new SourceFileService(),
      state,
      config,
      ui,
    },
    ui,
    config,
    state,
    storage,
  };
}

async function closeAllEditors(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } catch {
    // Nothing to close in the test host.
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function cleanup(temp: TempProject, storage: string): Promise<void> {
  await closeAllEditors();
  await fs.rm(storage, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(temp.root, { recursive: true, force: true }).catch(() => undefined);
}

describe('Keil Project Files integration', () => {
  it('activates the extension and registers all commands', async () => {
    const extension = vscode.extensions.getExtension(
      'keil-project-files.keil-project-files',
    );
    assert.ok(extension, 'development extension should be discoverable');
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'keilProject.addNewC',
      'keilProject.addNewH',
      'keilProject.addModule',
      'keilProject.deleteModule',
      'keilProject.addExistingFiles',
      'keilProject.setProjectRoot',
      'keilProject.selectProject',
      'keilProject.createGroup',
      'keilProject.refreshView',
    ]) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }

    const manifest = extension.packageJSON as ExtensionManifest;
    const container = manifest.contributes?.viewsContainers?.activitybar?.find(
      (candidate) => candidate.id === 'keilProjectFiles',
    );
    assert.ok(container, 'activity bar container should be contributed');
    assert.equal(container.title, 'Keil 工程文件');
    assert.ok(
      manifest.contributes?.views?.keilProjectFiles?.some(
        (view) => view.id === 'keilProjectFiles.home',
      ),
      'view should be contributed',
    );
    assert.ok(
      manifest.contributes?.menus?.['view/title']?.some(
        (menu) => menu.command === 'keilProject.addNewC',
      ),
      'view title should expose the new-file action',
    );
    assert.equal(
      manifest.contributes?.menus?.['explorer/context']?.length ?? 0,
      0,
      'Explorer context menu entries should be removed',
    );
  });

  it('provides sidebar actions without acting as a project tree', async () => {
    const provider = new ProjectFilesViewProvider(
      new MemoryState(),
      new FakeConfig(''),
      new ProjectRepository(),
    );
    const items = await provider.getChildren();
    const labels = items.map(treeItemLabel);
    assert.ok(labels.includes(t.view.noProject));
    assert.ok(labels.includes(t.view.newC));
    assert.ok(labels.includes(t.view.newH));
    assert.ok(labels.includes(t.view.addModule));
    assert.ok(labels.includes(t.view.deleteModule));
    assert.ok(labels.includes(t.view.addExisting));
    assert.ok(items.some((item) => item.command?.command === 'keilProject.addNewC'));
    assert.deepEqual(await provider.getChildren(items[0]), []);
  });

  it('shows and updates the configured overall project folder', async () => {
    const temp = await createTempProject('utf8');
    const hardware = path.join(temp.root, 'HARDWARE');
    await fs.mkdir(hardware);
    const env = createEnvironment(temp.projectPath, {
      projectRootChoice: hardware,
    });
    try {
      await new KeilCommands(env.deps).setProjectRoot();
      assert.equal(env.state.getProjectRoot(temp.projectPath), path.resolve(hardware));
      assert.ok(env.ui.infos.some((message) => message.includes('总工程文件夹')));

      env.ui.projectRootChoice = null;
      await new KeilCommands(env.deps).setProjectRoot();
      assert.equal(env.state.getProjectRoot(temp.projectPath), undefined);
      assert.ok(env.ui.infos.some((message) => message.includes('自动推断')));
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('uses the configured project root as the module directory picker root', async () => {
    const temp = await createTempProject('utf8');
    const hardware = path.join(temp.root, 'HARDWARE');
    await fs.mkdir(hardware);
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(hardware),
      moduleName: 'rootmod',
      charset: 'utf8',
      groupChoice: { kind: 'create' },
      newGroupName: 'Drivers',
    });
    try {
      await env.state.setProjectRoot(temp.projectPath, hardware);
      await new KeilCommands(env.deps).addModule();

      assert.equal(env.ui.lastRootDirectory?.toLowerCase(), hardware.toLowerCase());
      assert.equal(env.ui.lastDefaultDirectory?.toLowerCase(), hardware.toLowerCase());
      assert.equal(
        (await fs.stat(path.join(hardware, 'rootmod', 'rootmod.c'))).isFile(),
        true,
      );
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('shows the configured overall project folder in the sidebar', async () => {
    const temp = await createTempProject('utf8');
    const hardware = path.join(temp.root, 'HARDWARE');
    await fs.mkdir(hardware);
    const state = new MemoryState();
    await state.setCurrentProject(temp.projectPath);
    await state.setProjectRoot(temp.projectPath, hardware);
    const provider = new ProjectFilesViewProvider(
      state,
      new FakeConfig(''),
      new ProjectRepository(),
    );
    try {
      const items = await provider.getChildren();
      const rootItem = items.find((item) => treeItemLabel(item) === t.view.projectRoot);
      assert.ok(rootItem);
      assert.equal(rootItem.description, hardware);
      assert.equal(rootItem.command?.command, 'keilProject.setProjectRoot');
    } finally {
      await fs.rm(temp.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('creates a UTF-8 C file through the full command flow', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.appDirectory),
      fileName: 'app',
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addNewC();

      const createdPath = path.join(temp.appDirectory, 'app.c');
      const createdBytes = await fs.readFile(createdPath);
      assert.equal(createdBytes[0], 0x2f, 'should not write a BOM');
      assert.match(createdBytes.toString('utf8'), /@file app\.c/);

      const projectBytes = await fs.readFile(temp.projectPath);
      const decoded = decodeProjectBytes(projectBytes);
      assert.equal(decoded.charset, 'utf8');
      assert.match(decoded.text, /<FileName>app\.c<\/FileName>/);
      assert.match(decoded.text, /<FilePath>\.\\App\\app\.c<\/FilePath>/);
      assert.match(decoded.text, /<FileName>main\.c<\/FileName>/);
      assert.match(decoded.text, /中文注释：必须保持原样/);

      const updated = parseProject(decoded.text, temp.projectPath);
      assert.deepEqual(
        updated.targets[0].groups[0].files.map((file) => file.name),
        ['main.c', 'app.c'],
      );
      assert.equal(env.ui.errors.length, 0);
      assert.ok(env.ui.infos.some((message) => message.includes('已创建')));

      const backups = await fs.readdir(path.join(env.storage, 'backups'));
      assert.equal(backups.length, 1);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('preserves UTF-8 BOM and CRLF when the project is saved with WorkspaceEdit', async () => {
    const temp = await createTempProject('utf8');
    const crlfText = temp.projectText.replace(/\n/g, '\r\n');
    await fs.writeFile(
      temp.projectPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlfText, 'utf8')]),
    );
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.appDirectory),
      fileName: 'bom',
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addNewC();

      const bytes = await fs.readFile(temp.projectPath);
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const decoded = decodeProjectBytes(bytes);
      assert.equal(decoded.charset, 'utf8bom');
      assert.match(decoded.text, /<FileName>bom\.c<\/FileName>/);
      assert.ok(decoded.text.includes('\r\n'));
      assert.equal(decoded.text.replace(/\r\n/g, '').includes('\n'), false);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('writes GB2312 projects and new Chinese-named headers without changing encoding', async () => {
    const temp = await createTempProject('gb2312');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.appDirectory),
      fileName: '驱动',
      charset: 'gb2312',
    });
    env.config.autoOpen = 'utf8-only';
    try {
      await new KeilCommands(env.deps).addNewH();

      const createdPath = path.join(temp.appDirectory, '驱动.h');
      const createdBytes = await fs.readFile(createdPath);
      assert.notEqual(createdBytes[0], 0xef);
      const sourceText = decodeSourceText(createdBytes, 'gb2312');
      assert.match(sourceText, /@file 驱动\.h/);
      assert.match(sourceText, /#ifndef 驱动_H|#ifndef ___H/);

      const projectBytes = await fs.readFile(temp.projectPath);
      const decoded = decodeProjectBytes(projectBytes);
      assert.equal(decoded.charset, 'gb2312');
      assert.match(decoded.text, /<FileName>驱动\.h<\/FileName>/);
      assert.match(decoded.text, /<FilePath>\.\\App\\驱动\.h<\/FilePath>/);
      assert.match(decoded.text, /中文注释：必须保持原样/);

      const isOpen = vscode.workspace.textDocuments.some(
        (document) => document.uri.fsPath.toLowerCase() === createdPath.toLowerCase(),
      );
      assert.equal(isOpen, false, 'GB file must not be auto-opened');
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('creates files in a sibling folder outside the project directory', async () => {
    const temp = await createTempProject('utf8');
    const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'keil-hardware-'));
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(outsideDirectory),
      fileName: 'led',
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addNewC();

      const createdPath = path.join(outsideDirectory, 'led.c');
      assert.equal((await fs.stat(createdPath)).isFile(), true);

      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const entry = updated.targets[0].groups[0].files.find(
        (file) => file.name === 'led.c',
      );
      assert.ok(entry);
      assert.ok(entry.path.startsWith('..\\'));
      assert.equal(path.resolve(path.dirname(temp.projectPath), entry.path), createdPath);
      assert.ok(env.ui.warnings.some((message) => message.includes('工程目录之外')));
    } finally {
      await fs
        .rm(outsideDirectory, { recursive: true, force: true })
        .catch(() => undefined);
      await cleanup(temp, env.storage);
    }
  });

  it('creates a module folder and adds only the C file to a separately selected Group', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.root),
      moduleName: 'motor',
      charset: 'utf8',
      groupChoice: { kind: 'create' },
      newGroupName: 'Drivers',
    });
    try {
      await new KeilCommands(env.deps).addModule();

      const moduleDirectory = path.join(temp.root, 'motor');
      const header = await fs.readFile(path.join(moduleDirectory, 'motor.h'), 'utf8');
      assert.equal(header, '#ifndef _MOTOR_H\n#define _MOTOR_H\n#endif\n');
      const source = await fs.readFile(path.join(moduleDirectory, 'motor.c'), 'utf8');
      assert.equal(source, '#include "motor.h"\n');

      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const drivers = updated.targets[0].groups.find((group) => group.name === 'Drivers');
      assert.ok(drivers);
      assert.deepEqual(
        drivers.files.map((file) => file.name),
        ['motor.c'],
      );
      assert.equal(drivers.files[0].path, '.\\motor\\motor.c');

      const allFileNames = updated.targets[0].groups.flatMap((group) =>
        group.files.map((file) => file.name),
      );
      assert.equal(allFileNames.includes('motor.h'), false);
      assert.ok(env.ui.infos.some((message) => message.includes('motor')));
      assert.equal(env.ui.errors.length, 0);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('does not overwrite an existing module folder', async () => {
    const temp = await createTempProject('utf8');
    const existingDirectory = path.join(temp.root, 'motor');
    await fs.mkdir(existingDirectory);
    await fs.writeFile(path.join(existingDirectory, 'keep.txt'), 'keep me\n');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.root),
      moduleNames: ['motor', 'motor2'],
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addModule();

      assert.equal(
        await fs.readFile(path.join(existingDirectory, 'keep.txt'), 'utf8'),
        'keep me\n',
      );
      assert.equal(
        (await fs
          .stat(path.join(existingDirectory, 'motor.c'))
          .catch(() => undefined)) === undefined,
        true,
      );
      assert.equal(
        (await fs.stat(path.join(temp.root, 'motor2', 'motor2.c'))).isFile(),
        true,
      );
      assert.ok(env.ui.errors.some((message) => message.includes('已存在')));

      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const names = updated.targets[0].groups
        .flatMap((group) => group.files)
        .map((file) => file.name);
      assert.ok(names.includes('motor2.c'));
      assert.equal(names.includes('motor.c'), false);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('removes module files and the module folder when updating the project fails', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(
      temp.projectPath,
      {
        directory: vscode.Uri.file(temp.root),
        moduleName: 'rollbackmod',
        charset: 'utf8',
      },
      new FailingWriter(),
    );
    const originalProject = await fs.readFile(temp.projectPath);
    try {
      await assert.rejects(new KeilCommands(env.deps).addModule(), /模拟工程写入失败/);
      await assert.rejects(fs.stat(path.join(temp.root, 'rollbackmod')), /ENOENT/);
      assert.equal((await fs.readFile(temp.projectPath)).equals(originalProject), true);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('allows module folders outside the project and uses a .. relative path', async () => {
    const temp = await createTempProject('utf8');
    const outsideDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'keil-module-outside-'),
    );
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(outsideDirectory),
      moduleName: 'motor',
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addModule();

      const moduleDirectory = path.join(outsideDirectory, 'motor');
      assert.equal((await fs.stat(path.join(moduleDirectory, 'motor.c'))).isFile(), true);
      assert.equal((await fs.stat(path.join(moduleDirectory, 'motor.h'))).isFile(), true);

      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const entry = updated.targets[0].groups
        .flatMap((group) => group.files)
        .find((file) => file.name === 'motor.c');
      assert.ok(entry);
      assert.ok(entry.path.startsWith('..\\'));
      assert.equal(
        path.resolve(path.dirname(temp.projectPath), entry.path),
        path.join(moduleDirectory, 'motor.c'),
      );
      assert.ok(
        env.ui.warnings.some((message) => message.includes('工程文件所在目录之外')),
      );
    } finally {
      await fs
        .rm(outsideDirectory, { recursive: true, force: true })
        .catch(() => undefined);
      await cleanup(temp, env.storage);
    }
  });

  it('deletes a module folder and removes its project entries', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.root),
      moduleName: 'motor',
      charset: 'utf8',
      groupChoice: { kind: 'create' },
      newGroupName: 'Drivers',
    });
    try {
      await new KeilCommands(env.deps).addModule();
      const moduleDirectory = path.join(temp.root, 'motor');
      env.ui.moduleDeleteChoice = moduleDirectory;

      await new KeilCommands(env.deps).deleteModule();

      await assert.rejects(fs.stat(moduleDirectory), /ENOENT/);
      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const names = updated.targets[0].groups
        .flatMap((group) => group.files)
        .map((file) => file.name);
      assert.equal(names.includes('motor.c'), false);
      assert.equal(names.includes('motor.h'), false);
      const drivers = updated.targets[0].groups.find((group) => group.name === 'Drivers');
      assert.ok(drivers);
      assert.deepEqual(drivers.files, []);

      assert.equal(env.ui.deleteCandidates[0].length, 1);
      assert.equal(
        env.ui.deleteCandidates[0][0].directoryPath.toLowerCase(),
        moduleDirectory.toLowerCase(),
      );
      assert.deepEqual(
        env.ui.deletePreviews[0].entries.map((entry) => entry.targetName),
        ['Debug'],
      );
      assert.deepEqual(env.ui.deletePreviews[0].files, ['motor.c', 'motor.h']);
      assert.ok(env.ui.infos.some((message) => message.includes('已删除模块')));
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('keeps the module when deletion is cancelled', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.root),
      moduleName: 'cancelmod',
      charset: 'utf8',
      confirmDelete: false,
    });
    try {
      await new KeilCommands(env.deps).addModule();
      const moduleDirectory = path.join(temp.root, 'cancelmod');
      env.ui.moduleDeleteChoice = moduleDirectory;
      const before = await fs.readFile(temp.projectPath);

      await new KeilCommands(env.deps).deleteModule();

      assert.equal(
        (await fs.stat(path.join(moduleDirectory, 'cancelmod.c'))).isFile(),
        true,
      );
      assert.equal((await fs.readFile(temp.projectPath)).equals(before), true);
      assert.equal(env.ui.deletePreviews.length, 1);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('deletes a module from a GB2312 project without changing encoding', async () => {
    const temp = await createTempProject('gb2312');
    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.root),
      moduleName: 'gbmod',
      charset: 'gb2312',
      groupChoice: { kind: 'create' },
      newGroupName: 'Modules',
    });
    try {
      await new KeilCommands(env.deps).addModule();
      const moduleDirectory = path.join(temp.root, 'gbmod');
      env.ui.moduleDeleteChoice = moduleDirectory;

      await new KeilCommands(env.deps).deleteModule();

      await assert.rejects(fs.stat(moduleDirectory), /ENOENT/);
      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      assert.equal(decoded.charset, 'gb2312');
      assert.match(decoded.text, /中文注释：必须保持原样/);
      const updated = parseProject(decoded.text, temp.projectPath);
      const names = updated.targets[0].groups
        .flatMap((group) => group.files)
        .map((file) => file.name);
      assert.equal(names.includes('gbmod.c'), false);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('refuses to delete a folder that is not a module folder', async () => {
    const temp = await createTempProject('utf8');
    const plainDirectory = path.join(temp.root, 'plain');
    await fs.mkdir(plainDirectory);
    await fs.writeFile(path.join(plainDirectory, 'other.c'), 'int other;\n');
    const env = createEnvironment(temp.projectPath, {
      moduleDeleteChoice: plainDirectory,
    });
    try {
      await assert.rejects(new KeilCommands(env.deps).deleteModule(), /不是模块文件夹/);
      assert.equal((await fs.stat(path.join(plainDirectory, 'other.c'))).isFile(), true);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('adds multiple existing files and skips duplicates', async () => {
    const temp = await createTempProject('utf8');
    const drivers = path.join(temp.root, 'Drivers');
    await fs.mkdir(drivers);
    const fooPath = path.join(drivers, 'foo.c');
    const barPath = path.join(drivers, 'bar.h');
    await fs.writeFile(fooPath, 'void foo(void) {}\n');
    await fs.writeFile(barPath, '#pragma once\n');
    const mainPath = path.join(temp.appDirectory, 'main.c');

    const env = createEnvironment(temp.projectPath, {
      directory: vscode.Uri.file(temp.appDirectory),
      existingFiles: [
        vscode.Uri.file(fooPath),
        vscode.Uri.file(barPath),
        vscode.Uri.file(mainPath),
      ],
      charset: 'utf8',
    });
    try {
      await new KeilCommands(env.deps).addExistingFiles();

      assert.equal(env.ui.previews.length, 1);
      assert.equal(env.ui.previews[0].files.length, 2);
      assert.equal(env.ui.previews[0].skipped.length, 1);
      assert.match(env.ui.previews[0].skipped[0].reason, /已存在/);

      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      assert.deepEqual(
        updated.targets[0].groups[0].files.map((file) => file.name),
        ['main.c', 'foo.c', 'bar.h'],
      );
      assert.equal(await fs.readFile(fooPath, 'utf8'), 'void foo(void) {}\n');
      assert.equal(await fs.readFile(barPath, 'utf8'), '#pragma once\n');

      const textAfterFirst = decoded.text;
      await new KeilCommands(env.deps).addExistingFiles();
      const textAfterSecond = (await fs.readFile(temp.projectPath)).toString('utf8');
      assert.equal(textAfterSecond, textAfterFirst);
      assert.ok(env.ui.warnings.some((message) => message.includes('没有可添加')));
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('creates an empty group that is visible in the project', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(temp.projectPath, {
      newGroupName: 'Modules',
    });
    try {
      await new KeilCommands(env.deps).createGroup();
      const decoded = decodeProjectBytes(await fs.readFile(temp.projectPath));
      const updated = parseProject(decoded.text, temp.projectPath);
      const group = updated.targets[0].groups.find(
        (candidate) => candidate.name === 'Modules',
      );
      assert.ok(group);
      assert.deepEqual(group.files, []);
      assert.ok(decoded.text.includes(EMPTY_FILES_BLOCK));
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('deletes a newly created source file when updating the project fails', async () => {
    const temp = await createTempProject('utf8');
    const env = createEnvironment(
      temp.projectPath,
      {
        directory: vscode.Uri.file(temp.appDirectory),
        fileName: 'rollback',
        charset: 'utf8',
      },
      new FailingWriter(),
    );
    const originalProject = await fs.readFile(temp.projectPath);
    try {
      await assert.rejects(new KeilCommands(env.deps).addNewC(), /模拟工程写入失败/);
      await assert.rejects(fs.stat(path.join(temp.appDirectory, 'rollback.c')), /ENOENT/);
      const projectAfter = await fs.readFile(temp.projectPath);
      assert.equal(projectAfter.equals(originalProject), true);
    } finally {
      await cleanup(temp, env.storage);
    }
  });

  it('aborts with a conflict when the project changed after reading it', async () => {
    const temp = await createTempProject('utf8');
    const storage = path.join(os.tmpdir(), `keil-storage-${Date.now()}-${Math.random()}`);
    try {
      const repository = new ProjectRepository();
      const snapshot: ProjectSnapshot = await repository.read(temp.projectPath);
      const result = addFiles(snapshot.document, {
        targetName: 'Debug',
        groups: [
          {
            groupName: 'App',
            files: [{ fileName: 'late.c', path: '.\\App\\late.c', fileType: 1 }],
          },
        ],
      });

      const externalText = `${snapshot.document.text}\n<!-- external change -->\n`;
      await fs.writeFile(temp.projectPath, externalText, 'utf8');

      const writer = new ProjectWriter(vscode.Uri.file(storage));
      await assert.rejects(
        writer.write(snapshot, result, true),
        (error: unknown) =>
          error instanceof KeilProjectError && error.code === 'conflict',
      );
      assert.equal(await fs.readFile(temp.projectPath, 'utf8'), externalText);
    } finally {
      await closeAllEditors();
      await fs.rm(storage, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(temp.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('aborts a GB byte write when the project changes between backup and write', async () => {
    const temp = await createTempProject('gb2312');
    const storage = path.join(os.tmpdir(), `keil-storage-${Date.now()}-${Math.random()}`);
    try {
      const repository = new ProjectRepository();
      const snapshot: ProjectSnapshot = await repository.read(temp.projectPath);
      const result = addFiles(snapshot.document, {
        targetName: 'Debug',
        groups: [
          {
            groupName: 'App',
            files: [{ fileName: 'late.c', path: '.\\App\\late.c', fileType: 1 }],
          },
        ],
      });
      const externalBytes = encodeProjectText(
        `${snapshot.document.text}<!-- external change -->`,
        'gb2312',
      );

      const writer = new ProjectWriter(vscode.Uri.file(storage));
      // Modify the file after writeInternal's verification, inside the backup
      // step, so only writeBytes' pre-write re-check can catch it.
      const patched = writer as unknown as {
        createBackup: (snapshot: ProjectSnapshot) => Promise<string>;
      };
      patched.createBackup = async () => {
        await fs.writeFile(temp.projectPath, externalBytes);
        return '';
      };

      await assert.rejects(
        writer.write(snapshot, result, true),
        (error: unknown) =>
          error instanceof KeilProjectError && /外部修改/.test(error.message),
      );
      assert.equal((await fs.readFile(temp.projectPath)).equals(externalBytes), true);
    } finally {
      await closeAllEditors();
      await fs.rm(storage, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(temp.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('restores the original bytes when a save loses the UTF-8 BOM', async () => {
    const temp = await createTempProject('utf8');
    const crlfText = temp.projectText.replace(/\n/g, '\r\n');
    const bomBytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(crlfText, 'utf8'),
    ]);
    await fs.writeFile(temp.projectPath, bomBytes);
    const storage = path.join(os.tmpdir(), `keil-storage-${Date.now()}-${Math.random()}`);
    try {
      const repository = new ProjectRepository();
      const snapshot: ProjectSnapshot = await repository.read(temp.projectPath);
      assert.equal(snapshot.document.charset, 'utf8bom');
      const result = addFiles(snapshot.document, {
        targetName: 'Debug',
        groups: [
          {
            groupName: 'App',
            files: [{ fileName: 'bom.c', path: '.\\App\\bom.c', fileType: 1 }],
          },
        ],
      });

      // Simulate an editor save that writes the text without the BOM.
      const writer = new ProjectWriter(vscode.Uri.file(storage));
      const patched = writer as unknown as {
        writeWithWorkspaceEdit: () => Promise<void>;
      };
      patched.writeWithWorkspaceEdit = async () => {
        await fs.writeFile(snapshot.path, Buffer.from(result.text, 'utf8'));
      };

      await assert.rejects(
        writer.write(snapshot, result, true),
        (error: unknown) =>
          error instanceof KeilProjectError && error.code === 'validation',
      );
      const after = await fs.readFile(temp.projectPath);
      assert.equal(
        after.equals(bomBytes),
        true,
        'BOM and original bytes must be restored',
      );
    } finally {
      await closeAllEditors();
      await fs.rm(storage, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(temp.root, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
