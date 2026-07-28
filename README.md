# wZed Wrangler

wZed Wrangler is a browser-only IDE powered by a browser-runtime fork of
[Nodepod](https://github.com/Pipluppp/nodepod). It combines Monaco, an xterm terminal, a virtual
filesystem, local Vite previews, and one-click temporary Cloudflare deployments. End users do not
need a Cloudflare account, API token, local CLI, or relay configuration.

This fork modernizes the original wZed application from Next.js to a Vite 8 single-page app using
React 19, TypeScript 7, Tailwind CSS 4, and Oxlint.

> Experimental: Nodepod emulates Node.js inside browser workers. Package compatibility and memory
> use are not yet equivalent to native Node.js.

## What works

- Vanilla Vite and React projects install and preview inside the browser.
- Project files and editor layouts persist locally.
- The Vite, React, and Cloudflare Worker templates expose a **Deploy** button.
- Deploy builds the project, runs a pinned Wrangler inside Nodepod, and creates a temporary
  Cloudflare preview.
- The user accepts Cloudflare's terms in one dialog; no setup commands or credentials are needed.
- The result includes a private claim URL for moving the preview into a Cloudflare account within
  Cloudflare's time limit.

The matching local Vite preview stays inside wZed. The public Cloudflare preview opens in a top-level
tab because Cloudflare may protect a new accountless hostname with a challenge that browsers are not
allowed to render in a third-party iframe.

`wrangler dev` is intentionally out of scope because it requires the native `workerd` runtime. The
supported browser-native loop is local Vite preview followed by `wrangler deploy --temporary`.

## Runtime boundary

wZed pins the immutable
[Nodepod `v1.9.13-wzed.1` release](https://github.com/Pipluppp/nodepod/releases/tag/v1.9.13-wzed.1)
directly in `package.json`; a sibling Nodepod checkout is not required.

- Nodepod owns reusable runtime behavior: browser workers, filesystem, networking, service-worker
  preview routing, package loading, and Vite/Rolldown WASI compatibility.
- wZed owns the product integration: starter templates, deploy UI, the version-pinned Wrangler
  adapter, the same-origin relay, and temporary-preview results.

That seam avoids hiding product-specific Wrangler patches inside every Nodepod process while keeping
the browser-runtime fixes independently upstreamable. See [the architecture notes](docs/architecture.md).

## Local development

Requirements: Node.js 22+ and npm. Deno 2 is only needed to run or deploy the production server.

```bash
git clone https://github.com/Pipluppp/wzed-wrangler.git
cd wzed-wrangler
npm ci
npm run dev
```

For the production-equivalent server, including the same-origin relay:

```bash
npm run build
npm run preview:deno
```

Open <http://localhost:8000>.

## Quality checks

```bash
npm run check
npm test
npm run check:deno
npm run test:deno
npm run build
```

## Production architecture

One Deno Deploy application serves the static Vite build and the narrow Cloudflare API relay. This
is one-time operator infrastructure; end users only visit the application and click **Deploy**.

```text
Browser / wZed
├── Nodepod workers: npm, Vite, Wrangler, virtual filesystem
├── local preview: instance-scoped service-worker URL
└── /api/cloudflare/client/v4/*
    └── same-origin Deno relay
        └── https://api.cloudflare.com/client/v4/*
```

The relay is not a general-purpose proxy. It accepts only same-origin requests for Cloudflare's
Client API, strips browser and proxy credentials, rejects redirects, disables caching, and
rate-limits clients. Attach Deno KV in production so rate limits are shared across instances.

After configuring a Deno Deploy application once, publish a production revision with:

```bash
npm run deploy:deno -- YOUR_ORG YOUR_APP
```

The script builds the SPA and stages the output in the shape expected by Deno's dynamic uploader.
See [the Deno deployment guide](relay-deno/README.md) for the one-time application settings.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite development host |
| `npm run build` | Build the production SPA into `dist/` |
| `npm run preview` | Preview only the Vite build |
| `npm run preview:deno` | Serve the SPA and Cloudflare relay locally |
| `npm run deploy:deno -- ORG APP` | Stage and publish the complete Deno app |
| `npm run check` | Type-check and run Oxlint |
| `npm test` | Run browser-app unit tests |
| `npm run check:deno` | Type-check the Deno server |
| `npm run test:deno` | Run relay and static-server tests |

## Security notes

- Temporary-account claim URLs are secrets. wZed never places them in share snapshots.
- `/project/.wzed`, `/project/.wrangler`, and `/home/user/.wrangler` are hidden from the project tree
  or stripped from shared snapshots.
- The relay has no operator Cloudflare token. It forwards the user's short-lived temporary
  authorization headers in memory to Cloudflare and neither stores nor logs them.
- The relay is infrastructure operated by the wZed host; users do not configure or trust a relay of
  their own.

## License

[MIT with Commons Clause](LICENSE), inherited from the original wZed project.
