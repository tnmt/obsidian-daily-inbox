---
name: release
description: Release a new version of the Daily Inbox plugin (version bump, build, tag and GitHub Release). Use when asked to release, cut a version, or publish a new version such as 0.5.0.
---

# Release

Releases are published as a GitHub Release whose tag is the bare version (`0.5.0`, no `v`). Match the previous release's shape: `gh release view <previous>`.

## Steps

1. Work out the version. If none was given, propose the next minor for a `feat`, patch for fixes only, and confirm before continuing. Start from a clean `main` that equals `origin/main`.
2. Set `"version"` in `manifest.json` and `package.json` to the new version.
3. Verify with the dev shell, because `pnpm` is not on PATH: `nix develop --command pnpm test` then `nix develop --command pnpm build`. Stop on any failure.
4. Commit as `chore: release <version>`. The body is one or two sentences saying what the release adds, for a reader of the changelog. Push `main`.
5. Write the release notes to a scratchpad file in the shape of the previous release:
   - `## What's Changed`, then one `* <type>(<scope>): <user-facing description> by @<author> in <PR URL>` line per change since the previous tag (`git log <previous>..HEAD`, `gh pr view <n>`). Name settings locations and defaults a user needs; no internal detail.
   - A blank line and `**Full Changelog**: https://github.com/<owner>/<repo>/compare/<previous>...<version>`.
6. Create the release, letting GitHub create the tag:

   ```
   gh release create <version> main.js manifest.json styles.css \
     --target main --title <version> --notes-file <file> --latest
   ```

7. Check with `gh release view <version> --json tagName,isDraft,assets`: not a draft, and the three assets attached.

## Pitfalls

- Do not create the tag locally. `tag.gpgsign` may be enabled, which makes `git tag` demand a message, and earlier tags are lightweight. `gh release create` makes the tag on GitHub.
- `--target` takes a branch name or a full commit SHA, not an abbreviated SHA.
- `git rev-parse --short` accepts one revision only; do not pass two in a chain.
- Only `main.js`, `manifest.json` and `styles.css` are attached.
- Installing into a vault is a separate step: `pnpm dev:install --vault <path>`, via the dev shell. It overwrites the three files and keeps `data.json`.
