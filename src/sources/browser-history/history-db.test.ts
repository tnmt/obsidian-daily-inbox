import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDate } from "../../domain";
import { createSyntheticHistoryDb, openSyntheticHistoryDb } from "../../test-support/synthetic-history-db";
import { chromiumMicrosFromDate, chromiumRangeForLocalDate } from "./chromium-time";
import { BrowserHistorySourceError } from "./errors";
import {
  buildVisitsQuery,
  createNodeHistoryDbRuntime,
  queryVisits,
  withHistorySnapshot,
  type HistoryDbRuntime,
} from "./history-db";

const DATE = localDate("2026-09-23");
const RANGE = chromiumRangeForLocalDate(DATE);

function visitTimeAt(hour: number): number {
  return chromiumMicrosFromDate(new Date(2026, 8, 23, hour, 0, 0));
}

describe("buildVisitsQuery", () => {
  it("inlines the numeric range bounds", () => {
    const sql = buildVisitsQuery(RANGE);
    expect(sql).toContain(`>= ${RANGE.startMicros}`);
    expect(sql).toContain(`< ${RANGE.endMicrosExclusive}`);
  });
});

// These tests spawn the real sqlite3 binary (present on macOS/Linux dev
// machines and CI runners), exercising the actual chosen read strategy
// rather than a mock of it.
describe("withHistorySnapshot + queryVisits (real sqlite3)", () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), "daily-inbox-history-source-"));
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
  });

  it("returns only visits within the date range, ordered by time", async () => {
    await createSyntheticHistoryDb(sourceDir, [
      { url: "https://example.com/a", title: "A", chromiumVisitTime: visitTimeAt(9) },
      { url: "https://example.com/b", title: "B", chromiumVisitTime: visitTimeAt(8) },
      {
        url: "https://example.com/out-of-range",
        title: "Out",
        chromiumVisitTime: chromiumMicrosFromDate(new Date(2026, 8, 24, 1, 0, 0)),
      },
    ]);
    const historyPath = `${sourceDir}/History`;
    const runtime = createNodeHistoryDbRuntime();
    const rows = await withHistorySnapshot(runtime, historyPath, (snapshotPath) =>
      queryVisits(runtime, snapshotPath, RANGE, new AbortController().signal),
    );
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/b", "https://example.com/a"]);
  });

  it("preserves non-ASCII titles across the sqlite3 -json round trip", async () => {
    await createSyntheticHistoryDb(sourceDir, [
      { url: "https://example.com/ja", title: "日本語のページタイトル 🎉", chromiumVisitTime: visitTimeAt(9) },
    ]);
    const historyPath = `${sourceDir}/History`;
    const runtime = createNodeHistoryDbRuntime();
    const rows = await withHistorySnapshot(runtime, historyPath, (snapshotPath) =>
      queryVisits(runtime, snapshotPath, RANGE, new AbortController().signal),
    );
    expect(rows[0]?.title).toBe("日本語のページタイトル 🎉");
  });

  it("includes visits tagged with a non-empty originator_cache_guid (synced visits)", async () => {
    await createSyntheticHistoryDb(sourceDir, [
      {
        url: "https://example.com/synced",
        title: "Synced",
        chromiumVisitTime: visitTimeAt(10),
        originatorCacheGuid: "device-guid-123",
      },
    ]);
    const historyPath = `${sourceDir}/History`;
    const runtime = createNodeHistoryDbRuntime();
    const rows = await withHistorySnapshot(runtime, historyPath, (snapshotPath) =>
      queryVisits(runtime, snapshotPath, RANGE, new AbortController().signal),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].originator_cache_guid).toBe("device-guid-123");
  });

  it("removes the temp snapshot directory afterwards", async () => {
    await createSyntheticHistoryDb(sourceDir, []);
    const historyPath = `${sourceDir}/History`;
    const runtime = createNodeHistoryDbRuntime();
    let capturedSnapshotDir = "";
    await withHistorySnapshot(runtime, historyPath, async (snapshotPath) => {
      capturedSnapshotDir = snapshotPath.slice(0, snapshotPath.lastIndexOf("/"));
      expect(runtime.existsSync(snapshotPath)).toBe(true);
    });
    expect(runtime.existsSync(capturedSnapshotDir)).toBe(false);
  });

  // The hardest acceptance criterion: a visit that Chrome has only written to
  // History-wal (not yet checkpointed into History) while the browser is
  // still running must still be readable.
  it("sees a visit that is still only in the WAL file while the browser holds it open", async () => {
    const handle = await openSyntheticHistoryDb(sourceDir);
    try {
      await handle.insertVisit({
        url: "https://example.com/live",
        title: "Live",
        chromiumVisitTime: visitTimeAt(11),
      });
      const runtime = createNodeHistoryDbRuntime();
      const rows = await withHistorySnapshot(runtime, handle.historyPath, (snapshotPath) =>
        queryVisits(runtime, snapshotPath, RANGE, new AbortController().signal),
      );
      expect(rows.map((r) => r.url)).toEqual(["https://example.com/live"]);
    } finally {
      await handle.close();
    }
  });
});

describe("queryVisits error handling", () => {
  function fakeRuntime(overrides: Partial<HistoryDbRuntime>): HistoryDbRuntime {
    return {
      existsSync: () => true,
      mkdtemp: async (p) => p,
      copyFile: async () => undefined,
      fileExists: async () => false,
      rm: async () => undefined,
      spawnSqlite3Json: async () => "",
      ...overrides,
    };
  }

  it("wraps a non-zero sqlite3 exit as an unreadable error", async () => {
    const runtime = fakeRuntime({
      spawnSqlite3Json: async () => {
        throw new Error("sqlite3 exited with code 1: no such table: visits");
      },
    });
    await expect(queryVisits(runtime, "/tmp/History", RANGE, new AbortController().signal)).rejects.toMatchObject({
      kind: "unreadable",
    });
  });

  it("passes an sqlite3-missing error through unwrapped", async () => {
    const runtime = fakeRuntime({
      spawnSqlite3Json: async () => {
        throw new BrowserHistorySourceError("sqlite3-missing", "The sqlite3 command was not found on PATH.");
      },
    });
    await expect(queryVisits(runtime, "/tmp/History", RANGE, new AbortController().signal)).rejects.toMatchObject({
      kind: "sqlite3-missing",
    });
  });

  it("rejects malformed JSON output as a malformed error", async () => {
    const runtime = fakeRuntime({ spawnSqlite3Json: async () => "not json" });
    await expect(queryVisits(runtime, "/tmp/History", RANGE, new AbortController().signal)).rejects.toMatchObject({
      kind: "malformed",
    });
  });

  it("returns an empty array for empty output (no matching rows)", async () => {
    const runtime = fakeRuntime({ spawnSqlite3Json: async () => "" });
    await expect(queryVisits(runtime, "/tmp/History", RANGE, new AbortController().signal)).resolves.toEqual([]);
  });
});
