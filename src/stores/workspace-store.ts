import { create } from "zustand";
import {
  type OpenFile,
  detectLanguage,
} from "@/lib/mock-data";
import { flushSettings } from "@/stores/settings-store";
import { flushKeybindings } from "@/stores/keymap-store";
import { TEMPLATE_DEFINITIONS, type DeploymentKind } from "@/templates";
import type { Snapshot } from "@scelar/nodepod";
import {
  flushAllWorkspaceWrites,
  flushWorkspaceBufferSnapshot,
  forgetWorkspaceWrites,
  queueWorkspaceWrite,
  readWorkspaceFile,
  saveWorkspaceFile,
  writeWorkspaceFile,
} from "@/lib/workspace-repository";

export type TabType = "file" | "keymap" | "browser" | "ai";

const SPECIAL_TAB_PREFIX = "tab:";

export function getTabType(tabId: string): TabType {
  if (tabId.startsWith(SPECIAL_TAB_PREFIX)) {
    const type = tabId.slice(SPECIAL_TAB_PREFIX.length);
    if (type === "keymap" || type === "browser" || type === "ai") return type;
  }
  return "file";
}

export function getTabLabel(tabId: string): string {
  switch (tabId) {
    case "tab:keymap": return "Keymap";
    case "tab:browser": return "Browser";
    case "tab:ai": return "AI Assistant";
    default: return tabId.split("/").pop() || tabId;
  }
}

export function isSpecialTab(tabId: string): boolean {
  return tabId.startsWith(SPECIAL_TAB_PREFIX);
}

const PROJECTS_KEY = "wzed-projects";
const PROJECT_LAYOUT_PREFIX = "wzed-layout-";

interface PersistedLayout {
  leftDock: { visible: boolean; width: number; activePanel: string };
  rightDock: { visible: boolean; width: number; activePanel: string };
  bottomDock: { visible: boolean; height: number; activePanel: string };
  openTabPaths: string[];

  activeTabPath: string;
}

function loadProjects(): ProjectInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

function saveProjects(projects: ProjectInfo[]) {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); } catch { /* ignore */ }
  }, 0);
}

function loadProjectLayout(projectId: string): PersistedLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROJECT_LAYOUT_PREFIX + projectId);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveProjectLayout(projectId: string, layout: PersistedLayout) {
  if (typeof window === "undefined") return;
  // deferred to not block the UI
  setTimeout(() => {
    try { localStorage.setItem(PROJECT_LAYOUT_PREFIX + projectId, JSON.stringify(layout)); } catch { /* ignore */ }
  }, 0);
}

// sync version for beforeunload (setTimeout won't fire there)
function saveProjectLayoutSync(projectId: string, layout: PersistedLayout) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PROJECT_LAYOUT_PREFIX + projectId, JSON.stringify(layout)); } catch { /* ignore */ }
}

export interface ProjectInfo {
  id: string;
  name: string;
  lastOpened: number;
  createdAt: number;
  templateId: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  startupCommand?: string;
  deploymentKind?: DeploymentKind;
}

export type DockPosition = "left" | "right" | "bottom";
export type PanelKind = "project" | "git" | "search" | "terminal" | "browser" | "ai";

export interface PaneState {
  id: string;
  tabs: string[];
  activeTab: string;
  tabHistory: string[];
  historyIndex: number;
}

export interface SplitNode {
  id: string;
  type: "leaf" | "row" | "column";
  paneId?: string;
  children?: SplitNode[];
  sizes?: number[];
}

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

let _nextId = Date.now();
function uid() { return `n${_nextId++}`; }
function puid() { return `pane-${_nextId++}`; }

let _bootGeneration = 0;

function findLeafByPaneId(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === "leaf" && node.paneId === paneId) return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findLeafByPaneId(c, paneId);
      if (found) return found;
    }
  }
  return null;
}

function collectPaneIds(node: SplitNode): string[] {
  if (node.type === "leaf" && node.paneId) return [node.paneId];
  if (node.children) return node.children.flatMap(collectPaneIds);
  return [];
}

function cleanupTree(node: SplitNode): SplitNode {
  if (node.type === "leaf") return node;
  if (!node.children || node.children.length === 0) return node;

  let children = node.children.map(cleanupTree);
  let sizes = node.sizes ? [...node.sizes] : children.map(() => 1000);

  const flatChildren: SplitNode[] = [];
  const flatSizes: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.type === node.type && c.children && c.children.length > 0) {
      const childTotal = (c.sizes || c.children.map(() => 1000)).reduce((a, b) => a + b, 0);
      const parentSize = sizes[i];
      for (let j = 0; j < c.children.length; j++) {
        flatChildren.push(c.children[j]);
        flatSizes.push(((c.sizes?.[j] ?? 1000) / childTotal) * parentSize);
      }
    } else {
      flatChildren.push(c);
      flatSizes.push(sizes[i]);
    }
  }

  if (flatChildren.length === 0) return { id: node.id, type: "leaf" };
  if (flatChildren.length === 1) return flatChildren[0];
  return { ...node, children: flatChildren, sizes: flatSizes };
}

function removeLeaf(root: SplitNode, paneId: string): SplitNode {
  if (root.type === "leaf") {
    if (root.paneId === paneId) return { id: root.id, type: "leaf" };
    return root;
  }
  if (!root.children) return root;
  const newChildren: SplitNode[] = [];
  const newSizes: number[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c.type === "leaf" && c.paneId === paneId) continue;
    newChildren.push(removeLeaf(c, paneId));
    newSizes.push(root.sizes?.[i] ?? 1000);
  }
  return cleanupTree({ ...root, children: newChildren, sizes: newSizes });
}

