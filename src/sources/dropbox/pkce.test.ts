import { describe, expect, it } from "vitest";
import { createCodeChallenge, createCodeVerifier } from "./pkce";

describe("createCodeVerifier", () => {
  it("produces a string within the RFC 7636 length bounds", () => {
    const verifier = createCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("only uses the permitted character set", () => {
    const verifier = createCodeVerifier(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("rejects lengths outside 43-128", () => {
    expect(() => createCodeVerifier(42)).toThrow();
    expect(() => createCodeVerifier(129)).toThrow();
  });

  it("does not repeat across calls", () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
  });
});

describe("createCodeChallenge", () => {
  it("matches the RFC 7636 appendix B test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    await expect(createCodeChallenge(verifier)).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
