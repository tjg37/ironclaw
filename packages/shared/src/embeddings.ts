const MODEL = "voyage-3-lite";
const DIMENSIONS = 512; // voyage-3-lite native dimension
const API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_TIMEOUT_MS = 15_000;

let _apiKey: string | undefined;

/**
 * Set the Voyage AI API key. Should be called once at startup from the config module
 * to avoid reading process.env directly at call time.
 */
export function setVoyageApiKey(key: string): void {
  _apiKey = key;
}

function getApiKey(): string {
  // Prefer explicitly set key, fall back to env for backwards compatibility
  const apiKey = _apiKey || process.env["VOYAGE_API_KEY"];
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is required for embedding generation");
  }
  return apiKey;
}

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

async function callVoyage(input: string[]): Promise<VoyageResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Voyage AI API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<VoyageResponse>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Voyage AI API timed out after ${VOYAGE_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await callVoyage([text]);
  return response.data[0]!.embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const response = await callVoyage(texts);
  return response.data.map((d) => d.embedding);
}

export { DIMENSIONS as EMBEDDING_DIMENSIONS };
