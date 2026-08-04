export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCallInfo[];
  tool_call_id?: string;
}

export interface ToolCallInfo {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall: (call: ToolCallInfo) => void;
  onToolResult: (callId: string, name: string, result: string) => void;
  onComplete: (message: ChatMessage) => void;
  onError: (error: string) => void;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export interface ErrorReportData {
  title: string;
  description: string;
  code_snippet?: string;
  error_message: string;
  affected_module?: string;
}

export interface ToolExecutorOptions {
  onReportError?: (data: ErrorReportData) => Promise<boolean>;
}

const AGENT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file. Returns the full text content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path (e.g. /project/src/index.js)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file, creating it and any parent directories if they don't exist. Overwrites existing content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Full content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories at the given path. Returns entries with [dir] or [file] prefix and size info.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path (e.g. /project)" },
          recursive: { type: "boolean", description: "If true, list recursively (max 3 levels deep). Default false." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_directory",
      description: "Create a directory (and parents if needed).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path of the directory to create" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_path",
      description: "Delete a file or directory (recursively).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to delete" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rename",
      description: "Rename or move a file or directory.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Current path" },
          to: { type: "string", description: "New path" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stat",
      description: "Get file or directory metadata (size, type, modification time).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to stat" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the project directory. Use for npm install, running scripts, building, testing, or any CLI task. Returns stdout and stderr. Has a 30 second timeout.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The full shell command to run (e.g. 'npm install', 'node index.js', 'ls -la')" },
          cwd: { type: "string", description: "Working directory. Defaults to /project." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern across files in a directory. Returns matching lines with file paths and line numbers. Useful for finding usages, definitions, imports, etc.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
          path: { type: "string", description: "Directory to search in. Defaults to /project." },
          include: { type: "string", description: "File glob to include (e.g. '*.ts', '*.{js,jsx}'). Optional." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description: "Find files by name pattern. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Filename pattern to match (substring match, case-insensitive)" },
          path: { type: "string", description: "Directory to search in. Defaults to /project." },
        },
        required: ["pattern"],
      },
    },
  },
  // --- Error reporting ---
  {
    type: "function",
    function: {
      name: "report_error",
      description: "Report a suspected Nodepod runtime bug. Use this whenever an error looks like it could be caused by the browser-based Node.js runtime (missing API, incorrect polyfill behavior, crash, package import failure) rather than user code. The user can dismiss false positives — always err on the side of reporting.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short summary of the bug (e.g. 'fs.createReadStream missing highWaterMark option')" },
          description: { type: "string", description: "Detailed description of what went wrong, what was expected, and what actually happened" },
          code_snippet: { type: "string", description: "The code that triggered the bug" },
          error_message: { type: "string", description: "The exact error message or unexpected output" },
          affected_module: { type: "string", description: "The Node.js module or Nodepod component affected (e.g. 'fs', 'http', 'child_process')" },
        },
        required: ["title", "description", "error_message"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are an expert AI coding assistant embedded in wZed, a browser-based IDE powered by Nodepod (an in-browser Node.js runtime). You help users build, debug, and understand their projects.

## Environment
You are running inside Nodepod, a browser-based Node.js runtime. Nodepod uses an in-memory virtual filesystem and JavaScript-based polyfills of Node.js built-in modules (fs, http, path, crypto, child_process, etc.). Write normal Node.js code — most APIs work correctly. However, some APIs may be incomplete or have edge-case bugs because they are browser polyfills, not native C++ bindings.

## Capabilities
You have full access to the project's virtual filesystem and a shell terminal. You can:
- Read, write, create, rename, and delete files and directories
- Run any shell command (node, npm, npx, etc.)
- Search across files for patterns, find files by name
- Install npm packages, run scripts, start dev servers

## Guidelines
- The project root is /project. All file paths should be absolute.
- Before modifying code, read the relevant files to understand context.
- When writing files, always provide the complete file content.
- After making changes, run relevant commands to verify (e.g. type-check, tests, build).
- When installing packages, use \`npm install\`.
- Be concise. Show what you did and the result, don't over-explain.
- If a command might run forever (e.g. a dev server), mention that to the user — the 30s timeout will kill it.
- Use search_files and find_files to explore unfamiliar codebases instead of guessing file locations.

## Debugging in Nodepod
When something fails, think about what could cause this in a browser-based runtime. Common root causes:

- **ESM/CJS mismatch**: Nodepod converts ESM to CJS. If exports are empty, methods return undefined, or "class constructors must be invoked with 'new'" — the transform likely broke something.
- **Polyfill gaps**: A Node.js API exists but behaves slightly wrong (missing option, wrong return type).
- **Native bindings**: C++ addon packages (bcrypt, sharp, better-sqlite3, canvas) will never work. Suggest pure-JS alternatives.
- **Async/sync mismatch**: Code hangs or a Promise never resolves — the sync bridge can't unwrap native Promises.
- **Module resolution**: Package found but exports are wrong — resolver picked the wrong conditional export.
- **Missing globals**: \`__dirname\`, \`process.binding\`, etc. may be absent or stubbed.

## Quick Error Triage
When an error mentions a file path (e.g. "TypeError in /project/node_modules/foo/bar.js"), do a quick read_file on that file to glance at the relevant code. Don't analyze it deeply — just skim enough to identify if the issue is an ESM/CJS problem, a missing API, or something the user actually wrote wrong. Keep it brief: one read, a quick assessment, then report or move on. Do NOT go down a rabbit hole investigating node_modules internals.

## Reporting Runtime Bugs
Report errors liberally — not just crashes, but also warnings, unexpected behavior, or anything that seems "off" compared to real Node.js. ALWAYS call report_error FIRST, before attempting any workaround. Keep your message to the user short: say what failed and that you've reported it. Don't hedge with "I'm 60% sure it's X or maybe Y" — just report it and move on. After reporting, you may briefly suggest an alternative if one is obvious.`;

// --- Nodepod tool executor factory ---

/** Cached store import to avoid repeated dynamic imports */
let _nodepodStoreModule: typeof import("@/stores/nodepod-store") | null = null;
async function getNodepodStoreModule() {
  if (!_nodepodStoreModule) _nodepodStoreModule = await import("@/stores/nodepod-store");
  return _nodepodStoreModule;
}

/** Validate that a path is safe (absolute, no traversal) */
function validatePath(path: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return "Path must be absolute (start with /)";
  if (path.includes("..")) return "Path must not contain '..' traversal";
  return null;
}

export function createNodepodToolExecutor(nodepod: any, options?: ToolExecutorOptions): ToolExecutor {
  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {

      // --- Filesystem ---

      case "read_file": {
        const path = args.path as string;
        const pathErr = validatePath(path);
        if (pathErr) return `Error: ${pathErr}`;
        try {
          const content = await nodepod.fs.readFile(path, "utf-8");
          return typeof content === "string" ? content : "(empty file)";
        } catch (e: any) {
          return `Error reading ${path}: ${e.message || e}`;
        }
      }

      case "write_file": {
        const path = args.path as string;
        const pathErr = validatePath(path);
        if (pathErr) return `Error: ${pathErr}`;
        const content = args.content as string;
        try {
          const { writeWorkspaceFile } = await import("@/lib/workspace-repository");
          await writeWorkspaceFile(path, content);
          // Refresh the file tree in the workspace
          try {
            const { useNodepodStore } = await getNodepodStoreModule();
            await useNodepodStore.getState().refreshFileTree();
          } catch { /* ignore */ }
          return `Wrote ${content.length} chars to ${path}`;
        } catch (e: any) {
          return `Error writing ${path}: ${e.message || e}`;
        }
      }

      case "list_directory": {
        const path = args.path as string;
        const recursive = args.recursive as boolean ?? false;

        async function listDir(dir: string, depth: number): Promise<string[]> {
          const results: string[] = [];
          try {
            const entries = await nodepod.fs.readdir(dir);
            for (const entry of entries.sort()) {
              if (entry === "node_modules" || entry === ".cache" || entry === ".npm" || entry === ".git") continue;
              const fullPath = dir.endsWith("/") ? `${dir}${entry}` : `${dir}/${entry}`;
              try {
                const st = await nodepod.fs.stat(fullPath);
                const indent = "  ".repeat(depth);
                if (st.isDirectory) {
                  results.push(`${indent}[dir]  ${entry}/`);
                  if (recursive && depth < 3) {
                    results.push(...await listDir(fullPath, depth + 1));
                  }
                } else {
                  const size = st.size != null ? ` (${formatSize(st.size)})` : "";
                  results.push(`${indent}[file] ${entry}${size}`);
                }
              } catch {
                results.push(`${"  ".repeat(depth)}[?]    ${entry}`);
              }
            }
          } catch (e: any) {
            results.push(`Error: ${e.message || e}`);
          }
          return results;
        }

        const lines = await listDir(path, 0);
        return lines.join("\n") || "(empty directory)";
      }

      case "create_directory": {
        const path = args.path as string;
        try {
          await nodepod.fs.mkdir(path, { recursive: true });
          return `Created directory ${path}`;
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

      case "delete_path": {
        const path = args.path as string;
        try {
          const st = await nodepod.fs.stat(path);
          if (st.isDirectory) {
            await nodepod.fs.rmdir(path, { recursive: true });
          } else {
            await nodepod.fs.unlink(path);
          }
          try {
            const { useNodepodStore } = await getNodepodStoreModule();
            await useNodepodStore.getState().refreshFileTree();
          } catch { /* ignore */ }
          return `Deleted ${path}`;
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

      case "rename": {
        const from = args.from as string;
        const to = args.to as string;
        try {
          await nodepod.fs.rename(from, to);
          try {
            const { useNodepodStore } = await getNodepodStoreModule();
            await useNodepodStore.getState().refreshFileTree();
          } catch { /* ignore */ }
          return `Renamed ${from} → ${to}`;
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

      case "stat": {
        const path = args.path as string;
        try {
          const st = await nodepod.fs.stat(path);
          return JSON.stringify({
            type: st.isDirectory ? "directory" : "file",
            size: st.size,
            modified: st.mtimeMs ? new Date(st.mtimeMs).toISOString() : undefined,
          }, null, 2);
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

    
      case "run_command": {
        const command = args.command as string;
        const cwd = (args.cwd as string) || "/project";
        try {
          // Parse command into parts for spawn
          const parts = parseCommand(command);
          const cmd = parts[0];
          const cmdArgs = parts.slice(1);

          const proc = await nodepod.spawn(cmd, cmdArgs, { cwd });

          // Race against a 30 second timeout
          const timeout = new Promise<{ stdout: string; stderr: string; exitCode: number }>((_, reject) => {
            setTimeout(() => reject(new Error("Command timed out after 30 seconds")), 30000);
          });

          const result = await Promise.race([proc.completion, timeout]);

          let output = "";
          if (result.stdout) output += result.stdout;
          if (result.stderr) output += (output ? "\n" : "") + result.stderr;
          if (result.exitCode !== 0) {
            output += `\n[exit code: ${result.exitCode}]`;
          }

          // Refresh file tree after commands that might change files
          try {
            const { useNodepodStore } = await getNodepodStoreModule();
            await useNodepodStore.getState().refreshFileTree();
          } catch { /* ignore */ }

          return output || "(no output)";
        } catch (e: any) {
          return `Error running "${command}": ${e.message || e}`;
        }
      }

    
      case "search_files": {
        const pattern = args.pattern as string;
        const searchPath = (args.path as string) || "/project";
        const include = args.include as string | undefined;
        try {
          const results = await grepFiles(nodepod, searchPath, pattern, include);
          return results || "No matches found.";
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

      case "find_files": {
        const pattern = (args.pattern as string).toLowerCase();
        const searchPath = (args.path as string) || "/project";
        try {
          const matches = await findFilesByName(nodepod, searchPath, pattern);
          return matches.join("\n") || "No matching files found.";
        } catch (e: any) {
          return `Error: ${e.message || e}`;
        }
      }

      // --- Error reporting ---

      case "report_error": {
        const data: ErrorReportData = {
          title: args.title as string,
          description: args.description as string,
          code_snippet: args.code_snippet as string | undefined,
          error_message: args.error_message as string,
          affected_module: args.affected_module as string | undefined,
        };
        if (options?.onReportError) {
          const reported = await options.onReportError(data);
          return reported
            ? "The user has opened a GitHub issue to report this bug."
            : "The user chose not to report this bug at this time.";
        }
        return "Error reporting is not available.";
      }

      default:
        return `Unknown tool: ${name}`;
    }
  };
}

// --- Helpers ---

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Simple command string parser that handles basic quoting */
function parseCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === " " && !inSingle && !inDouble) {
      if (current) { parts.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Recursively grep files for a pattern */
async function grepFiles(
  nodepod: any,
  dir: string,
  pattern: string,
  include?: string,
  maxResults = 50,
): Promise<string> {
  const results: string[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gi");
  } catch {
    regex = new RegExp(escapeRegex(pattern), "gi");
  }

  const includeExts = include ? parseGlob(include) : null;

  async function walk(d: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = await nodepod.fs.readdir(d);
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry === "node_modules" || entry === ".cache" || entry === ".npm" || entry === ".git" || entry === "dist") continue;
        const full = d.endsWith("/") ? `${d}${entry}` : `${d}/${entry}`;
        try {
          const st = await nodepod.fs.stat(full);
          if (st.isDirectory) {
            await walk(full);
          } else {
            if (includeExts && !matchGlob(entry, includeExts)) continue;
            // Skip binary-looking files
            if (/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|svg|mp3|mp4|zip|tar|gz|lock)$/i.test(entry)) continue;
            try {
              const content = await nodepod.fs.readFile(full, "utf-8");
              if (typeof content !== "string") continue;
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) return;
                regex.lastIndex = 0;
                if (regex.test(lines[i])) {
                  results.push(`${full}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
                }
              }
            } catch { /* skip unreadable files */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  await walk(dir);
  if (results.length >= maxResults) {
    results.push(`\n... (truncated at ${maxResults} results)`);
  }
  return results.join("\n");
}

/** Recursively find files by name pattern */
async function findFilesByName(nodepod: any, dir: string, pattern: string, maxResults = 50): Promise<string[]> {
  const results: string[] = [];

  async function walk(d: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = await nodepod.fs.readdir(d);
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (entry === "node_modules" || entry === ".cache" || entry === ".npm" || entry === ".git") continue;
        const full = d.endsWith("/") ? `${d}${entry}` : `${d}/${entry}`;
        if (entry.toLowerCase().includes(pattern)) {
          results.push(full);
        }
        try {
          const st = await nodepod.fs.stat(full);
          if (st.isDirectory) await walk(full);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  await walk(dir);
  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a simple glob like "*.ts" or "*.{js,jsx}" into an array of extensions */
function parseGlob(glob: string): string[] {
  // Handle *.{ts,tsx} pattern
  const braceMatch = glob.match(/^\*\.\{(.+)\}$/);
  if (braceMatch) return braceMatch[1].split(",").map((e) => `.${e.trim()}`);
  // Handle *.ts pattern
  const extMatch = glob.match(/^\*(\..+)$/);
  if (extMatch) return [extMatch[1]];
  return [];
}

function matchGlob(filename: string, exts: string[]): boolean {
  return exts.some((ext) => filename.endsWith(ext));
}

// --- OpenRouter streaming agent ---

const MAX_AGENT_TURNS = 25;

export async function runAgentTurn(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  toolExecutor: ToolExecutor,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  _turnCount = 0,
): Promise<ChatMessage[]> {
  if (_turnCount >= MAX_AGENT_TURNS) {
    const limitMsg: ChatMessage = {
      role: "assistant",
      content: "I've reached the maximum number of tool-use turns (25). Please continue the conversation to proceed.",
    };
    callbacks.onComplete(limitMsg);
    return [...messages, limitMsg];
  }
  const allMessages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
    },
    body: JSON.stringify({
      model,
      messages: allMessages.map((m) => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        return msg;
      }),
      tools: AGENT_TOOLS,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  // Parse SSE stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let contentAccum = "";
  const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          contentAccum += delta.content;
          callbacks.onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccum[idx]) {
              toolCallAccum[idx] = { id: "", name: "", args: "" };
            }
            if (tc.id) toolCallAccum[idx].id = tc.id;
            if (tc.function?.name) toolCallAccum[idx].name += tc.function.name;
            if (tc.function?.arguments) toolCallAccum[idx].args += tc.function.arguments;
          }
        }
      } catch {
        /* skip malformed SSE chunk */
      }
    }
  }

  // Build final tool calls array
  const toolCalls: ToolCallInfo[] = [];
  for (const key of Object.keys(toolCallAccum).sort((a, b) => Number(a) - Number(b))) {
    const tc = toolCallAccum[Number(key)];
    if (tc.id && tc.name) {
      toolCalls.push({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.args },
      });
    }
  }

  // Create assistant message
  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: contentAccum,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
  callbacks.onComplete(assistantMsg);
  const newMessages = [...messages, assistantMsg];

  // If there are tool calls, execute them and loop
  if (toolCalls.length > 0) {
    const toolResults: ChatMessage[] = [];

    for (const tc of toolCalls) {
      callbacks.onToolCall(tc);
      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await toolExecutor(tc.function.name, args);
        callbacks.onToolResult(tc.id, tc.function.name, result);
        toolResults.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : "Unknown error";
        callbacks.onToolResult(tc.id, tc.function.name, `Error: ${errMsg}`);
        toolResults.push({
          role: "tool",
          content: `Error: ${errMsg}`,
          tool_call_id: tc.id,
        });
      }
    }

    // Recursive agentic loop — continue with tool results
    return runAgentTurn(
      apiKey,
      model,
      [...newMessages, ...toolResults],
      toolExecutor,
      callbacks,
      signal,
      _turnCount + 1,
    );
  }

  return newMessages;
}

// --- OpenRouter models ---

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
}

let _modelsCache: OpenRouterModel[] | null = null;
let _modelsFetchPromise: Promise<OpenRouterModel[]> | null = null;

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  if (_modelsCache) return _modelsCache;
  if (_modelsFetchPromise) return _modelsFetchPromise;

  _modelsFetchPromise = (async () => {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
    const json: unknown = await res.json();
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;
    const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
    const models: OpenRouterModel[] = data
      .filter(
        (model): model is Record<string, unknown> & { id: string; name: string } =>
          isRecord(model) &&
          typeof model.id === "string" &&
          typeof model.name === "string",
      )
      .map((model) => {
        const pricing = isRecord(model.pricing) ? model.pricing : {};
        return {
          id: model.id,
          name: model.name,
          context_length:
            typeof model.context_length === "number" ? model.context_length : 0,
          pricing: {
            prompt: typeof pricing.prompt === "string" ? pricing.prompt : "0",
            completion:
              typeof pricing.completion === "string" ? pricing.completion : "0",
          },
        };
      })
      .sort((a: OpenRouterModel, b: OpenRouterModel) => a.name.localeCompare(b.name));
    _modelsCache = models;
    _modelsFetchPromise = null;
    return models;
  })();

  return _modelsFetchPromise;
}

export function invalidateModelsCache() {
  _modelsCache = null;
  _modelsFetchPromise = null;
}
