/**
 * CORS helper — shared between the HTTP handler and tests so we can
 * verify the allowed methods list without booting the whole gateway.
 */

export const CORS_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
export const CORS_ALLOWED_HEADERS = "Content-Type";

export function buildCorsOrigins(envOrigin?: string | null): Set<string> {
  return new Set([
    "http://localhost:3000",
    ...(envOrigin ? [envOrigin] : []),
  ]);
}

export function getCorsHeaders(
  allowedOrigins: Set<string>,
  req?: { headers?: { origin?: string } },
): Record<string, string> {
  const origin = req?.headers?.origin ?? "";
  const allowedOrigin = allowedOrigins.has(origin) ? origin : "http://localhost:3000";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
  };
}
