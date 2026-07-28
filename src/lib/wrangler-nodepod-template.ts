export const WRANGLER_NODEPOD_COMPAT = String.raw`import fs from "fs/promises";
import path from "path";

const root = process.cwd();
await fs.mkdir(path.join(process.env.HOME || "/home/user", ".wrangler"), { recursive: true });
const wranglerRoot = path.join(root, "node_modules", "wrangler");
const wranglerPackage = JSON.parse(await fs.readFile(path.join(wranglerRoot, "package.json"), "utf8"));
const version = String(wranglerPackage.version);
const [major, minor] = version.split(".").map(Number);
if (major < 4 || (major === 4 && minor < 102)) throw new Error("Wrangler 4.102.0 or later is required for --temporary");

const workerdRoot = path.join(root, "node_modules", "@cloudflare", "workerd-linux-64");
await fs.mkdir(path.join(workerdRoot, "bin"), { recursive: true });
await fs.writeFile(path.join(workerdRoot, "package.json"), JSON.stringify({
  name: "@cloudflare/workerd-linux-64",
  version: wranglerPackage.dependencies?.workerd || "0.0.0-nodepod",
}));
await fs.writeFile(path.join(workerdRoot, "bin", "workerd"), "");

// Nodepod resolves blake3-wasm's ESM entrypoint, which references a file the
// package does not publish. Forward it to the directory entrypoint it intended.
const blake3EsmRoot = path.join(root, "node_modules", "blake3-wasm", "esm");
await fs.writeFile(path.join(blake3EsmRoot, "node.js"), 'export * from "./node/index.js";\n');
const blake3HashInstancePath = path.join(blake3EsmRoot, "node", "hash-instance.js");
const blake3HashInstance = await fs.readFile(blake3HashInstancePath, "utf8");
await fs.writeFile(blake3HashInstancePath, blake3HashInstance.replace("from 'stream.js'", "from 'stream'"));

const marker = "/* wzed-nodepod-wrangler-bridge-v11 */";
const fetchBridge = [
  "const __wzedRelayUrl = process.env.WZED_CLOUDFLARE_RELAY_URL || '';",
  "function __wzedFetch(input, init) {",
  "  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;",
  "  if (__wzedRelayUrl && raw) {",
  "    try {",
      "      const url = new URL(raw);",
      "      if (url.hostname === 'api.cloudflare.com') {",
      "        const proxied = __wzedRelayUrl + encodeURIComponent(url.href);",
      "        const sourceRequest = input instanceof Request ? input : init instanceof Request ? init : null;",
      "        const headers = new Headers(sourceRequest ? sourceRequest.headers : init && init.headers);",
      "        headers.set('x-nodepod-network', 'bypass');",
      "        if (sourceRequest) {",
      "          const proxiedRequest = new Request(proxied, sourceRequest);",
      "          return globalThis.fetch(new Request(proxiedRequest, { headers }));",
      "        }",
      "        return globalThis.fetch(proxied, { ...init, headers });",
  "      }",
  "    } catch {}",
  "  }",
  "  return globalThis.fetch(input, init);",
  "}",
].join("\n");
const bridge = [
  marker,
  fetchBridge,
  "function __wzedFormatMessagesSync(messages, options = {}) {",
  "  const kind = String(options.kind || 'error').toUpperCase();",
  "  return messages.map((message) => {",
  "    const location = message && message.location;",
  "    const where = location && location.file ? location.file + ':' + (location.line || 0) + ':' + ((location.column || 0) + 1) + ': ' : '';",
  "    return where + kind + ': ' + (message && message.text ? message.text : String(message));",
  "  });",
  "}",
  "function __wzedWrapEsbuild(module) {",
  "  if (typeof module.formatMessagesSync === 'function') return module;",
  "  return Object.assign({}, module, { formatMessagesSync: __wzedFormatMessagesSync });",
  "}",
  "const __nodepodUnsupportedDispatcher = {",
  "  dispatch() { const error = new Error('Raw socket dispatch is unavailable in Nodepod'); error.code = 'ENOTSUP'; throw error; },",
  "  close() { return Promise.resolve(); },",
  "  destroy() { return Promise.resolve(); }",
  "};",
  "class __NodepodDispatcher {",
  "  dispatch(options, handler) { return __nodepodUnsupportedDispatcher.dispatch(options, handler); }",
  "  close() { return __nodepodUnsupportedDispatcher.close(); }",
  "  destroy() { return __nodepodUnsupportedDispatcher.destroy(); }",
  "}",
  "class __NodepodEnvHttpProxyAgent extends __NodepodDispatcher {}",
  "const __nodepodUndici = {",
  "  fetch: __wzedFetch,",
  "  Headers: globalThis.Headers, FormData: globalThis.FormData,",
  "  Request: globalThis.Request, Response: globalThis.Response, File: globalThis.File,",
  "  Dispatcher: __NodepodDispatcher, EnvHttpProxyAgent: __NodepodEnvHttpProxyAgent,",
  "  getGlobalDispatcher: () => __nodepodUnsupportedDispatcher, setGlobalDispatcher: () => {}",
  "};",
].join("\n");

const cliPath = path.join(wranglerRoot, "wrangler-dist", "cli.js");
let cli = await fs.readFile(cliPath, "utf8");
let fetchReplacements = 0;
let esbuildReplacements = 0;
let keepaliveReplacements = 0;
let assetHashRestorations = 0;
if (!cli.includes(marker) && /\/\* wzed-nodepod-wrangler-bridge-v(?:[2-9]|10) \*\//.test(cli)) {
  cli = cli.replace(
    /\/\* wzed-nodepod-wrangler-bridge-v(?:[2-9]|10) \*\/[\s\S]*?(?=function __wzedFormatMessagesSync)/,
    marker + "\n" + fetchBridge + "\n",
  );
  cli = cli.replace(
    "fetch: (...args) => globalThis.fetch(...args),",
    "fetch: __wzedFetch,",
  );
  fetchReplacements += 1;
}
if (!cli.includes(marker)) {
  cli = cli.replace(/__toESM\(require_undici\(\)(?:, 1)?\)/g, () => {
    fetchReplacements += 1;
    return "__nodepodUndici";
  });
  cli = cli.replace(/var esbuild = require\((['\"])esbuild\1\);/, (match, quote) => {
    esbuildReplacements += 1;
    return "var esbuild = __wzedWrapEsbuild(require(" + quote + "esbuild" + quote + "));";
  });
  if (fetchReplacements === 0 || esbuildReplacements === 0 || !cli.startsWith("'use strict';")) {
    throw new Error("This Wrangler release is not compatible with the wZed Nodepod bridge");
  }
  cli = cli.replace("'use strict';", "'use strict';\n\n" + bridge);
}

const blake3AssetHash = 'return blake3Wasm.hash(base64Contents + extension2).toString("hex").slice(0, 32);';
const shaAssetHash = 'return crypto2.createHash("sha256").update(base64Contents + extension2).digest("hex").slice(0, 32);';
const directAssetHash = 'return __wzedAssetId(contents, extension2);';
const browserSafeAssetHash = 'return __wzedAssetId(base64Contents + extension2);';
for (const previousAssetHash of [shaAssetHash, directAssetHash, browserSafeAssetHash]) {
  if (cli.includes(previousAssetHash)) {
    cli = cli.replace(previousAssetHash, blake3AssetHash);
    assetHashRestorations += 1;
  }
}
if (!cli.includes(blake3AssetHash)) {
  throw new Error("This Wrangler release has an unsupported static asset hashing implementation");
}

if (!cli.includes("const __wzedKeepAlive = setInterval")) {
  const mainStart = "  main(hideBin(process5__default.default.argv)).catch((e9) => {";
  const mainEnd = "    process5__default.default.exit(exitCode);\n  });\n}";
  if (!cli.includes(mainStart) || !cli.includes(mainEnd)) {
    throw new Error("This Wrangler release has an unsupported CLI lifecycle");
  }
  cli = cli.replace(
    mainStart,
    "  const __wzedKeepAlive = setInterval(() => {}, 1e3);\n" + mainStart,
  );
  cli = cli.replace(
    mainEnd,
    "    process5__default.default.exit(exitCode);\n  }).finally(() => clearInterval(__wzedKeepAlive));\n}",
  );
  keepaliveReplacements += 1;
}

await fs.writeFile(cliPath, cli);

await fs.writeFile(path.join(wranglerRoot, "bin", "wrangler.js"), "#!/usr/bin/env node\nrequire('../wrangler-dist/cli.js');\n");
console.log(fetchReplacements + esbuildReplacements + keepaliveReplacements + assetHashRestorations > 0
  ? "Patched Wrangler " + version + " for Nodepod"
  : "Wrangler " + version + " is already patched for Nodepod");
`;
