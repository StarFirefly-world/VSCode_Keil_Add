import { describe, expect, it } from 'vitest';

import { KeilProjectError } from '../../src/core/errors';
import { parseProject } from '../../src/core/parseProject';
import { fixture } from '../helpers';

const PROJECT = 'D:\\work\\demo\\demo.uvprojx';

describe('parseProject', () => {
  it('parses targets, groups, files and positions', () => {
    const text = fixture('sample.uvprojx');
    const project = parseProject(text, PROJECT);

    expect(project.charset).toBe('utf8');
    expect(project.eol).toBe('\n');
    expect(project.indentUnit).toBe('  ');
    expect(project.targets.map((target) => target.name)).toEqual(['Debug', 'Release']);

    const debug = project.targets[0];
    expect(debug.groups.map((group) => group.name)).toEqual(['App', 'Drivers']);
    expect(debug.groups[0].files).toEqual([
      { name: 'main.c', fileType: 1, path: '.\\App\\main.c' },
      { name: 'util.h', fileType: 5, path: '.\\App\\util.h' },
    ]);

    expect(debug.targetClose).toBeGreaterThan(0);
    expect(text.slice(debug.targetClose, debug.targetClose + 9)).toBe('</Target>');
    expect(debug.groupsClose).toBeDefined();
    expect(text.slice(debug.groupsClose, debug.groupsClose! + 9)).toBe('</Groups>');
    const app = debug.groups[0];
    expect(app.groupClose).toBeGreaterThan(0);
    expect(text.slice(app.groupClose, app.groupClose + 8)).toBe('</Group>');
    expect(app.filesClose).toBeDefined();
    expect(text.slice(app.filesClose, app.filesClose! + 8)).toBe('</Files>');
  });

  it('detects CRLF and indentation', () => {
    const text = fixture('sample.uvprojx').replace(/\n/g, '\r\n');
    const project = parseProject(text, PROJECT);
    expect(project.eol).toBe('\r\n');
    expect(project.indentUnit).toBe('  ');
  });

  it('decodes XML entities in names and paths', () => {
    const text = fixture('sample.uvprojx').replace(
      '.\\App\\main.c',
      '.\\App\\A &amp; B &lt;x&gt;.c',
    );
    const project = parseProject(text, PROJECT);
    expect(project.targets[0].groups[0].files[0].path).toBe('.\\App\\A & B <x>.c');
  });

  it('rejects malformed XML', () => {
    expect(() => parseProject('<Project><Targets><Target></Project>', PROJECT)).toThrow(
      KeilProjectError,
    );
  });

  it('rejects a project without targets', () => {
    expect(() =>
      parseProject('<Project><SchemaVersion>2.1</SchemaVersion></Project>', PROJECT),
    ).toThrow(/没有找到任何 Target/);
  });

  it('supports a target without a Groups element', () => {
    const text = `<Project>
  <Targets>
    <Target>
      <TargetName>Only</TargetName>
      <TargetOption><Device>X</Device></TargetOption>
    </Target>
  </Targets>
</Project>
`;
    const project = parseProject(text, PROJECT);
    expect(project.targets[0].name).toBe('Only');
    expect(project.targets[0].groups).toEqual([]);
    expect(project.targets[0].groupsClose).toBeUndefined();
    expect(project.targets[0].targetClose).toBeGreaterThan(0);
  });

  it('supports tab indentation', () => {
    const text = fixture('sample.uvprojx').replace(/^ +/gm, (spaces) =>
      '\t'.repeat(spaces.length / 2),
    );
    const project = parseProject(text, PROJECT);
    expect(project.indentUnit).toBe('\t');
  });

  it('detects a self-closing Files tag', () => {
    const text = `<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups>
        <Group>
          <GroupName>App</GroupName>
          <Files />
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;
    const project = parseProject(text, PROJECT);
    const app = project.targets[0].groups[0];
    expect(app.files).toEqual([]);
    expect(app.filesIsSelfClosing).toBe(true);
    expect(text.slice(app.filesClose!, app.filesClose! + 9)).toBe('<Files />');
  });

  it('detects a self-closing Groups tag', () => {
    const text = `<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups />
    </Target>
  </Targets>
</Project>
`;
    const project = parseProject(text, PROJECT);
    expect(project.targets[0].groups).toEqual([]);
    expect(project.targets[0].groupsIsSelfClosing).toBe(true);
    expect(
      text.slice(project.targets[0].groupsClose!, project.targets[0].groupsClose! + 10),
    ).toBe('<Groups />');
  });
});
