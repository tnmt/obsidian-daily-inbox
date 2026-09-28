# Architecture

## Supported platforms

Daily Inbox is desktop-only (`manifest.json`'s `isDesktopOnly: true`) and is
developed and tested on **macOS and Linux** — both are real daily-driver
environments for this plugin's users, not just macOS. Any OS-specific logic
(default file-system paths, spawned binaries, path separators) must account
for both. Windows is not currently supported: it is not silently broken, but
default-path detection and testing do not cover it, so Windows users fall back
to manual configuration (e.g. a source's custom-path settings field) where one
exists. Extending official support to Windows is a deliberate future decision,
not an assumption to code against today.

## Terminology

**Daily Inbox** is the user-facing plugin and view.

**Daily Context** is the internal domain model: the date being reconstructed and relevant Obsidian state.

**Context Source** resolves items for a Daily Context.

**Context Item** is a piece of material returned by a source.

**Action** operates on a Context Item. Sources should not own insertion or publishing behavior.

## Core model

The exact TypeScript types may evolve, but dependencies should point in this direction:

```ts
interface DailyContext {
  date: LocalDate;
  activeFile?: TFile;
}

interface ContextSource {
  readonly id: string;
  readonly name: string;

  isAvailable(): boolean;
  getItems(
    context: DailyContext,
    signal: AbortSignal
  ): Promise<ContextItem[]>;
}

interface ContextItem {
  id: string;
  sourceId: string;
  type: "image" | "link" | "note" | "activity";
  timestamp?: Date;
  title?: string;
  subtitle?: string;
  thumbnail?: string;
  payload: unknown;
}

interface ContextAction {
  id: string;
  canHandle(item: ContextItem): boolean;
  run(
    item: ContextItem,
    context: DailyContext,
    signal: AbortSignal
  ): Promise<void>;
}
```

Do not add lifecycle state such as `processed`, `read`, or `archived` to `ContextItem`.

## Data flow

```text
active leaf/file
      |
DateResolver
      |
DailyContext
      |
DailyContextService
      |
  +---+----------------+
  |                    |
DropboxSource      future sources
  |                    |
  +------ ContextItem[]+
             |
       sort / group
             |
       DailyInboxView
             |
        user action
```

Source failures should be isolated and rendered at section/source level.

## Date resolution

Date resolution is a first-class component. Initial precedence:

1. explicit date metadata if configured/supported;
2. a filename matching `YYYY-MM-DD.md`;
3. Daily Notes configuration where practical;
4. otherwise no inferred date.

Never silently use today's date when an active note looks like a dated note but cannot be resolved. A separate "Today" action may explicitly select today.

Use local calendar dates rather than UTC dates for the domain model. Avoid midnight/time-zone conversion bugs.

## View lifecycle

Implement an Obsidian `ItemView` in the right sidebar.

Relevant changes should trigger context refresh:

- active file changes;
- resolved Daily Note date changes;
- manual refresh;
- source settings/authentication changes.

Refreshes must cancel obsolete source requests via `AbortController`. Rendering an older request after switching dates is a bug.

## Source adapters

Source-specific API details belong under `src/sources/<source>/`.

A source:

- queries existing authoritative data;
- maps results into `ContextItem`;
- may maintain disposable cache/cursor metadata;
- does not write to the Daily Note;
- does not publish assets;
- does not define global UI state.

## Dropbox source

v0.1 targets a configurable folder, initially expected to be Dropbox Camera Uploads.

Responsibilities:

- authenticate without committing secrets;
- list candidate image files;
- select items relevant to the Daily Context date;
- request small thumbnails for the grid;
- fetch original bytes only for explicit actions;
- handle pagination/cursors where appropriate.

Date matching must be encapsulated because Dropbox metadata is not necessarily equivalent to EXIF capture time. v0.1 may use Camera Upload filename conventions with a documented fallback. EXIF extraction should only be added after real-world evidence shows it is needed.

## Browser history source

v0.2 adds a Chromium-history source: pages visited on the Daily Note's date, from
Brave Origin and/or Chrome, desktop only. Each configured browser profile is its
own `ContextSource` instance/section (`src/sources/browser-history/`).

Responsibilities:

- detect configured browsers' profiles from each browser's `Local State` file
  (`profile.info_cache`) for settings UI, or accept a custom `History` file path.
  Default profile-directory paths are known for both macOS and Linux (see
  "Supported platforms" above) — e.g. Brave Origin is
  `~/Library/Application Support/BraveSoftware/Brave-Origin` on macOS and
  `~/.config/BraveSoftware/Brave-Origin` on Linux. Other installs (Windows,
  plain Chromium rather than Google Chrome, non-default install locations)
  use the custom path field instead of a guessed default;
- copy `History` (+ `-wal`/`-shm` if present) into a temp directory before
  reading, since the browser holds the live file open; delete the copy
  afterwards, including on error;
- convert Chromium visit timestamps (microseconds since 1601-01-01 UTC) to
  local dates for date matching, mirroring how Dropbox's `date-matching.ts`
  encapsulates its own epoch;
- group/collapse repeated visits per domain and filter a configurable
  domain-exclude list (hostname suffix match: excluding `example.com` also
  excludes `www.example.com`, not `notexample.com`);
- normalize visited pages into `link`-typed `ContextItem`s, tagged with
  `groupLabel` set to the domain, for `CopyMarkdownLinkAction` to act on.

### SQLite access strategy

Chosen: spawn the system `sqlite3` binary (`child_process.spawn`, array
arguments, `shell: false`), reading `-json` output, rather than bundling
`sql.js` or a native SQLite binding.

This is decided specifically against the "reading works while the browser is
running" requirement, not bundle size: the live `History` file is in WAL mode,
so very recent visits exist only in a companion `History-wal` file until
checkpointed. The snapshot is a plain filesystem copy of `History` (+
`-wal`/`-shm` if present) into a temp directory under their original
filenames; opening the copy with a real SQLite engine then replays the WAL the
same way the live browser would.

Two alternatives were tried and rejected before landing on this:

- **SQLite's own online backup command** (`sqlite3 <historyPath> ".backup
  <dest>"`) looked strictly better on paper — it uses SQLite's backup API,
  which takes its own locks and produces a page-consistent snapshot even if
  the browser checkpoints mid-copy, avoiding a theoretical torn-snapshot race
  that a plain multi-file `fs.copyFile` sequence can't rule out. In practice
  it fails outright: `.backup` needs to acquire a real SQLite lock on the
  source database, and confirmed against a real, currently-open Brave Origin
  profile, `sqlite3 <liveHistoryPath> ".backup ..."` reliably errors with
  `Error: database is locked` — Chromium's History backend holds a lock often
  enough, even when merely open and not actively browsing, that this isn't an
  edge case. A plain `fs.copyFile` doesn't participate in SQLite's locking
  protocol at all, so it isn't blocked by it, and was confirmed to work
  against the same live profile. The theoretical consistency risk of a
  multi-file copy is accepted as the more practical trade-off — file copies
  read of order milliseconds, and Chromium doesn't checkpoint that
  frequently — over an approach that fails deterministically.
- **`sql.js`**'s public API only accepts a single in-memory buffer for the
  main database file and has no supported way to run an online backup or
  replay a companion WAL buffer, so it would silently miss the most recent
  visits — the exact case this feature most needs to work.

A native module (e.g. `better-sqlite3`) would handle WAL correctly without
this locking problem (it opens the live file directly, the way the browser
itself does, rather than copying it), but ties the plugin to Obsidian's
bundled Electron Node ABI, which is a known source of plugin breakage across
Obsidian upgrades. Node's experimental `node:sqlite` has the same WAL
guarantee but uncertain availability across the range of Node versions
different Obsidian/Electron releases embed. This plugin already targets
macOS and Linux only (see "Supported platforms" above), and `sqlite3` ships
by default on macOS and is near-universally available on Linux desktop
distributions, making the external-binary dependency low-risk on both.

Query bounds are Chromium-microsecond integers this plugin computes itself
(never user-controlled strings), so they are safe to inline into the SQL text
passed to `sqlite3 -json`. Domain-exclude matching and per-URL visit
collapsing are done in JS after parsing the JSON output, not in SQL, because
that logic involves user-typed strings and semantics best expressed and
unit-tested as plain predicates rather than dynamic SQL.

`isAvailable()` returns `false` when the platform isn't desktop or the
resolved `History` path doesn't exist; a resolvable-but-unreadable file
(corrupt copy, `sqlite3` missing) surfaces as a per-source error from
`getItems()`, which the existing per-source isolation in
`DailyContextService`/`DailyInboxRefresher` already contains to that source's
section.

Test fixtures are never committed. `src/test-support/synthetic-history-db.ts`
builds throwaway `History` databases via the same `sqlite3` binary at test
time (present on macOS/Linux CI runners and developer machines), including a
variant that keeps a `sqlite3` process alive across a mid-session copy to
exercise WAL replay directly.

## Actions

v0.1 should minimize coupling with the existing S3 Image Uploader.

Preferred first action:

```text
ContextItem (Dropbox image)
 -> fetch image bytes
 -> copy image to clipboard
 -> user pastes into editor
 -> existing S3 Image Uploader handles upload/R2/Markdown
```

Do not synthesize paste events or depend on another plugin's private implementation.

The async Clipboard API only accepts `image/png` for image writes, so non-PNG originals (camera JPEGs) are decoded and re-encoded as PNG before copying. The pasted file is therefore a PNG that is typically several times larger than the original JPEG, and that PNG is what S3 Image Uploader uploads. Formats the platform cannot decode (e.g. HEIC on desktop Chromium) fail with an explicit error. If upload size becomes a problem in real use, revisit this (e.g. downscaling, or the direct-publish path below) rather than working around the clipboard.

A later direct-publish path should be modeled behind an interface such as:

```ts
interface AssetPublisher {
  publish(asset: BinaryAsset): Promise<PublishedAsset>;
}
```

and must not leak R2/S3 concerns into `DropboxSource`.

## Persistence

Persist only what is operationally necessary:

- plugin settings;
- authentication state where required;
- disposable API cursors/cache metadata.

Do not persist a second copy of the Daily Context or a history of Context Items merely to support the view.

## Security

Never commit tokens, OAuth secrets, real private Daily Notes, or personal photos.

Authentication material must live in Obsidian plugin data or an appropriate platform credential mechanism. Public repository fixtures must use synthetic data.

## UI implementation

Prefer Obsidian's native DOM APIs for the first implementation. Avoid introducing React/Svelte unless complexity demonstrates a need.

The first photo UI is a thumbnail grid grouped under a source/Photos section with timestamp metadata and explicit loading/error/empty states.
