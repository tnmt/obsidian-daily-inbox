# Architecture

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
