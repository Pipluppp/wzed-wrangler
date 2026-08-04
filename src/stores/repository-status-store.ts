import { create } from "zustand";
import type { GitStatus, GitStatusEntry } from "@pierre/trees";
import type { Nodepod } from "@scelar/nodepod";

export interface RepositoryChange {
  path: string;
  status: string;
  scope: "working" | "staged";
}

interface RepositoryStatusState {
  changes: RepositoryChange[];
  treeStatuses: GitStatusEntry[];
  setChanges: (changes: RepositoryChange[]) => void;
  clear: () => void;
}

function toTreeStatus(change: RepositoryChange): GitStatus {
  switch (change.status) {
    case "A": return "added";
    case "D": return "deleted";
    case "R": return "renamed";
    case "?": return "untracked";
    default: return "modified";
  }
}

function createTreeStatuses(changes: RepositoryChange[]): GitStatusEntry[] {
  const statusByPath = new Map<string, GitStatus>();
  for (const change of changes) {
    const next = toTreeStatus(change);
    const previous = statusByPath.get(change.path);
    // Prefer a working-tree state over the staged state for paths present in both.
    if (!previous || change.scope === "working") statusByPath.set(change.path, next);
  }
  return [...statusByPath].map(([path, status]) => ({ path, status }));
}

export const useRepositoryStatusStore = create<RepositoryStatusState>((set) => ({
  changes: [],
  treeStatuses: [],
  setChanges: (changes) => set({ changes, treeStatuses: createTreeStatuses(changes) }),
  clear: () => set({ changes: [], treeStatuses: [] }),
}));

function normalizeRepoPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\/project\//, "")
    .replace(/^\/+/, "");
}

async function getRepositoryChanges(instance: Nodepod): Promise<RepositoryChange[]> {
  const process = await instance.spawn("git", ["status", "--porcelain"], { cwd: "/project" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      process.completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Git status timed out")), 15_000);
      }),
    ]);
    if (result.exitCode !== 0) return [];

    const changes: RepositoryChange[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.length < 4) continue;
      const indexStatus = line[0];
      const workingStatus = line[1];
      const rawPath = line.slice(3).trim();
      const path = normalizeRepoPath(
        rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)! : rawPath,
      );
      if (!path) continue;
      if (indexStatus !== " " && indexStatus !== "?") {
        changes.push({ path, status: indexStatus, scope: "staged" });
      }
      if (workingStatus !== " " || indexStatus === "?") {
        changes.push({
          path,
          status: indexStatus === "?" ? "?" : workingStatus,
          scope: "working",
        });
      }
    }
    return changes;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function refreshRepositoryStatus(instance: Nodepod): Promise<RepositoryChange[]> {
  try {
    const changes = await getRepositoryChanges(instance);
    useRepositoryStatusStore.getState().setChanges(changes);
    return changes;
  } catch {
    useRepositoryStatusStore.getState().clear();
    return [];
  }
}
