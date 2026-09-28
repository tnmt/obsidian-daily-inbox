import { spawn } from "child_process";

// Builds throwaway Chromium-style History databases via the real sqlite3
// binary at test time (present on macOS/Linux dev machines and CI runners).
// Nothing here is ever committed — this satisfies "fixtures must be
// synthetic databases; never commit real history" without a binary blob.
// Only the columns src/sources/browser-history/history-db.ts actually
// selects are modeled; this is not a full replica of Chromium's real schema.

export interface SyntheticVisit {
  readonly url: string;
  readonly title: string;
  readonly chromiumVisitTime: number;
  readonly originatorCacheGuid?: string | null;
}

const SCHEMA =
  "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);\n" +
  "CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, originator_cache_guid TEXT);";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function insertStatements(visits: readonly SyntheticVisit[]): string {
  return visits
    .map((v, i) => {
      const urlId = i + 1;
      const guid = v.originatorCacheGuid == null ? "NULL" : `'${escapeSqlString(v.originatorCacheGuid)}'`;
      return (
        `INSERT INTO urls (id, url, title) VALUES (${urlId}, '${escapeSqlString(v.url)}', '${escapeSqlString(v.title)}');\n` +
        `INSERT INTO visits (id, url, visit_time, originator_cache_guid) VALUES (${urlId}, ${urlId}, ${v.chromiumVisitTime}, ${guid});`
      );
    })
    .join("\n");
}

function runSqlite3(dbPath: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`sqlite3 exited with code ${code}: ${stderr}`));
      else resolve();
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

/** A fully closed/checkpointed synthetic History DB — the common case for source-level tests. */
export async function createSyntheticHistoryDb(dir: string, visits: readonly SyntheticVisit[]): Promise<string> {
  const historyPath = `${dir}/History`;
  await runSqlite3(historyPath, `${SCHEMA}\n${insertStatements(visits)}`);
  return historyPath;
}

export interface SyntheticHistoryDbHandle {
  readonly historyPath: string;
  insertVisit(visit: SyntheticVisit): Promise<void>;
  close(): Promise<void>;
}

/**
 * Keeps a sqlite3 process alive against a WAL-mode database, so inserted
 * visits sit only in `History-wal` until `close()` checkpoints them —
 * simulating "the browser still has this file open". Used to directly test
 * that a snapshot taken while this handle is still open sees the in-flight
 * visit (the "reading works while the browser is running" acceptance
 * criterion).
 */
export function openSyntheticHistoryDb(dir: string): Promise<SyntheticHistoryDbHandle> {
  const historyPath = `${dir}/History`;
  const child = spawn("sqlite3", [historyPath]);
  let stdoutBuffer = "";
  const waiters: { marker: string; resolve: () => void }[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (stdoutBuffer.includes(waiters[i].marker)) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
  });

  function waitForMarker(marker: string): Promise<void> {
    if (stdoutBuffer.includes(marker)) return Promise.resolve();
    return new Promise((resolve) => waiters.push({ marker, resolve }));
  }

  let syncCounter = 0;
  // Runs `sql` and waits for a marker SELECT to come back on stdout, so the
  // caller knows the statement was actually executed by the still-running
  // process before proceeding (stdin writes are otherwise fire-and-forget).
  async function exec(sql: string): Promise<void> {
    syncCounter += 1;
    const marker = `__sync_${syncCounter}__`;
    child.stdin.write(`${sql}\nSELECT '${marker}';\n`);
    await waitForMarker(marker);
  }

  let nextId = 1;

  return exec(`PRAGMA journal_mode=WAL;\n${SCHEMA}`).then(() => ({
    historyPath,
    insertVisit: async (visit: SyntheticVisit) => {
      const urlId = nextId++;
      const guid = visit.originatorCacheGuid == null ? "NULL" : `'${escapeSqlString(visit.originatorCacheGuid)}'`;
      await exec(
        `INSERT INTO urls (id, url, title) VALUES (${urlId}, '${escapeSqlString(visit.url)}', '${escapeSqlString(visit.title)}');\n` +
          `INSERT INTO visits (id, url, visit_time, originator_cache_guid) VALUES (${urlId}, ${urlId}, ${visit.chromiumVisitTime}, ${guid});`,
      );
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        child.on("close", () => resolve());
        child.on("error", reject);
        child.stdin.write(".quit\n");
        child.stdin.end();
      }),
  }));
}
