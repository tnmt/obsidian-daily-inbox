# Daily Inbox for Obsidian

Daily Inbox is an Obsidian side-panel that reconstructs the context of a given day from existing sources and presents it as material for writing a Daily Note.

The motivating use case is simple: while writing a private Daily Note, quickly see photos taken that day and insert selected material without leaving Obsidian. Over time, other sources such as notes or GitHub activity may be added.

## Core idea

Daily Inbox is a **view, not a new system of record**.

- Existing services remain the source of truth.
- Inbox contents are derived on demand for a date.
- The plugin does not introduce read/unread, processed, archive, or other inbox state.
- The first target is a right-side panel that follows the active Daily Note.
- v0.1 focuses on Dropbox photos.
- Publishing to a public journal is deliberately outside the initial scope.

Internally, the domain concept is called **Daily Context**: a date plus the material resolved from one or more Context Sources.

See [Product](docs/product.md), [Architecture](docs/architecture.md), and [Roadmap](docs/roadmap.md).

## Initial workflow

```text
Dropbox Camera Uploads (photo SSoT)
              |
              v
     Daily Inbox side panel
       "photos for this date"
              |
        copy selected image
              |
              v
       Obsidian Daily Note
              |
        existing paste flow
              |
              v
   S3 Image Uploader -> R2
```

The plugin should initially reduce the friction of finding today's photos. It should not replace Dropbox, R2, the existing image uploader, or the Daily Note.

## Status

Design / pre-alpha. See the roadmap and GitHub issues before implementing.
