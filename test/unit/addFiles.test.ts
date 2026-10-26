import { describe, expect, it } from 'vitest';

import { addFiles } from '../../src/core/addFiles';
import { KeilProjectError } from '../../src/core/errors';
import { parseProject } from '../../src/core/parseProject';
import { fixture } from '../helpers';

const PROJECT = 'D:\\work\\demo\\demo.uvprojx';

function project(text = fixture('sample.uvprojx')) {
  return parseProject(text, PROJECT);
}

function removeInsertions(
  text: string,
  insertions: Array<{ offset: number; text: string }>,
): string {
  let result = text;
  for (const insertion of [...insertions].sort((a, b) => b.offset - a.offset)) {
    expect(result.slice(insertion.offset, insertion.offset + insertion.text.length)).toBe(
      insertion.text,
    );
    result =
      result.slice(0, insertion.offset) +
      result.slice(insertion.offset + insertion.text.length);
  }
  return result;
}

describe('addFiles', () => {
  it('inserts a file into an existing group with minimal edits', () => {
    const original = project();
    const result = addFiles(original, {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'app.c', path: '.\\App\\app.c', fileType: 1 }],
        },
      ],
    });

    expect(result.filesAdded).toBe(1);
    expect(result.groupsCreated).toEqual([]);
    expect(removeInsertions(result.text, result.insertions)).toBe(original.text);
    expect(result.text).toContain(
      [
        '            <File>',
        '              <FileName>app.c</FileName>',
        '              <FileType>1</FileType>',
        '              <FilePath>.\\App\\app.c</FilePath>',
        '            </File>',
      ].join('\n'),
    );

    const updated = parseProject(result.text, PROJECT);
    const app = updated.targets[0].groups[0];
    expect(app.files.map((file) => file.name)).toEqual(['main.c', 'util.h', 'app.c']);
  });

  it('creates a group in the selected target only', () => {
    const original = project();
    const result = addFiles(original, {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'Modules',
          files: [
            { fileName: 'spi.c', path: '.\\Modules\\spi.c', fileType: 1 },
            { fileName: 'spi.h', path: '.\\Modules\\spi.h', fileType: 5 },
          ],
        },
      ],
    });

    expect(result.groupsCreated).toEqual(['Modules']);
    const updated = parseProject(result.text, PROJECT);
    expect(updated.targets[0].groups.map((group) => group.name)).toEqual([
      'App',
      'Drivers',
      'Modules',
    ]);
    expect(updated.targets[1].groups.map((group) => group.name)).toEqual(['App']);
    expect(updated.targets[1].groups[0].files).toEqual([]);
    expect(updated.targets[0].groups[2].files).toHaveLength(2);
  });

  it('creates a Files element when the group has none', () => {
    const text = `<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups>
        <Group>
          <GroupName>App</GroupName>
          <GroupOption><CommonProperty><IncludePath></IncludePath></CommonProperty></GroupOption>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;
    const result = addFiles(project(text), {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'a.c', path: '.\\a.c', fileType: 1 }],
        },
      ],
    });
    expect(result.text).toContain('          <Files>');
    expect(result.text).toContain('            <File>');
    expect(parseProject(result.text, PROJECT).targets[0].groups[0].files).toHaveLength(1);
  });

  it('creates a Groups element when the target has none', () => {
    const text = `<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <TargetOption><Device>X</Device></TargetOption>
    </Target>
  </Targets>
</Project>
`;
    const result = addFiles(project(text), {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'a.c', path: '.\\a.c', fileType: 1 }],
        },
      ],
    });
    expect(result.text).toContain('      <Groups>');
    expect(result.text).toContain('        <Group>');
    expect(parseProject(result.text, PROJECT).targets[0].groups[0].name).toBe('App');
  });

  it('escapes XML special characters in paths and names', () => {
    const result = addFiles(project(), {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'A & B',
          files: [
            {
              fileName: 'a&b.c',
              path: '.\\A & B\\a&b<1>.c',
              fileType: 1,
            },
          ],
        },
      ],
    });
    expect(result.text).toContain('<GroupName>A &amp; B</GroupName>');
    expect(result.text).toContain('<FileName>a&amp;b.c</FileName>');
    expect(result.text).toContain(
      '<FilePath>.\\A &amp; B\\a&amp;b&lt;1&gt;.c</FilePath>',
    );
    const updated = parseProject(result.text, PROJECT);
    const group = updated.targets[0].groups[2];
    expect(group.name).toBe('A & B');
    expect(group.files[0].name).toBe('a&b.c');
    expect(group.files[0].path).toBe('.\\A & B\\a&b<1>.c');
  });

  it('does not reject pre-existing duplicate paths in the target', () => {
    const duplicateEntry = [
      '          <Files>',
      '            <File>',
      '              <FileName>main.c</FileName>',
      '              <FileType>1</FileType>',
      '              <FilePath>.\\App\\main.c</FilePath>',
      '            </File>',
    ].join('\n');
    const text = fixture('sample.uvprojx').replace(
      '          <GroupName>Drivers</GroupName>\n          <Files>',
      `          <GroupName>Drivers</GroupName>\n${duplicateEntry}`,
    );
    const original = parseProject(text, PROJECT);
    expect(original.targets[0].groups.flatMap((group) => group.files)).toHaveLength(4);

    const result = addFiles(original, {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'new.c', path: '.\\App\\new.c', fileType: 1 }],
        },
      ],
    });
    const updated = parseProject(result.text, PROJECT);
    const mainEntries = updated.targets[0].groups
      .flatMap((group) => group.files)
      .filter((file) => file.name === 'main.c');
    expect(mainEntries).toHaveLength(2);
    expect(
      updated.targets[0].groups
        .flatMap((group) => group.files)
        .some((file) => file.name === 'new.c'),
    ).toBe(true);
  });

  it('rejects duplicate paths in the same target', () => {
    expect(() =>
      addFiles(project(), {
        targetName: 'Debug',
        groups: [
          {
            groupName: 'Drivers',
            files: [
              {
                fileName: 'main.c',
                path: '.\\App\\MAIN.C',
                fileType: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow(/已存在/);
  });

  it('rejects duplicate paths inside the request using normalized relative paths', () => {
    expect(() =>
      addFiles(project(), {
        targetName: 'Debug',
        groups: [
          {
            groupName: 'New',
            files: [
              { fileName: 'a.c', path: '.\\New\\a.c', fileType: 1 },
              { fileName: 'a.c', path: 'New/a.c', fileType: 1 },
            ],
          },
        ],
      }),
    ).toThrow(KeilProjectError);
  });

  it('creates an empty group with an empty Files element', () => {
    const result = addFiles(project(), {
      targetName: 'Debug',
      groups: [{ groupName: 'Modules', files: [] }],
    });
    expect(result.groupsCreated).toEqual(['Modules']);
    expect(result.filesAdded).toBe(0);
    expect(result.text).toContain(
      [
        '        <Group>',
        '          <GroupName>Modules</GroupName>',
        '          <Files>',
        '          </Files>',
        '        </Group>',
      ].join('\n'),
    );
    const updated = parseProject(result.text, PROJECT);
    expect(updated.targets[0].groups.at(-1)).toMatchObject({
      name: 'Modules',
      files: [],
    });
  });

  it('rejects an unknown target', () => {
    expect(() =>
      addFiles(project(), {
        targetName: 'Nope',
        groups: [],
      }),
    ).toThrow(/未找到 Target/);
  });

  it('keeps CRLF line endings and no unrelated bytes when inserting', () => {
    const text = fixture('sample.uvprojx').replace(/\n/g, '\r\n');
    const original = project(text);
    const result = addFiles(original, {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'x.c', path: '.\\App\\x.c', fileType: 1 }],
        },
      ],
    });
    expect(result.text).toContain('\r\n');
    expect(result.text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(removeInsertions(result.text, result.insertions)).toBe(original.text);
  });

  it('adds files to two groups in one operation', () => {
    const result = addFiles(project(), {
      targetName: 'Debug',
      groups: [
        {
          groupName: 'App',
          files: [{ fileName: 'a.c', path: '.\\App\\a.c', fileType: 1 }],
        },
        {
          groupName: 'Drivers',
          files: [{ fileName: 'b.c', path: '.\\Drivers\\b.c', fileType: 1 }],
        },
      ],
    });
    const updated = parseProject(result.text, PROJECT);
    expect(updated.targets[0].groups[0].files.at(-1)?.name).toBe('a.c');
    expect(updated.targets[0].groups[1].files.at(-1)?.name).toBe('b.c');
    expect(result.filesAdded).toBe(2);
  });
});
