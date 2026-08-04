"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import {
  FileTree as PierreFileTree,
  useFileTree,
  useFileTreeSearch,
} from "@pierre/trees/react";
import type {
  ContextMenuItem as PierreContextMenuItem,
  ContextMenuOpenContext,
  FileTreeDirectoryHandle,
  FileTreeDropResult,
} from "@pierre/trees";
import {
  toTreePath,
  toVfsPath,
  treeBasename,
  treeParentPath,
} from "@/lib/trees-paths";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRepositoryStatusStore } from "@/stores/repository-status-store";
import type { ContextMenuSection } from "./ui/ContextMenu";

interface PendingCreate {
  type: "file" | "folder";
  parentPath: string | null;
  sourcePath: string;
}

interface FileTreeProps {
  paths: readonly string[];
  onSearchOpenChange?: (isOpen: boolean) => void;
}

export interface FileTreeHandle {
  toggleSearch: () => void;
}

const TREE_CSS = `
  :host { color-scheme: inherit; }
  [data-file-tree-search-container][data-open='false'] { display: none; }
  button[data-type='item'] { border-radius: 0; }
  button[data-type='item']:hover { background: var(--hover); }
`;

const TREE_STYLE = {
  height: "100%",
  width: "100%",
  minHeight: 0,
  "--trees-bg-override": "transparent",
  "--trees-bg-muted-override": "var(--bg1)",
  "--trees-fg-override": "var(--text3)",
  "--trees-fg-muted-override": "var(--text4)",
  "--trees-selected-bg-override": "var(--hover)",
  "--trees-border-color-override": "var(--border)",
  "--trees-accent-override": "var(--accent)",
  "--trees-focus-ring-color-override": "var(--focus)",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "13px",
  "--trees-git-added-color-override": "var(--added)",
  "--trees-git-modified-color-override": "var(--modified)",
  "--trees-git-deleted-color-override": "var(--deleted)",
  "--trees-git-untracked-color-override": "var(--added)",
} as CSSProperties;

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function TreeContextMenu({
  sections,
  context,
}: {
  sections: ContextMenuSection[];
  context: ContextMenuOpenContext;
}) {
  const run = (action?: () => void) => {
    context.close({ restoreFocus: false });
    action?.();
  };

  return (
    <div
      data-file-tree-context-menu-root="true"
      role="menu"
      className="fixed z-[200] min-w-[220px] rounded-lg border border-scroll-thumb bg-bg3 p-1 text-[12px] shadow-xl shadow-black/50"
      style={{ left: context.anchorRect.left, top: context.anchorRect.bottom }}
    >
      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          {sectionIndex > 0 && <div role="separator" className="mx-2 my-1 h-px bg-scroll-thumb" />}
          {section.items.map((item, itemIndex) => (
            <button
              key={itemIndex}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => run(item.onClick)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-t3 outline-none hover:bg-selection hover:text-t1 focus-visible:bg-selection focus-visible:text-t1 disabled:text-t5"
            >
              <span>{item.label}</span>
              {item.shortcut && <span className="ml-6 font-mono text-[11px] text-t5">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { paths, onSearchOpenChange },
  ref,
) {
  const flatPaths = useMemo(() => [...paths], [paths]);
  const pathKey = flatPaths.join("\u0000");

  const openTab = useWorkspaceStore((state) => state.openTab);
  const setLeftPanel = useWorkspaceStore((state) => state.setLeftPanel);
  const setBottomPanel = useWorkspaceStore((state) => state.setBottomPanel);
  const renameFile = useWorkspaceStore((state) => state.renameFile);
  const moveNode = useWorkspaceStore((state) => state.moveNode);
  const createFile = useWorkspaceStore((state) => state.createFile);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const duplicateFile = useWorkspaceStore((state) => state.duplicateFile);
  const collapseCounter = useWorkspaceStore((state) => state.collapseCounter);
  const activeFilePath = useWorkspaceStore((state) =>
    state.panes[state.activePaneId]?.activeTab ?? "",
  );
  const gitStatuses = useRepositoryStatusStore((state) => state.treeStatuses);

  const openTabRef = useRef(openTab);
  const renameFileRef = useRef(renameFile);
  const moveNodeRef = useRef(moveNode);
  const createFileRef = useRef(createFile);
  const createFolderRef = useRef(createFolder);
  const pendingCreateRef = useRef<PendingCreate | null>(null);
  const syncingActiveSelectionRef = useRef(false);
  useEffect(() => { openTabRef.current = openTab; }, [openTab]);
  useEffect(() => { renameFileRef.current = renameFile; }, [renameFile]);
  useEffect(() => { moveNodeRef.current = moveNode; }, [moveNode]);
  useEffect(() => { createFileRef.current = createFile; }, [createFile]);
  useEffect(() => { createFolderRef.current = createFolder; }, [createFolder]);

  const { model } = useFileTree({
    paths: flatPaths,
    initialExpansion: 1,
    flattenEmptyDirectories: false,
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    itemHeight: 25,
    overscan: 12,
    stickyFolders: true,
    unsafeCSS: TREE_CSS,
    composition: {
      contextMenu: { enabled: true, triggerMode: "right-click" },
    },
    onSelectionChange: (selectedPaths) => {
      if (syncingActiveSelectionRef.current) return;
      if (selectedPaths.length !== 1) return;
      const item = modelRef.current?.getItem(selectedPaths[0]);
      if (item && !item.isDirectory()) openTabRef.current(toVfsPath(selectedPaths[0]));
    },
    renaming: {
      onRename: ({ sourcePath, destinationPath }) => {
        const pending = pendingCreateRef.current;
        if (pending && toTreePath(sourcePath, pending.type === "folder") === pending.sourcePath) {
          const name = treeBasename(destinationPath);
          if (pending.type === "file") createFileRef.current(name, pending.parentPath);
          else createFolderRef.current(name, pending.parentPath);
          pendingCreateRef.current = null;
          return;
        }
        renameFileRef.current(toVfsPath(sourcePath), treeBasename(destinationPath));
      },
      onError: (error) => {
        pendingCreateRef.current = null;
        console.error("Unable to rename tree item:", error);
      },
    },
    dragAndDrop: {
      canDrag: (draggedPaths) => draggedPaths.length === 1,
      onDropComplete: (event: FileTreeDropResult) => {
        const source = event.draggedPaths[0];
        if (!source) return;
        moveNodeRef.current(
          toVfsPath(source),
          event.target.directoryPath ? toVfsPath(event.target.directoryPath) : null,
        );
      },
      onDropError: (error) => console.error("Unable to move tree item:", error),
    },
  });
  const modelRef = useRef(model);
  modelRef.current = model;
  const search = useFileTreeSearch(model);

  useImperativeHandle(ref, () => ({
    toggleSearch: () => {
      if (model.isSearchOpen()) model.closeSearch();
      else model.openSearch();
    },
  }), [model]);

  useEffect(() => {
    onSearchOpenChange?.(search.isOpen);
  }, [onSearchOpenChange, search.isOpen]);

  useEffect(() => {
    model.resetPaths(flatPaths);
  }, [model, pathKey, flatPaths]);

  useEffect(() => {
    model.setGitStatus(gitStatuses);
  }, [model, gitStatuses]);

  useEffect(() => {
    if (!collapseCounter) return;
    for (const path of flatPaths) {
      if (!path.endsWith("/")) continue;
      const item = model.getItem(path);
      if (item?.isDirectory()) (item as FileTreeDirectoryHandle).collapse();
    }
  }, [model, collapseCounter, pathKey]);

  useEffect(() => {
    const treePath = toTreePath(activeFilePath);
    if (!treePath) return;
    const item = model.getItem(treePath);
    if (!item || item.isDirectory()) return;
    const selectedPaths = model.getSelectedPaths();
    if (selectedPaths.length === 1 && selectedPaths[0] === treePath) return;
    syncingActiveSelectionRef.current = true;
    for (const selectedPath of selectedPaths) model.getItem(selectedPath)?.deselect();
    item.select();
    model.scrollToPath(treePath, { focus: false, offset: "nearest" });
    syncingActiveSelectionRef.current = false;
  }, [model, activeFilePath, pathKey]);

  const collapseAll = useCallback(() => {
    for (const path of flatPaths) {
      if (!path.endsWith("/")) continue;
      const item = model.getItem(path);
      if (item?.isDirectory()) (item as FileTreeDirectoryHandle).collapse();
    }
  }, [model, pathKey]);

  const startCreate = useCallback((type: "file" | "folder", parentPath: string | null) => {
    const parentTreePath = parentPath ? toTreePath(parentPath, true) : "";
    let suffix = 1;
    let basename = "untitled";
    let sourcePath = `${parentTreePath}${basename}${type === "folder" ? "/" : ""}`;
    while (model.getItem(sourcePath)) {
      basename = `untitled-${++suffix}`;
      sourcePath = `${parentTreePath}${basename}${type === "folder" ? "/" : ""}`;
    }
    pendingCreateRef.current = { type, parentPath, sourcePath };
    model.add(sourcePath);
    model.startRenaming(sourcePath, { removeIfCanceled: true });
  }, [model]);

  const menuSections = useCallback((item: PierreContextMenuItem): ContextMenuSection[] => {
    const vfsPath = toVfsPath(item.path);
    const parentVfsPath = treeParentPath(item.path);
    const parent = parentVfsPath ? toVfsPath(parentVfsPath) : null;
    const isFile = item.kind === "file";
    const createParent = isFile ? parent : vfsPath;
    const sections: ContextMenuSection[] = [];

    if (isFile) sections.push({ items: [{ label: "Open", onClick: () => openTab(vfsPath) }] });
    sections.push({ items: [
      { label: "New File...", onClick: () => startCreate("file", createParent) },
      { label: "New Folder...", onClick: () => startCreate("folder", createParent) },
    ] });
    sections.push({ items: [
      ...(isFile ? [{ label: "Duplicate", onClick: () => duplicateFile(vfsPath) }] : []),
      { label: "Rename", shortcut: "F2", onClick: () => model.startRenaming(item.path) },
    ] });
    sections.push({ items: [
      { label: "Copy Name", onClick: () => copyToClipboard(item.name) },
      { label: "Copy Path", shortcut: "Alt-Shift-C", onClick: () => copyToClipboard(vfsPath) },
    ] });
    sections.push({ items: [
      { label: "Find in Folder", shortcut: "Alt-Shift-F", onClick: () => setLeftPanel("search") },
      { label: "Open in Terminal", onClick: () => setBottomPanel("terminal") },
    ] });
    if (!isFile) sections.push({ items: [{ label: "Collapse All", onClick: collapseAll }] });
    sections.push({ items: [{ label: "Delete", shortcut: "Del", onClick: () => deleteNode(vfsPath) }] });
    return sections;
  }, [collapseAll, deleteNode, duplicateFile, model, openTab, setBottomPanel, setLeftPanel, startCreate]);

  return (
    <div className="relative h-full min-h-0">
      <PierreFileTree
        model={model}
        style={TREE_STYLE}
        renderContextMenu={(item, context) => (
          <TreeContextMenu sections={menuSections(item)} context={context} />
        )}
      />
      {flatPaths.length === 0 && (
        <div className={`pointer-events-none absolute inset-x-0 ${search.isOpen ? "top-[34px]" : "top-0"} px-3 py-4 text-center text-xs text-t4`}>
          <p>No files yet. Open a project or use the terminal.</p>
          <div className="pointer-events-auto mt-2 flex justify-center gap-2">
            <button className="text-accent hover:underline" onClick={() => startCreate("file", null)}>New file</button>
            <button className="text-accent hover:underline" onClick={() => startCreate("folder", null)}>New folder</button>
          </div>
        </div>
      )}
    </div>
  );
});
