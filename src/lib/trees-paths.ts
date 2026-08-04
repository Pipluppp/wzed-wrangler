import { toProjectPath, toVfsPath } from "@/lib/workspace-repository";

export { toVfsPath };

/** Convert a Nodepod VFS path to the project-relative path Pierre Trees uses. */
export function toTreePath(path: string, directory = false): string {
  const withoutRoot = toProjectPath(path).replace(/\/+$/g, "");
  return directory && withoutRoot ? `${withoutRoot}/` : withoutRoot;
}

export function treeBasename(path: string): string {
  const normalized = path.replace(/\/$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function treeParentPath(path: string): string | null {
  const normalized = path.replace(/\/$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? null : normalized.slice(0, separator + 1);
}
