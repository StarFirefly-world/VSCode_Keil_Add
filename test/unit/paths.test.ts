import { describe, expect, it } from 'vitest';

import {
  canonicalFileKey,
  commonDirectory,
  isPathInside,
  isPathInsideDirectory,
  overallProjectRoot,
  toKeilPath,
  validateFileName,
  xmlEscape,
} from '../../src/core/paths';
import { fileTypeForPath, isSupportedFile } from '../../src/core/fileTypes';
import { includeGuardFor, renderSourceTemplate } from '../../src/core/templates';

const PROJECT = 'D:\\work\\demo\\demo.uvprojx';

describe('paths', () => {
  it('creates .\\ relative paths inside the project', () => {
    expect(toKeilPath(PROJECT, 'D:\\work\\demo\\App\\main.c')).toEqual({
      path: '.\\App\\main.c',
      outsideProject: false,
      differentDrive: false,
    });
  });

  it('keeps .. relative paths outside the project but on the same drive', () => {
    expect(toKeilPath(PROJECT, 'D:\\work\\lib\\util.c')).toEqual({
      path: '..\\lib\\util.c',
      outsideProject: true,
      differentDrive: false,
    });
  });

  it('uses absolute paths for a different drive', () => {
    expect(toKeilPath(PROJECT, 'E:\\lib\\util.c')).toEqual({
      path: 'E:\\lib\\util.c',
      outsideProject: true,
      differentDrive: true,
    });
  });

  it('normalizes forward slashes and case for deduplication', () => {
    expect(canonicalFileKey(PROJECT, '.\\App\\MAIN.C')).toBe(
      canonicalFileKey(PROJECT, 'd:/work/demo/App/main.c'),
    );
  });

  it('recognizes paths inside the project', () => {
    expect(isPathInside(PROJECT, 'D:\\work\\demo\\App\\a.c')).toBe(true);
    expect(isPathInside(PROJECT, 'D:\\work\\other\\a.c')).toBe(false);
  });

  it('checks containment against an arbitrary project root', () => {
    expect(isPathInsideDirectory('D:\\work\\demo', 'D:\\work\\demo\\HARDWARE')).toBe(
      true,
    );
    expect(isPathInsideDirectory('D:\\work\\demo', 'D:\\work\\demo')).toBe(true);
    expect(isPathInsideDirectory('D:\\work\\demo', 'D:\\work\\other\\HARDWARE')).toBe(
      false,
    );
    expect(isPathInsideDirectory('D:\\work\\demo', 'E:\\demo\\HARDWARE')).toBe(false);
  });

  it('derives the overall project root for module folders', () => {
    const project = 'D:\\work\\demo\\MDK-ARM\\demo.uvprojx';
    expect(overallProjectRoot(project)).toBe('D:\\work\\demo\\MDK-ARM');
    expect(overallProjectRoot(project, 'D:\\work\\demo\\MDK-ARM')).toBe('D:\\work\\demo');
    expect(overallProjectRoot(project, 'D:\\work\\demo')).toBe('D:\\work\\demo');
    expect(overallProjectRoot('D:\\work\\demo\\demo.uvprojx', 'D:\\work\\demo')).toBe(
      'D:\\work\\demo',
    );
    expect(overallProjectRoot('D:\\demo.uvprojx', 'D:\\')).toBe('D:\\');
  });

  it('finds the common directory of group files', () => {
    expect(
      commonDirectory(['D:\\work\\demo\\App\\a.c', 'D:\\work\\demo\\App\\sub\\b.c']),
    ).toBe('D:\\work\\demo\\App');
    expect(commonDirectory(['D:\\work\\demo\\App\\a.c'])).toBe('D:\\work\\demo\\App');
    expect(commonDirectory([])).toBeUndefined();
    expect(
      commonDirectory(['D:\\work\\demo\\App\\a.c', 'E:\\other\\b.c']),
    ).toBeUndefined();
    expect(
      commonDirectory([
        '\\\\server\\share\\App\\a.c',
        '\\\\server\\share\\App\\sub\\b.c',
      ]),
    ).toBe('\\\\server\\share\\App');
  });

  it('validates and normalizes new file names', () => {
    expect(validateFileName('app', '.c')).toEqual({ name: 'app.c' });
    expect(validateFileName('app.c', '.c')).toEqual({ name: 'app.c' });
    expect(validateFileName('app.h', '.c')).toEqual({
      error: '扩展名必须为 .c。',
    });
    expect(validateFileName('a/b.c')).toHaveProperty('error');
    expect(validateFileName('CON.c')).toHaveProperty('error');
    expect(validateFileName('name. ')).toHaveProperty('error');
    expect(validateFileName('')).toHaveProperty('error');
  });

  it('escapes XML text', () => {
    expect(xmlEscape('A & B <c>')).toBe('A &amp; B &lt;c&gt;');
  });
});

describe('file types', () => {
  it('maps Keil file extensions', () => {
    expect(fileTypeForPath('main.c')).toBe(1);
    expect(fileTypeForPath('startup.S')).toBe(2);
    expect(fileTypeForPath('lib.a.lib')).toBe(4);
    expect(fileTypeForPath('app.h')).toBe(5);
    expect(fileTypeForPath('readme.txt')).toBe(5);
    expect(fileTypeForPath('main.cpp')).toBe(8);
  });

  it('rejects unknown extensions', () => {
    expect(fileTypeForPath('main.rs')).toBeUndefined();
    expect(isSupportedFile('main.rs')).toBe(false);
  });
});

describe('templates', () => {
  it('renders a C template with placeholders', () => {
    const text = renderSourceTemplate({
      kind: 'c',
      fileName: 'app.c',
      eol: '\n',
      customTemplate: '// ${filename} ${basename} ${year}\n',
      date: new Date(2026, 9, 26),
    });
    expect(text).toBe('// app.c app 2026\n');
  });

  it('renders an include guard for headers', () => {
    const text = renderSourceTemplate({
      kind: 'h',
      fileName: 'my-driver.h',
      eol: '\r\n',
    });
    expect(text).toContain('#ifndef MY_DRIVER_H');
    expect(text).toContain('#define MY_DRIVER_H');
    expect(text).toContain('#endif /* MY_DRIVER_H */');
    expect(text).toContain('\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('creates a valid guard for unusual names', () => {
    expect(includeGuardFor('123.h')).toBe('_123_H');
    expect(includeGuardFor('中文.h')).toBe('___H');
  });

  it('uses the built-in C template when no custom template is configured', () => {
    const text = renderSourceTemplate({
      kind: 'c',
      fileName: 'main.c',
      eol: '\n',
      customTemplate: '',
      date: new Date(2026, 9, 26),
    });
    expect(text).toContain('@file main.c');
    expect(text).toContain('2026-10-26');
  });
});
