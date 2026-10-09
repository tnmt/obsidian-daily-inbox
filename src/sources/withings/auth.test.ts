import { describe, expect, it, vi } from "vitest";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { CancelledError } from "../dropbox/cancel";
import type { HttpRequester } from "../dropbox/http";
import { WithingsAuthManager } from "./auth";
import type { WithingsAuthPersistence, WithingsTokens } from "./auth";
import type { CallbackServerOptions } from "./callback-server";

const signal = () => new AbortController().signal;
const credentials = () => ({ clientId: "cid", clientSecret: "sec" });

function tokenResponse(overrides: Record<string, unknown> = {}): RequestUrlResponse {
  const json = {
    status: 0,
    body: { userid: 42, access_token: "A2", refresh_token: "R2", expires_in: 10800, ...overrides },
  };
  return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), json, text: JSON.stringify(json) };
}
const envelope = (status: number): RequestUrlResponse => ({
  status: 200,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: { status },
  text: "",
});

function memoryPersistence(initial?: WithingsTokens) {
  const saved: Array<WithingsTokens | undefined> = [];
  const persistence: WithingsAuthPersistence = {
    load: () => initial,
    save: async (tokens) => {
      saved.push(tokens);
    },
  };
  return { persistence, saved };
}

const stored = (expiresInMs: number): WithingsTokens => ({
  userId: "42",
  accessToken: "A1",
  refreshToken: "R1",
  expiresAtMs: Date.now() + expiresInMs,
});

const form = (call: RequestUrlParam) => Object.fromEntries(new URLSearchParams(call.body as string));

