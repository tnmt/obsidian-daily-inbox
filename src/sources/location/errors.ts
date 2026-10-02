export type LocationSourceErrorKind = "auth-required" | "not-found" | "transient" | "malformed";

// Every failure LocationSource surfaces at the source level. CancelledError is
// deliberately not one of these, matching the other sources.
export class LocationSourceError extends Error {
  constructor(
    public readonly kind: LocationSourceErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocationSourceError";
  }
}
