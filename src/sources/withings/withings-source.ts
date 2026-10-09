import type { ContextItem, ContextSource, DailyContext, LocalDate } from "../../domain";
import type { ActivityTextPayload } from "../../actions/copy-activity-text";
import { CancelledError, throwIfAborted } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { buildSessions, localDayRange } from "./aggregate";
import type { WithingsAuthClient } from "./auth";
import { AccessTokenRejectedError, fetchMeasures } from "./client";
import type { MeasuresResponse } from "./client";
import { WithingsSourceError } from "./errors";

// Withings allows one poll per 10 minutes per user (status 601); a repeat
// query for the same date inside that window is answered from memory.
export const CACHE_TTL_MS = 10 * 60_000;
// Time zones span UTC-12 to UTC+14, so the account's calendar day can start up
// to 26 hours before or end 26 hours after the same date on this machine.
const ZONE_MARGIN_SECONDS = 26 * 60 * 60;

export class WithingsSource implements ContextSource {
  readonly id = "withings";
  readonly name = "Withings";

  // Disposable: not persisted, keyed by account and date.
  private readonly cache = new Map<string, { readonly at: number; readonly items: ContextItem[] }>();
  private readonly inFlight = new Map<string, Promise<ContextItem[]>>();

  constructor(
    private readonly http: HttpRequester,
    private readonly auth: WithingsAuthClient,
    private readonly now: () => number = Date.now,
  ) {}

  isAvailable(): boolean {
    return this.auth.isConnected();
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    const userId = this.auth.userId() ?? "";
    const key = `${userId}:${context.date}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.items;

    // Shared by overlapping callers, so it runs on its own signal (the HTTP
    // request cannot be aborted anyway) and each caller checks its own after.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.load(key, userId, context.date).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const items = await pending;
    throwIfAborted(signal);
    return items;
  }

  // `userId` is the account the query started for. If the connection changes
  // while the request is in flight, its result (or its retry with the new
  // account's token) belongs to nobody and must not reach the cache.
  private async load(key: string, userId: string, date: LocalDate): Promise<ContextItem[]> {
    const sameAccount = () => {
      if ((this.auth.userId() ?? "") !== userId) throw new CancelledError();
    };
    const response = await this.fetchForDate(date, new AbortController().signal, sameAccount);
    sameAccount();
    const items = buildSessions(response.groups, response.timezone, date).map((session): ContextItem => {
      const payload: ActivityTextPayload = { text: `${session.time} ${session.summary}` };
      return {
        id: `${this.id}:${session.startUnix}`,
        sourceId: this.id,
        type: "activity",
        timestamp: new Date(session.startUnix * 1000),
        title: session.summary,
        subtitle: session.time,
        payload,
      };
    });
    this.cache.set(key, { at: this.now(), items });
    return items;
  }

  // The range is widened by the largest possible zone difference on each side
  // so an account in another zone than this machine still yields the whole day; buildSessions then keeps
  // only the groups dated `date` in the account's own zone.
  private async fetchForDate(date: LocalDate, signal: AbortSignal, sameAccount: () => void): Promise<MeasuresResponse> {
    const { startUnix, endUnix } = localDayRange(date);
    const query = (token: string) => fetchMeasures(this.http, token, startUnix - ZONE_MARGIN_SECONDS, endUnix + ZONE_MARGIN_SECONDS, signal);
    const token = await this.auth.getAccessToken(signal);
    try {
      return await query(token);
    } catch (err) {
      if (!(err instanceof AccessTokenRejectedError)) throw err;
    }
    sameAccount();
    const refreshed = await this.auth.refreshAfterUnauthorized(signal);
    sameAccount();
    try {
      return await query(refreshed);
    } catch (err) {
      if (err instanceof AccessTokenRejectedError) {
        throw new WithingsSourceError("auth-required", "Withings rejected the refreshed access token.", err);
      }
      throw err;
    }
  }
}
