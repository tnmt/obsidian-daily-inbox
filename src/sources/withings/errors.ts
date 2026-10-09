export type WithingsSourceErrorKind = "auth-required" | "rate-limited" | "transient" | "malformed";

// Every failure WithingsSource surfaces at the source level. CancelledError is
// deliberately not one of these, matching the other sources.
export class WithingsSourceError extends Error {
  constructor(
    public readonly kind: WithingsSourceErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WithingsSourceError";
  }
}
