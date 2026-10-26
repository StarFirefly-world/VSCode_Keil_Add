const EXTENSION_TO_FILE_TYPE: Readonly<Record<string, number>> = {
  '.c': 1,
  '.s': 2,
  '.asm': 2,
  '.lib': 4,
  '.h': 5,
  '.txt': 5,
  '.cpp': 8,
};

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze(
  Object.keys(EXTENSION_TO_FILE_TYPE),
);

export function fileTypeForPath(filePath: string): number | undefined {
  const normalized = filePath.replace(/\\/g, '/');
  const baseName = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = baseName.lastIndexOf('.');
  if (dot < 0) {
    return undefined;
  }
  return EXTENSION_TO_FILE_TYPE[baseName.slice(dot).toLowerCase()];
}
