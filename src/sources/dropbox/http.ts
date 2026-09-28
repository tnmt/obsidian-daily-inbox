import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

// Obsidian's requestUrl (rather than the browser fetch) sidesteps CORS
// differences between desktop and mobile, at the cost of not accepting an
// AbortSignal. Callers are responsible for cooperative cancellation via the
// helpers in cancel.ts.
export type HttpRequester = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

export class DropboxApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorSummary?: string,
  ) {
    super(message);
    this.name = "DropboxApiError";
  }
}

function extractErrorSummary(response: RequestUrlResponse): string | undefined {
  const body = response.json;
  if (body && typeof body === "object" && typeof body.error_summary === "string") {
    return body.error_summary;
  }
  return undefined;
}

function header(response: RequestUrlResponse, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export async function rpcCall<T>(
  http: HttpRequester,
  host: "api" | "content",
  route: string,
  accessToken: string,
  args: unknown,
): Promise<T> {
  const response = await http({
    url: `https://${host}.dropboxapi.com/2/${route}`,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(args ?? {}),
    throw: false,
  });
  if (response.status >= 400) {
    throw new DropboxApiError(
      `Dropbox API error calling ${route} (${response.status})`,
      response.status,
      extractErrorSummary(response),
    );
  }
  return response.json as T;
}

export interface DownloadResult {
  readonly metadata: unknown;
  readonly data: ArrayBuffer;
}

export async function contentDownloadCall(
  http: HttpRequester,
  route: string,
  accessToken: string,
  args: unknown,
): Promise<DownloadResult> {
  const response = await http({
    url: `https://content.dropboxapi.com/2/${route}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify(args ?? {}),
    },
    throw: false,
  });
  if (response.status >= 400) {
    throw new DropboxApiError(
      `Dropbox API error calling ${route} (${response.status})`,
      response.status,
      extractErrorSummary(response),
    );
  }
  const resultHeader = header(response, "Dropbox-API-Result");
  return {
    metadata: resultHeader ? JSON.parse(resultHeader) : undefined,
    data: response.arrayBuffer,
  };
}
