import { validateFileName } from './paths';
import type { Eol } from './model';

export interface ModuleFileSet {
  moduleName: string;
  folderName: string;
  headerFileName: string;
  sourceFileName: string;
  includeGuard: string;
}

export interface ModuleNameValidation {
  name?: string;
  error?: string;
}

/**
 * Accepts either a bare module name or one accidentally entered with a
 * .c/.h suffix. The module name is used for the folder and both file names.
 */
export function normalizeModuleName(input: string): string {
  return input
    .trim()
    .replace(/\.(?:c|h)$/i, '')
    .trim();
}

export function validateModuleName(input: string): ModuleNameValidation {
  const name = normalizeModuleName(input);
  if (name.length === 0) {
    return { error: '模块名不能为空。' };
  }
  if (name.startsWith('.')) {
    return { error: '模块名不能以点开头。' };
  }
  const validation = validateFileName(name);
  if (validation.error) {
    return validation;
  }
  return { name };
}

export function moduleFileSet(moduleName: string): ModuleFileSet {
  let guardBase = moduleName.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  if (guardBase.length === 0) {
    guardBase = 'MODULE';
  }
  return {
    moduleName,
    folderName: moduleName,
    headerFileName: `${moduleName}.h`,
    sourceFileName: `${moduleName}.c`,
    includeGuard: `_${guardBase}_H`,
  };
}

/**
 * The header intentionally contains only the include guard. It mirrors the
 * minimal module skeleton requested by the product workflow.
 */
export function renderModuleHeader(moduleName: string, eol: Eol): string {
  const { includeGuard } = moduleFileSet(moduleName);
  return [`#ifndef ${includeGuard}`, `#define ${includeGuard}`, '#endif', ''].join(eol);
}

export function renderModuleSource(moduleName: string, eol: Eol): string {
  const { headerFileName } = moduleFileSet(moduleName);
  return `#include "${headerFileName}"${eol}`;
}
