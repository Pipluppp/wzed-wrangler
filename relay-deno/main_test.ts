import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createApp, handleCloudflareRelay, type RateLimiter } from "./main.ts";

class TestRateLimiter implements RateLimiter {
  readonly storage = "test" as const;
  allowed = true;
  calls = 0;

  allow(): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(this.allowed);
  }
}

function relayRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://wzed.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://wzed.example",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": "192.0.2.10",
      "X-Nodepod-Network": "bypass",
      Authorization: "Bearer temporary-account-token",
      "Content-Type": "application/json",
      Cookie: "must-not-leak=true",
      ...init.headers,
    },
    body: "{}",
    ...init,
  });
}

Deno.test("maps Wrangler's same-origin API base to Cloudflare", async () => {
  const limiter = new TestRateLimiter();
  let forwardedTarget = "";
  let forwardedHeaders = new Headers();
  const response = await handleCloudflareRelay(
    relayRequest(
      "/api/cloudflare/client/v4/provisioning/previews/challenge?source=wzed",
    ),
    limiter,
    (target, init) => {
      forwardedTarget = String(target);
      forwardedHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ success: true }));
    },
  );

  assertEquals(response.status, 200);
  assertEquals(
    forwardedTarget,
    "https://api.cloudflare.com/client/v4/provisioning/previews/challenge?source=wzed",
  );
  assertEquals(
    forwardedHeaders.get("Authorization"),
    "Bearer temporary-account-token",
  );
  assertEquals(forwardedHeaders.has("Cookie"), false);
  assertEquals(forwardedHeaders.has("Origin"), false);
  assertEquals(forwardedHeaders.has("X-Forwarded-For"), false);
  assertEquals(forwardedHeaders.has("X-Nodepod-Network"), false);
  assertEquals(limiter.calls, 1);
  await response.body?.cancel();
});

Deno.test("supports Nodepod's URL-form proxy without becoming an open proxy", async () => {
  const limiter = new TestRateLimiter();
  const target = encodeURIComponent(
    "https://api.cloudflare.com/client/v4/accounts",
  );
  const allowed = await handleCloudflareRelay(
    relayRequest(`/api/cloudflare?url=${target}`),
    limiter,
    () => Promise.resolve(new Response("ok")),
  );
  const blocked = await handleCloudflareRelay(
    relayRequest(
      `/api/cloudflare?url=${
        encodeURIComponent("https://example.com/client/v4")
      }`,
    ),
    limiter,
  );

  assertEquals(allowed.status, 200);
  assertEquals(blocked.status, 403);
  await allowed.body?.cancel();
  await blocked.body?.cancel();
});

Deno.test("rejects cross-origin requests and rate-limits allowed requests", async () => {
  const crossOriginLimiter = new TestRateLimiter();
  const crossOrigin = await handleCloudflareRelay(
    relayRequest("/api/cloudflare/client/v4/accounts", {
      headers: { Origin: "https://attacker.example" },
    }),
    crossOriginLimiter,
  );
  assertEquals(crossOrigin.status, 403);
  assertEquals(crossOriginLimiter.calls, 0);

  const blockedLimiter = new TestRateLimiter();
  blockedLimiter.allowed = false;
  const rateLimited = await handleCloudflareRelay(
    relayRequest("/api/cloudflare/client/v4/accounts"),
    blockedLimiter,
  );
  assertEquals(rateLimited.status, 429);
  await crossOrigin.body?.cancel();
  await rateLimited.body?.cancel();
});

Deno.test("blocks upstream redirects and response cookies", async () => {
  const limiter = new TestRateLimiter();
  const redirected = await handleCloudflareRelay(
    relayRequest("/api/cloudflare/client/v4/accounts"),
    limiter,
    () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.com" },
        }),
      ),
  );
  assertEquals(redirected.status, 502);

  const responseWithCookie = await handleCloudflareRelay(
    relayRequest("/api/cloudflare/client/v4/accounts"),
    limiter,
    () =>
      Promise.resolve(
        new Response("ok", { headers: { "Set-Cookie": "secret=true" } }),
      ),
  );
  assertEquals(responseWithCookie.headers.has("Set-Cookie"), false);
  assertEquals(responseWithCookie.headers.get("Cache-Control"), "no-store");
  await redirected.body?.cancel();
  await responseWithCookie.body?.cancel();
});

Deno.test("serves the SPA and required Nodepod isolation headers", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${root}/index.html`,
      "<!doctype html><title>wZed test</title>",
    );
    await Deno.writeTextFile(
      `${root}/__sw__.js`,
      "self.addEventListener('fetch', () => {});",
    );
    const app = createApp({
      staticRoot: root,
      indexFile: `${root}/index.html`,
      rateLimiter: new TestRateLimiter(),
    });

    const response = await app(
      new Request("https://wzed.example/editor", {
        headers: { Accept: "text/html" },
      }),
    );
    assertEquals(response.status, 200);
    assertStringIncludes(await response.text(), "wZed test");
    assertEquals(
      response.headers.get("Cross-Origin-Opener-Policy"),
      "same-origin",
    );
    assertEquals(
      response.headers.get("Cross-Origin-Embedder-Policy"),
      "credentialless",
    );
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("health reports the configured limiter without exposing secrets", async () => {
  const app = createApp({ rateLimiter: new TestRateLimiter() });
  const response = await app(new Request("https://wzed.example/api/health"));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    service: "wzed",
    rateLimit: "test",
  });
  assertEquals(response.headers.get("Cache-Control"), "no-store");
});
