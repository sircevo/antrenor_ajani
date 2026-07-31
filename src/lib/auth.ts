/**
 * Single-password gate.
 *
 * Not a user system: there is one shared password and one long-lived signed
 * cookie, which is all a personal single-user install needs. When real
 * multi-user registration arrives it replaces this module wholesale.
 *
 * Signing uses Web Crypto (not node:crypto) because Next 14 middleware runs on
 * the Edge runtime, where node:crypto is unavailable.
 */

export const SESSION_COOKIE = "antrenor_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 60; // 60 days

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is not set");
  }
  return secret;
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-safe comparison so a wrong guess can't be timed character by character. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isPasswordCorrect(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD environment variable is not set");
  }
  return safeEqual(candidate, expected);
}

/** Builds a `<expiresAt>.<signature>` cookie value. */
export async function createSessionToken(): Promise<string> {
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  return `${expiresAt}.${await hmac(expiresAt)}`;
}

/** True only if the signature matches and the token has not expired. */
export async function isSessionTokenValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  return safeEqual(signature, await hmac(expiresAt));
}
