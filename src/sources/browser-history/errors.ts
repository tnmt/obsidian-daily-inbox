export type BrowserHistorySourceErrorKind = "sqlite3-missing" | "unreadable" | "malformed";

// Mirrors dropbox/errors.ts's DropboxSourceError. CancelledError is
// deliberately not one of these — callers drop cancelled requests instead of
// rendering them as errors.
export class BrowserHistorySourceError extends Error {
  constructor(
    public readonly kind: BrowserHistorySourceErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BrowserHistorySourceError";
  }
}