describe("WithingsAuthManager refresh", () => {
  it("returns the stored token while it is not near expiry", async () => {
    const http = vi.fn();
    const { persistence } = memoryPersistence(stored(3 * 3600_000));
    const auth = new WithingsAuthManager(http, credentials, persistence);
    expect(await auth.getAccessToken(signal())).toBe("A1");
    expect(http).not.toHaveBeenCalled();
  });

  it("refreshes near expiry and persists the rotated refresh token before returning", async () => {
    const order: string[] = [];
    const http = vi.fn(async (_: RequestUrlParam) => tokenResponse());
    const { persistence } = memoryPersistence(stored(60_000));
    const save = persistence.save;
    persistence.save = async (t) => {
      order.push("save");
      await save(t);
    };
    const auth = new WithingsAuthManager(http, credentials, persistence);
    const token = await auth.getAccessToken(signal());
    order.push("use");
    expect(token).toBe("A2");
    expect(order).toEqual(["save", "use"]);
    expect(form(vi.mocked(http).mock.calls[0][0])).toMatchObject({
      action: "requesttoken",
      grant_type: "refresh_token",
      refresh_token: "R1",
      client_id: "cid",
      client_secret: "sec",
    });
  });

  it("serializes concurrent refreshes into one request", async () => {
    const http = vi.fn(async (_: RequestUrlParam) => tokenResponse());
    const { persistence } = memoryPersistence(stored(60_000));
    const auth = new WithingsAuthManager(http, credentials, persistence);
    await Promise.all([auth.getAccessToken(signal()), auth.getAccessToken(signal()), auth.refreshAfterUnauthorized(signal())]);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("clears the tokens when the refresh token is rejected", async () => {
    const { persistence, saved } = memoryPersistence(stored(60_000));
    const auth = new WithingsAuthManager(vi.fn(async () => envelope(401)), credentials, persistence);
    await expect(auth.getAccessToken(signal())).rejects.toMatchObject({ kind: "auth-required" });
    expect(auth.isConnected()).toBe(false);
    expect(saved).toEqual([undefined]);
  });

  it("keeps the tokens on a transient failure and falls back to the still-valid access token", async () => {
    const { persistence, saved } = memoryPersistence(stored(60_000));
    const http: HttpRequester = async () => {
      throw new Error("offline");
    };
    const auth = new WithingsAuthManager(http, credentials, persistence);
    expect(await auth.getAccessToken(signal())).toBe("A1");
    expect(auth.isConnected()).toBe(true);
    expect(saved).toEqual([]);
  });

  it("keeps the tokens when rate limited", async () => {
    const { persistence } = memoryPersistence(stored(-1000));
    const auth = new WithingsAuthManager(vi.fn(async () => envelope(601)), credentials, persistence);
    await expect(auth.getAccessToken(signal())).rejects.toMatchObject({ kind: "rate-limited" });
    expect(auth.isConnected()).toBe(true);
  });

  it("still persists the rotated token when the caller aborts after the request was sent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const http = vi.fn(async (_: RequestUrlParam) => {
      await gate;
      return tokenResponse();
    });
    const { persistence, saved } = memoryPersistence(stored(60_000));
    const auth = new WithingsAuthManager(http, credentials, persistence);
    const controller = new AbortController();
    const first = auth.getAccessToken(controller.signal);
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    controller.abort();
    release();
    await first;
    expect(saved[0]).toMatchObject({ refreshToken: "R2" });
    expect(await auth.getAccessToken(signal())).toBe("A2");
  });

  it("makes concurrent callers wait until the rotated token is stored", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const order: string[] = [];
    const { persistence } = memoryPersistence(stored(60_000));
    persistence.save = async () => {
      await gate;
      order.push("saved");
    };
    const auth = new WithingsAuthManager(vi.fn(async (_: RequestUrlParam) => tokenResponse()), credentials, persistence);
    const first = auth.getAccessToken(signal()).then((t) => order.push(`first:${t}`));
    await vi.waitFor(() => expect(auth.isConnected()).toBe(true));
    const second = auth.getAccessToken(signal()).then((t) => order.push(`second:${t}`));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["saved", "first:A2", "second:A2"]);
  });

  it("withholds the rotated token until a failed write is retried successfully", async () => {
    let failing = true;
    const writes: Array<WithingsTokens | undefined> = [];
    const persistence: WithingsAuthPersistence = {
      load: () => stored(60_000),
      save: async (tokens) => {
        if (failing) throw new Error("disk full");
        writes.push(tokens);
      },
    };
    const auth = new WithingsAuthManager(vi.fn(async (_: RequestUrlParam) => tokenResponse()), credentials, persistence);
    await expect(auth.getAccessToken(signal())).rejects.toMatchObject({ kind: "transient" });
    await expect(auth.getAccessToken(signal())).rejects.toMatchObject({ kind: "transient" });
    failing = false;
    expect(await auth.getAccessToken(signal())).toBe("A2");
    expect(writes).toEqual([expect.objectContaining({ refreshToken: "R2" })]);
  });

  it("never writes an older unsaved token over a newer stored one", async () => {
    const writes: Array<WithingsTokens | undefined> = [];
    let failNext = true;
    const persistence: WithingsAuthPersistence = {
      load: () => stored(60_000),
      save: async (tokens) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        writes.push(tokens);
      },
    };
    const refreshTokens = ["R2", "R3"];
    const http = vi.fn(async (_: RequestUrlParam) => tokenResponse({ refresh_token: refreshTokens.shift() }));
    const auth = new WithingsAuthManager(http, credentials, persistence);
    await expect(auth.getAccessToken(signal())).rejects.toMatchObject({ kind: "transient" });
    await auth.refreshAfterUnauthorized(signal());
    await auth.getAccessToken(signal());
    expect(writes.map((t) => t?.refreshToken)).toEqual(["R3"]);
  });

  it("falls back to the still-valid access token when the proactive refresh is rate limited", async () => {
    const { persistence } = memoryPersistence(stored(60_000));
    const auth = new WithingsAuthManager(vi.fn(async (_: RequestUrlParam) => envelope(601)), credentials, persistence);
    expect(await auth.getAccessToken(signal())).toBe("A1");
  });

  it("drops a refresh result that resolves after disconnect", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const http = vi.fn(async () => {
      await gate;
      return tokenResponse();
    });
    const { persistence, saved } = memoryPersistence(stored(60_000));
    const auth = new WithingsAuthManager(http, credentials, persistence);
    const pending = auth.refreshAfterUnauthorized(signal());
    await auth.disconnect();
    release();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(auth.isConnected()).toBe(false);
    expect(saved).toEqual([undefined]);
  });
});

