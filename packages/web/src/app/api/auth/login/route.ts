import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isSecureRequest } from "../../../../lib/auth";

/**
 * In-memory rate limiter for login attempts.
 * Tracks attempts per IP, blocks after MAX_ATTEMPTS within WINDOW_MS.
 */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_ATTEMPTS;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
}, 5 * 60_000);

function getSessionSecret(): string {
  if (process.env.IRONCLAW_SESSION_SECRET) {
    return process.env.IRONCLAW_SESSION_SECRET;
  }
  // Fall back to a hash of the password — acceptable for single-user setup.
  // For production, set IRONCLAW_SESSION_SECRET independently so the session
  // secret and password are not cryptographically linked.
  const password = process.env.IRONCLAW_WEB_PASSWORD ?? "";
  return createHmac("sha256", "ironclaw-session-fallback")
    .update(password)
    .digest("hex");
}

function createSessionToken(secret: string): string {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret)
    .update(timestamp)
    .digest("hex");
  return `${timestamp}.${signature}`;
}

/** Constant-time password comparison to prevent timing attacks */
function passwordMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length info via timing
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const password = process.env.IRONCLAW_WEB_PASSWORD;

  if (!password) {
    console.error(
      "IRONCLAW_WEB_PASSWORD is not set. Authentication is disabled."
    );
    return NextResponse.json(
      { success: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  // Rate limit by IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "Too many login attempts. Try again in a minute." },
      { status: 429 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }

  if (!body.password || !passwordMatches(body.password, password)) {
    return NextResponse.json(
      { success: false, error: "Invalid password" },
      { status: 401 }
    );
  }

  const secret = getSessionSecret();
  const token = createSessionToken(secret);

  const cookieStore = await cookies();
  cookieStore.set("ironclaw_session", token, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return NextResponse.json({ success: true });
}
