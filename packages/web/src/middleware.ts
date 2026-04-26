import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];
const SKIP_PREFIXES = ["/_next/", "/favicon.ico"];

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return hexEncode(sig);
}

async function getSessionSecret(): Promise<string> {
  if (process.env.IRONCLAW_SESSION_SECRET) {
    return process.env.IRONCLAW_SESSION_SECRET;
  }
  // Fall back to a hash of the password
  const password = process.env.IRONCLAW_WEB_PASSWORD ?? "";
  return hmacSha256("ironclaw-session-fallback", password);
}

async function isValidSession(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  // Check expiry
  if (Date.now() - ts > SESSION_MAX_AGE_MS) return false;

  // Verify signature
  const secret = await getSessionSecret();
  const expected = await hmacSha256(secret, timestamp);

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for public paths and static assets
  if (
    PUBLIC_PATHS.includes(pathname) ||
    SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  // If IRONCLAW_WEB_PASSWORD is not set, allow all requests (no auth configured)
  if (!process.env.IRONCLAW_WEB_PASSWORD) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("ironclaw_session");

  if (!sessionCookie || !(await isValidSession(sessionCookie.value))) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
