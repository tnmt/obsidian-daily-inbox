import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { CancelledError } from "../dropbox/cancel";
import { searchCommits, searchIssues } from "./client";
import { GitHubSourceError } from "./errors";

function respond(status: number, body: unknown, headers: Record<string, string> = {}): RequestUrlResponse {
  return { status, headers, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
}

const commitItem = (n: number) => ({
  sha: `${String(n).padStart(7, "0")}abcdef`,
  html_url: `https://github.com/o/r/commit/${n}`,
  repository: { full_name: "o/r" },
  commit: { message: `msg ${n}`, author: { date: "2026-10-09T12:00:00.000+09:00" } },
});

const page = (items: unknown[], total = items.length, extra: object = {}) => ({
  total_count: total,
  incomplete_results: false,
  items,
  ...extra,
});

const signal = () => new AbortController().signal;

describe("search client", () => {
  it("sends the query, bearer token and API headers", async () => {
    const http = vi.fn(async (_req: RequestUrlParam) => respond(200, page([])));
    await searchCommits(http, " tok ", "author:u author-date:X", signal());
    const req = http.mock.calls[0][0];
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe("https://api.github.com/search/commits");
    expect(url.searchParams.get("q")).toBe("author:u author-date:X");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(req.headers?.Authorization).toBe("Bearer tok");
    expect(req.headers?.Accept).toBe("application/vnd.github+json");
  });

  it("follows pages until total_count is reached", async () => {
    const first = Array.from({ length: 100 }, (_, i) => commitItem(i));
    const second = Array.from({ length: 20 }, (_, i) => commitItem(100 + i));
    const http = vi
      .fn()
      .mockResolvedValueOnce(respond(200, page(first, 120)))
      .mockResolvedValueOnce(respond(200, page(second, 120)));
    const results = await searchCommits(http, "t", "q", signal());
    expect(results).toHaveLength(120);
    expect(http).toHaveBeenCalledTimes(2);
    expect(new URL(http.mock.calls[1][0].url).searchParams.get("page")).toBe("2");
  });

  it("maps pull request and issue results", async () => {
    const http = vi.fn(async () =>
      respond(
        200,
        page([
          {
            html_url: "https://github.com/o/r/pull/7",
            number: 7,
            title: "Fix",
            repository_url: "https://api.github.com/repos/o/r",
            created_at: "2026-10-09T01:00:00Z",
            closed_at: "2026-10-09T02:00:00Z",
            pull_request: { merged_at: "2026-10-09T02:00:00Z" },
          },
          {
            html_url: "https://github.com/o/r/issues/8",
            number: 8,
            title: "Bug",
            repository_url: "https://api.github.com/repos/o/r",
            created_at: "2026-10-09T01:00:00Z",
            closed_at: null,
            pull_request: null,
          },
        ]),
      ),
    );
    const [pr, issue] = await searchIssues(http, "t", "q", signal());
    expect(pr).toMatchObject({ isPullRequest: true, repository: "o/r", mergedAt: "2026-10-09T02:00:00Z" });
    expect(issue).toMatchObject({ isPullRequest: false, closedAt: undefined, mergedAt: undefined });
  });

  const kindOf = async (response: RequestUrlResponse | Error) => {
    const http = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    try {
      await searchCommits(http, "t", "q", signal());
    } catch (err) {
      return (err as GitHubSourceError).kind;
    }
    return "none";
  };

  it("distinguishes failure kinds", async () => {
    expect(await kindOf(respond(401, {}))).toBe("auth-required");
    expect(await kindOf(respond(403, {}))).toBe("auth-required");
    expect(await kindOf(respond(403, {}, { "X-RateLimit-Remaining": "0" }))).toBe("rate-limited");
    expect(await kindOf(respond(403, {}, { "Retry-After": "30" }))).toBe("rate-limited");
    expect(await kindOf(respond(429, {}))).toBe("rate-limited");
    expect(await kindOf(respond(422, {}))).toBe("invalid-user");
    expect(await kindOf(respond(503, {}))).toBe("transient");
    expect(await kindOf(new Error("offline"))).toBe("transient");
    expect(await kindOf(respond(200, { nope: true }))).toBe("malformed");
    expect(await kindOf(respond(200, page([{ sha: 1 }])))).toBe("malformed");
    expect(await kindOf(respond(200, page([], 0, { incomplete_results: true })))).toBe("incomplete");
  });

  it("stops without a request when already cancelled", async () => {
    const http = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(searchCommits(http, "t", "q", controller.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(http).not.toHaveBeenCalled();
  });
});
