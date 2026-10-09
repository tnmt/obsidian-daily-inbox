import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import { GitHubSource } from "./github-source";
import type { GitHubSettings } from "./settings";

const context: DailyContext = { date: localDate("2026-10-09") };
const settings: GitHubSettings = { username: "tnmt", token: "t", includeCommits: true };

const commit = (sha: string, repo: string, at: string, message: string) => ({
  sha,
  html_url: `https://github.com/${repo}/commit/${sha}`,
  repository: { full_name: repo },
  commit: { message, author: { date: at } },
});

const issue = (
  number: number,
  repo: string,
  title: string,
  createdAt: string,
  closedAt: string | null,
  pullRequest: object | null,
) => ({
  html_url: `https://github.com/${repo}/${pullRequest ? "pull" : "issues"}/${number}`,
  number,
  title,
  repository_url: `https://api.github.com/repos/${repo}`,
  created_at: createdAt,
  closed_at: closedAt,
  pull_request: pullRequest,
});

function sourceFor(
  answers: { commits: unknown[]; created: unknown[]; closed: unknown[] },
  config: GitHubSettings = settings,
) {
  const http = vi.fn(async ({ url }: { url: string }): Promise<RequestUrlResponse> => {
    const u = new URL(url);
    const q = u.searchParams.get("q") ?? "";
    const all = u.pathname.endsWith("/commits") ? answers.commits : q.includes(" created:") ? answers.created : answers.closed;
    const isPullRequest = (item: unknown) => (item as { pull_request?: unknown }).pull_request != null;
    const items = q.includes("is:pull-request")
      ? all.filter(isPullRequest)
      : q.includes("is:issue")
        ? all.filter((item) => !isPullRequest(item))
        : all;
    const body = { total_count: items.length, incomplete_results: false, items };
    return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
  });
  return { http, source: new GitHubSource(http, () => config) };
}

