/**
 * Parse LLM output into an array of fact strings.
 * Tries JSON array first, falls back to line-by-line extraction.
 */
export function parseFacts(text: string, fallbackToLines = false): string[] {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
      }
    }
  } catch {
    // JSON parsing failed
  }

  if (!fallbackToLines) return [];

  // Fallback: split by newlines and clean up
  return text
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").replace(/^"\s*|\s*"$/g, "").trim())
    .filter((line) => line.length > 10 && !line.startsWith("[") && !line.startsWith("{"));
}
