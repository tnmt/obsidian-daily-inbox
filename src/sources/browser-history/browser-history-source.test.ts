import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { createSyntheticHistoryDb } from "../../test-support/synthetic-history-db";
import { ChromiumHistorySource, type ChromiumHistorySourceConfig } from "./browser-history-source";
import { chromiumMicrosFromDate } from "./chromium-time";
import { BrowserHistorySourceError } from "./errors";
import { createNodeHistoryDbRuntime, type HistoryDbRuntime } from "./history-db";

const context = { date: localDate("2026-09-23") };

function visitTimeAt(hour: number, minute = 0): number {
  return chromiumMicrosFromDate(new Date(2026, 8, 23, hour, minute, 0));
}

function config(overrides: Partial<ChromiumHistorySourceConfig> = {}): ChromiumHistorySourceConfig {
  return {
    id: "browser-history:1",
    name: "Chrome — Personal",
    getHistoryPath: () => "",
    getExcludedDomains: () => [],
    ...overrides,
  };
}

describe("ChromiumHistorySource.isAvailable", () => {
  const fakeRuntime: HistoryDbRuntime = {
    existsSync: (path) => path === "/exists/History",
    mkdtemp: async (p) => p,
    copyFile: async () => undefined,
    fileExists: async () => false,
    rm: async () => undefined,
    spawnSqlite3Json: async () => "",
  };

  it("is false when not on desktop", () => {
    const source = new ChromiumHistorySource(config({ getHistoryPath: () => "/exists/History" }), fakeRuntime, () => false);
    expect(source.isAvailable()).toBe(false);
  });

  it("is false when no path is configured", () => {
    const source = new ChromiumHistorySource(config({ getHistoryPath: () => "  " }), fakeRuntime, () => true);
    expect(source.isAvailable()).toBe(false);
  });

  it("is false when the configured path doesn't exist", () => {
    const source = new ChromiumHistorySource(config({ getHistoryPath: () => "/missing/History" }), fakeRuntime, () => true);
    expect(source.isAvailable()).toBe(false);
  });

  it("is true on desktop with an existing path", () => {
    const source = new ChromiumHistorySource(config({ getHistoryPath: () => "/exists/History" }), fakeRuntime, () => true);
    expect(source.isAvailable()).toBe(true);
  });
});

describe("ChromiumHistorySource.getItems (real sqlite3)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "daily-inbox-history-source-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps in-range visits to grouped, collapsed link items", async () => {
    await createSyntheticHistoryDb(dir, [
      { url: "https://a.example/1", title: "A1", chromiumVisitTime: visitTimeAt(9) },
      { url: "https://a.example/1", title: "A1", chromiumVisitTime: visitTimeAt(14) },
      { url: "https://b.example/1", title: "B1", chromiumVisitTime: visitTimeAt(10) },
      { url: "https://excluded.example/1", title: "Excluded", chromiumVisitTime: visitTimeAt(11) },
      {
        url: "https://a.example/2",
        title: "Synced",
        chromiumVisitTime: visitTimeAt(12),
        originatorCacheGuid: "other-device",
      },
      { url: "https://a.example/out", title: "Out", chromiumVisitTime: chromiumMicrosFromDate(new Date(2026, 8, 24, 1, 0)) },
    ]);
    const historyPath = `${dir}/History`;
    const source = new ChromiumHistorySource(
      config({ getHistoryPath: () => historyPath, getExcludedDomains: () => ["excluded.example"] }),
      createNodeHistoryDbRuntime(),
      () => true,
    );

    const items = await source.getItems(context, new AbortController().signal);

    expect(items.every((i) => i.type === "link" && i.sourceId === "browser-history:1")).toBe(true);
    expect(items.map((i) => i.groupLabel)).toEqual(["a.example", "a.example", "b.example"]);
    const collapsed = items.find((i) => (i.payload as { url: string }).url === "https://a.example/1");
    expect(collapsed?.subtitle).toContain("Visited 2×");
    expect(items.some((i) => (i.payload as { url: string }).url === "https://excluded.example/1")).toBe(false);
    expect(items.some((i) => (i.payload as { url: string }).url === "https://a.example/out")).toBe(false);
    expect(items.some((i) => (i.payload as { url: string }).url === "https://a.example/2")).toBe(true);
  });

  it("returns an empty list when there are no visits that day", async () => {
    await createSyntheticHistoryDb(dir, []);
    const source = new ChromiumHistorySource(
      config({ getHistoryPath: () => `${dir}/History` }),
      createNodeHistoryDbRuntime(),
      () => true,
    );
    expect(await source.getItems(context, new AbortController().signal)).toEqual([]);
  });
});

describe("ChromiumHistorySource error handling", () => {
  it("wraps a snapshot/query failure as BrowserHistorySourceError", async () => {
    const failingRuntime: HistoryDbRuntime = {
      existsSync: () => true,
      mkdtemp: async () => {
        throw new Error("disk full");
      },
      copyFile: async () => undefined,
      fileExists: async () => false,
      rm: async () => undefined,
      spawnSqlite3Json: async () => "",
    };
    const source = new ChromiumHistorySource(
      config({ getHistoryPath: () => "/some/History" }),
      failingRuntime,
      () => true,
    );
    await expect(source.getItems(context, new AbortController().signal)).rejects.toBeInstanceOf(
      BrowserHistorySourceError,
    );
  });
});
