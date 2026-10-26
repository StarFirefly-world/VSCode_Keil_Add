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

export function isSupportedFile(filePath: string): boolean {
  return fileTypeForPath(filePath) !== undefined;
}

export function isHeaderFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.h');
}

export function fileTypeLabel(fileType: number): string {
  switch (fileType) {
    case 1:
      return 'C Source';
    case 2:
      return 'Assembly';
    case 4:
      return 'Library';
    case 5:
      return 'Header/Text';
    case 8:
      return 'C++ Source';
    default:
      return `FileType ${fileType}`;
  }
}
