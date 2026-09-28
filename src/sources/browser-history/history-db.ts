import { spawn } from "child_process";
import { existsSync } from "fs";
import { access, copyFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { CancelledError, throwIfAborted } from "../dropbox/cancel";
import { BrowserHistorySourceError } from "./errors";
import type { ChromiumDateRange } from "./chromium-time";

// Injected like Dropbox injects HttpRequester, so the copy-and-query logic is
// testable without touching a real filesystem/process.
export interface HistoryDbRuntime {
  existsSync(path: string): boolean;
  mkdtemp(prefix: string): Promise<string>;
  copyFile(src: string, dest: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  rm(path: string, opts: { recursive: true }): Promise<void>;
  spawnSqlite3Json(dbPath: string, sql: string, signal: AbortSignal): Promise<string>;
}

export interface RawVisitRow {
  readonly url: string;
  readonly title: string;
  readonly visit_time: number;
  readonly originator_cache_guid: string | null;
}

/**
 * Copies History (+ -wal/-shm if present) into a fresh temp directory under
 * identical filenames, then runs `fn` against the copy, removing the temp
 * directory afterwards even on error or cancellation.
 *
 * This uses a plain filesystem copy rather than SQLite's online backup
 * command (`.backup`), which was tried first and rejected: `.backup` needs to
 * acquire a real SQLite lock on the source database, and Chromium's History
 * backend holds one often enough — even when the browser is merely open, not
 * actively browsing — that `.backup` against a live profile reliably fails
 * with "database is locked" (confirmed against a real running Brave Origin
 * profile). A plain `fs.copyFile` doesn't participate in SQLite's locking
 * protocol at all, so it isn't blocked by it; copying `-wal`/`-shm` alongside
 * `History` lets a real SQLite engine opening the copy still replay the WAL
 * the same way the live browser would. See docs/architecture.md's "Browser
 * history source" section for the full trade-off.
 */
export async function withHistorySnapshot<T>(
  runtime: HistoryDbRuntime,
  historyPath: string,
  fn: (snapshotDbPath: string) => Promise<T>,
): Promise<T> {
  const tempDir = await runtime.mkdtemp("obsidian-daily-inbox-history-");
  const snapshotPath = `${tempDir}/History`;
  try {
    await runtime.copyFile(historyPath, snapshotPath);
    for (const suffix of ["-wal", "-shm"]) {
      const src = `${historyPath}${suffix}`;
      if (await runtime.fileExists(src)) {
        await runtime.copyFile(src, `${snapshotPath}${suffix}`);
      }
    }
    const result = await fn(snapshotPath);
    await safeRm(runtime, tempDir);
    return result;
  } catch (err) {
    // Cleanup failures are logged, not thrown, so they never mask the
    // original error/cancellation that caused this catch to run.
    await safeRm(runtime, tempDir);
    throw err;
  }
}

async function safeRm(runtime: HistoryDbRuntime, path: string): Promise<void> {
  try {
    await runtime.rm(path, { recursive: true });
  } catch (err) {
    console.error("Daily Inbox: failed to remove a temporary browser-history snapshot", err);
  }
}

export function buildVisitsQuery(range: ChromiumDateRange): string {
  return (
    "SELECT urls.url AS url, urls.title AS title, visits.visit_time AS visit_time, " +
    "visits.originator_cache_guid AS originator_cache_guid " +
    "FROM visits JOIN urls ON urls.id = visits.url " +
    // Bounds are integers this plugin computes itself, never user-controlled
    // strings, so inlining them into the SQL text is safe.
    `WHERE visits.visit_time >= ${range.startMicros} AND visits.visit_time < ${range.endMicrosExclusive} ` +
    "ORDER BY visits.visit_time ASC;"
  );
}

export async function queryVisits(
  runtime: HistoryDbRuntime,
  snapshotDbPath: string,
  range: ChromiumDateRange,
  signal: AbortSignal,
): Promise<RawVisitRow[]> {
  throwIfAborted(signal);
  let stdout: string;
  try {
    stdout = await runtime.spawnSqlite3Json(snapshotDbPath, buildVisitsQuery(range), signal);
  } catch (err) {
    if (err instanceof CancelledError || err instanceof BrowserHistorySourceError) throw err;
    throw new BrowserHistorySourceError("unreadable", "Could not read the browser history database.", err);
  }
  throwIfAborted(signal);
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  try {
    const rows: unknown = JSON.parse(trimmed);
    if (!Array.isArray(rows)) throw new Error("Expected a JSON array from sqlite3 -json output.");
    return rows as RawVisitRow[];
  } catch (err) {
    throw new BrowserHistorySourceError("malformed", "sqlite3 returned unexpected output.", err);
  }
}

export function createNodeHistoryDbRuntime(): HistoryDbRuntime {
  return {
    existsSync: (path) => existsSync(path),
    mkdtemp: (prefix) => mkdtemp(join(tmpdir(), prefix)),
    copyFile: (src, dest) => copyFile(src, dest),
    fileExists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    rm: (path, opts) => rm(path, opts),
    spawnSqlite3Json: (dbPath, sql, signal) => spawnSqlite3Json(dbPath, sql, signal),
  };
}

function spawnSqlite3Json(dbPath: string, sql: string, signal: AbortSignal): Promise<string> {
  return runSqlite3(["-batch", "-json", dbPath], sql, signal);
}

function runSqlite3(args: string[], stdin: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    // Array args with shell:false (the default) avoid any shell-injection
    // concern; SQL is sent over stdin rather than argv so query length/quoting
    // never matters either.
    const child = spawn("sqlite3", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;

    // setEncoding lets Node's stream decoder buffer partial multi-byte UTF-8
    // sequences across chunk boundaries; concatenating chunk.toString() per
    // chunk (the previous approach) corrupts non-ASCII page titles whenever a
    // character happens to straddle two chunks.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    // Writing to stdin after the process has already exited/crashed can emit
    // an 'error' on the stream itself (e.g. EPIPE); the process-level
    // 'error'/'close' handlers below already report the real failure, so this
    // only prevents an unhandled stream error from crashing the plugin.
    child.stdin.on("error", () => undefined);

    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    }

    function onAbort(): void {
      if (aborted) return;
      aborted = true;
      // Rejection happens in the 'close' handler below, once the process has
      // actually exited — killing here and rejecting immediately would let a
      // caller's temp-directory cleanup race the process still holding the
      // snapshot file open.
      child.kill();
    }
    signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      settle(() => {
        if (aborted) {
          reject(new CancelledError());
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(new BrowserHistorySourceError("sqlite3-missing", "The sqlite3 command was not found on PATH.", err));
          return;
        }
        reject(err);
      });
    });

    child.on("close", (code) => {
      settle(() => {
        if (aborted) {
          reject(new CancelledError());
          return;
        }
        if (code !== 0) {
          reject(new Error(`sqlite3 exited with code ${code}: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}
