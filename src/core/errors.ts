export type KeilProjectErrorCode =
  | 'parse'
  | 'invalid-project'
  | 'target-not-found'
  | 'group-not-found'
  | 'duplicate-file'
  | 'invalid-file-name'
  | 'unsupported-file'
  | 'encoding'
  | 'validation'
  | 'conflict'
  | 'io'
  | 'busy'
  | 'cancelled';

export class KeilProjectError extends Error {
  public constructor(
    public readonly code: KeilProjectErrorCode,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'KeilProjectError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
