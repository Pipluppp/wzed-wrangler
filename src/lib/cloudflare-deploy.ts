import { WRANGLER_NODEPOD_COMPAT } from "@/lib/wrangler-nodepod-template";
import type { DeploymentKind } from "@/templates";

const WRANGLER_VERSION = "4.114.0";
const INTERNAL_DIRECTORY = "/project/.wzed";
const VITE_BUILD_SCRIPT = `import { build } from "vite";\nawait build();\n`;
interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ProcessLike {
  completion: Promise<ProcessResult>;
  on(event: "output" | "error", handler: (chunk: string) => void): ProcessLike;
  write(data: string): void;
  kill(): void;
}

export interface NodepodLike {
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    stat(path: string): Promise<unknown>;
    writeFile(path: string, contents: string): Promise<void>;
  };
  spawn(
    command: string,
    args?: string[],
    options?: { cwd?: string; signal?: AbortSignal },
  ): Promise<ProcessLike>;
}

export type DeployStage = "installing" | "building" | "deploying";

export interface TemporaryDeployment {
  deploymentUrl: string;
  claimUrl: string;
  output: string;
}

export interface TemporaryDeployOptions {
  kind: DeploymentKind;
  signal?: AbortSignal;
  onStage?: (stage: DeployStage) => void;
  onOutput?: (chunk: string) => void;
}

async function pathExists(nodepod: NodepodLike, path: string): Promise<boolean> {
  try {
    await nodepod.fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  nodepod: NodepodLike,
  command: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    onOutput?: (chunk: string) => void;
    confirmTerms?: boolean;
  } = {},
): Promise<string> {
  if (options.signal?.aborted) throw new DOMException("Deployment cancelled", "AbortError");

  const process = await nodepod.spawn(command, args, {
    cwd: "/project",
    signal: options.signal,
  });
  let streamed = "";
  let termsConfirmed = false;

  const confirmTerms = () => {
    if (!options.confirmTerms || termsConfirmed) return;
    termsConfirmed = true;
    process.write("yes\r");
  };
  const collect = (chunk: string) => {
    streamed += chunk;
    options.onOutput?.(chunk);
    if (/type\s+["']?yes["']?/i.test(chunk)) confirmTerms();
  };

  process.on("output", collect);
  process.on("error", collect);
  const fallbackConfirmation = options.confirmTerms
    ? globalThis.setTimeout(confirmTerms, 1_500)
    : null;

  try {
    const result = await process.completion;
    const captured = `${result.stdout}${result.stderr}`;
    if (!streamed && captured) options.onOutput?.(captured);
    if (result.exitCode !== 0) {
      const detail = (captured || streamed).trim();
      throw new Error(detail || `${command} exited with code ${result.exitCode}`);
    }
    return captured || streamed;
  } finally {
    if (fallbackConfirmation !== null) globalThis.clearTimeout(fallbackConfirmation);
  }
}

async function installWrangler(
  nodepod: NodepodLike,
  options: TemporaryDeployOptions,
): Promise<void> {
  let installedVersion = "";
  try {
    const manifest = JSON.parse(
      await nodepod.fs.readFile("/project/node_modules/wrangler/package.json", "utf8"),
    ) as { version?: string };
    installedVersion = manifest.version ?? "";
  } catch {
    // Install below.
  }

  if (installedVersion === WRANGLER_VERSION) return;
  await runCommand(
    nodepod,
    "npm",
    [
      "install",
      "--no-save",
      "--package-lock=false",
      `wrangler@${WRANGLER_VERSION}`,
    ],
    options,
  );
}

async function writeCompatibilityFiles(nodepod: NodepodLike): Promise<void> {
  await Promise.all([
    nodepod.fs.mkdir(INTERNAL_DIRECTORY, { recursive: true }),
    // Child processes receive an isolated filesystem view. Create Wrangler's
    // state directory through the owning Nodepod VFS so every spawn can see it.
    nodepod.fs.mkdir("/home/user/.wrangler/logs", { recursive: true }),
  ]);
  await nodepod.fs.writeFile(
    `${INTERNAL_DIRECTORY}/patch-wrangler.mjs`,
    WRANGLER_NODEPOD_COMPAT,
  );
  await nodepod.fs.writeFile(
    `${INTERNAL_DIRECTORY}/build-static.mjs`,
    VITE_BUILD_SCRIPT,
  );
}

function findUrl(output: string, pattern: RegExp): string | null {
  const match = output.match(pattern)?.[0];
  return match?.replace(/[),.;]+$/, "") ?? null;
}

export async function deployTemporaryPreview(
  nodepod: NodepodLike,
  options: TemporaryDeployOptions,
): Promise<TemporaryDeployment> {
  options.onStage?.("installing");

  if (
    options.kind === "static" &&
    !(await pathExists(nodepod, "/project/node_modules/vite/package.json"))
  ) {
    await runCommand(nodepod, "npm", ["install"], options);
  }
  await installWrangler(nodepod, options);
  await writeCompatibilityFiles(nodepod);
  await runCommand(
    nodepod,
    "node",
    [".wzed/patch-wrangler.mjs"],
    options,
  );

  if (options.kind === "static") {
    options.onStage?.("building");
    // Vite's executable starts its async command without awaiting it. Native
    // Node stays alive long enough for the build to finish, but Nodepod has no
    // OS event-loop handles and reports completion while Vite is still writing
    // dist. A top-level await around the public build API gives Nodepod an
    // explicit completion boundary before Wrangler scans the asset directory.
    await runCommand(nodepod, "node", [".wzed/build-static.mjs"], options);
  }

  options.onStage?.("deploying");
  const deployArgs = [
    "node_modules/wrangler/wrangler-dist/cli.js",
    "deploy",
    "--temporary",
  ];
  if (options.kind === "worker") deployArgs.push("--no-bundle");

  let output = "";
  const captured = await runCommand(nodepod, "node", deployArgs, {
    ...options,
    confirmTerms: true,
    onOutput: (chunk) => {
      output += chunk;
      options.onOutput?.(chunk);
    },
  });
  if (!output) output = captured;

  const deploymentUrl = findUrl(
    output,
    /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev(?:\/[^\s]*)?/i,
  );
  const claimUrl = findUrl(
    output,
    /https:\/\/dash\.cloudflare\.com\/claim-preview\?claimToken=[^\s]+/i,
  );

  if (!deploymentUrl || !claimUrl) {
    throw new Error("Cloudflare completed without returning both preview and claim URLs");
  }

  return { deploymentUrl, claimUrl, output };
}
