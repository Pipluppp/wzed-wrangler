# wZed on Deno Deploy

One Deno Deploy application serves the Vite production build and the same-origin
Cloudflare API relay. End users never configure this component.

The server:

- serves the SPA from `dist/` locally or the staged `out/` directory in
  production;
- applies the COOP/COEP headers required by Nodepod;
- exposes `/api/cloudflare/client/v4/*`, the API base used by Wrangler;
- forwards only Cloudflare Client API requests;
- strips browser and proxy credentials, blocks redirects, and never caches API
  responses; and
- rate-limits each client with Deno KV, with a per-process fallback for local
  development.

Cloudflare rejects temporary-account provisioning when it originates from
another Cloudflare Worker with `1017 worker_subrequest_blocked`. Hosting the
application and relay together on Deno Deploy provides independent egress and a
same-origin browser endpoint.

## Local verification

From the repository root:

```sh
npm ci
npm run build
npm run test:deno
npm run preview:deno
```

Open <http://localhost:8000>.

## One-time Deno application setup

Create a dynamic Deno Deploy application with these settings:

- runtime mode: `dynamic`;
- entry point: `relay-deno/main.ts`;
- working directory: `.`;
- region: `global`;
- install command: `echo prebuilt`; and
- build command: `echo prebuilt`.

Attach a Deno KV database so rate limiting remains consistent across runtime
instances. The relay does not require a Cloudflare API token or any application
secret.

## Publish an update

Authenticate once with `deno deploy`, then run from the repository root:

```sh
npm run deploy:deno -- YOUR_ORG YOUR_APP
```

The command builds the Vite app, stages `dist/` as `out/`, copies the relay
configuration, and calls the Deno CLI. The temporary staging directory is
removed afterward. Renaming is necessary because Deno's dynamic-source uploader
omits conventional `dist` build directories.