function insertAtLeaf(
  root: SplitNode,
  targetNodeId: string,
  newPaneId: string,
  zone: DropZone,
): SplitNode {
  if (root.id === targetNodeId && root.type === "leaf") {
    if (zone === "center") return root;
    const dir: "row" | "column" = (zone === "left" || zone === "right") ? "row" : "column";
    const newLeaf: SplitNode = { id: uid(), type: "leaf", paneId: newPaneId };
    const first = zone === "left" || zone === "top";
    return {
      id: uid(),
      type: dir,
      children: first ? [newLeaf, root] : [root, newLeaf],
      sizes: [1000, 1000],
    };
  }
  if (!root.children) return root;
  return cleanupTree({
    ...root,
    children: root.children.map(c => insertAtLeaf(c, targetNodeId, newPaneId, zone)),
    sizes: root.sizes,
  });
}

let _nodepodStoreCache: typeof import("@/stores/nodepod-store") | null = null;
async function getNodepod() {
  if (!_nodepodStoreCache) _nodepodStoreCache = await import("@/stores/nodepod-store");
  return _nodepodStoreCache.useNodepodStore.getState().instance;
}

async function refreshProjectIndex() {
  if (!_nodepodStoreCache) _nodepodStoreCache = await import("@/stores/nodepod-store");
  await _nodepodStoreCache.useNodepodStore.getState().refreshFileTree();
}

async function saveCurrentSnapshot(openFiles?: OpenFile[]) {
  if (openFiles) await flushWorkspaceBufferSnapshot(openFiles);
  else await flushAllWorkspaceWrites();
  if (!_nodepodStoreCache) _nodepodStoreCache = await import("@/stores/nodepod-store");
  await _nodepodStoreCache.useNodepodStore.getState().saveSnapshot();
}

function flushMountedEditorBuffers() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("wzed:editor-command", { detail: { command: "flush-all" } }),
  );
}

function pushHistory(pane: PaneState, filePath: string): Pick<PaneState, "tabHistory" | "historyIndex"> {
  if (pane.tabHistory[pane.historyIndex] === filePath) return pane;
  const tabHistory = [...pane.tabHistory.slice(0, pane.historyIndex + 1), filePath];
  return { tabHistory, historyIndex: tabHistory.length - 1 };
}

interface WorkspaceState {
  currentProject: ProjectInfo | null;
  projects: ProjectInfo[];
  templates: TemplateInfo[];
  showHomeScreen: boolean;
  homeSearch: string;
  pendingTemplateId: string | null;

  leftDock: { visible: boolean; width: number; activePanel: PanelKind };
  rightDock: { visible: boolean; width: number; activePanel: PanelKind };
  bottomDock: { visible: boolean; height: number; activePanel: PanelKind };

  panes: Record<string, PaneState>;
  activePaneId: string;
  splitLayout: SplitNode;
  openFiles: Record<string, OpenFile>;

  projectPaths: string[];

  paletteOpen: boolean;
  paletteInitialPrefix: string;
  themePickerOpen: boolean;
  settingsOpen: boolean;
  userMenuOpen: boolean;
  ctrlKMenuOpen: boolean;
  bugReportOpen: boolean;

  maximizedPaneId: string | null;
  bottomDockMaximized: boolean;
  collapseCounter: number;

  dragState: {
    dragging: boolean;
    fileName: string;
    sourcePaneId: string;
  } | null;

  openProject: (projectId: string) => void;
  openTemplate: (templateId: string) => void;
  goHome: () => void;
  setHomeSearch: (q: string) => void;
  toggleLeftDock: () => void;
  toggleRightDock: () => void;
  toggleBottomDock: () => void;
  resizeLeftDock: (delta: number) => void;
  resizeRightDock: (delta: number) => void;
  resizeBottomDock: (delta: number) => void;
  setLeftPanel: (p: PanelKind) => void;
  setRightPanel: (p: PanelKind) => void;
  setBottomPanel: (p: PanelKind) => void;
  openTab: (filePath: string, paneId?: string) => void;
  closeTab: (paneId: string, filePath: string) => void;
  setActiveTab: (paneId: string, filePath: string) => void;
  setActivePaneId: (id: string) => void;
  reorderTab: (paneId: string, from: number, to: number) => void;
  moveTabToPane: (filePath: string, fromPaneId: string, toPaneId: string) => void;
  splitPaneWith: (targetPaneId: string, zone: DropZone, filePath: string, sourcePaneId: string) => void;
  splitActivePane: (direction: "row" | "column") => void;
  closePane: (paneId: string) => void;
  resizeSplit: (parentNodeId: string, childIndex: number, delta: number) => void;
  startTabDrag: (filePath: string, paneId: string) => void;
  endTabDrag: () => void;
  toggleMaximizePane: (paneId: string) => void;
  toggleBottomDockMaximized: () => void;
  openPalette: (prefix?: string) => void;
  closePalette: () => void;
  toggleThemePicker: () => void;
  toggleSettings: () => void;
  toggleKeymapEditor: () => void;
  toggleUserMenu: () => void;
  toggleBugReport: () => void;
  navigateBack: (paneId: string) => void;
  navigateForward: (paneId: string) => void;
  closeOtherTabs: (paneId: string, filePath: string) => void;
  closeTabsToLeft: (paneId: string, filePath: string) => void;
  closeTabsToRight: (paneId: string, filePath: string) => void;
  closeAllTabs: (paneId: string) => void;
  revealInProjectPanel: (filePath: string) => void;
  renameFile: (oldPath: string, newName: string) => void;
  moveNode: (nodePath: string, targetFolderPath: string | null) => void;
  setProjectPaths: (paths: string[]) => void;
  updateFileContent: (filePath: string, content: string) => void;
  createFile: (name: string, parentPath: string | null) => void;
  createFolder: (name: string, parentPath: string | null) => void;
  deleteNode: (nodePath: string) => void;
  duplicateFile: (filePath: string) => void;
  collapseAll: () => void;
  resetEditorState: () => void;
  importFromShare: (name: string, templateId: string, snapshot: Snapshot) => void;
  deleteProject: (projectId: string) => void;
  renameProject: (projectId: string, newName: string) => void;
  hydrateProjects: () => void;
}

