# Roadmap

The roadmap is deliberately friction-driven: implement the smallest workflow, use it in real Daily Note writing, then add only capabilities that remove observed friction.

## v0.1 — Dropbox photo context

Goal: eliminate the need to open Dropbox just to find photos for the Daily Note date.

Milestones:

1. Obsidian plugin scaffold and right-side Daily Inbox ItemView.
2. Daily Note date resolver and automatic view synchronization.
3. `ContextSource` / `ContextItem` core contracts.
4. Dropbox authentication and configurable Camera Uploads folder.
5. Date-filtered image retrieval with pagination/cursor handling.
6. Thumbnail grid with loading, empty, and error states.
7. Click/action to copy the selected full image to the clipboard.
8. Manual refresh and cancellation of stale requests.

Acceptance workflow:

```text
open 2026-09-23.md
 -> Daily Inbox resolves 2026-09-23
 -> Dropbox section shows photos for 2026-09-23
 -> choose photo
 -> image is copied
 -> paste in editor
 -> existing S3 Image Uploader publishes it to R2
```

## v0.2 — only after real usage

Candidates, not commitments:

- multi-select photos;
- drag/drop or direct insertion;
- more robust capture-date/EXIF handling;
- caching/performance improvements.

Do not implement these merely because they are easy.

## Planned sources

The Daily Inbox view renders one section per Context Source, so each of these is added as a source without changing the view:

- On this day: material from the same calendar date in earlier years;
- Obsidian Notes: notes created/modified on the date;
- Claude Code sessions active on the date;
- Browser history / read-later items from the date.

## Later source candidates

- GitHub activity;
- lightweight capture source;
- other photo providers.

Every source must preserve the "external SSoT, derived Daily Context" model.

## Explicitly deferred

- processed/read/archive Inbox state;
- storing a canonical life log in this plugin;
- replacing Dropbox as photo storage;
- replacing S3 Image Uploader/R2;
- automatic private-to-public journal publishing;
- Immich deployment/integration;
- generic workflow automation.

These can be reconsidered independently if actual usage changes the problem.
