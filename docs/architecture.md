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

### Multi-folder search

v0.1's original single hardcoded `folderPath` broke for a common real-world
Dropbox setup: files older than some age get moved out of Camera Uploads into
a yearly archive folder (e.g. `/Pictures/Archive/2025`). A Daily Note older
than that cutoff found nothing, because its photos no longer lived under the
one configured folder. This was found from real usage, not anticipated up
front (#20).

Resolution:

- settings hold an ordered list of folder path templates (`folderPaths:
  string[]`) instead of a single string; existing single-`folderPath`
  installs migrate to a one-entry list on first load (`migrateDropboxSettings`
  in `settings.ts`);
- a template may contain a `{year}` placeholder, substituted with the local
  4-digit year of `DailyContext.date` before listing — this matches a
  per-year archive layout without requiring the user to add a new folder
  entry every year (`folder-path-template.ts`);
- each resolved path is listed and date-matched independently (mirroring the
  original single-path logic); matched items from all folders are merged into
  one result set;
- a `not-found` result for one resolved path does not by itself fail the
  call — it's tolerated as "no items from this folder", since with a
  `{year}` template this is an expected steady state (e.g. a future or
  not-yet-archived year has no such folder). If *every* configured path comes
  back `not-found`, that's indistinguishable from a genuine
  misconfiguration, so the `not-found` source error is still surfaced in
  that case. Other errors (`auth-required`, `transient`) are not
  folder-specific and always fail the whole `getItems()` call immediately,
  per the existing per-source isolation model.

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

## Location source

Shows where the user stayed and how they moved on the date. The authoritative
store is a self-hosted [overland-server](https://github.com/tnmt/overland-server)
instance, which collects phone location uploads, imports Google Maps Timeline
exports, detects stays and attaches user-chosen place names. Daily Inbox only
reads its `GET /api/days/{YYYY-MM-DD}` and does not keep a copy.

Responsibilities (`src/sources/location/`):

- call the server through `requestUrl` with `Authorization: Bearer <token>`;
  base URL and token live in plugin settings and the source is unavailable
  until both are set;
- map each stay and move to an `activity`-typed `ContextItem`, chronologically,
  with a pre-rendered one-line text payload for `CopyActivityTextAction`;
- report 401/403, 404, network/5xx and unexpected JSON as distinct
  `LocationSourceError` kinds, contained to the section.

Times are displayed from the wall-clock part of the server's RFC 3339
timestamps rather than converted to the local machine's zone: the server
defines which calendar day a stay belongs to, and converting would make a stay
appear to start or end on a different date than the one it was returned for.
Stays that began on the previous day (typically the night at home) show their
start date.

Place naming stays on the server. Naming places from Daily Inbox would need a
write API there and is not part of this source.

## Withings source

Shows body measurements recorded on the date (#27). The authoritative store is
the Withings cloud; Daily Inbox reads it through the public API and keeps no
copy. Only `getmeas` (scope `user.metrics`) is in scope: weight, body
composition, standing heart rate, pulse wave velocity and vascular age from a
Body Cardio scale. Steps and sleep need other devices and are out of scope.

Findings from a real Body Cardio account:

- `POST https://wbsapi.withings.net/measure`, `action=getmeas`, with
  `startdate`/`enddate` as Unix timestamps. Values decode as
  `value * 10^unit`. The response carries `timezone` (`Asia/Tokyo`).
- Returned types: weight 1, fat-free mass 5, fat ratio 6, fat mass 8, heart
  rate 11, muscle mass 76, hydration 77, bone mass 88, pulse wave velocity 91,
  vascular age 155. PWV and vascular age are returned even though the docs
  call scale cardio metrics EU-only.
- A response holds at most 1000 groups (`more`/`offset` to page); fetching one
  date's range never needs paging. History goes back to 2016.
- A day can hold up to 12 groups: weight + body composition, heart rate, and
  PWV + vascular age arrive as separate groups.
- Rate limit: one poll per 10 minutes per user (status 601).
- Access token 3 h; refresh token 1 year and rotated on every refresh. The
  previous refresh token stays valid for 8 hours after rotation (per the
  docs, not exercised).
- The authorization code expires in 30 seconds.

Decisions proposed here and open to review before implementation:

- **Authorization.** Each user registers their own Withings application and
  enters its Client ID and Client Secret in settings. A shared application
  would need Withings' production review, which is not assumed. The plugin
  starts a loopback HTTP listener on `127.0.0.1` (fixed port, registered as the
  redirect URI) only while an authorization is pending, exchanges the code
  immediately, and closes the listener. The `requesttoken` documentation lists
  `client_id`, `code`, `grant_type`, `redirect_uri` and a secret-derived
  `signature` or `client_secret`, and no PKCE parameters, so the Client Secret
  is required and PKCE is not used. Withings documents no custom-scheme
  redirect, so `obsidian://` is not used. For production applications it
  documents https-only callbacks without IPs or localhost; the loopback
  redirect relies on the development-environment exception, which caps the
  application at 10 users.
- **Token storage.** Tokens and the secret live in plugin data like the other
  sources' credentials. Refreshes are serialized so two concurrent refreshes
  cannot invalidate each other, and the new refresh token is persisted before
  the new access token is used.
- **Aggregation.** `getmeas` groups are merged when their timestamps fall
  within 30 minutes of each other, so one weigh-in session becomes one
  `activity` item (e.g. `07:12 Weight 55.7kg / Fat 15.7% / Muscle 44.4kg / PWV
  6.0m/s`). The window is a starting value to be tuned against real data.
- **Date range.** The query range is the local calendar day's start and end as
  Unix timestamps, widened by 26 hours on each side (the UTC-12 to UTC+14 span) so a
  machine in another zone than the Withings account still receives the whole
  day. Groups are then
  kept only if their date in the response `timezone`, not the machine's zone,
  equals the requested date.
- **Rate limit.** A short in-memory cache keyed by date avoids hitting the
  10-minute limit on date switches and manual refreshes. It is disposable and
  not persisted.
- **Errors.** Authorization failure/expired refresh token, rate limit (601),
  network/5xx and malformed responses are distinct `WithingsSourceError`
  kinds, contained to the section. Observed against the real API: the token
  endpoint answers an invalid code or refresh token with 503 (`Invalid
  Params`). 601 as the rate limit comes from the documentation, and 401 and
  293 as a rejected access token are assumed, not observed. For the token endpoint, 503 and every status outside 500-599 clear
  the tokens and ask for re-authorization; other 500-599 statuses are treated
  as Withings-side faults (stored tokens kept), which is unverified.
- **Cancellation.** A token refresh is not tied to the requesting view's
  signal: Withings rotates the refresh token as soon as it handles the
  request, so the response must reach storage even if the view has moved on.
  Overlapping queries for the same date and account share one request.

Development-phase applications may use HTTP/loopback redirect URIs but are
capped at 10 users, which is acceptable for per-user applications.

## GitHub source

Shows the user's development activity on the date (#29). GitHub is the
authoritative store; Daily Inbox reads it through the REST API and keeps no
copy. The events endpoint is not used because it keeps only 300 events from
the past 30 days and could not serve earlier dates. The search endpoints are
used instead.

Findings from the official documentation (not yet exercised against a real
account):

- `GET /search/commits` supports `author:` and `author-date:` /
  `committer-date:` qualifiers and returns up to 100 results per page. It
  searches only the default branch, so commits on unmerged branches are not
  returned.
- `GET /search/issues` covers issues and pull requests (`type:`, `author:`,
  `created:`, `closed:`, `merged:`).
- Search allows 30 requests per minute when authenticated and 1000 results per
  query, and may answer with `incomplete_results: true` after a timeout.

Decisions proposed here and open to review before implementation:

- **Forge seam.** GitHub's response shapes stay inside `src/sources/github/`;
  the items handed to the view and actions are forge-neutral, so another forge
  can be added later as a separate adapter. No second adapter is built now.
- **Scope.** The user's own commits, pull requests opened, merged or closed,
  and issues opened or closed. Other people's activity, reviews and comments
  are out of scope until the Daily Note shows a need.
- **Authorization.** The user enters their GitHub username and a personal
  access token in settings, held in plugin data like the other sources'
  credentials. The source is unavailable until both are set. The token scopes
  needed for private repositories are to be verified.
- **Items.** Each commit, pull request or issue event becomes an `activity`
  item with a pre-rendered one-line text payload for `CopyActivityTextAction`,
  grouped by repository through `groupLabel`. Because commits can number in
  the dozens per day, the collapse rule (for example a count with expansion)
  is decided together with the first implementation.
- **Date range.** The local calendar day must be expressed in a form the search
  qualifiers interpret correctly. Whether they accept an ISO 8601 date-time
  with a UTC offset is unverified; if they do not, the range is widened by a
  day on each side and results are filtered by their timestamp's local date.
- **Default-branch limit.** The commit search gap is documented in the source's
  section hint rather than worked around with per-repository branch scans.
- **Errors.** Authorization failure, rate limit, `incomplete_results`,
  network/5xx and malformed responses are distinct `GitHubSourceError` kinds,
  contained to the section.
- **Cancellation.** Date switches cancel in-flight requests through the
  `AbortSignal`, as for the other sources.

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

`CopyActivityTextAction` copies the text an `activity` item's source prepared
in its payload (e.g. `09:39–11:15 Office` for a stay). It matches on type and
payload shape, so the view needs no knowledge of the Location source.

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

Clicking a thumbnail opens a preview modal that downloads the original and shows it uncropped; clicking the preview copies the photo to the clipboard. The copy reuses the original the preview downloaded (a single-entry cache), so only one full-size download happens per photo selection.