function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function remapWorkspacePaths(
  state: Pick<WorkspaceState, "openFiles" | "panes">,
  oldPrefix: string,
  newPrefix: string,
): Pick<WorkspaceState, "openFiles" | "panes"> {
  const openFiles = { ...state.openFiles };
  for (const path of Object.keys(openFiles)) {
    if (!isPathWithin(path, oldPrefix)) continue;
    const nextPath = `${newPrefix}${path.slice(oldPrefix.length)}`;
    const file = openFiles[path];
    delete openFiles[path];
    openFiles[nextPath] = {
      ...file,
      id: nextPath,
      path: nextPath,
      name: nextPath.split("/").at(-1) ?? file.name,
    };
  }

  const panes: Record<string, PaneState> = {};
  const remap = (path: string) => isPathWithin(path, oldPrefix)
    ? `${newPrefix}${path.slice(oldPrefix.length)}`
    : path;
  for (const [paneId, pane] of Object.entries(state.panes)) {
    panes[paneId] = {
      ...pane,
      tabs: pane.tabs.map(remap),
      activeTab: remap(pane.activeTab),
      tabHistory: pane.tabHistory.map(remap),
    };
  }
  return { openFiles, panes };
}

async function flushDirtyFilesWithin(pathPrefix: string): Promise<void> {
  const files = Object.values(useWorkspaceStore.getState().openFiles)
    .filter((file) => file.modified && isPathWithin(file.path, pathPrefix));
  await Promise.all(files.map((file) => saveWorkspaceFile(file.path)));
}

function removeWorkspacePaths(
  state: Pick<WorkspaceState, "openFiles" | "panes">,
  pathPrefix: string,
): Pick<WorkspaceState, "openFiles" | "panes"> {
  const openFiles = { ...state.openFiles };
  for (const path of Object.keys(openFiles)) {
    if (isPathWithin(path, pathPrefix)) delete openFiles[path];
  }
  const panes: Record<string, PaneState> = {};
  for (const [paneId, pane] of Object.entries(state.panes)) {
    const tabs = pane.tabs.filter((tab) => !isPathWithin(tab, pathPrefix));
    panes[paneId] = {
      ...pane,
      tabs,
      activeTab: isPathWithin(pane.activeTab, pathPrefix) ? tabs[0] ?? "" : pane.activeTab,
      tabHistory: pane.tabHistory.filter((tab) => !isPathWithin(tab, pathPrefix)),
    };
  }
  return { openFiles, panes };
}

const mainPaneId = "pane-1";

function uniqueProjectName(baseName: string, existing: ProjectInfo[]): string {
  const names = new Set(existing.map((p) => p.name));
  if (!names.has(baseName)) return baseName;
  let i = 2;
  while (names.has(`${baseName} #${i}`)) i++;
  return `${baseName} #${i}`;
}

// start empty, hydrate from localStorage on client mount
const INITIAL_PROJECTS: ProjectInfo[] = [];

