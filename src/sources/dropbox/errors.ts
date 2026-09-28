export type DropboxSourceErrorKind = "auth-required" | "transient" | "not-found";

// Wraps every failure DropboxSource can surface at the source level
// (architecture.md: "Authentication and API errors are surfaced as
// source-level errors"). CancelledError is deliberately not one of these —
// callers drop cancelled requests instead of rendering them as errors.
export class DropboxSourceError extends Error {
  constructor(
    public readonly kind: DropboxSourceErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DropboxSourceError";
  }
}
