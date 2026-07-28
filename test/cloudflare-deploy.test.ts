import { describe, expect, it } from "vitest";
import {
  deployTemporaryPreview,
  type NodepodLike,
} from "../src/lib/cloudflare-deploy";
import { WRANGLER_NODEPOD_COMPAT } from "../src/lib/wrangler-nodepod-template";

const deployOutput = `Temporary account ready:
  Claim URL: https://dash.cloudflare.com/claim-preview?claimToken=secret-token
Deployed wzed-vite-preview triggers
  https://wzed-vite-preview.example-account.workers.dev
`;

function fakeNodepod(existingPaths: string[]) {
  const files = new Map<string, string>([
    ["/project/node_modules/wrangler/package.json", '{"version":"4.114.0"}'],
  ]);
  const commands: string[][] = [];

  const nodepod: NodepodLike = {
    fs: {
      async mkdir() {},
      async readFile(path) {
        const value = files.get(path);
        if (value === undefined) throw new Error("ENOENT");
        return value;
      },
      async stat(path) {
        if (!existingPaths.includes(path)) throw new Error("ENOENT");
        return {};
      },
      async writeFile(path, contents) {
        files.set(path, contents);
      },
    },
    async spawn(command, args = []) {
      commands.push([command, ...args]);
      const isDeploy = args.includes("deploy");
      const stdout = isDeploy ? deployOutput : "ok\n";
      return {
        completion: Promise.resolve({ stdout, stderr: "", exitCode: 0 }),
        on() { return this; },
        write() {},
        kill() {},
      };
    },
  };

  return { nodepod, commands, files };
}

describe("temporary preview deployment", () => {
  it("keeps Wrangler's BLAKE3 content digest", () => {
    expect(WRANGLER_NODEPOD_COMPAT).toContain(
      "blake3Wasm.hash(base64Contents + extension2)",
    );
    expect(WRANGLER_NODEPOD_COMPAT).not.toContain("@noble/hashes/blake3");
    expect(WRANGLER_NODEPOD_COMPAT).toContain(
      "unsupported static asset hashing implementation",
    );
  });

  it("preserves Request method and body when routing Wrangler through the relay", () => {
    expect(WRANGLER_NODEPOD_COMPAT).toContain(
      "input instanceof Request ? input : init instanceof Request ? init : null",
    );
    expect(WRANGLER_NODEPOD_COMPAT).toContain(
      "const proxiedRequest = new Request(proxied, sourceRequest)",
    );
    expect(WRANGLER_NODEPOD_COMPAT).not.toContain(
      "globalThis.fetch(new Request(proxied, input), { ...init, headers })",
    );
  });

  it("builds and deploys a static template without Wrangler bundling flags", async () => {
    const { nodepod, commands, files } = fakeNodepod([
      "/project/node_modules/vite/package.json",
    ]);

    const result = await deployTemporaryPreview(nodepod, { kind: "static" });

    expect(commands).toContainEqual(["node", ".wzed/build-static.mjs"]);
    const deploy = commands.find((command) => command.includes("deploy"));
    expect(deploy).not.toContain("--no-bundle");
    expect(result.deploymentUrl).toBe(
      "https://wzed-vite-preview.example-account.workers.dev",
    );
    expect(result.claimUrl).toContain("claimToken=secret-token");
    expect(files.has("/project/.wzed/patch-wrangler.mjs")).toBe(true);
    expect(files.get("/project/.wzed/build-static.mjs")).toContain("await build()");
  });

  it("deploys the Worker entrypoint with bundling disabled", async () => {
    const { nodepod, commands } = fakeNodepod([]);
    await deployTemporaryPreview(nodepod, { kind: "worker" });

    const deploy = commands.find((command) => command.includes("deploy"));
    expect(deploy).toContain("--no-bundle");
    expect(commands).not.toContainEqual(["node", ".wzed/build-static.mjs"]);
  });
});