const INITIAL_TEMPLATES: TemplateInfo[] = TEMPLATE_DEFINITIONS.map(
  ({ id, name, description, startupCommand, deploymentKind }) => ({
    id,
    name,
    description,
    startupCommand,
    deploymentKind,
  }),
);

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentProject: null,
  projects: INITIAL_PROJECTS,
  templates: INITIAL_TEMPLATES,
  showHomeScreen: true,
  homeSearch: "",
  pendingTemplateId: null,

  leftDock: { visible: true, width: 260, activePanel: "project" },
  rightDock: { visible: false, width: 500, activePanel: "ai" },
  bottomDock: { visible: true, height: 240, activePanel: "terminal" },
  panes: {
    [mainPaneId]: { id: mainPaneId, tabs: [], activeTab: "", tabHistory: [], historyIndex: 0 },
  },
  activePaneId: mainPaneId,
  splitLayout: { id: "root", type: "leaf", paneId: mainPaneId },
  openFiles: {},
  projectPaths: [],
  paletteOpen: false,
  paletteInitialPrefix: "",
  themePickerOpen: false,
  settingsOpen: false,
  userMenuOpen: false,
  ctrlKMenuOpen: false,
  bugReportOpen: false,
  maximizedPaneId: null,
  bottomDockMaximized: false,
  collapseCounter: 0,
  dragState: null,

  openProject: (projectId) => {
    flushMountedEditorBuffers();
    const s = get();
    const previousOpenFiles = Object.values(s.openFiles);
    const hadProject = s.currentProject && !s.showHomeScreen;
    if (hadProject) {
      const pane = s.panes[s.activePaneId];
      saveProjectLayout(s.currentProject!.id, {
        leftDock: s.leftDock,
        rightDock: s.rightDock,
        bottomDock: s.bottomDock,
        openTabPaths: pane?.tabs || [],
        activeTabPath: pane?.activeTab || "",
      });
    }
    const project = s.projects.find((p) => p.id === projectId);
    if (!project) return;
    const updatedProjects = s.projects.map((p) =>
      p.id === projectId ? { ...p, lastOpened: Date.now() } : p
    );
    saveProjects(updatedProjects);

    get().resetEditorState();

    const layout = loadProjectLayout(projectId);
    const updates: Partial<WorkspaceState> = {
      currentProject: { ...project, lastOpened: Date.now() },
      projects: updatedProjects,
      showHomeScreen: false,
      pendingTemplateId: project.templateId || "blank",
    };
    if (layout) {
      const VALID_PANELS: Set<string> = new Set(["project", "git", "search", "terminal", "browser", "ai"]);
      if (layout.leftDock && typeof layout.leftDock.visible === "boolean" && VALID_PANELS.has(layout.leftDock.activePanel)) {
        updates.leftDock = layout.leftDock as WorkspaceState["leftDock"];
      }
      if (layout.rightDock && typeof layout.rightDock.visible === "boolean" && VALID_PANELS.has(layout.rightDock.activePanel)) {
        updates.rightDock = layout.rightDock as WorkspaceState["rightDock"];
      }
      if (layout.bottomDock && typeof layout.bottomDock.visible === "boolean" && VALID_PANELS.has(layout.bottomDock.activePanel)) {
        updates.bottomDock = layout.bottomDock as WorkspaceState["bottomDock"];
      }
    }
    set(updates);

    const gen = ++_bootGeneration;
    (async () => {
      try {
        if (hadProject) await saveCurrentSnapshot(previousOpenFiles);
        const { useNodepodStore } = await import("@/stores/nodepod-store");
        useNodepodStore.getState().teardown();
        if (gen !== _bootGeneration) return;
        await useNodepodStore.getState().boot(project.templateId || "blank");
        if (layout?.openTabPaths?.length) {
          for (const tab of layout.openTabPaths) {
            get().openTab(tab);
          }
          if (layout.activeTabPath) {
            get().openTab(layout.activeTabPath);
          }
        }
      } catch (e) {
        console.error("Failed to reboot nodepod:", e);
      }
    })();
  },

  openTemplate: (templateId) => {
    flushMountedEditorBuffers();
    const s = get();
    const previousOpenFiles = Object.values(s.openFiles);
    const hadProject = s.currentProject && !s.showHomeScreen;
    if (hadProject) {
      const pane = s.panes[s.activePaneId];
      saveProjectLayout(s.currentProject!.id, {
        leftDock: s.leftDock,
        rightDock: s.rightDock,
        bottomDock: s.bottomDock,
        openTabPaths: pane?.tabs || [],
        activeTabPath: pane?.activeTab || "",
      });
    }
    const template = s.templates.find((t) => t.id === templateId);
    if (!template) return;
    const now = Date.now();
    const baseName = template.name === "Empty Project" ? "Untitled" : `${template.name} Project`;
    const newProject: ProjectInfo = {
      id: `${template.id}-${now}`,
      name: uniqueProjectName(baseName, s.projects),
      lastOpened: now,
      createdAt: now,
      templateId: template.id,
    };
    const updatedProjects = [newProject, ...s.projects];
    saveProjects(updatedProjects);

    get().resetEditorState();

    set({
      currentProject: newProject,
      projects: updatedProjects,
      showHomeScreen: false,
      pendingTemplateId: templateId,
    });

    if (template.startupCommand) {
      get().openTab("tab:browser");
    }

    const gen = ++_bootGeneration;
    (async () => {
      try {
        if (hadProject) await saveCurrentSnapshot(previousOpenFiles);
        const { useNodepodStore } = await import("@/stores/nodepod-store");
        useNodepodStore.getState().teardown();
        if (gen !== _bootGeneration) return;
        await useNodepodStore.getState().boot(templateId);
      } catch (e) {
        console.error("Failed to boot nodepod:", e);
      }
    })();
  },

  goHome: () => {
    const s = get();
    if (s.currentProject && !s.showHomeScreen) {
      const pane = s.panes[s.activePaneId];
      saveProjectLayout(s.currentProject.id, {
        leftDock: s.leftDock,
        rightDock: s.rightDock,
        bottomDock: s.bottomDock,
        openTabPaths: pane?.tabs || [],
        activeTabPath: pane?.activeTab || "",
      });
      saveCurrentSnapshot();
    }
    set({ showHomeScreen: true, homeSearch: "" });
  },

  setHomeSearch: (q) => set({ homeSearch: q }),

  toggleLeftDock: () => set((s) => ({ leftDock: { ...s.leftDock, visible: !s.leftDock.visible } })),
  toggleRightDock: () => set((s) => ({ rightDock: { ...s.rightDock, visible: !s.rightDock.visible } })),
  toggleBottomDock: () => set((s) => ({ bottomDock: { ...s.bottomDock, visible: !s.bottomDock.visible } })),

  resizeLeftDock: (delta) => set((s) => ({ leftDock: { ...s.leftDock, width: Math.max(180, Math.min(s.leftDock.width + delta, 600)) } })),
  resizeRightDock: (delta) => set((s) => ({ rightDock: { ...s.rightDock, width: Math.max(300, Math.min(s.rightDock.width - delta, 1200)) } })),
  resizeBottomDock: (delta) => set((s) => ({ bottomDock: { ...s.bottomDock, height: Math.max(100, Math.min(s.bottomDock.height - delta, 600)) } })),

  setLeftPanel: (p) => set((s) => ({ leftDock: { ...s.leftDock, activePanel: p, visible: true } })),
  setRightPanel: (p) => set((s) => ({ rightDock: { ...s.rightDock, activePanel: p, visible: true } })),
  setBottomPanel: (p) => set((s) => ({ bottomDock: { ...s.bottomDock, activePanel: p, visible: true } })),

  openTab: (filePath, paneId) => {
    const s = get();
    const targetId = paneId || s.activePaneId;
    const pane = s.panes[targetId];
    if (!pane) return;

    const hist = pushHistory(pane, filePath);
    if (pane.tabs.includes(filePath)) {
      set({ panes: { ...s.panes, [pane.id]: { ...pane, activeTab: filePath, ...hist } }, activePaneId: targetId });
    } else {
      set({ panes: { ...s.panes, [pane.id]: { ...pane, tabs: [...pane.tabs, filePath], activeTab: filePath, ...hist } }, activePaneId: targetId });
    }

    if (!isSpecialTab(filePath) && !s.openFiles[filePath]) {
      (async () => {
        try {
          const content = await readWorkspaceFile(filePath);
          const name = filePath.split("/").pop() || filePath;
          const language = detectLanguage(name);
          set((prev) => ({
            openFiles: { ...prev.openFiles, [filePath]: { id: filePath, name, path: filePath, language, content: typeof content === "string" ? content : "" } },
          }));
        } catch (e) {
          console.error("Failed to load file from VFS:", filePath, e);
        }
      })();
    }
  },

  closeTab: (paneId, filePath) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const newTabs = pane.tabs.filter((t) => t !== filePath);
      if (newTabs.length === 0) {
        const allPaneIds = collectPaneIds(s.splitLayout);
        if (allPaneIds.length <= 1) return { panes: { ...s.panes, [paneId]: { ...pane, tabs: [], activeTab: "" } } };
        const newLayout = cleanupTree(removeLeaf(s.splitLayout, paneId));
        const remaining = collectPaneIds(newLayout);
        const { [paneId]: _, ...restPanes } = s.panes;
        return { panes: restPanes, splitLayout: newLayout, activePaneId: remaining.includes(s.activePaneId) ? s.activePaneId : remaining[0] || mainPaneId };
      }
      const idx = pane.tabs.indexOf(filePath);
      const newActive = pane.activeTab === filePath ? newTabs[Math.min(idx, newTabs.length - 1)] || "" : pane.activeTab;
      return { panes: { ...s.panes, [paneId]: { ...pane, tabs: newTabs, activeTab: newActive } } };
    }),

  setActiveTab: (paneId, filePath) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const hist = pushHistory(pane, filePath);
      return { panes: { ...s.panes, [paneId]: { ...pane, activeTab: filePath, ...hist } }, activePaneId: paneId };
    }),

  setActivePaneId: (id) => set({ activePaneId: id }),

  reorderTab: (paneId, from, to) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const tabs = [...pane.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { panes: { ...s.panes, [paneId]: { ...pane, tabs } } };
    }),

  moveTabToPane: (filePath, fromPaneId, toPaneId) => {
    if (fromPaneId === toPaneId) return;
    const s = get();
    const fromPane = s.panes[fromPaneId];
    const toPane = s.panes[toPaneId];
    if (!fromPane || !toPane) return;
    const newFromTabs = fromPane.tabs.filter(t => t !== filePath);
    const newFromActive = fromPane.activeTab === filePath ? newFromTabs[Math.min(fromPane.tabs.indexOf(filePath), newFromTabs.length - 1)] || "" : fromPane.activeTab;
    const newToTabs = toPane.tabs.includes(filePath) ? toPane.tabs : [...toPane.tabs, filePath];
    const toHist = pushHistory(toPane, filePath);
    const newPanes: Record<string, PaneState> = {
      ...s.panes,
      [fromPaneId]: { ...fromPane, tabs: newFromTabs, activeTab: newFromActive },
      [toPaneId]: { ...toPane, tabs: newToTabs, activeTab: filePath, ...toHist },
    };
    let newLayout = s.splitLayout;
    if (newFromTabs.length === 0) {
      const allPaneIds = collectPaneIds(s.splitLayout);
      if (allPaneIds.length > 1) { newLayout = cleanupTree(removeLeaf(s.splitLayout, fromPaneId)); delete newPanes[fromPaneId]; }
    }
    set({ panes: newPanes, splitLayout: newLayout, activePaneId: toPaneId });
  },

  splitPaneWith: (targetPaneId, zone, filePath, sourcePaneId) => {
    const s = get();
    if (zone === "center") { get().moveTabToPane(filePath, sourcePaneId, targetPaneId); return; }
    const targetLeaf = findLeafByPaneId(s.splitLayout, targetPaneId);
    if (!targetLeaf) return;
    const newId = puid();
    const newPane: PaneState = { id: newId, tabs: [filePath], activeTab: filePath, tabHistory: [filePath], historyIndex: 0 };
    const newPanes: Record<string, PaneState> = { ...s.panes, [newId]: newPane };
    if (sourcePaneId !== targetPaneId) {
      const fromPane = s.panes[sourcePaneId];
      if (fromPane) {
        const newFromTabs = fromPane.tabs.filter(t => t !== filePath);
        const newFromActive = fromPane.activeTab === filePath ? newFromTabs[Math.min(fromPane.tabs.indexOf(filePath), newFromTabs.length - 1)] || "" : fromPane.activeTab;
        newPanes[sourcePaneId] = { ...fromPane, tabs: newFromTabs, activeTab: newFromActive };
      }
    }
    let newLayout = insertAtLeaf(s.splitLayout, targetLeaf.id, newId, zone);
    if (sourcePaneId !== targetPaneId) {
      const fromTabs = newPanes[sourcePaneId]?.tabs || [];
      if (fromTabs.length === 0 && collectPaneIds(newLayout).length > 1) { newLayout = cleanupTree(removeLeaf(newLayout, sourcePaneId)); delete newPanes[sourcePaneId]; }
    }
    set({ panes: newPanes, splitLayout: cleanupTree(newLayout), activePaneId: newId });
  },

  splitActivePane: (direction) => {
    const s = get();
    const currentPane = s.panes[s.activePaneId];
    if (!currentPane || !currentPane.activeTab) return;
    const targetLeaf = findLeafByPaneId(s.splitLayout, s.activePaneId);
    if (!targetLeaf) return;
    const newId = puid();
    const newPane: PaneState = { id: newId, tabs: [currentPane.activeTab], activeTab: currentPane.activeTab, tabHistory: [currentPane.activeTab], historyIndex: 0 };
    const zone: DropZone = direction === "row" ? "right" : "bottom";
    const newLayout = insertAtLeaf(s.splitLayout, targetLeaf.id, newId, zone);
    set({ panes: { ...s.panes, [newId]: newPane }, splitLayout: cleanupTree(newLayout), activePaneId: newId });
  },

  closePane: (paneId) =>
    set((s) => {
      const allPaneIds = collectPaneIds(s.splitLayout);
      if (allPaneIds.length <= 1) return s;
      const newLayout = cleanupTree(removeLeaf(s.splitLayout, paneId));
      const remaining = collectPaneIds(newLayout);
      const { [paneId]: _, ...restPanes } = s.panes;
      return { panes: restPanes, splitLayout: newLayout, activePaneId: remaining.includes(s.activePaneId) ? s.activePaneId : remaining[0] || mainPaneId, maximizedPaneId: s.maximizedPaneId === paneId ? null : s.maximizedPaneId };
    }),

  resizeSplit: (parentNodeId, childIndex, delta) =>
    set((s) => {
      const update = (node: SplitNode): SplitNode => {
        if (node.id === parentNodeId && node.children && node.sizes) {
          const sizes = [...node.sizes];
          const minSize = 50;
          const a = sizes[childIndex] + delta;
          const b = sizes[childIndex + 1] - delta;
          if (a >= minSize && b >= minSize) { sizes[childIndex] = a; sizes[childIndex + 1] = b; }
          return { ...node, sizes };
        }
        if (!node.children) return node;
        return { ...node, children: node.children.map(update) };
      };
      return { splitLayout: update(s.splitLayout) };
    }),

  startTabDrag: (filePath, paneId) => set({ dragState: { dragging: true, fileName: filePath, sourcePaneId: paneId } }),
  endTabDrag: () => set({ dragState: null }),

  toggleMaximizePane: (paneId) => set((s) => ({ maximizedPaneId: s.maximizedPaneId === paneId ? null : paneId })),
  toggleBottomDockMaximized: () => set((s) => ({ bottomDockMaximized: !s.bottomDockMaximized })),

  openPalette: (prefix = "") => set((s) => (s.paletteOpen ? { paletteOpen: false } : { paletteOpen: true, paletteInitialPrefix: prefix, themePickerOpen: false })),
  closePalette: () => set({ paletteOpen: false }),
  toggleThemePicker: () => set((s) => ({ themePickerOpen: !s.themePickerOpen, paletteOpen: false })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen, userMenuOpen: false })),
  toggleKeymapEditor: () => {
    const s = get();
    for (const [pid, pane] of Object.entries(s.panes)) {
      if (pane.tabs.includes("tab:keymap")) {
        get().closeTab(pid, "tab:keymap");
        set({ userMenuOpen: false });
        return;
      }
    }
    get().openTab("tab:keymap");
    set({ userMenuOpen: false });
  },
  toggleUserMenu: () => set((s) => ({ userMenuOpen: !s.userMenuOpen })),
  toggleBugReport: () => set((s) => ({ bugReportOpen: !s.bugReportOpen })),

  navigateBack: (paneId) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane || pane.historyIndex <= 0) return s;
      for (let i = pane.historyIndex - 1; i >= 0; i--) {
        if (pane.tabs.includes(pane.tabHistory[i])) return { panes: { ...s.panes, [paneId]: { ...pane, activeTab: pane.tabHistory[i], historyIndex: i } } };
      }
      return s;
    }),

  navigateForward: (paneId) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane || pane.historyIndex >= pane.tabHistory.length - 1) return s;
      for (let i = pane.historyIndex + 1; i < pane.tabHistory.length; i++) {
        if (pane.tabs.includes(pane.tabHistory[i])) return { panes: { ...s.panes, [paneId]: { ...pane, activeTab: pane.tabHistory[i], historyIndex: i } } };
      }
      return s;
    }),

  closeOtherTabs: (paneId, filePath) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      return { panes: { ...s.panes, [paneId]: { ...pane, tabs: [filePath], activeTab: filePath, tabHistory: [filePath], historyIndex: 0 } } };
    }),

  closeTabsToLeft: (paneId, filePath) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const idx = pane.tabs.indexOf(filePath);
      if (idx <= 0) return s;
      const newTabs = pane.tabs.slice(idx);
      return { panes: { ...s.panes, [paneId]: { ...pane, tabs: newTabs, activeTab: pane.activeTab && newTabs.includes(pane.activeTab) ? pane.activeTab : filePath } } };
    }),

  closeTabsToRight: (paneId, filePath) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const idx = pane.tabs.indexOf(filePath);
      if (idx < 0 || idx >= pane.tabs.length - 1) return s;
      const newTabs = pane.tabs.slice(0, idx + 1);
      return { panes: { ...s.panes, [paneId]: { ...pane, tabs: newTabs, activeTab: pane.activeTab && newTabs.includes(pane.activeTab) ? pane.activeTab : filePath } } };
    }),

  closeAllTabs: (paneId) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const allPaneIds = collectPaneIds(s.splitLayout);
      if (allPaneIds.length <= 1) return { panes: { ...s.panes, [paneId]: { ...pane, tabs: [], activeTab: "", tabHistory: [], historyIndex: 0 } } };
      const newLayout = cleanupTree(removeLeaf(s.splitLayout, paneId));
      const remaining = collectPaneIds(newLayout);
      const { [paneId]: _, ...restPanes } = s.panes;
      return { panes: restPanes, splitLayout: newLayout, activePaneId: remaining.includes(s.activePaneId) ? s.activePaneId : remaining[0] || mainPaneId };
    }),

  revealInProjectPanel: (_filePath) => set((s) => ({ leftDock: { ...s.leftDock, visible: true, activePanel: "project" } })),

  renameFile: (oldPath, newName) => {
    if (!newName || !oldPath) return;
    const oldName = oldPath.split("/").pop() || "";
    if (newName === oldName) return;
    const newPath = oldPath.slice(0, oldPath.lastIndexOf("/") + 1) + newName;
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod || await nodepod.fs.exists(newPath)) {
          set((state) => ({ projectPaths: [...state.projectPaths] }));
          return;
        }
        await flushDirtyFilesWithin(oldPath);
        await nodepod.fs.rename(oldPath, newPath);
        forgetWorkspaceWrites(oldPath);
        set((state) => remapWorkspacePaths(state, oldPath, newPath));
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to rename in VFS:", error);
        set((state) => ({ projectPaths: [...state.projectPaths] }));
      }
    })();
  },

  moveNode: (nodePath, targetFolderPath) => {
    if (!nodePath) return;
    const nodeName = nodePath.split("/").pop() || "";
    const destDir = targetFolderPath ?? "/project";
    const newNodePath = `${destDir}/${nodeName}`;
    if (nodePath === newNodePath || (targetFolderPath && isPathWithin(targetFolderPath, nodePath))) return;
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod || await nodepod.fs.exists(newNodePath)) {
          set((state) => ({ projectPaths: [...state.projectPaths] }));
          return;
        }
        await flushDirtyFilesWithin(nodePath);
        await nodepod.fs.rename(nodePath, newNodePath);
        forgetWorkspaceWrites(nodePath);
        set((state) => remapWorkspacePaths(state, nodePath, newNodePath));
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to move in VFS:", error);
        set((state) => ({ projectPaths: [...state.projectPaths] }));
      }
    })();
  },

  setProjectPaths: (paths) => set({ projectPaths: paths }),

  updateFileContent: (filePath, content) => {
    if (!get().openFiles[filePath]) return;
    set((s) => { const file = s.openFiles[filePath]; if (!file) return s; return { openFiles: { ...s.openFiles, [filePath]: { ...file, content, modified: true } } }; });
    queueWorkspaceWrite(filePath, content);
  },

  createFile: (name, parentPath) => {
    const dir = parentPath ?? "/project";
    const fullPath = `${dir}/${name}`;
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod || await nodepod.fs.exists(fullPath)) {
          set((state) => ({ projectPaths: [...state.projectPaths] }));
          return;
        }
        await writeWorkspaceFile(fullPath, "", { updateBuffer: false });
        const language = detectLanguage(name);
        set((state) => ({
          openFiles: {
            ...state.openFiles,
            [fullPath]: { id: fullPath, name, path: fullPath, language, content: "" },
          },
        }));
        get().openTab(fullPath);
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to create file in VFS:", error);
        set((state) => ({ projectPaths: [...state.projectPaths] }));
      }
    })();
  },

  createFolder: (name, parentPath) => {
    const dir = parentPath ?? "/project";
    const fullPath = `${dir}/${name}`;
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod || await nodepod.fs.exists(fullPath)) {
          set((state) => ({ projectPaths: [...state.projectPaths] }));
          return;
        }
        await nodepod.fs.mkdir(fullPath, { recursive: true });
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to create folder in VFS:", error);
        set((state) => ({ projectPaths: [...state.projectPaths] }));
      }
    })();
  },

  deleteNode: (nodePath) => {
    if (!nodePath) return;
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod) return;
        await flushDirtyFilesWithin(nodePath);
        const stat = await nodepod.fs.stat(nodePath);
        if (stat.isDirectory) await nodepod.fs.rmdir(nodePath, { recursive: true }); else await nodepod.fs.unlink(nodePath);
        forgetWorkspaceWrites(nodePath);
        set((state) => removeWorkspacePaths(state, nodePath));
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to delete from VFS:", error);
      }
    })();
  },

  duplicateFile: (filePath) => {
    if (!filePath) return;
    const parentDir = filePath.slice(0, filePath.lastIndexOf("/"));
    const fileName = filePath.split("/").pop() || "";
    const dotIdx = fileName.lastIndexOf(".");
    const baseName = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";
    void (async () => {
      try {
        const nodepod = await getNodepod();
        if (!nodepod) return;
        let newName = `${baseName} copy${ext}`;
        let newPath = `${parentDir}/${newName}`;
        let counter = 2;
        while (await nodepod.fs.exists(newPath)) {
          newName = `${baseName} copy ${counter++}${ext}`;
          newPath = `${parentDir}/${newName}`;
        }
        const content = get().openFiles[filePath]?.content ?? await nodepod.fs.readFile(filePath, "utf-8");
        await writeWorkspaceFile(newPath, content, { updateBuffer: false });
        const language = detectLanguage(newName);
        set((state) => ({
          openFiles: {
            ...state.openFiles,
            [newPath]: { id: newPath, name: newName, path: newPath, language, content },
          },
        }));
        get().openTab(newPath);
        await refreshProjectIndex();
      } catch (error) {
        console.error("Failed to duplicate file in VFS:", error);
      }
    })();
  },

  collapseAll: () => set((s) => ({ collapseCounter: s.collapseCounter + 1 })),

  resetEditorState: () => {
    set({
      panes: {
        [mainPaneId]: { id: mainPaneId, tabs: [], activeTab: "", tabHistory: [], historyIndex: 0 },
      },
      activePaneId: mainPaneId,
      splitLayout: { id: "root", type: "leaf", paneId: mainPaneId },
      openFiles: {},
      projectPaths: [],
      maximizedPaneId: null,
      bottomDockMaximized: false,
      dragState: null,
      paletteOpen: false,
      paletteInitialPrefix: "",
      themePickerOpen: false,
      settingsOpen: false,
      userMenuOpen: false,
      ctrlKMenuOpen: false,
      bugReportOpen: false,
    });
  },

  importFromShare: (name, templateId, snapshot) => {
    const s = get();
    const previousOpenFiles = Object.values(s.openFiles);
    const hadProject = s.currentProject && !s.showHomeScreen;
    if (hadProject) {
      const pane = s.panes[s.activePaneId];
      saveProjectLayout(s.currentProject!.id, {
        leftDock: s.leftDock,
        rightDock: s.rightDock,
        bottomDock: s.bottomDock,
        openTabPaths: pane?.tabs || [],
        activeTabPath: pane?.activeTab || "",
      });
    }

    const now = Date.now();
    const newProject: ProjectInfo = {
      id: `shared-${now}`,
      name: uniqueProjectName(name, s.projects),
      lastOpened: now,
      createdAt: now,
      templateId,
    };
    const updatedProjects = [newProject, ...s.projects];
    saveProjects(updatedProjects);

    get().resetEditorState();

    set({
      currentProject: newProject,
      projects: updatedProjects,
      showHomeScreen: false,
      pendingTemplateId: templateId,
    });

    const gen = ++_bootGeneration;
    (async () => {
      try {
        if (hadProject) await saveCurrentSnapshot(previousOpenFiles);
        const { useNodepodStore } = await import("@/stores/nodepod-store");
        useNodepodStore.getState().teardown();
        if (gen !== _bootGeneration) return;
        await useNodepodStore.getState().boot(templateId);
        const instance = useNodepodStore.getState().instance;
        if (instance && snapshot) {
          await instance.restore(snapshot);
          await useNodepodStore.getState().refreshFileTree();
        }
        await useNodepodStore.getState().saveSnapshot();
      } catch (e) {
        console.error("Failed to import shared project:", e);
      }
    })();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      window.history.replaceState({}, "", url.pathname);
    }
  },

  deleteProject: (projectId) => {
    const s = get();
    const updatedProjects = s.projects.filter((p) => p.id !== projectId);
    saveProjects(updatedProjects);
    if (typeof window !== "undefined") {
      try { localStorage.removeItem(PROJECT_LAYOUT_PREFIX + projectId); } catch { /* ignore */ }
    }
    (async () => {
      try {
        const { deleteProjectSnapshot } = await import("@/lib/snapshot-db");
        await deleteProjectSnapshot(projectId);
      } catch { /* ignore */ }
    })();
    set({ projects: updatedProjects });
  },

  renameProject: (projectId, newName) => {
    const s = get();
    if (!newName.trim()) return;
    const others = s.projects.filter((p) => p.id !== projectId);
    const finalName = uniqueProjectName(newName.trim(), others);
    const updatedProjects = s.projects.map((p) =>
      p.id === projectId ? { ...p, name: finalName } : p
    );
    saveProjects(updatedProjects);
    const updates: Partial<WorkspaceState> = { projects: updatedProjects };
    if (s.currentProject?.id === projectId) {
      updates.currentProject = { ...s.currentProject, name: newName.trim() };
    }
    set(updates);
  },

  hydrateProjects: () => {
    const stored = loadProjects();
    if (stored.length > 0) {
      // backfill for older projects that don't have these fields
      const migrated = stored.map((p) => ({
        ...p,
        createdAt: p.createdAt || p.lastOpened,
        templateId: p.templateId || "blank",
      }));
      set({ projects: migrated });
    }
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    const cur = useWorkspaceStore.getState();
    if (cur.currentProject && !cur.showHomeScreen) {
      const pane = cur.panes[cur.activePaneId];
      saveProjectLayoutSync(cur.currentProject.id, {
        leftDock: cur.leftDock,
        rightDock: cur.rightDock,
        bottomDock: cur.bottomDock,
        openTabPaths: pane?.tabs || [],
        activeTabPath: pane?.activeTab || "",
      });
    }
    try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(cur.projects)); } catch { /* ignore */ }
    flushSettings();
    flushKeybindings();
    saveCurrentSnapshot();
    e.preventDefault();
  });
}
