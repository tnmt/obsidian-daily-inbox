import type { ContextItem, ContextSource, DailyContext } from "../../domain";
import { CancelledError, throwIfAborted } from "../dropbox/cancel";
import { chromiumRangeForLocalDate, chromiumTimestampToDate } from "./chromium-time";
import { BrowserHistorySourceError } from "./errors";
import { groupAndCollapseVisits, type CollapsedVisit, type RawVisit } from "./group-and-collapse";
import { queryVisits, withHistorySnapshot, type HistoryDbRuntime } from "./history-db";

export interface BrowserHistoryItemPayload {
  readonly url: string;
}

export interface ChromiumHistorySourceConfig {
  readonly id: string;
  readonly name: string;
  getHistoryPath(): string;
  getExcludedDomains(): readonly string[];
}

function toSourceError(err: unknown): never {
  if (err instanceof BrowserHistorySourceError || err instanceof CancelledError) throw err;
  throw new BrowserHistorySourceError("unreadable", "Could not read the browser history database.", err);
}

function formatVisitSubtitle(visit: CollapsedVisit): string {
  const hh = String(visit.lastVisit.getHours()).padStart(2, "0");
  const mm = String(visit.lastVisit.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  return visit.visitCount > 1 ? `Visited ${visit.visitCount}× · ${time}` : time;
}

export class ChromiumHistorySource implements ContextSource {
  readonly id: string;
  readonly name: string;

  constructor(
    private readonly config: ChromiumHistorySourceConfig,
    private readonly runtime: HistoryDbRuntime,
    private readonly isDesktop: () => boolean,
  ) {
    this.id = config.id;
    this.name = config.name;
  }

  isAvailable(): boolean {
    const path = this.config.getHistoryPath().trim();
    return this.isDesktop() && path.length > 0 && this.runtime.existsSync(path);
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    try {
      const range = chromiumRangeForLocalDate(context.date);
      const historyPath = this.config.getHistoryPath();
      const rows = await withHistorySnapshot(this.runtime, historyPath, (dbPath) =>
        queryVisits(this.runtime, dbPath, range, signal),
      );
      throwIfAborted(signal);
      const visits: RawVisit[] = rows.map((row) => ({
        url: row.url,
        title: row.title || row.url,
        timestamp: chromiumTimestampToDate(row.visit_time),
      }));
      const groups = groupAndCollapseVisits(visits, this.config.getExcludedDomains());
      return groups.flatMap((group) => group.visits.map((visit) => this.toContextItem(group.domain, visit)));
    } catch (err) {
      toSourceError(err);
    }
  }

  private toContextItem(domain: string, visit: CollapsedVisit): ContextItem {
    const payload: BrowserHistoryItemPayload = { url: visit.url };
    return {
      id: `${this.id}:${visit.url}`,
      sourceId: this.id,
      type: "link",
      timestamp: visit.lastVisit,
      title: visit.title,
      subtitle: formatVisitSubtitle(visit),
      groupLabel: domain,
      payload,
    };
  }
}
