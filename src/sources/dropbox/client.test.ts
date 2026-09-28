import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
  THUMBNAIL_BATCH_LIMIT,
  downloadFile,
  getThumbnailBatch,
  listFolder,
  listFolderContinue,
} from "./client";
import { CancelledError } from "./cancel";
import type { HttpRequester } from "./http";

function jsonResponse(body: unknown): RequestUrlResponse {
  return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
}

function mockHttp(handler: (params: RequestUrlParam) => RequestUrlResponse): HttpRequester {
  return vi.fn(async (params: RequestUrlParam) => handler(params));
}

describe("listFolder", () => {
  it("calls the api host RPC route with the given path", async () => {
    const http = mockHttp(() => jsonResponse({ entries: [], cursor: "c1", has_more: false }));
    await listFolder(http, "token", "/Camera Uploads", new AbortController().signal);
    const params = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as RequestUrlParam;
    expect(params.url).toBe("https://api.dropboxapi.com/2/files/list_folder");
    expect(JSON.parse(params.body as string)).toEqual({ path: "/Camera Uploads" });
    expect(params.headers?.Authorization).toBe("Bearer token");
  });

  it("throws CancelledError instead of calling http when already aborted", async () => {
    const http = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(listFolder(http, "token", "/x", controller.signal)).rejects.toThrow(CancelledError);
    expect(http).not.toHaveBeenCalled();
  });
});

describe("listFolderContinue", () => {
  it("sends the cursor to the continue route", async () => {
    const http = mockHttp(() => jsonResponse({ entries: [], cursor: "c2", has_more: false }));
    await listFolderContinue(http, "token", "cursor-1", new AbortController().signal);
    const params = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as RequestUrlParam;
    expect(params.url).toBe("https://api.dropboxapi.com/2/files/list_folder/continue");
    expect(JSON.parse(params.body as string)).toEqual({ cursor: "cursor-1" });
  });
});

describe("getThumbnailBatch", () => {
  it("calls the content host with one entry per path", async () => {
    const http = mockHttp(() => jsonResponse({ entries: [] }));
    await getThumbnailBatch(http, "token", ["/a.jpg", "/b.jpg"], new AbortController().signal);
    const params = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as RequestUrlParam;
    expect(params.url).toBe("https://content.dropboxapi.com/2/files/get_thumbnail_batch");
    const body = JSON.parse(params.body as string) as { entries: Array<{ path: string }> };
    expect(body.entries.map((e) => e.path)).toEqual(["/a.jpg", "/b.jpg"]);
  });

  it("rejects more than the batch limit without making a request", async () => {
    const http = vi.fn();
    const tooMany = Array.from({ length: THUMBNAIL_BATCH_LIMIT + 1 }, (_, i) => `/${i}.jpg`);
    await expect(getThumbnailBatch(http, "token", tooMany, new AbortController().signal)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });
});

describe("downloadFile", () => {
  it("sends the path via the Dropbox-API-Arg header and parses the result header", async () => {
    const bytes = new TextEncoder().encode("image-bytes").buffer;
    const http = mockHttp(() => ({
      status: 200,
      headers: { "Dropbox-API-Result": JSON.stringify({ name: "a.jpg" }) },
      arrayBuffer: bytes,
      json: undefined,
      text: "",
    }));
    const result = await downloadFile(http, "token", "/a.jpg", new AbortController().signal);
    const params = (http as ReturnType<typeof vi.fn>).mock.calls[0][0] as RequestUrlParam;
    expect(params.url).toBe("https://content.dropboxapi.com/2/files/download");
    expect(JSON.parse(params.headers?.["Dropbox-API-Arg"] as string)).toEqual({ path: "/a.jpg" });
    expect(result.metadata).toEqual({ name: "a.jpg" });
    expect(result.data).toBe(bytes);
  });

  it("is case-insensitive when reading the result header", async () => {
    const http = mockHttp(() => ({
      status: 200,
      headers: { "dropbox-api-result": JSON.stringify({ name: "a.jpg" }) },
      arrayBuffer: new ArrayBuffer(0),
      json: undefined,
      text: "",
    }));
    const result = await downloadFile(http, "token", "/a.jpg", new AbortController().signal);
    expect(result.metadata).toEqual({ name: "a.jpg" });
  });
});
