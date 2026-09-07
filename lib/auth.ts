import { cookies } from "next/headers";

/**
 * Session handling built on Web Crypto rather than node:crypto, because
 * middleware runs on the Edge runtime where node modules aren't available.
 * One module then works in both places.
 */

const COOKIE = "ece_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const enc = new TextEncoder();

async function key() {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.SESSION_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sign(value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparison that doesn't short-circuit on the first differing byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyCredentials(username: string, password: string): boolean {
  return (
    safeEqual(username, process.env.APP_USERNAME ?? "") &&
    safeEqual(password, process.env.APP_PASSWORD ?? "")
  );
}

export async function createSessionCookie() {
  const issued = Date.now().toString();
  return {
    name: COOKIE,
    value: `${issued}.${await sign(issued)}`,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  };
}

export async function isValidSession(token?: string): Promise<boolean> {
  if (!token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  if (!safeEqual(sig, await sign(issued))) return false;
  return Date.now() - Number(issued) < MAX_AGE * 1000;
}

/** For route handlers, which read cookies directly. */
export async function isSignedIn(): Promise<boolean> {
  return isValidSession(cookies().get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
