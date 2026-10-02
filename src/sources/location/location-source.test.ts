import { describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import { formatDistance, formatDuration, formatMode, formatTimeRange } from "./format";
import { LocationSource, UNNAMED_PLACE } from "./location-source";
import type { LocationSettings } from "./settings";

const context: DailyContext = { date: localDate("2026-09-30") };

function sourceReturning(body: unknown, settings: LocationSettings = { baseUrl: "https://x", token: "t" }) {
  const http = vi.fn(
    async (): Promise<RequestUrlResponse> => ({
      status: 200,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      json: body,
      text: JSON.stringify(body),
    }),
  );
  return new LocationSource(http, () => settings);
}

describe("LocationSource", () => {
  it("is unavailable until both URL and token are set", () => {
    expect(sourceReturning({}, { baseUrl: "https://x", token: "" }).isAvailable()).toBe(false);
    expect(sourceReturning({}, { baseUrl: " ", token: "t" }).isAvailable()).toBe(false);
    expect(sourceReturning({}).isAvailable()).toBe(true);
  });

  it("lists stays and moves chronologically with copyable one-line text", async () => {
    const source = sourceReturning({
      stays: [
        { start: "2026-09-30T09:39:00+09:00", end: "2026-09-30T11:15:00+09:00", place: { id: 2, name: "Office" } },
        { start: "2026-09-29T22:15:00+09:00", end: "2026-09-30T08:44:00+09:00", place: { id: 1, name: "Home" } },
        { start: "2026-09-30T18:00:00+09:00", end: "2026-10-01T00:30:00+09:00", place: null },
      ],
      moves: [{ start: "2026-09-30T08:44:00+09:00", end: "2026-09-30T09:39:00+09:00", mode: "IN_TRAIN", distance_meters: 7000 }],
    });

    const items = await source.getItems(context, new AbortController().signal);

    expect(items.map((i) => [i.title, i.subtitle, (i.payload as { text: string }).text])).toEqual([
      ["Home", "09-29 22:15–08:44 · 10h29m", "09-29 22:15–08:44 Home"],
      ["Train · 7.0 km", "08:44–09:39 · 55m", "08:44–09:39 Train 7.0 km"],
      ["Office", "09:39–11:15 · 1h36m", "09:39–11:15 Office"],
      [UNNAMED_PLACE, "18:00–10-01 00:30 · 6h30m", `18:00–10-01 00:30 ${UNNAMED_PLACE}`],
    ]);
    expect(items.every((i) => i.type === "activity" && i.sourceId === "location")).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("format", () => {
  const date = localDate("2026-09-30");

  it("reads wall-clock times as reported, regardless of this machine's time zone", () => {
    expect(formatTimeRange("2026-09-30T23:30:00+09:00", "2026-09-30T23:59:00+09:00", date)).toBe("23:30–23:59");
  });

  it("formats durations and distances", () => {
    expect(formatDuration("2026-09-30T09:00:00+09:00", "2026-09-30T09:45:00+09:00")).toBe("45m");
    expect(formatDuration("2026-09-30T09:00:00+09:00", "2026-09-30T11:00:00+09:00")).toBe("2h");
    expect(formatDistance(450)).toBe("0.5 km");
    expect(formatDistance(23_400)).toBe("23 km");
  });

  it("names known and unknown activity modes", () => {
    expect(formatMode("WALKING")).toBe("Walk");
    expect(formatMode("IN_CABLECAR")).toBe("Cablecar");
    expect(formatMode("UNKNOWN_ACTIVITY_TYPE")).toBe("Unknown activity type");
  });
});
