/**
 * Detect if the request was made over HTTPS (directly or via proxy/tunnel).
 * Used to set the Secure flag on session cookies — ensures cookies are
 * only sent over HTTPS when accessed via ngrok or other HTTPS proxies.
 */
export function isSecureRequest(request: Request): boolean {
  const isHttps =
    request.url.startsWith("https://") ||
    request.headers.get("x-forwarded-proto") === "https";
  return process.env.NODE_ENV === "production" || isHttps;
}
