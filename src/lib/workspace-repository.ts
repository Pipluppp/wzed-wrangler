import { useSettingsStore } from "@/stores/settings-store";

interface PendingWrite {
  revision: number;
  latestContent: string;
  timer: ReturnType<typeof setTimeout> | null;
  chain: Promise<void>;
}

interface WriteOptions {
  updateBuffer?: boolean;
  debounce?: boolean;
}

export function toProjectPath(path: string): string {
  return path.replace(/^\/project\/?/, "").replace(/^\/+/, "");
}

export function toVfsPath(path: string): string {
  const relative = toProjectPath(path).replace(/\/+$/g, "");
  return relative ? `/project/${relative}` : "/project";
}

const pendingWrites = new Map<string, PendingWrite>();

async function stores() {
  const [{ useNodepodStore }, { useWorkspaceStore }] = await Promise.all([
    import("@/stores/nodepod-store"),
    import("@/stores/workspace-store"),
  ]);
  return { nodepod: useNodepodStore, workspace: useWorkspaceStore };
}

function entryFor(path: string, content: string): PendingWrite {
  const existing = pendingWrites.get(path);
  if (existing) {
    existing.revision += 1;
    existing.latestContent = content;
    return existing;
  }
  const entry: PendingWrite = {
    revision: 1,
    latestContent: content,
    timer: null,
    chain: Promise.resolve(),
  };
  pendingWrites.set(path, entry);
  return entry;
}

async function commit(path: string, revision: number, content: string): Promise<void> {
  const { nodepod, workspace } = await stores();
  const instance = nodepod.getState().instance;
  if (!instance) throw new Error("Nodepod is not running");
  await instance.fs.writeFile(toVfsPath(path), content);

  const current = pendingWrites.get(path);
  const openFile = workspace.getState().openFiles[path];
  // An older write completing must never mark a newer edit as persisted.
  if (current?.revision === revision && openFile?.content === content) {
    workspace.setState((state) => {
      const file = state.openFiles[path];
      if (!file || file.content !== content) return state;
      return {
        openFiles: {
          ...state.openFiles,
          [path]: { ...file, modified: false },
        },
      };
    });
  }
}

function enqueue(path: string, entry: PendingWrite): Promise<void> {
  const revision = entry.revision;
  const content = entry.latestContent;
  entry.timer = null;
  entry.chain = entry.chain
    .catch(() => undefined)
    .then(() => commit(path, revision, content));
  return entry.chain;
}

export async function readWorkspaceFile(path: string): Promise<string> {
  const { nodepod } = await stores();
  const instance = nodepod.getState().instance;
  if (!instance) throw new Error("Nodepod is not running");
  const content = await instance.fs.readFile(toVfsPath(path), "utf-8");
  return typeof content === "string" ? content : "";
}

/** Queue the latest in-memory buffer for an autosave, if delay autosave is enabled. */
export function queueWorkspaceWrite(path: string, content: string): void {
  const entry = entryFor(path, content);
  if (entry.timer) clearTimeout(entry.timer);
  if (useSettingsStore.getState().settings.auto_save !== "afterDelay") return;
  const delay = 300;
  entry.timer = setTimeout(() => {
    enqueue(path, entry).catch((error) => {
      console.error("Failed to autosave file:", path, error);
    });
  }, delay);
}

/** Persist the current buffer immediately. Safe against an older queued write. */
export async function saveWorkspaceFile(path: string): Promise<void> {
  const { workspace } = await stores();
  const file = workspace.getState().openFiles[path];
  if (!file) return;
  const entry = entryFor(path, file.content);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  await enqueue(path, entry);
}

export async function saveAllWorkspaceFiles(): Promise<void> {
  const { workspace } = await stores();
  const dirty = Object.values(workspace.getState().openFiles).filter((file) => file.modified);
  await Promise.all(dirty.map((file) => saveWorkspaceFile(file.path)));
}

/** Flush all dirty buffers and wait for every per-file write queue to settle. */
export async function flushAllWorkspaceWrites(): Promise<void> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("wzed:editor-command", { detail: { command: "flush-all" } }),
    );
  }
  await saveAllWorkspaceFiles();
  await Promise.all([...pendingWrites.values()].map((entry) => entry.chain));
}

/** Persist a captured set of buffers after workspace UI state has already moved on. */
export async function flushWorkspaceBufferSnapshot(
  files: Array<{ path: string; content: string; modified?: boolean }>,
): Promise<void> {
  await Promise.all(files.filter((file) => file.modified).map(async (file) => {
    const entry = entryFor(file.path, file.content);
    if (entry.timer) clearTimeout(entry.timer);
    await enqueue(file.path, entry);
  }));
}

/**
 * Write content from non-editor producers (AI tools, imports, replacements) through
 * the same revision-safe queue and keep an already-open buffer in sync.
 */
export async function writeWorkspaceFile(
  path: string,
  content: string,
  options: WriteOptions = {},
): Promise<void> {
  const { workspace } = await stores();
  if (options.updateBuffer !== false) {
    const existing = workspace.getState().openFiles[path];
    if (existing) {
      workspace.setState((state) => ({
        openFiles: {
          ...state.openFiles,
          [path]: { ...state.openFiles[path], content, modified: true },
        },
      }));
    }
  }
  const entry = entryFor(path, content);
  if (entry.timer) clearTimeout(entry.timer);
  if (options.debounce) {
    const delay = 300;
    entry.timer = setTimeout(() => {
      enqueue(path, entry).catch((error) => {
        console.error("Failed to write file:", path, error);
      });
    }, delay);
    return;
  }
  await enqueue(path, entry);
}

/** Refresh clean open buffers after terminal/Git/external VFS changes. */
export async function reconcileOpenFilesFromVfs(): Promise<void> {
  const { nodepod, workspace } = await stores();
  const instance = nodepod.getState().instance;
  if (!instance) return;
  const snapshot = workspace.getState().openFiles;
  const updates: Record<string, string> = {};
  await Promise.all(Object.values(snapshot).map(async (file) => {
    if (file.modified) return; // Never silently clobber an unsaved editor buffer.
    try {
      const content = await instance.fs.readFile(file.path, "utf-8");
      if (typeof content === "string" && content !== file.content) updates[file.path] = content;
    } catch {
      // A removed file remains visible until the explorer/tab layer handles it.
    }
  }));
  if (!Object.keys(updates).length) return;
  workspace.setState((state) => {
    const openFiles = { ...state.openFiles };
    for (const [path, content] of Object.entries(updates)) {
      const current = openFiles[path];
      if (current && !current.modified) openFiles[path] = { ...current, content };
    }
    return { openFiles };
  });
}

export function forgetWorkspaceWrites(pathPrefix?: string): void {
  for (const [path, entry] of pendingWrites) {
    if (pathPrefix && path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) continue;
    if (entry.timer) clearTimeout(entry.timer);
    pendingWrites.delete(path);
  }
}
