import * as path from 'node:path';

import type { Eol } from './model';

export type TemplateKind = 'c' | 'h';

export interface TemplateInput {
  kind: TemplateKind;
  fileName: string;
  eol: Eol;
  customTemplate?: string;
  date?: Date;
}

const DEFAULT_C_TEMPLATE = `/**
 * @file \${filename}
 * @brief
 * @date \${date}
 */
`;

const DEFAULT_H_TEMPLATE = `/**
 * @file \${filename}
 * @brief
 * @date \${date}
 */
#ifndef \${includeGuard}
#define \${includeGuard}

#ifdef __cplusplus
extern "C" {
#endif

#ifdef __cplusplus
}
#endif

#endif /* \${includeGuard} */
`;

export function includeGuardFor(fileName: string): string {
  const stem = path.win32.basename(fileName, path.win32.extname(fileName));
  let guard = stem.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  if (guard.length === 0) {
    guard = 'FILE';
  }
  if (/^[0-9]/.test(guard)) {
    guard = `_${guard}`;
  }
  return `${guard}_H`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeEol(text: string, eol: Eol): string {
  return text.replace(/\r\n|\n|\r/g, eol);
}

export function renderSourceTemplate(input: TemplateInput): string {
  const date = input.date ?? new Date();
  const dateText = formatDate(date);
  const stem = path.win32.basename(input.fileName, path.win32.extname(input.fileName));
  const includeGuard = includeGuardFor(input.fileName);

  let template =
    input.customTemplate && input.customTemplate.length > 0
      ? input.customTemplate
      : input.kind === 'c'
        ? DEFAULT_C_TEMPLATE
        : DEFAULT_H_TEMPLATE;

  template = template
    .replace(/\$\{filename\}/g, input.fileName)
    .replace(/\$\{basename\}/g, stem)
    .replace(/\$\{date\}/g, dateText)
    .replace(/\$\{year\}/g, String(date.getFullYear()))
    .replace(/\$\{includeGuard\}/g, includeGuard);

  template = normalizeEol(template, input.eol);
  if (!template.endsWith(input.eol)) {
    template += input.eol;
  }
  return template;
}
