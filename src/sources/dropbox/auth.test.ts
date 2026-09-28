import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { DropboxAuthManager, type DropboxAuthPersistence, type DropboxTokens } from "./auth";
import { CancelledError } from "./cancel";
import { DropboxSourceError } from "./errors";

function jsonResponse(status: number, body: unknown): RequestUrlResponse {
  return { status, headers: {}, arrayBuffer: new ArrayBuffer(0), json: body, text: JSON.stringify(body) };
}

function memoryPersistence(initial?: DropboxTokens): DropboxAuthPersistence {
  let stored = initial;
  return {
    load: () => stored,
    save: async (tokens) => {
      stored = tokens;
    },
  };
}

const signal = new AbortController().signal;

describe("DropboxAuthManager", () => {
  it("builds an authorization URL with PKCE and offline access parameters", async () => {
    const manager = new DropboxAuthManager(vi.fn(), () => "test-client-id", memoryPersistence());
    const url = new URL(await manager.beginAuthorization());
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("rejects completing authorization without a pending attempt", async () => {
    const manager = new DropboxAuthManager(vi.fn(), () => "client", memoryPersistence());
    await expect(manager.completeAuthorization("some-code")).rejects.toThrow(DropboxSourceError);
  });

  it("exchanges the code for tokens and persists them", async () => {
    const http = vi.fn(async (_params: RequestUrlParam): Promise<RequestUrlResponse> =>
      jsonResponse(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 14400 }),
    );
    const persistence = memoryPersistence();
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    await manager.beginAuthorization();
    await manager.completeAuthorization(" the-code ");

    expect(manager.isConnected()).toBe(true);
    expect(persistence.load()?.accessToken).toBe("at-1");
    const params = http.mock.calls[0][0] as RequestUrlParam;
    expect(params.body).toContain("code=the-code");
    expect(params.body).toContain("grant_type=authorization_code");
  });

  it("returns the stored access token without refreshing when it is not near expiry", async () => {
    const http = vi.fn();
    const manager = new DropboxAuthManager(
      http,
      () => "client",
      memoryPersistence({ accessToken: "at", refreshToken: "rt", expiresAtMs: Date.now() + 3_600_000 }),
    );
    await expect(manager.getAccessToken(signal)).resolves.toBe("at");
    expect(http).not.toHaveBeenCalled();
  });

  it("refreshes when the access token is near expiry", async () => {
    const http = vi.fn(async (): Promise<RequestUrlResponse> =>
      jsonResponse(200, { access_token: "at-new", expires_in: 14400 }),
    );
    const persistence = memoryPersistence({
      accessToken: "at-old",
      refreshToken: "rt",
      expiresAtMs: Date.now() + 1000,
    });
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    await expect(manager.getAccessToken(signal)).resolves.toBe("at-new");
    expect(persistence.load()?.refreshToken).toBe("rt");
  });

  it("de-duplicates concurrent refreshes into a single request", async () => {
    let calls = 0;
    const http = vi.fn(async (): Promise<RequestUrlResponse> => {
      calls++;
      return jsonResponse(200, { access_token: `at-${calls}`, expires_in: 14400 });
    });
    const manager = new DropboxAuthManager(
      http,
      () => "client",
      memoryPersistence({ accessToken: "at-old", refreshToken: "rt", expiresAtMs: Date.now() + 1000 }),
    );
    const [a, b] = await Promise.all([manager.getAccessToken(signal), manager.getAccessToken(signal)]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("clears stored tokens and requires re-auth when refresh gets invalid_grant", async () => {
    const http = vi.fn(async (): Promise<RequestUrlResponse> =>
      jsonResponse(400, { error: "invalid_grant", error_description: "revoked" }),
    );
    const persistence = memoryPersistence({
      accessToken: "at",
      refreshToken: "rt",
      expiresAtMs: Date.now() - 1000,
    });
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    const error = await manager.getAccessToken(signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DropboxSourceError);
    expect((error as DropboxSourceError).kind).toBe("auth-required");
    expect(persistence.load()).toBeUndefined();
  });

  it("keeps stored tokens and reports a transient error on a network/5xx failure", async () => {
    const http = vi.fn(async (): Promise<RequestUrlResponse> => jsonResponse(503, { error: "server_error" }));
    const persistence = memoryPersistence({
      accessToken: "at",
      refreshToken: "rt",
      expiresAtMs: Date.now() - 1000,
    });
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    const error = await manager.getAccessToken(signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DropboxSourceError);
    expect((error as DropboxSourceError).kind).toBe("transient");
    expect(persistence.load()?.refreshToken).toBe("rt");
  });

  it("clears tokens on disconnect", async () => {
    const persistence = memoryPersistence({ accessToken: "at", refreshToken: "rt", expiresAtMs: Date.now() + 1000 });
    const manager = new DropboxAuthManager(vi.fn(), () => "client", persistence);
    await manager.disconnect();
    expect(manager.isConnected()).toBe(false);
    expect(persistence.load()).toBeUndefined();
  });

  it("falls back to the still-valid old token when a near-expiry refresh fails transiently", async () => {
    const http = vi.fn(async (): Promise<RequestUrlResponse> => jsonResponse(503, { error: "server_error" }));
    const persistence = memoryPersistence({
      accessToken: "at-old",
      refreshToken: "rt",
      // Inside the 5-minute refresh margin, but not actually expired yet.
      expiresAtMs: Date.now() + 60_000,
    });
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    await expect(manager.getAccessToken(signal)).resolves.toBe("at-old");
  });

  it("does not resurrect a disconnected account when an in-flight refresh resolves afterward", async () => {
    let resolveHttp!: (value: RequestUrlResponse) => void;
    const http = vi.fn(
      () =>
        new Promise<RequestUrlResponse>((resolve) => {
          resolveHttp = resolve;
        }),
    );
    const persistence = memoryPersistence({
      accessToken: "at-old",
      refreshToken: "rt",
      expiresAtMs: Date.now() + 1000,
    });
    const manager = new DropboxAuthManager(http, () => "client", persistence);

    const getPromise = manager.getAccessToken(signal);
    await manager.disconnect();
    resolveHttp(jsonResponse(200, { access_token: "at-new", expires_in: 14400 }));

    await expect(getPromise).rejects.toThrow(CancelledError);
    expect(manager.isConnected()).toBe(false);
    expect(persistence.load()).toBeUndefined();
  });

  it("does not resurrect a connection when cancelAuthorization races a completeAuthorization in flight", async () => {
    let resolveHttp!: (value: RequestUrlResponse) => void;
    const http = vi.fn(
      () =>
        new Promise<RequestUrlResponse>((resolve) => {
          resolveHttp = resolve;
        }),
    );
    const persistence = memoryPersistence();
    const manager = new DropboxAuthManager(http, () => "client", persistence);
    await manager.beginAuthorization();

    const completePromise = manager.completeAuthorization("the-code");
    manager.cancelAuthorization();
    resolveHttp(jsonResponse(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 14400 }));
    await completePromise;

    expect(manager.isConnected()).toBe(false);
    expect(persistence.load()).toBeUndefined();
  });
});
