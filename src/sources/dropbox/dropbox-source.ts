import type { ContextItem, ContextSource, DailyContext } from "../../domain";
import type { DropboxAuthClient } from "./auth";
import {
  THUMBNAIL_BATCH_LIMIT,
  THUMBNAIL_SUPPORTED_EXTENSIONS,
  downloadFile,
  getThumbnailBatch,
  isFileEntry,
  isImageFile,
  isThumbnailSuccess,
  listFolder,
  listFolderContinue,
  type DropboxFileEntry,
} from "./client";
import { CancelledError, throwIfAborted } from "./cancel";
import { DropboxApiError, type HttpRequester } from "./http";
import { DropboxSourceError } from "./errors";
import { resolveEntryDate } from "./date-matching";
import { withAuthRetry } from "./with-auth-retry";

export interface DropboxImagePayload {
  readonly path: string;
}

const MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024;

function isThumbnailEligible(entry: DropboxFileEntry): boolean {
  const ext = entry.name.split(".").pop()?.toLowerCase();
  return !!ext && THUMBNAIL_SUPPORTED_EXTENSIONS.has(ext) && entry.size <= MAX_THUMBNAIL_BYTES;
}

// Maps every failure that can reach getItems()/downloadOriginal() into the
// source-level error vocabulary from errors.ts, or rethrows
// DropboxSourceError/CancelledError as-is so callers can drop a cancelled
// request instead of rendering it as an error.
function toSourceError(err: unknown): never {
  if (err instanceof DropboxSourceError || err instanceof CancelledError) throw err;
  if (err instanceof DropboxApiError) {
    if (err.status === 401) {
      // withAuthRetry already tried a refresh-and-retry once; a 401 that
      // survives that means re-authentication, not a transient hiccup.
      throw new DropboxSourceError(
        "auth-required",
        `Dropbox re-authentication is required: ${err.message}`,
        err,
      );
    }
    if (err.status === 409 && err.errorSummary?.includes("not_found")) {
      throw new DropboxSourceError("not-found", `Dropbox folder not found: ${err.message}`, err);
    }
    throw new DropboxSourceError("transient", `Dropbox API error: ${err.message}`, err);
  }
  throw new DropboxSourceError("transient", "Unexpected error while querying Dropbox.", err);
}

export class DropboxSource implements ContextSource {
  readonly id = "dropbox";
  readonly name = "Dropbox";

  constructor(
    private readonly http: HttpRequester,
    private readonly auth: DropboxAuthClient,
    private readonly getFolderPath: () => string,
  ) {}

  isAvailable(): boolean {
    return this.auth.isConnected() && this.getFolderPath().trim().length > 0;
  }

  async getItems(context: DailyContext, signal: AbortSignal): Promise<ContextItem[]> {
    try {
      // Each phase gets its own withAuthRetry so a 401 partway through
      // thumbnail fetching only re-does thumbnail fetching, not the
      // already-completed folder listing (docs/dropbox-oauth-design.md #7).
      const matched = await withAuthRetry(this.auth, signal, (token) =>
        this.listMatchingEntries(context, token, signal),
      );
      const thumbnails = await withAuthRetry(this.auth, signal, (token) =>
        this.fetchThumbnails(token, matched, signal),
      );
      return matched.map((entry) => this.toContextItem(entry, thumbnails.get(entry.path_lower)));
    } catch (err) {
      toSourceError(err);
    }
  }

  // Filters per page as entries arrive rather than buffering the whole
  // folder listing, while still following every cursor to completion so a
  // day's results are never silently truncated (docs/dropbox-oauth-design.md #7).
  private async listMatchingEntries(
    context: DailyContext,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<DropboxFileEntry[]> {
    const matched: DropboxFileEntry[] = [];
    const path = this.getFolderPath();
    let page = await listFolder(this.http, accessToken, path, signal);
    while (true) {
      throwIfAborted(signal);
      for (const entry of page.entries) {
        if (isFileEntry(entry) && isImageFile(entry) && resolveEntryDate(entry) === context.date) {
          matched.push(entry);
        }
      }
      if (!page.has_more) break;
      page = await listFolderContinue(this.http, accessToken, page.cursor, signal);
    }
    return matched;
  }

  private async fetchThumbnails(
    accessToken: string,
    entries: readonly DropboxFileEntry[],
    signal: AbortSignal,
  ): Promise<Map<string, string>> {
    const thumbnails = new Map<string, string>();
    const eligible = entries.filter(isThumbnailEligible);
    const chunks: DropboxFileEntry[][] = [];
    for (let i = 0; i < eligible.length; i += THUMBNAIL_BATCH_LIMIT) {
      chunks.push(eligible.slice(i, i + THUMBNAIL_BATCH_LIMIT));
    }
    // Chunks are independent batch calls with no ordering dependency, so
    // fetch them concurrently instead of one at a time.
    const results = await Promise.all(
      chunks.map((chunk) =>
        getThumbnailBatch(
          this.http,
          accessToken,
          chunk.map((entry) => entry.path_lower),
          signal,
        ),
      ),
    );
    // The batch calls above don't check the signal again after their last
    // await resolves, so a cancellation during that final wait needs to be
    // caught here before the result is used.
    throwIfAborted(signal);
    results.forEach((result, chunkIndex) => {
      const chunk = chunks[chunkIndex];
      result.entries.forEach((resultEntry, index) => {
        if (isThumbnailSuccess(resultEntry)) {
          thumbnails.set(chunk[index].path_lower, `data:image/jpeg;base64,${resultEntry.thumbnail}`);
        }
      });
    });
    return thumbnails;
  }

  private toContextItem(entry: DropboxFileEntry, thumbnail: string | undefined): ContextItem {
    const payload: DropboxImagePayload = { path: entry.path_lower };
    return {
      id: entry.id,
      sourceId: this.id,
      type: "image",
      timestamp: new Date(entry.client_modified ?? entry.server_modified),
      title: entry.name,
      thumbnail,
      payload,
    };
  }

  /** Fetches the full image bytes for a payload produced by this source. Called only from an explicit Action, never from getItems(). */
  async downloadOriginal(payload: DropboxImagePayload, signal: AbortSignal): Promise<ArrayBuffer> {
    try {
      const { data } = await withAuthRetry(this.auth, signal, (token) =>
        downloadFile(this.http, token, payload.path, signal),
      );
      throwIfAborted(signal);
      return data;
    } catch (err) {
      toSourceError(err);
    }
  }
}
