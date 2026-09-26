# Product principles

## Problem

Writing a Daily Note often requires reconstructing what happened that day. Useful evidence already exists across systems: photos, notes, reading history, development activity, and other logs. Opening each application and locating the relevant date interrupts writing.

Daily Inbox should make that context visible next to the Daily Note.

## Primary use case

While editing a private Daily Note for a date, open the Daily Inbox side panel and see photos taken on that date. Select a photo and move it into the existing Obsidian image-publishing workflow with minimal interaction.

The date is the Daily Note's date, not necessarily today. Reviewing an older Daily Note must show that older day's context.

## Product model

Daily Inbox is an ephemeral, derived view.

```text
Sources -> query(date) -> Daily Context -> side panel -> user chooses material
```

It is explicitly **not**:

- a second photo library;
- a life-log database;
- a replacement for Dropbox;
- a replacement for the existing S3/R2 image publishing path;
- a task/inbox processing system;
- a public-journal publishing system.

There should be no concept of processed/unprocessed items in the core model.

## Source of truth

Every Context Source owns its data elsewhere. The plugin may keep disposable caches, cursors, authentication state, and settings, but must not become the authoritative copy of source content.

For the first source:

- Dropbox remains the source of truth for photos.
- Daily Inbox discovers and previews photos.
- The existing S3 Image Uploader/R2 flow remains responsible for images embedded in notes.

## Privacy boundary

Daily Inbox and the private Daily Note are on the private side of the workflow.

```text
Daily Inbox -> private Daily Note -> human curation -> public journal
                                  ^ privacy boundary is after this stage
```

The plugin must not automatically publish Inbox material. Public-journal integration is a separate concern and is out of scope for v0.x unless deliberately reconsidered.

## UX principles

1. Stay beside the writing surface: prefer a right-side Obsidian ItemView.
2. Follow the note's date automatically.
3. Make retrieval cheap: thumbnails first, full assets only on explicit action.
4. Keep actions unsurprising and reversible.
5. Avoid configuration that is not needed for the current source.
6. Degrade per source: one failing source must not make the entire panel unusable.

## Success criterion for v0.1

The user can open a Daily Note, see the day's Dropbox Camera Uploads in the side panel, click/copy a desired image, and paste it into the note through the existing image-uploader workflow without opening Dropbox separately.
