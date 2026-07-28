import { serveDir, serveFile } from "jsr:@std/http@1/file-server";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";

const RELAY_PATH = "/api/cloudflare";
const RELAY_API_BASE_PATH = "/api/cloudflare/client/v4";
const HEALTH_PATH = "/api/health";
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";
const CLOUDFLARE_API_BASE_PATH = "/client/v4";
const CLOUDFLARE_API_PREFIX = `${CLOUDFLARE_API_BASE_PATH}/`;
const RATE_LIMIT_REQUESTS = 300;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_RETRIES = 8;
function defaultStaticFiles(): { root: string; index: string } {
  // Vite writes `dist` locally. Deno Deploy's dynamic-source uploader omits
  // that conventional build directory, so the prebuilt production bundle is
  // packaged as `out` instead.
  for (const directory of ["dist", "out"]) {
    const root = fromFileUrl(new URL(`../${directory}/`, import.meta.url));
    const index = fromFileUrl(
      new URL(`../${directory}/index.html`, import.meta.url),
    );
    try {
      Deno.statSync(index);
      return { root, index };
    } catch {
      // Try the other supported bundle name.
    }
  }
  return {
    root: fromFileUrl(new URL("../dist/", import.meta.url)),
    index: fromFileUrl(new URL("../dist/index.html", import.meta.url)),
  };
}

const STATIC_FILES = defaultStaticFiles();
const STATIC_ROOT = STATIC_FILES.root;
const INDEX_FILE = STATIC_FILES.index;
const ALLOWED_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

type UpstreamFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RateLimiter {
  readonly storage: "deno-kv" | "memory" | "test";
  allow(key: string): Promise<boolean>;
}

export interface AppOptions {
  staticRoot?: string;
  indexFile?: string;
  upstreamFetch?: UpstreamFetch;
  rateLimiter?: RateLimiter;
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isSameOriginBrowserRequest(
  request: Request,
  requestUrl: URL,
): boolean {
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== requestUrl.origin) return false;

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite === null || fetchSite === "same-origin" ||
    fetchSite === "none";
}

