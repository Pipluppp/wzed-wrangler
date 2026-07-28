/**
 * Project sharing via URL.
 *
 * Encodes a shallow VFS snapshot as a compressed, base64url-encoded string
 * that can be appended to the URL as `?share=<data>`.
 *
 * Uses native CompressionStream (gzip) — supported in all modern browsers.
 */

// Max URL length we'll allow (conservative — most browsers support ~64KB+)
const MAX_SHARE_LENGTH = 32_000;

/** Compress a JSON-serializable value to a base64url string. */
export async function compressToBase64(data: unknown): Promise<string> {
  // Yield a frame so the UI can paint loading states before blocking stringify
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const compressed = new Uint8Array(
    chunks.reduce((acc, c) => acc + c.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }

  // base64url encoding (no padding, URL-safe chars)
  // Chunked conversion to avoid call stack overflow on large payloads
  let binary = "";
  for (let i = 0; i < compressed.length; i += 8192) {
    binary += String.fromCharCode(...compressed.subarray(i, i + 8192));
  }
  const b64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return b64;
}

/** Decompress a base64url string back to a parsed JSON value. */
export async function decompressFromBase64<T = unknown>(
  b64: string,
): Promise<T> {
  // Restore standard base64
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const decompressed = new Uint8Array(
    chunks.reduce((acc, c) => acc + c.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    decompressed.set(chunk, offset);
    offset += chunk.length;
  }

  const json = new TextDecoder().decode(decompressed);
  return JSON.parse(json);
}

export interface SharePayload {
  version: 1;
  name: string;
  templateId: string;
  snapshot: Snapshot;
}

/** Create a share URL from the current project. Returns null if too large. */
export async function createShareUrl(
  name: string,
  templateId: string,
  snapshot: Snapshot,
): Promise<{ url: string } | { error: string }> {
  const payload: SharePayload = {
    version: 1,
    name,
    templateId,
    snapshot,
  };

  const encoded = await compressToBase64(payload);

  if (encoded.length > MAX_SHARE_LENGTH) {
    const sizeKB = Math.round(encoded.length / 1024);
    return {
      error: `Project is too large to share via URL (${sizeKB}KB compressed, max ${Math.round(MAX_SHARE_LENGTH / 1024)}KB). Try removing unnecessary files.`,
    };
  }

  const base = window.location.origin + window.location.pathname;
  return { url: `${base}?share=${encoded}` };
}

/** Parse a share param from the URL. Returns null if not present or invalid. */
export async function parseShareParam(): Promise<SharePayload | null> {
  const params = new URLSearchParams(window.location.search);
  const data = params.get("share");
  if (!data) return null;

  try {
    const payload = await decompressFromBase64<SharePayload>(data);
    // Validate required fields
    if (
      !payload ||
      typeof payload !== "object" ||
      payload.version !== 1 ||
      typeof payload.name !== "string" ||
      typeof payload.templateId !== "string" ||
      !payload.snapshot
    ) return null;
    return payload;
  } catch {
    return null;
  }
}
import type { Snapshot } from "@scelar/nodepod";
