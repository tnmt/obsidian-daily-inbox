# Agent instructions

Read `README.md`, `docs/product.md`, `docs/architecture.md`, and `docs/roadmap.md` before changing architecture or implementing roadmap work.

## Non-negotiable design constraints

- Daily Inbox is an ephemeral view over existing sources, not a system of record.
- Internally use the Daily Context model. Do not introduce inbox-processing state such as read/processed/archive.
- Sources retrieve and normalize data; Actions act on items. Keep those responsibilities separate.
- Dropbox remains authoritative for v0.1 photos.
- Do not replace or integrate against private internals of the existing S3 Image Uploader in v0.1.
- Do not implement public-journal publishing as part of Daily Inbox.
- Never commit credentials, private notes, or real personal photos. The gitleaks hooks and CI enforce this; do not bypass them with `--no-verify` or widen `.gitleaks.toml` allowlists to make a real value pass.
- Keep source failures isolated.
- Correct local-date semantics and cancellation of stale asynchronous requests matter more than feature breadth.

## Implementation policy

Work issue-by-issue. Before implementing an issue:

1. identify its acceptance criteria;
2. check whether the requested change conflicts with the product/architecture docs;
3. prefer the smallest implementation satisfying the criteria;
4. add tests for pure domain/date logic where practical;
5. run typecheck/lint/tests/build before declaring completion.

Do not opportunistically implement roadmap items from later versions.

Prefer Obsidian-native APIs and DOM for the initial UI. Add framework dependencies only with a concrete justification.

When external API behavior is uncertain, verify current official documentation rather than guessing.

## Scope changes

If implementation reveals that a documented architectural constraint is impractical, do not silently work around it. Document the trade-off and propose a change to the architecture first.