function parseTarget(requestUrl: URL): URL | null {
  if (requestUrl.pathname.startsWith(`${RELAY_API_BASE_PATH}/`)) {
    const apiPath = requestUrl.pathname.slice(RELAY_API_BASE_PATH.length);
    const target = new URL(
      `${CLOUDFLARE_API_ORIGIN}${CLOUDFLARE_API_BASE_PATH}${apiPath}`,
    );
    target.search = requestUrl.search;
    return target;
  }

  if (requestUrl.pathname !== RELAY_PATH) return null;
  const targetValue = requestUrl.searchParams.get("url");
  if (!targetValue) return null;

  try {
    const target = new URL(targetValue);
    if (
      target.origin !== CLOUDFLARE_API_ORIGIN ||
      target.port ||
      target.username ||
      target.password ||
      !target.pathname.startsWith(CLOUDFLARE_API_PREFIX)
    ) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

function sanitizedUpstreamHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (
    const name of [
      "cf-connecting-ip",
      "cf-ipcountry",
      "cf-ray",
      "cf-visitor",
      "connection",
      "content-length",
      "cookie",
      "forwarded",
      "host",
      "origin",
      "referer",
      "true-client-ip",
      "x-deno-client-ip",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-nodepod-network",
      "x-real-ip",
      "x-wzed-relay-key",
    ]
  ) {
    headers.delete(name);
  }
  for (const name of [...headers.keys()]) {
    if (name.startsWith("sec-") || name.startsWith("cf-")) headers.delete(name);
  }
  return headers;
}

function clientIdentity(request: Request): string {
  for (
    const header of [
      "x-deno-client-ip",
      "x-real-ip",
      "x-forwarded-for",
      "cf-connecting-ip",
    ]
  ) {
    const value = request.headers.get(header)?.split(",", 1)[0]?.trim();
    if (value) return value;
  }
  return "unknown";
}

async function hashIdentity(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class MemoryRateLimiter implements RateLimiter {
  readonly storage = "memory" as const;
  #buckets = new Map<string, { count: number; expiresAt: number }>();

  async allow(key: string): Promise<boolean> {
    const now = Date.now();
    const bucket = this.#buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      this.#buckets.set(key, {
        count: 1,
        expiresAt: now + RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }
    if (bucket.count >= RATE_LIMIT_REQUESTS) return false;
    bucket.count += 1;
    return true;
  }
}

export class KvRateLimiter implements RateLimiter {
  readonly storage = "deno-kv" as const;

  constructor(private readonly kv: Deno.Kv) {}

  async allow(identity: string): Promise<boolean> {
    const window = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    const key: Deno.KvKey = ["cloudflare-api-rate-limit", window, identity];

    for (let attempt = 0; attempt < RATE_LIMIT_MAX_RETRIES; attempt++) {
      const entry = await this.kv.get<number>(key, { consistency: "strong" });
      const count = entry.value ?? 0;
      if (count >= RATE_LIMIT_REQUESTS) return false;

      const result = await this.kv.atomic()
        .check(entry)
        .set(key, count + 1, { expireIn: RATE_LIMIT_WINDOW_MS * 2 })
        .commit();
      if (result.ok) return true;
    }

    return false;
  }
}

let rateLimiterPromise: Promise<RateLimiter> | undefined;

async function defaultRateLimiter(): Promise<RateLimiter> {
  rateLimiterPromise ??= (async () => {
    try {
      return new KvRateLimiter(await Deno.openKv());
    } catch (error) {
      console.warn(
        `Deno KV is unavailable; using per-process rate limiting: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
      return new MemoryRateLimiter();
    }
  })();
  return await rateLimiterPromise;
}

function withSecurityHeaders(response: Response, requestUrl: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (requestUrl.pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
  } else if (requestUrl.pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (requestUrl.pathname === "/__sw__.js") {
    headers.set("Cache-Control", "no-cache");
  } else if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleCloudflareRelay(
  request: Request,
  rateLimiter: RateLimiter,
  upstreamFetch: UpstreamFetch = fetch,
): Promise<Response> {
  const requestUrl = new URL(request.url);

  console.info(JSON.stringify({
    message: "Cloudflare relay entry",
    method: request.method,
    path: requestUrl.pathname,
    origin: request.headers.get("Origin"),
    fetchSite: request.headers.get("Sec-Fetch-Site"),
  }));

  if (
    requestUrl.pathname !== RELAY_PATH &&
    !requestUrl.pathname.startsWith(`${RELAY_API_BASE_PATH}/`)
  ) {
    return jsonError("Not found", 404);
  }
  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError("Method not allowed", 405);
  }
  if (!isSameOriginBrowserRequest(request, requestUrl)) {
    return jsonError("Cross-origin relay requests are not allowed", 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const target = parseTarget(requestUrl);
  if (!target) {
    return jsonError("Only Cloudflare client API URLs are allowed", 403);
  }

  console.info(JSON.stringify({
    message: "Cloudflare relay request",
    method: request.method,
    path: requestUrl.pathname,
    upstreamPath: target.pathname,
  }));

  const identity = await hashIdentity(clientIdentity(request));
  if (!(await rateLimiter.allow(identity))) {
    return jsonError("Too many Cloudflare API requests", 429);
  }

  const upstream = await upstreamFetch(target, {
    method: request.method,
    headers: sanitizedUpstreamHeaders(request),
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.body,
    redirect: "manual",
  });

  console.info(JSON.stringify({
    message: "Cloudflare relay response",
    upstreamPath: target.pathname,
    status: upstream.status,
  }));

  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    return jsonError("Cloudflare API redirect blocked", 502);
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("set-cookie");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function serveStatic(
  request: Request,
  staticRoot: string,
  indexFile: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError("Method not allowed", 405);
  }

  const response = await serveDir(request, {
    fsRoot: staticRoot,
    showDirListing: false,
    quiet: true,
  });
  if (response.status !== 404) return response;

  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ??
    true;
  return acceptsHtml
    ? await serveFile(request, indexFile)
    : new Response("Not found", { status: 404 });
}

export function createApp(options: AppOptions = {}) {
  const staticRoot = options.staticRoot ?? STATIC_ROOT;
  const indexFile = options.indexFile ?? INDEX_FILE;
  const upstreamFetch = options.upstreamFetch ?? fetch;

  return async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url);
    try {
      if (requestUrl.pathname === HEALTH_PATH) {
        const limiter = options.rateLimiter ?? await defaultRateLimiter();
        return withSecurityHeaders(
          Response.json({
            ok: true,
            service: "wzed",
            rateLimit: limiter.storage,
          }),
          requestUrl,
        );
      }
      if (
        requestUrl.pathname === RELAY_PATH ||
        requestUrl.pathname.startsWith(`${RELAY_API_BASE_PATH}/`)
      ) {
        const limiter = options.rateLimiter ?? await defaultRateLimiter();
        return withSecurityHeaders(
          await handleCloudflareRelay(request, limiter, upstreamFetch),
          requestUrl,
        );
      }

      return withSecurityHeaders(
        await serveStatic(request, staticRoot, indexFile),
        requestUrl,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "wZed request failed",
          error: error instanceof Error ? error.message : "Unknown error",
          path: requestUrl.pathname,
        }),
      );
      return withSecurityHeaders(jsonError("Request failed", 502), requestUrl);
    }
  };
}

if (import.meta.main) {
  Deno.serve(createApp());
}
