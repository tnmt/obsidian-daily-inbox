export type GitHubSourceErrorKind =
  | "auth-required"
  | "invalid-user"
  | "rate-limited"
  | "incomplete"
  | "transient"
  | "malformed";

// Every failure GitHubSource surfaces at the source level. CancelledError is
// deliberately not one of these, matching the other sources.
export class GitHubSourceError extends Error {
  constructor(
    public readonly kind: GitHubSourceErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GitHubSourceError";
  }
}
