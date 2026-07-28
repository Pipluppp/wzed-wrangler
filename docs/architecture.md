# Runtime and deployment architecture

## Why the runtime is a separate fork

The published Nodepod package and the current wZed repository had drifted apart. Vite 8's Rolldown
WASI binding graph and Wrangler exercise runtime paths that the published package does not yet
support reliably. The reusable fixes therefore live in
[Pipluppp/nodepod](https://github.com/Pipluppp/nodepod), where they can be tested and proposed
upstream independently.

wZed consumes an immutable release asset rather than requiring a sibling source checkout. This
keeps a fresh clone reproducible without copying the Nodepod implementation into the application.

## Ownership boundary

### Nodepod runtime module

- virtual filesystem and process-worker lifecycle;
- service-worker routing for local preview servers;
- cross-origin fetch proxy propagation into child processes;
- a host-network bypass for requests made by Nodepod itself;
- browser-compatible esbuild sync-surface behavior; and
- Vite 8 / Rolldown WASI runtime compatibility.

### wZed deployment module

- Vite, React, and Worker starter templates;
- pinned browser-compatible dependencies in those templates;
- deploy consent and progress UI;
- installation and invocation of a tested Wrangler version;
- the narrow Wrangler-on-Nodepod compatibility adapter;
- the same-origin Deno relay; and
- public-preview and private-claim results.

Wrangler-specific behavior belongs in wZed because it is a product adapter, not a guarantee every
Nodepod process should inherit.

## Temporary deployment sequence

1. The user clicks **Deploy** and accepts Cloudflare's terms in the dialog.
2. wZed saves modified editor buffers into Nodepod's virtual filesystem.
3. wZed installs template dependencies when needed and pins Wrangler to the tested version.
4. The adapter removes deploy-path assumptions about native `workerd`, raw sockets, and unavailable
   esbuild functions.
5. Vite or React projects run `npm run build`; Worker projects use their existing entry point.
6. Wrangler calls `/api/cloudflare/client/v4/*` on the same origin as wZed.
7. The Deno server validates and rate-limits the request, then forwards it to
   `api.cloudflare.com`.
8. Wrangler uploads to the temporary account and returns a public preview URL plus a private claim
   URL.
9. wZed preserves the matching local preview inside the editor and offers the public preview as a
   top-level link.

The relay is needed because browser code cannot directly make all of Wrangler's authenticated,
cross-origin Cloudflare API requests. It changes the network route, not the ownership model: Deno
does not hold a Cloudflare account and does not deploy on the user's behalf.

Cloudflare can show a one-time bot-verification page on a new `workers.dev` hostname. That page sends
`X-Frame-Options: SAMEORIGIN`, so an external IDE cannot embed it. Opening the public result in a
top-level tab is the correct browser-security boundary; the deployed application remains valid.

## Wrangler compatibility policy

The adapter is version-pinned and should fail loudly when Wrangler's generated CLI no longer
matches its expected shape. Upgrade Wrangler only after testing all supported paths:

- Worker script deployment;
- vanilla Vite static assets; and
- React static assets with SPA fallback.

`wrangler dev` remains unsupported because it executes native `workerd`. Nodepod/Vite supplies the
local preview instead.

## Upstream path

When an official Nodepod release includes the required runtime fixes:

1. switch `@scelar/nodepod` from the fork release asset to the official published version;
2. remove only compatibility code made redundant by that release;
3. keep the wZed Wrangler adapter and Deno relay; and
4. rerun the local-preview and temporary-deployment matrix.
