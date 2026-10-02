import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { localDate } from "../../domain";
import { CancelledError } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { fetchDay, parseDayResponse } from "./client";
import { LocationSourceError } from "./errors";

function response(status: number, body: unknown): RequestUrlResponse {
  return { status, headers: {}, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
}

function mockHttp(handler: (params: RequestUrlParam) => RequestUrlResponse | Promise<RequestUrlResponse>): HttpRequester {
  return vi.fn(async (params: RequestUrlParam) => handler(params));
}

const date = localDate("2026-09-30");
const signal = () => new AbortController().signal;

const sampleDay = {
  date: "2026-09-30",
  timezone: "Asia/Tokyo",
  stays: [
    {
      start: "2026-09-29T22:15:00+09:00",
      end: "2026-09-30T08:44:00+09:00",
      latitude: 35,
      longitude: 139,
      source: "recorded",
      place: { id: 1, name: "Home" },
    },
    { start: "2026-09-30T09:39:12.5+09:00", end: "2026-09-30T11:15:00+09:00", source: "google-timeline", place: null },
  ],
  moves: [{ start: "2026-09-30T08:44:00+09:00", end: "2026-09-30T09:39:00+09:00", mode: "IN_TRAIN", distance_meters: 7000, source: "google-timeline" }],
};

async function errorKind(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof LocationSourceError) return err.kind;
    throw err;
  }
  throw new Error("expected a LocationSourceError");
}

describe("fetchDay", () => {
  it("requests the date with a bearer token, tolerating a trailing slash in the base URL", async () => {
    const http = mockHttp(() => response(200, sampleDay));
    await fetchDay(http, " https://loc.example.com/ ", " secret ", date, signal());
    const params = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as RequestUrlParam;
    expect(params.url).toBe("https://loc.example.com/api/days/2026-09-30");
    expect(params.method).toBe("GET");
    expect(params.headers?.Authorization).toBe("Bearer secret");
    expect(params.throw).toBe(false);
  });

  it("maps HTTP failures to source error kinds", async () => {
    const at = (status: number) => fetchDay(mockHttp(() => response(status, {})), "https://x", "t", date, signal());
    expect(await errorKind(at(401))).toBe("auth-required");
    expect(await errorKind(at(403))).toBe("auth-required");
    expect(await errorKind(at(404))).toBe("not-found");
    expect(await errorKind(at(500))).toBe("transient");
    const offline = mockHttp(() => Promise.reject(new Error("net::ERR_CONNECTION_REFUSED")));
    expect(await errorKind(fetchDay(offline, "https://x", "t", date, signal()))).toBe("transient");
  });

  it("does not call http once aborted, and drops a response that arrives after abort", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const http = vi.fn();
    await expect(fetchDay(http, "https://x", "t", date, aborted.signal)).rejects.toThrow(CancelledError);
    expect(http).not.toHaveBeenCalled();

    const late = new AbortController();
    const slow = mockHttp(() => {
      late.abort();
      return response(200, sampleDay);
    });
    await expect(fetchDay(slow, "https://x", "t", date, late.signal)).rejects.toThrow(CancelledError);
  });
});

describe("parseDayResponse", () => {
  it("keeps place names and treats a null place as unnamed", () => {
    const day = parseDayResponse(sampleDay);
    expect(day.stays.map((s) => s.placeName)).toEqual(["Home", undefined]);
    expect(day.moves[0]).toEqual({
      start: "2026-09-30T08:44:00+09:00",
      end: "2026-09-30T09:39:00+09:00",
      mode: "IN_TRAIN",
      distanceMeters: 7000,
    });
  });

  it("rejects unexpected shapes as malformed", async () => {
    for (const body of [
      null,
      { stays: [] },
      { stays: [{ start: "yesterday", end: "2026-09-30T08:44:00+09:00" }], moves: [] },
      { stays: [], moves: [{ start: "2026-09-30T08:44:00+09:00", end: "2026-09-30T09:39:00+09:00" }] },
    ]) {
      expect(await errorKind(Promise.resolve().then(() => parseDayResponse(body)))).toBe("malformed");
    }
  });
});
