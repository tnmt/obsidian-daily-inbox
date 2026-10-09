import { throwIfAborted } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { GitHubSourceError } from "./errors";

export interface CommitResult {
  readonly sha: string;
  readonly url: string;
  /** `owner/name`. */
  readonly repository: string;
  readonly message: string;
  /** Author date, the timestamp `author-date:` matches against. */
  readonly authoredAt: string;
}

export interface IssueResult {
  readonly url: string;
  readonly number: number;
  readonly repository: string;
  readonly title: string;
  readonly isPullRequest: boolean;
  readonly createdAt: string;
  readonly closedAt?: string;
  readonly mergedAt?: string;
}

const API = "https://api.github.com";
const PER_PAGE = 100;
// Search never returns more than 1000 results for a query.
const MAX_PAGES = 10;

function header(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

async function searchAll<T>(
  http: HttpRequester,
  token: string,
  path: "commits" | "issues",
  query: string,
  signal: AbortSignal,
  parseItem: (raw: unknown) => T,
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    throwIfAborted(signal);
    const params = new URLSearchParams({ q: query, per_page: String(PER_PAGE), page: String(page) });
    let response;
    try {
      response = await http({
        url: `${API}/search/${path}?${params.toString()}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        throw: false,
      });
    } catch (err) {
      throwIfAborted(signal);
      throw new GitHubSourceError("transient", "Could not reach GitHub.", err);
    }
    throwIfAborted(signal);

    if (
      response.status === 429 ||
      (response.status === 403 && (isRateLimited(response.headers) || /rate limit/i.test(errorDetail(response) ?? "")))
    ) {
      throw new GitHubSourceError("rate-limited", "GitHub search rate limit reached.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitHubSourceError("auth-required", `GitHub rejected the token (${response.status}).`);
    }
    if (response.status === 422) {
      // 422 is GitHub's answer to any invalid query, not only an unsearchable
      // user, so only the documented user message is reported as that.
      const detail = errorDetail(response);
      if (detail !== undefined && /cannot be searched/i.test(detail)) {
        throw new GitHubSourceError("invalid-user", "GitHub could not search the configured user.", undefined, detail);
      }
      throw new GitHubSourceError("invalid-query", "GitHub rejected the search query.", undefined, detail);
    }
    if (response.status >= 400) {
      throw new GitHubSourceError("transient", `GitHub error (${response.status}).`);
    }

    let body: unknown;
    try {
      body = response.json;
    } catch (err) {
      throw new GitHubSourceError("malformed", "GitHub returned invalid JSON.", err);
    }
    if (!isRecord(body) || !Array.isArray(body.items) || typeof body.total_count !== "number") {
      throw new GitHubSourceError("malformed", "Unexpected GitHub search response shape.");
    }
    if (body.incomplete_results === true) {
      throw new GitHubSourceError("incomplete", "GitHub search timed out and returned partial results.");
    }
    results.push(...body.items.map(parseItem));
    if (body.items.length < PER_PAGE || results.length >= body.total_count) break;
  }
  return results;
}

// A 422 from search names the cause only in the body, e.g. a token that
// cannot see the user, so that text is the actionable part for the user.
function errorDetail(response: { json: unknown }): string | undefined {
  let body: unknown;
  try {
    body = response.json;
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  const messages = Array.isArray(body.errors)
    ? body.errors.flatMap((e) => (isRecord(e) && typeof e.message === "string" ? [e.message] : []))
    : [];
  if (messages.length > 0) return messages.join(" ");
  return typeof body.message === "string" ? body.message : undefined;
}

function isRateLimited(headers: Record<string, string>): boolean {
  return header(headers, "x-ratelimit-remaining") === "0" || header(headers, "retry-after") !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new GitHubSourceError("malformed", `Unexpected ${what} in GitHub response.`);
  return value;
}

// Events are placed on a date by their timestamp, so an unparsable one would
// be silently dropped as "outside the day" rather than reported.
function timestamp(value: unknown, what: string): string {
  const text = str(value, what);
  if (Number.isNaN(Date.parse(text))) {
    throw new GitHubSourceError("malformed", `Unexpected ${what} in GitHub response.`);
  }
  return text;
}

function optionalTimestamp(value: unknown, what: string): string | undefined {
  return value === null || value === undefined ? undefined : timestamp(value, what);
}

export function parseCommit(raw: unknown): CommitResult {
  if (!isRecord(raw) || !isRecord(raw.commit) || !isRecord(raw.commit.author) || !isRecord(raw.repository)) {
    throw new GitHubSourceError("malformed", "Unexpected commit in GitHub response.");
  }
  return {
    sha: str(raw.sha, "commit sha"),
    url: str(raw.html_url, "commit url"),
    repository: str(raw.repository.full_name, "repository name"),
    message: str(raw.commit.message, "commit message"),
    authoredAt: timestamp(raw.commit.author.date, "commit date"),
  };
}

const REPOS_PREFIX = "/repos/";

export function parseIssue(raw: unknown): IssueResult {
  if (!isRecord(raw) || typeof raw.number !== "number") {
    throw new GitHubSourceError("malformed", "Unexpected issue in GitHub response.");
  }
  let repoPath: string;
  try {
    repoPath = new URL(str(raw.repository_url, "repository url")).pathname;
  } catch (err) {
    if (err instanceof GitHubSourceError) throw err;
    throw new GitHubSourceError("malformed", "Unexpected repository url in GitHub response.", err);
  }
  if (!repoPath.startsWith(REPOS_PREFIX)) {
    throw new GitHubSourceError("malformed", "Unexpected repository url in GitHub response.");
  }
  const pullRequest = isRecord(raw.pull_request) ? raw.pull_request : undefined;
  return {
    url: str(raw.html_url, "issue url"),
    number: raw.number,
    repository: repoPath.slice(REPOS_PREFIX.length),
    title: str(raw.title, "issue title"),
    isPullRequest: pullRequest !== undefined,
    createdAt: timestamp(raw.created_at, "created_at"),
    closedAt: optionalTimestamp(raw.closed_at, "closed_at"),
    mergedAt: optionalTimestamp(pullRequest?.merged_at, "merged_at"),
  };
}

export function searchCommits(http: HttpRequester, token: string, query: string, signal: AbortSignal) {
  return searchAll(http, token, "commits", query, signal, parseCommit);
}

export function searchIssues(http: HttpRequester, token: string, query: string, signal: AbortSignal) {
  return searchAll(http, token, "issues", query, signal, parseIssue);
}
