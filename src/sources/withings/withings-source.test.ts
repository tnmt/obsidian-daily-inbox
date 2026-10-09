import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import { CancelledError } from "../dropbox/cancel";
import { localDayRange } from "./aggregate";
import type { WithingsAuthClient } from "./auth";
import { WithingsSourceError } from "./errors";
import { CACHE_TTL_MS, WithingsSource } from "./withings-source";

const context: DailyContext = { date: localDate("2026-09-30") };
const signal = () => new AbortController().signal;
// 2026-09-30T07:12:00+09:00
const T0 = Date.UTC(2026, 8, 29, 22, 12) / 1000;

const body = {
  status: 0,
  body: {
    timezone: "Asia/Tokyo",
    measuregrps: [
      { date: T0, measures: [{ value: 557, type: 1, unit: -1 }, { value: 157, type: 6, unit: -1 }] },
      // The previous day in Tokyo, returned because the query range is widened.
      { date: T0 - 86400, measures: [{ value: 560, type: 1, unit: -1 }] },
    ],
  },
};

function json(value: unknown): RequestUrlResponse {
  return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), json: value, text: JSON.stringify(value) };
}

function fakeAuth(overrides: Partial<WithingsAuthClient> = {}): WithingsAuthClient {
  return {
    isConnected: () => true,
    userId: () => "u1",
    getAccessToken: async () => "old",
    refreshAfterUnauthorized: async () => "new",
    ...overrides,
  };
}

describe("WithingsSource", () => {
  it("is available only while connected", () => {
    const http = vi.fn();
    expect(new WithingsSource(http, fakeAuth()).isAvailable()).toBe(true);
    expect(new WithingsSource(http, fakeAuth({ isConnected: () => false })).isAvailable()).toBe(false);
  });

  it("returns one activity item per session with copyable text, ignoring other days", async () => {
    const http = vi.fn(async () => json(body));
    const items = await new WithingsSource(http, fakeAuth()).getItems(context, signal());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: "withings",
      type: "activity",
      title: "Weight 55.7kg / Fat 15.7%",
      subtitle: "07:12",
      payload: { text: "07:12 Weight 55.7kg / Fat 15.7%" },
    });
    expect(items[0].timestamp?.getTime()).toBe(T0 * 1000);
  });

  it("widens the query by the largest possible zone difference on each side", async () => {
    const http = vi.fn(async (_: RequestUrlParam) => json(body));
    await new WithingsSource(http, fakeAuth()).getItems(context, signal());
    const form = Object.fromEntries(new URLSearchParams(vi.mocked(http).mock.calls[0][0].body as string));
    const day = localDayRange(context.date);
    expect(Number(form.startdate)).toBe(day.startUnix - 26 * 3600);
    expect(Number(form.enddate)).toBe(day.endUnix + 26 * 3600);
  });

  it("answers a repeat query for the same date from memory until the TTL passes", async () => {
    const http = vi.fn(async () => json(body));
    let now = 1_000_000;
    const source = new WithingsSource(http, fakeAuth(), () => now);
    await source.getItems(context, signal());
    await source.getItems(context, signal());
    expect(http).toHaveBeenCalledTimes(1);
    now += CACHE_TTL_MS;
    await source.getItems(context, signal());
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("shares one request between overlapping queries and lets each caller cancel on its own", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const http = vi.fn(async (_: RequestUrlParam) => {
      await gate;
      return json(body);
    });
    const source = new WithingsSource(http, fakeAuth());
    const stale = new AbortController();
    const first = source.getItems(context, stale.signal);
    const second = source.getItems(context, signal());
    stale.abort();
    release();
    await expect(first).rejects.toBeInstanceOf(CancelledError);
    expect(await second).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("does not share cached items between accounts", async () => {
    const http = vi.fn(async () => json(body));
    let user = "u1";
    const source = new WithingsSource(http, fakeAuth({ userId: () => user }));
    await source.getItems(context, signal());
    user = "u2";
    await source.getItems(context, signal());
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("discards a result whose account was switched while the request was in flight", async () => {
    let user = "u1";
    const refresh = vi.fn(async () => "new");
    const http = vi.fn(async (_: RequestUrlParam) => {
      user = "u2";
      return json({ status: 401 });
    });
    const source = new WithingsSource(http, fakeAuth({ userId: () => user, refreshAfterUnauthorized: refresh }));
    await expect(source.getItems(context, signal())).rejects.toBeInstanceOf(CancelledError);
    expect(refresh).not.toHaveBeenCalled();
    expect(http).toHaveBeenCalledTimes(1);

    user = "u1";
    const ok = vi.fn(async (_: RequestUrlParam) => json(body));
    const again = new WithingsSource(ok, fakeAuth({ userId: () => user }));
    await again.getItems(context, signal());
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("does not cache a successful result fetched for an account that was switched away", async () => {
    let user = "u1";
    const http = vi.fn(async (_: RequestUrlParam) => {
      if (http.mock.calls.length === 1) user = "u2";
      return json(body);
    });
    const source = new WithingsSource(http, fakeAuth({ userId: () => user }));
    await expect(source.getItems(context, signal())).rejects.toBeInstanceOf(CancelledError);
    user = "u1";
    await source.getItems(context, signal());
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const http = vi.fn(async () => json({ status: 601 }));
    const source = new WithingsSource(http, fakeAuth());
    await expect(source.getItems(context, signal())).rejects.toMatchObject({ kind: "rate-limited" });
    await expect(source.getItems(context, signal())).rejects.toMatchObject({ kind: "rate-limited" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("refreshes once on a rejected token and retries with the new one", async () => {
    const tokens: string[] = [];
    const http = vi.fn(async (p: RequestUrlParam) => {
      tokens.push(p.headers?.Authorization ?? "");
      return json(tokens.length === 1 ? { status: 401 } : body);
    });
    const items = await new WithingsSource(http, fakeAuth()).getItems(context, signal());
    expect(tokens).toEqual(["Bearer old", "Bearer new"]);
    expect(items).toHaveLength(1);
  });

  it("requires re-authentication when the refreshed token is also rejected", async () => {
    const http = vi.fn(async () => json({ status: 401 }));
    const err = await new WithingsSource(http, fakeAuth()).getItems(context, signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WithingsSourceError);
    expect(err).toMatchObject({ kind: "auth-required" });
    expect(http).toHaveBeenCalledTimes(2);
  });
});
