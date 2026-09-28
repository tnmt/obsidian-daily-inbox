import { contentDownloadCall, rpcCall } from "./http";
import type { DownloadResult, HttpRequester } from "./http";
import { throwIfAborted } from "./cancel";

export interface DropboxFileEntry {
  readonly [".tag"]: "file";
  readonly name: string;
  readonly path_lower: string;
  readonly id: string;
  readonly client_modified: string;
  readonly server_modified: string;
  readonly size: number;
}

interface DropboxOtherEntry {
  readonly [".tag"]: "folder" | "deleted";
  readonly name: string;
}

export type DropboxListFolderEntry = DropboxFileEntry | DropboxOtherEntry;

export interface ListFolderResult {
  readonly entries: DropboxListFolderEntry[];
  readonly cursor: string;
  readonly has_more: boolean;
}

export function isFileEntry(entry: DropboxListFolderEntry): entry is DropboxFileEntry {
  return entry[".tag"] === "file";
}

export async function listFolder(
  http: HttpRequester,
  accessToken: string,
  path: string,
  signal: AbortSignal,
): Promise<ListFolderResult> {
  throwIfAborted(signal);
  return rpcCall(http, "api", "files/list_folder", accessToken, { path });
}

export async function listFolderContinue(
  http: HttpRequester,
  accessToken: string,
  cursor: string,
  signal: AbortSignal,
): Promise<ListFolderResult> {
  throwIfAborted(signal);
  return rpcCall(http, "api", "files/list_folder/continue", accessToken, { cursor });
}

// Dropbox accepts at most 25 entries per get_thumbnail_batch call; chunking
// across that limit is the caller's responsibility (dropbox-source.ts).
export const THUMBNAIL_BATCH_LIMIT = 25;

// Files outside this set (and files over 20MB) are not eligible for
// conversion and are simply absent from a successful batch's entries.
export const THUMBNAIL_SUPPORTED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "tiff",
  "tif",
  "gif",
  "webp",
  "ppm",
  "bmp",
]);

export interface GetThumbnailBatchSuccess {
  readonly [".tag"]: "success";
  readonly metadata: DropboxFileEntry;
  readonly thumbnail: string;
}

export interface GetThumbnailBatchFailure {
  readonly [".tag"]: "failure";
}

export type GetThumbnailBatchEntry = GetThumbnailBatchSuccess | GetThumbnailBatchFailure;

export interface GetThumbnailBatchResult {
  readonly entries: GetThumbnailBatchEntry[];
}

export function isThumbnailSuccess(
  entry: GetThumbnailBatchEntry,
): entry is GetThumbnailBatchSuccess {
  return entry[".tag"] === "success";
}

export async function getThumbnailBatch(
  http: HttpRequester,
  accessToken: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<GetThumbnailBatchResult> {
  throwIfAborted(signal);
  if (paths.length > THUMBNAIL_BATCH_LIMIT) {
    throw new Error(`getThumbnailBatch accepts at most ${THUMBNAIL_BATCH_LIMIT} paths, got ${paths.length}`);
  }
  return rpcCall(http, "content", "files/get_thumbnail_batch", accessToken, {
    entries: paths.map((path) => ({ path, format: "jpeg", size: "w128h128", mode: "strict" })),
  });
}

export async function downloadFile(
  http: HttpRequester,
  accessToken: string,
  path: string,
  signal: AbortSignal,
): Promise<DownloadResult> {
  throwIfAborted(signal);
  return contentDownloadCall(http, "files/download", accessToken, { path });
}
