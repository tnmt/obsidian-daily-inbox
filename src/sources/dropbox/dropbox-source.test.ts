import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { localDate } from "../../domain";
import type { DailyContext } from "../../domain";
import type { DropboxAuthClient } from "./auth";
import type { DropboxFileEntry } from "./client";
import { DropboxSourceError } from "./errors";
import { CancelledError } from "./cancel";
import { DropboxSource, type DropboxImagePayload } from "./dropbox-source";
import type { HttpRequester } from "./http";

function fileEntry(overrides: Partial<DropboxFileEntry> = {}): DropboxFileEntry {
  return {
    ".tag": "file",
    name: "2026-09-23 12.34.56.jpg",
    path_lower: "/camera uploads/2026-09-23 12.34.56.jpg",
    id: "id:1",
    client_modified: "2026-09-23T12:34:56Z",
    server_modified: "2026-09-23T12:34:56Z",
    size: 1000,
    ...overrides,
  };
}

function mockAuth(overrides: Partial<DropboxAuthClient> = {}): DropboxAuthClient {
  return {
    isConnected: () => true,
    getAccessToken: async () => "token",
    refreshAfterUnauthorized: async () => "token-2",
    ...overrides,
  };
}

function routeHttp(
  handlers: Record<string, (params: RequestUrlParam) => RequestUrlResponse>,
): HttpRequester {
  return vi.fn(async (params: RequestUrlParam) => {
    const handler = handlers[params.url];
    if (!handler) throw new Error(`no handler for ${params.url}`);
    return handler(params);
  });
}

function ok(body: unknown): RequestUrlResponse {
  return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
}

function context(date: string): DailyContext {
  return { date: localDate(date) };
}

const LIST_FOLDER = "https://api.dropboxapi.com/2/files/list_folder";
const LIST_FOLDER_CONTINUE = "https://api.dropboxapi.com/2/files/list_folder/continue";
const GET_THUMBNAIL_BATCH = "https://content.dropboxapi.com/2/files/get_thumbnail_batch";
const DOWNLOAD = "https://content.dropboxapi.com/2/files/download";

describe("DropboxSource.isAvailable", () => {
  it("requires both a connected account and a configured folder", () => {
    const http = vi.fn();
    expect(new DropboxSource(http, mockAuth({ isConnected: () => false }), () => "/x").isAvailable()).toBe(false);
    expect(new DropboxSource(http, mockAuth(), () => "").isAvailable()).toBe(false);
    expect(new DropboxSource(http, mockAuth(), () => "/x").isAvailable()).toBe(true);
  });
});

describe("DropboxSource.getItems", () => {
  it("returns only entries matching the context date, with thumbnails attached", async () => {
    const matching = fileEntry();
    const other = fileEntry({ name: "2026-09-24 08.00.00.jpg", id: "id:2" });
    const http = routeHttp({
      [LIST_FOLDER]: () => ok({ entries: [matching, other], cursor: "c1", has_more: false }),
      [GET_THUMBNAIL_BATCH]: (params) => {
        const body = JSON.parse(params.body as string) as { entries: Array<{ path: string }> };
        expect(body.entries.map((e) => e.path)).toEqual([matching.path_lower]);
        return ok({ entries: [{ ".tag": "success", metadata: matching, thumbnail: "YmFzZTY0" }] });
      },
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    const items = await source.getItems(context("2026-09-23"), new AbortController().signal);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("id:1");
    expect(items[0].sourceId).toBe("dropbox");
    expect(items[0].type).toBe("image");
    expect(items[0].thumbnail).toBe("data:image/jpeg;base64,YmFzZTY0");
    expect((items[0].payload as DropboxImagePayload).path).toBe(matching.path_lower);
  });

  it("follows has_more cursors to completion instead of truncating", async () => {
    const page1 = fileEntry({ id: "id:1", name: "2026-09-23 01.00.00.jpg" });
    const page2 = fileEntry({ id: "id:2", name: "2026-09-23 02.00.00.jpg" });
    const http = routeHttp({
      [LIST_FOLDER]: () => ok({ entries: [page1], cursor: "cursor-1", has_more: true }),
      [LIST_FOLDER_CONTINUE]: (params) => {
        expect(JSON.parse(params.body as string)).toEqual({ cursor: "cursor-1" });
        return ok({ entries: [page2], cursor: "cursor-2", has_more: false });
      },
      [GET_THUMBNAIL_BATCH]: () => ok({ entries: [] }),
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    const items = await source.getItems(context("2026-09-23"), new AbortController().signal);
    expect(items.map((i) => i.id).sort()).toEqual(["id:1", "id:2"]);
  });

  it("leaves non-thumbnail-eligible entries without a thumbnail", async () => {
    const tooLarge = fileEntry({ id: "id:big", size: 30 * 1024 * 1024 });
    const unsupported = fileEntry({ id: "id:heic", name: "2026-09-23 03.00.00.heic" });
    const http = routeHttp({
      [LIST_FOLDER]: () => ok({ entries: [tooLarge, unsupported], cursor: "c1", has_more: false }),
      [GET_THUMBNAIL_BATCH]: () => {
        throw new Error("should not request thumbnails for ineligible entries");
      },
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    const items = await source.getItems(context("2026-09-23"), new AbortController().signal);
    expect(items.every((i) => i.thumbnail === undefined)).toBe(true);
    expect(items).toHaveLength(2);
  });

  it("retries once after a 401 using a refreshed token", async () => {
    let listFolderCalls = 0;
    const http = routeHttp({
      [LIST_FOLDER]: (params) => {
        listFolderCalls++;
        if (params.headers?.Authorization === "Bearer token") {
          return { status: 401, headers: {}, arrayBuffer: new ArrayBuffer(0), json: { error_summary: "expired_access_token/" }, text: "" };
        }
        return ok({ entries: [], cursor: "c1", has_more: false });
      },
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    await source.getItems(context("2026-09-23"), new AbortController().signal);
    expect(listFolderCalls).toBe(2);
  });

  it("surfaces a not-found source error when the folder is missing", async () => {
    const http = routeHttp({
      [LIST_FOLDER]: () => ({
        status: 409,
        headers: {},
        arrayBuffer: new ArrayBuffer(0),
        json: { error_summary: "path/not_found/.." },
        text: "",
      }),
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Missing");
    const error = await source
      .getItems(context("2026-09-23"), new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DropboxSourceError);
    expect((error as DropboxSourceError).kind).toBe("not-found");
  });

  it("propagates cancellation instead of wrapping it as a source error", async () => {
    const http = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    await expect(source.getItems(context("2026-09-23"), controller.signal)).rejects.toThrow(CancelledError);
  });
});

describe("DropboxSource.downloadOriginal", () => {
  it("downloads the original bytes for a payload's path", async () => {
    const bytes = new TextEncoder().encode("bytes").buffer;
    const http = routeHttp({
      [DOWNLOAD]: (params) => {
        expect(JSON.parse(params.headers?.["Dropbox-API-Arg"] as string)).toEqual({
          path: "/camera uploads/2026-09-23 12.34.56.jpg",
        });
        return { status: 200, headers: {}, arrayBuffer: bytes, json: undefined, text: "" };
      },
    });
    const source = new DropboxSource(http, mockAuth(), () => "/Camera Uploads");
    const payload: DropboxImagePayload = { path: "/camera uploads/2026-09-23 12.34.56.jpg" };
    const data = await source.downloadOriginal(payload, new AbortController().signal);
    expect(data).toBe(bytes);
  });
});
