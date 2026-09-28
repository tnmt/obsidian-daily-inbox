const VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function createCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new Error(`PKCE code_verifier length must be 43-128, got ${length}`);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}
