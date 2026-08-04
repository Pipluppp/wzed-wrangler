import { create } from "zustand";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { saveProjectSnapshot, loadProjectSnapshot } from "@/lib/snapshot-db";
import { getTemplateDefinition } from "@/templates";
import type { Nodepod, NodepodFS, Snapshot } from "@scelar/nodepod";
import { forgetWorkspaceWrites, reconcileOpenFilesFromVfs } from "@/lib/workspace-repository";
import { refreshRepositoryStatus, useRepositoryStatusStore } from "@/stores/repository-status-store";

type NodepodInstance = Nodepod;
type NodepodFSInstance = NodepodFS;

let _vfsWatcher: { close(): void } | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;
let _snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let _repositoryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let _lastTreeHash = "";

let _nodepodModuleCache: typeof import("@scelar/nodepod") | null = null;

let _vfsDirty = false;
let _cachedSnapshot: Snapshot | null = null;

function isPrivateRuntimePath(path: string): boolean {
  return [
    "/home/user/.wrangler",
    "/project/.wrangler",
    "/project/.wzed",
  ].some((root) => path === root || path.startsWith(`${root}/`));
}

function sanitizeSharedSnapshot(snapshot: Snapshot): Snapshot {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("entries" in snapshot) ||
    !Array.isArray(snapshot.entries)
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    entries: snapshot.entries.filter((entry) => !isPrivateRuntimePath(entry.path)),
  };
}

function getCurrentProjectId(): string | null {
  return useWorkspaceStore.getState().currentProject?.id ?? null;
}

interface NodepodState {
  instance: NodepodInstance | null;
  runtimeId: string | null;
  booting: boolean;
  hydratingTree: boolean;
  error: string | null;
  serverPorts: Map<number, string>;
  startupCommand: string | null;
  externalPreviewUrl: string | null;
  dirty: boolean;

  boot: (templateId?: string) => Promise<void>;
  teardown: () => void;
  refreshFileTree: () => Promise<void>;
  saveSnapshot: () => Promise<void>;
  restoreSnapshot: () => Promise<boolean>;
  getShareUrl: () => Promise<{ url: string } | { error: string } | null>;
  showExternalPreview: (url: string) => void;
}

async function vfsToProjectPaths(
  fs: NodepodFSInstance,
  dirPath: string,
  relativeParent = "",
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return [];
  }

  const folders: string[] = [];
  const files: string[] = [];
  for (const name of entries.sort()) {
    if (
      name === "node_modules" ||
      name === ".git" ||
      name === ".cache" ||
      name === ".npm" ||
      name === ".wzed" ||
      name === ".wrangler" ||
      name === ".wrangler-nodepod-log-before"
    )
      continue;
    const fullPath = dirPath.endsWith("/")
      ? `${dirPath}${name}`
      : `${dirPath}/${name}`;
    try {
      const stat = await fs.stat(fullPath);
      const relativePath = relativeParent ? `${relativeParent}/${name}` : name;
      if (stat.isDirectory) {
        folders.push(`${relativePath}/`);
        folders.push(...await vfsToProjectPaths(fs, fullPath, relativePath));
      } else {
        files.push(relativePath);
      }
    } catch { /* skip */ }
  }
  return [...folders, ...files];
}

async function publishProjectPaths(instance: NodepodInstance): Promise<string[]> {
  const paths = await vfsToProjectPaths(instance.fs, "/project");
  if (useNodepodStore.getState().instance !== instance) return [];

  const hash = paths.join("\n");
  if (hash !== _lastTreeHash) {
    _lastTreeHash = hash;
    useWorkspaceStore.getState().setProjectPaths(paths);
  }
  return paths;
}

