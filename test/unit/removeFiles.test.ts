import { describe, expect, it } from 'vitest';

import { parseProject } from '../../src/core/parseProject';
import { removeFilesInDirectory } from '../../src/core/removeFiles';
import type { Eol } from '../../src/core/model';

const PROJECT = 'D:\\work\\demo\\demo.uvprojx';
const MODULE_DIR = 'D:\\work\\HARDWARE\\motor';

function projectText(eol: Eol = '\n'): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Project>',
    '  <Targets>',
    '    <Target>',
    '      <TargetName>Debug</TargetName>',
    '      <Groups>',
    '        <Group>',
    '          <GroupName>App</GroupName>',
    '          <Files>',
    '            <File>',
    '              <FileName>main.c</FileName>',
    '              <FileType>1</FileType>',
    '              <FilePath>.\\App\\main.c</FilePath>',
    '            </File>',
    '            <File>',
    '              <FileName>motor.c</FileName>',
    '              <FileType>1</FileType>',
    '              <FilePath>..\\HARDWARE\\motor\\motor.c</FilePath>',
    '            </File>',
    '          </Files>',
    '        </Group>',
    '      </Groups>',
    '    </Target>',
    '    <Target>',
    '      <TargetName>Release</TargetName>',
    '      <Groups>',
    '        <Group>',
    '          <GroupName>Drivers</GroupName>',
    '          <Files>',
    '            <File>',
    '              <FileName>motor.c</FileName>',
    '              <FileType>1</FileType>',
    '              <FilePath>..\\HARDWARE\\motor\\motor.c</FilePath>',
    '            </File>',
    '            <File>',
    '              <FileName>motor.h</FileName>',
    '              <FileType>5</FileType>',
    '              <FilePath>..\\HARDWARE\\motor\\motor.h</FilePath>',
    '            </File>',
    '          </Files>',
    '        </Group>',
    '      </Groups>',
    '    </Target>',
    '  </Targets>',
    '</Project>',
    '',
  ];
  return lines.join(eol);
}

describe('removeFilesInDirectory', () => {
  it('removes all module entries across targets and keeps other files', () => {
    const project = parseProject(projectText(), PROJECT);
    const result = removeFilesInDirectory(project, MODULE_DIR);

    expect(result.filesRemoved).toBe(3);
    expect(result.entries.map((entry) => entry.targetName)).toEqual([
      'Debug',
      'Release',
      'Release',
    ]);
    expect(result.insertions).toHaveLength(3);
    expect(result.insertions.every((edit) => edit.length && edit.length > 0)).toBe(true);
    expect(result.text).not.toContain('motor.c');
    expect(result.text).not.toContain('motor.h');
    expect(result.text).toContain('.\\App\\main.c');

    const updated = parseProject(result.text, PROJECT);
    expect(updated.targets[0].groups[0].files.map((file) => file.name)).toEqual([
      'main.c',
    ]);
    expect(updated.targets[1].groups[0].files).toEqual([]);
    expect(updated.targets.map((target) => target.name)).toEqual(['Debug', 'Release']);
    expect(updated.targets[1].groups[0].name).toBe('Drivers');
  });

  it('does not match sibling directories with the same prefix', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Targets>
    <Target>
      <TargetName>Debug</TargetName>
      <Groups>
        <Group>
          <GroupName>App</GroupName>
          <Files>
            <File>
              <FileName>a.c</FileName>
              <FileType>1</FileType>
              <FilePath>.\\App\\a.c</FilePath>
            </File>
            <File>
              <FileName>b.c</FileName>
              <FileType>1</FileType>
              <FilePath>.\\App2\\b.c</FilePath>
            </File>
          </Files>
        </Group>
      </Groups>
    </Target>
  </Targets>
</Project>
`;
    const result = removeFilesInDirectory(
      parseProject(text, PROJECT),
      'D:\\work\\demo\\App',
    );
    expect(result.filesRemoved).toBe(1);
    expect(result.text).not.toContain('.\\App\\a.c');
    expect(result.text).toContain('.\\App2\\b.c');
  });

  it('returns unchanged text when the directory is not referenced', () => {
    const project = parseProject(projectText(), PROJECT);
    const result = removeFilesInDirectory(project, 'D:\\work\\demo\\HARDWARE\\other');
    expect(result.filesRemoved).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.insertions).toEqual([]);
    expect(result.text).toBe(project.text);
  });

  it('preserves CRLF when removing entries', () => {
    const project = parseProject(projectText('\r\n'), PROJECT);
    const result = removeFilesInDirectory(project, MODULE_DIR);
    expect(result.filesRemoved).toBe(3);
    expect(result.text.includes('\r\n')).toBe(true);
    expect(result.text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parseProject(result.text, PROJECT).eol).toBe('\r\n');
  });

  it('removes only the File lines and leaves surrounding comments intact', () => {
    const text = projectText().replace(
      '            <File>\n              <FileName>motor.c</FileName>',
      '            <!-- module -->\n            <File>\n              <FileName>motor.c</FileName>',
    );
    const result = removeFilesInDirectory(parseProject(text, PROJECT), MODULE_DIR);
    expect(result.text).toContain('            <!-- module -->');
    expect(result.text).not.toContain('<FileName>motor.c</FileName>');
  });
});
