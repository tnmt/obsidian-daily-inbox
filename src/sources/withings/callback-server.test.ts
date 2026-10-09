import { describe, expect, it } from "vitest";
import { CancelledError } from "../dropbox/cancel";
import { startCallbackServer } from "./callback-server";

async function start(overrides: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  return startCallbackServer({
    port: 0,
    state: "S",
    signal: overrides.signal ?? new AbortController().signal,
    timeoutMs: overrides.timeoutMs ?? 5000,
  });
}
const get = (port: number, query: string) => fetch(`http://127.0.0.1:${port}/callback?${query}`);

describe("startCallbackServer", () => {
  it("resolves with the code and stops listening", async () => {
    const { port, code } = await start();
    const res = await get(port, "code=C1&state=S");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You can close this tab.");
    expect(await code).toBe("C1");
    await expect(get(port, "code=C2&state=S")).rejects.toThrow();
  });

  it("ignores a request with the wrong state and keeps waiting", async () => {
    const { port, code } = await start();
    expect((await get(port, "code=EVIL&state=X")).status).toBe(400);
    await get(port, "code=C1&state=S");
    expect(await code).toBe("C1");
  });

  it("fails as auth-required when authorization is denied", async () => {
    const { port, code } = await start();
    await get(port, "error=access_denied&state=S");
    await expect(code).rejects.toMatchObject({ kind: "auth-required" });
  });

  it("closes on abort", async () => {
    const controller = new AbortController();
    const { port, code } = await start({ signal: controller.signal });
    controller.abort();
    await expect(code).rejects.toBeInstanceOf(CancelledError);
    await expect(get(port, "code=C&state=S")).rejects.toThrow();
  });

  it("settles the start promise and frees the port when cancelled before the socket is bound", async () => {
    const probe = await start();
    const { port } = probe;
    await get(port, "code=C&state=S");
    await probe.code;

    const controller = new AbortController();
    const starting = startCallbackServer({ port, state: "S", signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(starting).rejects.toBeInstanceOf(CancelledError);

    const again = await startCallbackServer({ port, state: "S", signal: new AbortController().signal, timeoutMs: 5000 });
    await get(again.port, "code=C&state=S");
    await again.code;
  });

  it("times out", async () => {
    const { code } = await start({ timeoutMs: 20 });
    await expect(code).rejects.toMatchObject({ kind: "auth-required" });
  });

  it("reports a port already in use as transient", async () => {
    const first = await start();
    await expect(
      startCallbackServer({ port: first.port, state: "S", signal: new AbortController().signal, timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: "transient" });
    await get(first.port, "code=C&state=S");
    await first.code;
  });
});
