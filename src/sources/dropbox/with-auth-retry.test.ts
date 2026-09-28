import { describe, expect, it, vi } from "vitest";
import type { DropboxAuthClient } from "./auth";
import { DropboxApiError } from "./http";
import { withAuthRetry } from "./with-auth-retry";

function mockAuth(overrides: Partial<DropboxAuthClient> = {}): DropboxAuthClient {
  return {
    isConnected: () => true,
    getAccessToken: async () => "token",
    refreshAfterUnauthorized: async () => "token-2",
    ...overrides,
  };
}

const signal = new AbortController().signal;

describe("withAuthRetry", () => {
  it("calls fn once with the current token when it succeeds", async () => {
    const fn = vi.fn(async (token: string) => `result:${token}`);
    await expect(withAuthRetry(mockAuth(), signal, fn)).resolves.toBe("result:token");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("refreshes once and retries after a 401", async () => {
    const fn = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new DropboxApiError("unauthorized", 401))
      .mockResolvedValueOnce("result:token-2");
    await expect(withAuthRetry(mockAuth(), signal, fn)).resolves.toBe("result:token-2");
    expect(fn).toHaveBeenNthCalledWith(1, "token");
    expect(fn).toHaveBeenNthCalledWith(2, "token-2");
  });

  it("propagates a non-401 error without refreshing", async () => {
    const refreshAfterUnauthorized = vi.fn(async () => "token-2");
    const fn = vi.fn(async () => {
      throw new DropboxApiError("server error", 500);
    });
    await expect(withAuthRetry(mockAuth({ refreshAfterUnauthorized }), signal, fn)).rejects.toThrow(
      "server error",
    );
    expect(refreshAfterUnauthorized).not.toHaveBeenCalled();
  });

  it("propagates a 401 that survives the retry instead of looping again", async () => {
    const fn = vi.fn(async () => {
      throw new DropboxApiError("unauthorized", 401);
    });
    await expect(withAuthRetry(mockAuth(), signal, fn)).rejects.toThrow(DropboxApiError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