describe("WithingsAuthManager connect", () => {
  function listener(code: Promise<string>) {
    const seen: CallbackServerOptions[] = [];
    const listen = async (options: CallbackServerOptions) => {
      seen.push(options);
      return { port: options.port, code };
    };
    return { listen, seen };
  }

  it("opens the authorization URL and exchanges the returned code", async () => {
    const http = vi.fn(async (_: RequestUrlParam) => tokenResponse());
    const { persistence, saved } = memoryPersistence();
    const { listen, seen } = listener(Promise.resolve("CODE"));
    const auth = new WithingsAuthManager(http, credentials, persistence, listen, 8123);
    let opened = "";
    await auth.connect((url) => (opened = url));

    const url = new URL(opened);
    expect(url.origin + url.pathname).toBe("https://account.withings.com/oauth2_user/authorize2");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      scope: "user.metrics",
      redirect_uri: "http://127.0.0.1:8123/callback",
      state: seen[0].state,
    });
    expect(form(vi.mocked(http).mock.calls[0][0])).toMatchObject({
      grant_type: "authorization_code",
      code: "CODE",
      redirect_uri: "http://127.0.0.1:8123/callback",
      client_secret: "sec",
    });
    expect(auth.isConnected()).toBe(true);
    expect(auth.userId()).toBe("42");
    expect(saved[0]).toMatchObject({ accessToken: "A2", refreshToken: "R2" });
    expect(auth.hasPendingAuthorization()).toBe(false);
  });

  it("does not connect when disconnected during the code exchange", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const http = vi.fn(async () => {
      await gate;
      return tokenResponse();
    });
    const { persistence } = memoryPersistence();
    const auth = new WithingsAuthManager(http, credentials, persistence, listener(Promise.resolve("CODE")).listen);
    const connecting = auth.connect(() => undefined);
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    await auth.disconnect();
    release();
    await expect(connecting).rejects.toBeInstanceOf(CancelledError);
    expect(auth.isConnected()).toBe(false);
  });

  it("stays disconnected when the tokens cannot be saved", async () => {
    const persistence: WithingsAuthPersistence = {
      load: () => undefined,
      save: async () => {
        throw new Error("disk full");
      },
    };
    const auth = new WithingsAuthManager(
      vi.fn(async (_: RequestUrlParam) => tokenResponse()),
      credentials,
      persistence,
      listener(Promise.resolve("CODE")).listen,
    );
    await expect(auth.connect(() => undefined)).rejects.toThrow("disk full");
    expect(auth.isConnected()).toBe(false);
  });

  it("stays disconnected and restores storage when cancelled during the write", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writes: Array<WithingsTokens | undefined> = [];
    const persistence: WithingsAuthPersistence = {
      load: () => undefined,
      save: async (tokens) => {
        writes.push(tokens);
        if (tokens) await gate;
      },
    };
    const auth = new WithingsAuthManager(
      vi.fn(async (_: RequestUrlParam) => tokenResponse()),
      credentials,
      persistence,
      listener(Promise.resolve("CODE")).listen,
    );
    const connecting = auth.connect(() => undefined);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    auth.cancelAuthorization();
    release();
    await expect(connecting).rejects.toBeInstanceOf(CancelledError);
    expect(auth.isConnected()).toBe(false);
    expect(writes[1]).toBeUndefined();
    expect(writes).toHaveLength(2);
  });

  it("aborts the listener on cancel", async () => {
    const { persistence } = memoryPersistence();
    let listenSignal!: AbortSignal;
    const listen = async (options: CallbackServerOptions) => {
      listenSignal = options.signal;
      return {
        port: options.port,
        code: new Promise<string>((_, reject) => options.signal.addEventListener("abort", () => reject(new CancelledError()))),
      };
    };
    const auth = new WithingsAuthManager(vi.fn(), credentials, persistence, listen);
    const connecting = auth.connect(() => undefined);
    await vi.waitFor(() => expect(auth.hasPendingAuthorization()).toBe(true));
    auth.cancelAuthorization();
    await expect(connecting).rejects.toBeInstanceOf(CancelledError);
    expect(listenSignal.aborted).toBe(true);
    expect(auth.hasPendingAuthorization()).toBe(false);
  });
});
