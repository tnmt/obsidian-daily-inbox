import type { ContextItem, ContextSource, DailyContext } from "../../domain";
import type { ActivityTextPayload } from "../../actions/copy-activity-text";
import type { HttpRequester } from "../dropbox/http";
import { searchCommits, searchIssues } from "./client";
import { isWithin, localDayBounds, searchDateRange } from "./date-range";
import { isGitHubConfigured } from "./settings";
import type { GitHubSettings } from "./settings";

interface ActivityEvent {
  readonly id: string;
  readonly at: Date;
  readonly repository: string;
  readonly title: string;
  readonly label: string;
  readonly url: string;
  /** Short identifier within the repository: `abc1234` for a commit, `#12` for a pull request or issue. */
  readonly ref: string;
  /** Link text of the copied line, e.g. `owner/repo@abc1234` or `owner/repo#12`. */
  readonly reference: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const firstLine = (message: string) => message.split(/\r?\n/, 1)[0];

// Titles are arbitrary text pasted into a note, where "<T>", "*x*", "#tag" or
// "[[link]]" would otherwise be rendered instead of shown.
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>!|~#]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

export class GitHubSource implements ContextSource {
  readonly id = "github";
  readonly name = "GitHub";

  constructor(
    private readonly http: HttpRequester,
    private readonly getSettings: () => GitHubSettings,
  ) {}

  isAvailable(): boolean {
    return isGitHubConfigured(this.getSettings());
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    const { username, token, includeCommits } = this.getSettings();
    const user = username.trim();
    const range = searchDateRange(context.date);
    const bounds = localDayBounds(context.date);

    // Sequential rather than parallel: at most five requests are well inside the
    // 30/min search limit, and bursts risk GitHub's secondary rate limit.
    // Issue search is split by kind because some tokens are refused with a 422
    // ("Query must include 'is:issue' or 'is:pull-request'") otherwise.
    const commits = includeCommits
      ? await searchCommits(this.http, token, `author:${user} author-date:${range}`, signal)
      : [];
    const created = [];
    const closed = [];
    for (const kind of ["is:issue", "is:pull-request"]) {
      created.push(...(await searchIssues(this.http, token, `author:${user} ${kind} created:${range}`, signal)));
    }
    for (const kind of ["is:issue", "is:pull-request"]) {
      closed.push(...(await searchIssues(this.http, token, `author:${user} ${kind} closed:${range}`, signal)));
    }

    const events = new Map<string, ActivityEvent>();
    const add = (event: ActivityEvent) => events.set(event.id, event);

    for (const c of commits) {
      const at = new Date(c.authoredAt);
      if (!isWithin(at, bounds)) continue;
      add({
        id: `${this.id}:commit:${c.repository}:${c.sha}`,
        at,
        repository: c.repository,
        title: firstLine(c.message),
        label: "Commit",
        url: c.url,
        ref: c.sha.slice(0, 7),
        reference: `${c.repository}@${c.sha.slice(0, 7)}`,
      });
    }
    for (const i of created) {
      const at = new Date(i.createdAt);
      if (!isWithin(at, bounds)) continue;
      add({
        id: `${this.id}:opened:${i.url}`,
        at,
        repository: i.repository,
        title: i.title,
        label: i.isPullRequest ? "Opened pull request" : "Opened issue",
        url: i.url,
        ref: `#${i.number}`,
        reference: `${i.repository}#${i.number}`,
      });
    }
    for (const i of closed) {
      if (!i.closedAt) continue;
      const at = new Date(i.closedAt);
      if (!isWithin(at, bounds)) continue;
      const verb = i.isPullRequest ? (i.mergedAt ? "Merged" : "Closed") : "Closed";
      add({
        id: `${this.id}:closed:${i.url}`,
        at,
        repository: i.repository,
        title: i.title,
        label: `${verb} ${i.isPullRequest ? "pull request" : "issue"}`,
        url: i.url,
        ref: `#${i.number}`,
        reference: `${i.repository}#${i.number}`,
      });
    }

    const list = [...events.values()];
    const firstSeen = new Map<string, number>();
    for (const e of list) {
      const prev = firstSeen.get(e.repository);
      if (prev === undefined || e.at.getTime() < prev) firstSeen.set(e.repository, e.at.getTime());
    }
    // Repositories ordered by their first activity of the day, then
    // chronologically within each, so each repository forms one group.
    list.sort(
      (a, b) =>
        firstSeen.get(a.repository)! - firstSeen.get(b.repository)! ||
        a.repository.localeCompare(b.repository) ||
        a.at.getTime() - b.at.getTime(),
    );

    return list.map((e): ContextItem => {
      const payload: ActivityTextPayload = {
        text: `${clock(e.at)} ${e.label} [${e.reference}](${e.url}) ${escapeMarkdownText(e.title)}`,
      };
      return {
        id: e.id,
        sourceId: this.id,
        type: "activity",
        timestamp: e.at,
        title: e.title,
        subtitle: `${clock(e.at)} · ${e.label} ${e.ref}`,
        groupLabel: e.repository,
        payload,
      };
    });
  }
}