function scheduleRepositoryRefresh(instance: NodepodInstance): void {
  if (_repositoryRefreshTimer) clearTimeout(_repositoryRefreshTimer);
  _repositoryRefreshTimer = setTimeout(() => {
    _repositoryRefreshTimer = null;
    if (useNodepodStore.getState().instance !== instance) return;

    // Neither task is required to display the explorer. Keep them off the
    // initial tree-loading path and coalesce VFS event bursts from npm/Git.
    void Promise.all([
      reconcileOpenFilesFromVfs(),
      refreshRepositoryStatus(instance),
    ]).catch((error) => {
      console.error("Failed to reconcile repository state:", error);
    });
  }, 250);
}

export const useNodepodStore = create<NodepodState>((set, get) => ({
  instance: null,
  runtimeId: null,
  booting: false,
  hydratingTree: false,
  error: null,
  serverPorts: new Map(),
  startupCommand: null,
  externalPreviewUrl: null,
  dirty: false,

  boot: async (templateId?: string) => {
    if (get().booting) return;
    const existing = get().instance;
    if (existing) {
      get().teardown();
    }

    set({
      booting: true,
      hydratingTree: true,
      error: null,
      instance: null,
      runtimeId: null,
      serverPorts: new Map(),
      startupCommand: null,
      externalPreviewUrl: null,
    });

    try {
      if (!_nodepodModuleCache)
        _nodepodModuleCache = await import("@scelar/nodepod");
      const Nodepod = _nodepodModuleCache.Nodepod;
      const cloudflareProxyUrl = new URL(
        "/api/cloudflare?url=",
        window.location.origin,
      ).toString();

      const template = getTemplateDefinition(templateId);
      const files = template.files;

      const instance = await Nodepod.boot({
        files,
        workdir: "/project",
        swUrl: "/__sw__.js",
        env: {
          CLOUDFLARE_API_BASE_URL: "https://api.cloudflare.com/client/v4",
          WZED_CLOUDFLARE_RELAY_URL: cloudflareProxyUrl,
        },
        allowedFetchDomains: ["api.cloudflare.com"],
        corsProxyUrl: cloudflareProxyUrl,
        corsProxyDomains: ["api.cloudflare.com"],
        onServerReady: (port: number, url: string) => {
          set((s) => {
            const newPorts = new Map(s.serverPorts);
            newPorts.set(port, url);
            return { serverPorts: newPorts };
          });
          const ws = useWorkspaceStore.getState();
          ws.openTab("tab:browser");
        },
      });

      set({
        instance,
        runtimeId: instance.instanceId,
        booting: false,
        startupCommand: template.startupCommand ?? null,
      });

      const projectId = getCurrentProjectId();
      if (projectId) {
        try {
          const snapshot = await loadProjectSnapshot(projectId);
          if (snapshot) {
            await instance.restore(snapshot);
          }
        } catch (e) {
          console.error("Failed to restore snapshot:", e);
        }
      }

      if (_vfsWatcher) {
        _vfsWatcher.close();
        _vfsWatcher = null;
      }
      _vfsWatcher = instance.fs.watch("/project", { recursive: true }, () => {
        _vfsDirty = true;
        if (!get().dirty) set({ dirty: true });
        if (_refreshTimer) clearTimeout(_refreshTimer);
        _refreshTimer = setTimeout(() => {
          _refreshTimer = null;
          get().refreshFileTree();
        }, 200);
        if (_snapshotTimer) clearTimeout(_snapshotTimer);
        _snapshotTimer = setTimeout(() => {
          _snapshotTimer = null;
          if (_vfsDirty) get().saveSnapshot();
        }, 30_000);
      });

      // Force the first VFS snapshot into the workspace even when the previous
      // model was also empty. Keep the tree in its loading state until Nodepod
      // has made template files visible, retrying briefly for browser/VFS
      // hydration that completes just after boot resolves.
      _lastTreeHash = "\0";
      const expectsProjectFiles = Object.keys(files).some((path) =>
        path === "/project" || path.startsWith("/project/"),
      );
      for (let attempt = 0; attempt < 4; attempt++) {
        const paths = await publishProjectPaths(instance);
        if (!expectsProjectFiles || paths.length > 0) break;
        // The watcher remains the long-tail fallback. Avoid sleeping after the
        // final probe and keep the active polling window short (350 ms total).
        if (attempt < 3) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
        }
      }
      scheduleRepositoryRefresh(instance);
      set({ hydratingTree: false });
    } catch (e: any) {
      set({
        error: e?.message || "Failed to boot nodepod",
        booting: false,
        hydratingTree: false,
      });
      console.error("Nodepod boot error:", e);
    }
  },

  teardown: () => {
    if (_vfsWatcher) {
      _vfsWatcher.close();
      _vfsWatcher = null;
    }
    if (_snapshotTimer) {
      clearTimeout(_snapshotTimer);
      _snapshotTimer = null;
    }
    if (_refreshTimer) {
      clearTimeout(_refreshTimer);
      _refreshTimer = null;
    }
    if (_repositoryRefreshTimer) {
      clearTimeout(_repositoryRefreshTimer);
      _repositoryRefreshTimer = null;
    }
    const instance = get().instance;
    if (instance) {
      try {
        instance.teardown();
      } catch {
        /* ignore */
      }
    }
    _vfsDirty = false;
    _cachedSnapshot = null;
    _lastTreeHash = "";
    forgetWorkspaceWrites();
    useRepositoryStatusStore.getState().clear();
    set({
      instance: null,
      runtimeId: null,
      serverPorts: new Map(),
      startupCommand: null,
      externalPreviewUrl: null,
      error: null,
      dirty: false,
      hydratingTree: false,
    });
  },

  refreshFileTree: async () => {
    const instance = get().instance;
    if (!instance) return;

    try {
      await publishProjectPaths(instance);
      scheduleRepositoryRefresh(instance);
    } catch (e) {
      console.error("Failed to refresh file tree:", e);
    }
  },

  saveSnapshot: async () => {
    const instance = get().instance;
    if (!instance) return;
    const projectId = getCurrentProjectId();
    if (!projectId) return;
    if (!_vfsDirty && _cachedSnapshot) {
      await saveProjectSnapshot(projectId, _cachedSnapshot);
      set({ dirty: false });
      return;
    }
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const snapshot = instance.snapshot();
      _cachedSnapshot = snapshot;
      _vfsDirty = false;
      set({ dirty: false });
      await saveProjectSnapshot(projectId, snapshot);
    } catch (e) {
      console.error("Failed to save snapshot:", e);
    }
  },

  restoreSnapshot: async () => {
    const instance = get().instance;
    if (!instance) return false;
    const projectId = getCurrentProjectId();
    if (!projectId) return false;
    try {
      const snapshot = await loadProjectSnapshot(projectId);
      if (!snapshot) return false;
      await instance.restore(snapshot);
      await get().refreshFileTree();
      return true;
    } catch (e) {
      console.error("Failed to restore snapshot:", e);
      return false;
    }
  },

  getShareUrl: async () => {
    const instance = get().instance;
    if (!instance) return null;
    const ws = useWorkspaceStore.getState();
    if (!ws.currentProject) return null;
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const snapshot = (!_vfsDirty && _cachedSnapshot)
        ? _cachedSnapshot
        : instance.snapshot();
      _cachedSnapshot = snapshot;
      _vfsDirty = false;
      const { createShareUrl } = await import("@/lib/share");
      return await createShareUrl(
        ws.currentProject.name,
        ws.currentProject.templateId || "blank",
        sanitizeSharedSnapshot(snapshot),
      );
    } catch (e) {
      console.error("Failed to create share URL:", e);
      return { error: "Failed to create share URL" };
    }
  },

  showExternalPreview: (url) => {
    set({ externalPreviewUrl: url });
    useWorkspaceStore.getState().openTab("tab:browser");
  },
}));
