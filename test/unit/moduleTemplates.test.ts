import { describe, expect, it } from 'vitest';

import {
  moduleFileSet,
  normalizeModuleName,
  renderModuleHeader,
  renderModuleSource,
  validateModuleName,
} from '../../src/core/moduleTemplates';

describe('module templates', () => {
  it('renders the requested minimal header for MODULE', () => {
    expect(renderModuleHeader('MODULE', '\n')).toBe(
      '#ifndef _MODULE_H\n#define _MODULE_H\n#endif\n',
    );
  });

  it('derives folder, file names and guard from the module name', () => {
    expect(moduleFileSet('my-driver')).toEqual({
      moduleName: 'my-driver',
      folderName: 'my-driver',
      headerFileName: 'my-driver.h',
      sourceFileName: 'my-driver.c',
      includeGuard: '_MY_DRIVER_H',
    });
    expect(renderModuleSource('my-driver', '\n')).toBe('#include "my-driver.h"\n');
  });

  it('uses the project EOL for generated files', () => {
    expect(renderModuleHeader('led', '\r\n')).toBe(
      '#ifndef _LED_H\r\n#define _LED_H\r\n#endif\r\n',
    );
  });

  it('normalizes optional .c/.h suffixes', () => {
    expect(normalizeModuleName('  motor.c  ')).toBe('motor');
    expect(normalizeModuleName('motor.h')).toBe('motor');
    expect(normalizeModuleName('motor')).toBe('motor');
  });

  it('validates module names and rejects path-like or reserved names', () => {
    expect(validateModuleName('motor')).toEqual({ name: 'motor' });
    expect(validateModuleName('motor.c')).toEqual({ name: 'motor' });
    expect(validateModuleName('')).toHaveProperty('error');
    expect(validateModuleName('.hidden')).toHaveProperty('error');
    expect(validateModuleName('a/b')).toHaveProperty('error');
    expect(validateModuleName('CON')).toHaveProperty('error');
  });

  it('creates a valid guard for non-ASCII names', () => {
    const set = moduleFileSet('驱动');
    expect(set.includeGuard).toBe('____H');
    expect(renderModuleHeader('驱动', '\n')).toContain(`#ifndef ${set.includeGuard}`);
  });
});
