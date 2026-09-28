# Dropbox OAuth/API design (issue #2)

Status: design proposal, not yet implemented. Open questions are listed in
[Unresolved items](#unresolved-items).

## 1. OAuth flow

- Authorization Code Flow with PKCE (S256). No client_secret — it cannot be
  kept safe in a distributed plugin bundle.
- `token_access_type=offline` on the authorize URL to obtain a `refresh_token`.
- Rationale for refresh tokens: Daily Inbox refreshes its view automatically
  whenever the active file or resolved date changes (see architecture.md,
  "View lifecycle"), so re-prompting for manual auth on every refresh is not
  acceptable.
- client_id (the Dropbox App key) may be hardcoded in source. Dropbox
  documents it as a public identifier, unlike client_secret.

## 2. Redirect URI

v0.1 uses the no-redirect flow: the authorization code is displayed on
dropbox.com and the user pastes it into the plugin's settings tab.

Dropbox's official guarantee only covers the code-display step. On desktop,
the browser round-trip (open URL -> approve -> copy code -> paste into
Obsidian) is straightforward. On mobile, switching to a browser and back has
not been verified against real Obsidian mobile behavior.

A custom-protocol callback (`obsidian://...` via
`Plugin.registerObsidianProtocolHandler`) would remove the copy/paste step,
but requires confirming that Dropbox's App Console accepts a non-http
redirect URI, and that Obsidian mobile reliably delivers protocol callbacks.
Not adopted for v0.1; left as a future option.

## 3. Scopes and content access

Confirmed directly against `dropbox-api-spec` (`files.stone`):

- `list_folder` / `list_folder/continue` -> scope `files.metadata.read`
- `download` / `get_thumbnail_batch` -> scope `files.content.read`

Required scopes: `files.metadata.read` + `files.content.read`.

Content Access must be **Full Dropbox**, not App Folder: Camera Uploads lives
at `/Camera Uploads`, outside any app-scoped `/Apps/<AppName>` folder. This
means the token can read outside the configured folder as an artifact of
scope granularity — this must be disclosed to the user (settings tab copy,
README) rather than left implicit. The configured folder path is passed
as-is to `list_folder`; it is not hardcoded to `/Camera Uploads`.

## 4. Token lifecycle and error handling

- Store `expires_in` and refresh proactively when the access token is within
  ~5 minutes of expiry, in addition to reactive refresh on 401.
- Refresh calls are de-duplicated: concurrent `getItems()` calls share one
  in-flight refresh instead of racing.
- Error classification:
  - 401 that survives a refresh attempt (`invalid_grant` etc.) -> surfaced as
    a source-level "Dropbox re-authentication required" error.
  - Network errors / 429 / 5xx during refresh -> surfaced as a transient
    source-level error; stored credentials are **not** discarded, and the
    next refresh attempt retries. Retries are capped, not unbounded.

## 5. Cancellation propagation

`DropboxSource.getItems(context, signal)` must thread its `AbortSignal`
through every underlying operation: the `list_folder`/`continue` loop,
`get_thumbnail_batch` calls, and any backoff/retry `setTimeout`. This
satisfies architecture.md's "Refreshes must cancel obsolete source requests
via AbortController" — it is a required part of this issue, not a follow-up.

## 6. Date matching

- Camera Upload filenames (e.g. `2026-09-23 12.34.56.jpg`) encode the
  device's local time; the date is read as-is, with no timezone conversion,
  and compared directly against the Daily Context's local date.
- Fallback timestamps (`client_modified` / `server_modified`) are UTC and are
  **not** capture time. They are converted to local-date before comparison,
  and this must be covered by tests, not just a comment.
- Test cases to cover explicitly: day-boundary times (23:59-00:00), filenames
  that don't match the naming convention, and DST transition days.

## 7. Pagination

- Follow `has_more` cursors to completion (required to satisfy "pagination
  does not silently truncate a day's results"), but filter by date per page
  and discard non-matching entries immediately rather than buffering the
  entire folder listing.
- A cursor-reset error restarts from `list_folder`.
- A missing/renamed target folder surfaces as a source-level "folder not
  found" error.

## 8. Thumbnails

- `get_thumbnail_batch` accepts at most 25 files per call; date-matched items
  are chunked accordingly.
- Files outside the supported extensions (jpg, jpeg, png, tiff, tif, gif,
  webp, ppm, bmp) or larger than 20MB are not thumbnail-eligible. These items
  are left without a thumbnail (placeholder in the UI) rather than falling
  back to fetching the full original.
- `download` (full image bytes) is only ever called from an explicit user
  Action, never from `getItems()` — keeping with product.md's "thumbnails
  first, full assets only on explicit action."

## 9. Storage and secrecy

- Tokens are stored via `this.saveData()` (Vault-local `data.json`), per
  architecture.md's "Authentication material must live in Obsidian plugin
  data." This is plaintext, not secret storage, and must be documented as
  such in the settings tab and README.
- A `.gitignore` entry only prevents new tracking; it does not protect
  against Vault sync services or backups. This limitation is documented
  alongside the storage note above.
- Tokens are never written to logs or error messages. Disconnecting deletes
  stored credentials immediately; calling the revoke endpoint is attempted
  but not required for disconnect to succeed.

## 10. PKCE state handling

`code_verifier` is generated per authorization attempt and held only in
memory for that plugin session; it is discarded on cancel or on starting a
new attempt. It is never persisted to `data.json`.

## 11. Proposed layout (`src/sources/dropbox/`)

- `auth.ts` — PKCE generation, authorize URL construction, token
  exchange/refresh, refresh de-duplication
- `client.ts` — thin fetch wrappers for `list_folder`/`continue`,
  `get_thumbnail_batch`, `download`
- `dropbox-source.ts` — `ContextSource` implementation: pagination, date
  filtering, cancellation propagation
- `date-matching.ts` — filename/metadata date extraction and local-date
  conversion

## 12. Why not the official SDK

`dropbox-sdk-js` does provide token-refresh handling, so "refresh would need
to be reimplemented" is not a valid reason to avoid it. The actual reason is
narrower, per AGENTS.md's "add framework dependencies only with a concrete
justification": this source only calls four endpoints, and pulling in the
full SDK surface for that is not justified. A thin fetch wrapper covers the
four calls directly.

## 13. Scope of issue #2

This issue covers `DropboxSource` itself: authentication, folder
configuration, date-filtered + paginated `ContextItem[]` retrieval, and
thumbnail population. The thumbnail grid UI (roadmap milestone 6) and the
copy-to-clipboard Action (milestone 7) are out of scope for this issue.

## Unresolved items

1. Whether Dropbox's App Console accepts a custom-scheme redirect URI
   (`obsidian://...`) — relevant only if a future revision replaces the
   manual-paste flow.
2. Real-device behavior of the manual-paste flow on Obsidian mobile
   (browser hand-off and return).
3. The exact, current Camera Uploads filename convention — needs
   verification against a real Camera Uploads folder before implementation.
