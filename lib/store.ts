// Small JSON store. Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise
// memory (local dev without a store). Values are tiny JSON documents keyed by
// path, e.g. "sales/<hash>.json".

import { get, put } from "@vercel/blob";

const memory = new Map<string, unknown>();

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function storeKind(): "blob" | "memory" {
  return hasBlob() ? "blob" : "memory";
}

export async function readJson<T>(key: string): Promise<T | null> {
  if (!hasBlob()) return (memory.get(key) as T | undefined) ?? null;
  const result = await get(key, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  if (!hasBlob()) {
    memory.set(key, value);
    return;
  }
  await put(key, JSON.stringify(value), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** Stable, filesystem-safe key for a free-text string. */
export async function keyFor(prefix: string, text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}/${hex}.json`;
}