describe("GitHubSource", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("is unavailable without a valid username and a token", () => {
    expect(sourceFor({ commits: [], created: [], closed: [] }, { username: "", token: "t", includeCommits: true }).source.isAvailable()).toBe(false);
    expect(sourceFor({ commits: [], created: [], closed: [] }, { username: "tnmt", token: " ", includeCommits: true }).source.isAvailable()).toBe(false);
    expect(
      sourceFor({ commits: [], created: [], closed: [] }, { username: "x created:2020", token: "t", includeCommits: true }).source.isAvailable(),
    ).toBe(false);
    expect(sourceFor({ commits: [], created: [], closed: [] }).source.isAvailable()).toBe(true);
  });

  it("queries the local day's range for the user", async () => {
    const { http, source } = sourceFor({ commits: [], created: [], closed: [] });
    await source.getItems(context, new AbortController().signal);
    const queries = http.mock.calls.map(([req]) => new URL(req.url).searchParams.get("q"));
    const range = "2026-10-09T00:00:00+09:00..2026-10-09T23:59:59+09:00";
    expect(queries).toEqual([
      `author:tnmt author-date:${range}`,
      `author:tnmt is:issue created:${range}`,
      `author:tnmt is:pull-request created:${range}`,
      `author:tnmt is:issue closed:${range}`,
      `author:tnmt is:pull-request closed:${range}`,
    ]);
  });

  it("skips the commit search unless commits are included", async () => {
    const { http, source } = sourceFor(
      { commits: [commit("abc1234def", "tnmt/a", "2026-10-09T09:00:00+09:00", "Work")], created: [], closed: [] },
      { ...settings, includeCommits: false },
    );
    const items = await source.getItems(context, new AbortController().signal);
    expect(items).toEqual([]);
    expect(http.mock.calls.some(([req]) => new URL(req.url).pathname.endsWith("/commits"))).toBe(false);
  });

  it("groups by repository, ordered by first activity, chronological within a group", async () => {
    const { source } = sourceFor({
      commits: [
        commit("aaaaaaa1111", "tnmt/b", "2026-10-09T18:00:00.000+09:00", "late b\n\nbody"),
        commit("bbbbbbb2222", "tnmt/a", "2026-10-09T09:30:00.000+09:00", "early a"),
        commit("ccccccc3333", "tnmt/b", "2026-10-09T08:15:00.000+09:00", "early b"),
      ],
      created: [issue(5, "tnmt/a", "Plan", "2026-10-09T10:00:00+09:00", null, null)],
      closed: [
        issue(7, "tnmt/b", "Ship", "2026-10-07T10:00:00+09:00", "2026-10-09T12:00:00+09:00", { merged_at: "2026-10-09T12:00:00+09:00" }),
        issue(8, "tnmt/b", "Drop", "2026-10-07T10:00:00+09:00", "2026-10-09T13:00:00+09:00", { merged_at: null }),
        issue(9, "tnmt/a", "Done", "2026-10-09T01:00:00+09:00", "2026-10-09T01:10:00+09:00", null),
      ],
    });

    const items = await source.getItems(context, new AbortController().signal);

    expect(items.map((i) => [i.groupLabel, i.subtitle, i.title])).toEqual([
      ["tnmt/a", "01:10 · Closed issue #9", "Done"],
      ["tnmt/a", "09:30 · Commit bbbbbbb", "early a"],
      ["tnmt/a", "10:00 · Opened issue #5", "Plan"],
      ["tnmt/b", "08:15 · Commit ccccccc", "early b"],
      ["tnmt/b", "12:00 · Merged pull request #7", "Ship"],
      ["tnmt/b", "13:00 · Closed pull request #8", "Drop"],
      ["tnmt/b", "18:00 · Commit aaaaaaa", "late b"],
    ]);
    expect(items.every((i) => i.type === "activity" && i.sourceId === "github")).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("pre-renders a one-line Markdown text for copying", async () => {
    const { source } = sourceFor({
      commits: [commit("bbbbbbb2222", "tnmt/a", "2026-10-09T09:30:00.000+09:00", "early a")],
      created: [issue(5, "tnmt/a", "Plan", "2026-10-09T10:00:00+09:00", null, { merged_at: null })],
      closed: [],
    });
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => (i.payload as { text: string }).text)).toEqual([
      "09:30 Commit [tnmt/a@bbbbbbb](https://github.com/tnmt/a/commit/bbbbbbb2222) early a",
      "10:00 Opened pull request [tnmt/a#5](https://github.com/tnmt/a/pull/5) Plan",
    ]);
  });

  it("emits both events for an item opened and closed on the same date", async () => {
    const { source } = sourceFor({
      commits: [],
      created: [issue(9, "tnmt/a", "Done", "2026-10-09T01:00:00+09:00", "2026-10-09T01:10:00+09:00", null)],
      closed: [issue(9, "tnmt/a", "Done", "2026-10-09T01:00:00+09:00", "2026-10-09T01:10:00+09:00", null)],
    });
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => i.subtitle)).toEqual(["01:00 · Opened issue #9", "01:10 · Closed issue #9"]);
  });

  it("drops events whose own timestamp falls outside the date", async () => {
    // An item created the day before but closed today must not also appear as opened today.
    const { source } = sourceFor({
      commits: [commit("ddddddd4444", "tnmt/a", "2026-10-08T23:59:59.000+09:00", "yesterday")],
      created: [issue(1, "tnmt/a", "Old", "2026-10-08T10:00:00+09:00", "2026-10-09T10:00:00+09:00", null)],
      closed: [issue(1, "tnmt/a", "Old", "2026-10-08T10:00:00+09:00", "2026-10-09T10:00:00+09:00", null)],
    });
    const items = await source.getItems(context, new AbortController().signal);
    expect(items.map((i) => i.subtitle)).toEqual(["10:00 · Closed issue #1"]);
  });
});
