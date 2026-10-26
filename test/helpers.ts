import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}
