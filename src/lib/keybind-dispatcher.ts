import { useKeymapStore, type KeyBinding } from "@/stores/keymap-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { saveAllWorkspaceFiles, saveWorkspaceFile } from "@/lib/workspace-repository";

export function eventToKeyString(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  let key = e.key;
  if (key === " ") key = "Space";
  else if (key === "ArrowUp") key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight") key = "Right";
  else if (key === "Escape") key = "Escape";
  else if (key === "Enter") key = "Enter";
  else if (key === "Backspace") key = "Backspace";
  else if (key === "Delete") key = "Delete";
  else if (key === "Tab") key = "Tab";
  else if (key === "`") key = "`";
  else if (key === ",") key = ",";
  else if (key === ".") key = ".";
  else if (key === "/") key = "/";
  else if (key === "[") key = "[";
  else if (key === "]") key = "]";
  else if (key === "\\") key = "\\";
  else if (key === "-") key = "-";
  else if (key === "=") key = "=";
  else if (key === "+") key = "+";
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("-");
}

let pendingChord: string | null = null;
let chordTimer: ReturnType<typeof setTimeout> | null = null;

function clearChord() {
  pendingChord = null;
  if (chordTimer) {
    clearTimeout(chordTimer);
    chordTimer = null;
  }
  if (useWorkspaceStore.getState().ctrlKMenuOpen) {
    useWorkspaceStore.setState({ ctrlKMenuOpen: false });
  }
}

function matchBinding(keyStr: string): KeyBinding | null {
  const bindings = useKeymapStore.getState().bindings;

  if (pendingChord) {
    const fullChord = `${pendingChord} ${keyStr}`;
    clearChord();
    const match = bindings.find((b) => b.keys === fullChord);
    if (match) return match;
  }

  const exactMatch = bindings.find((b) => b.keys === keyStr && !b.keys.includes(" "));
  if (exactMatch) return exactMatch;

  const isChordStart = bindings.some((b) => b.keys.startsWith(keyStr + " "));
  if (isChordStart) {
    pendingChord = keyStr;
    chordTimer = setTimeout(clearChord, 1500);
    return null;
  }

  return null;
}

export function executeAction(action: string): boolean {
  const ws = useWorkspaceStore.getState();
  const ss = useSettingsStore.getState();

  switch (action) {
    case "file: open":
      ws.openPalette("");
      return true;
    case "file: save": {
      window.dispatchEvent(
        new CustomEvent("wzed:editor-command", { detail: { command: "flush" } }),
      );
      const pane = ws.panes[ws.activePaneId];
      if (pane?.activeTab) {
        void saveWorkspaceFile(pane.activeTab).catch((error) => {
          console.error("Failed to save file:", pane.activeTab, error);
        });
      }
      return true;
    }
    case "file: save all":
      window.dispatchEvent(
        new CustomEvent("wzed:editor-command", { detail: { command: "flush-all" } }),
      );
      void saveAllWorkspaceFiles().catch((error) => {
        console.error("Failed to save files:", error);
      });
      return true;
    case "file: new file":
      ws.createFile("untitled", null);
      return true;

    case "view: command palette":
      ws.openPalette(">");
      return true;
    case "view: toggle sidebar":
      ws.toggleLeftDock();
      return true;
    case "view: toggle terminal":
    case "view: toggle bottom panel":
      ws.toggleBottomDock();
      return true;
    case "view: toggle right panel":
      ws.toggleRightDock();
      return true;
    case "view: toggle minimap":
      ss.set("minimap", !ss.settings.minimap);
      return true;
    case "view: zoom in":
      ss.set("ui_font_size", Math.min(ss.settings.ui_font_size + 1, 24));
      return true;
    case "view: zoom out":
      ss.set("ui_font_size", Math.max(ss.settings.ui_font_size - 1, 8));
      return true;
    case "view: reset zoom":
      ss.set("ui_font_size", 14);
      return true;
    case "view: maximize panel":
      ws.toggleBottomDockMaximized();
      return true;
    case "view: focus editor":
      return true;
    case "view: focus terminal":
      if (!ws.bottomDock.visible) ws.toggleBottomDock();
      return true;

    case "editor: close tab": {
      const pane = ws.panes[ws.activePaneId];
      if (pane?.activeTab) ws.closeTab(ws.activePaneId, pane.activeTab);
      return true;
    }
    case "editor: close all tabs":
      ws.closeAllTabs(ws.activePaneId);
      return true;
    case "editor: close other tabs": {
      const p = ws.panes[ws.activePaneId];
      if (p?.activeTab) ws.closeOtherTabs(ws.activePaneId, p.activeTab);
      return true;
    }
    case "editor: next tab": {
      const pane = ws.panes[ws.activePaneId];
      if (pane && pane.tabs.length > 1) {
        const idx = pane.tabs.indexOf(pane.activeTab);
        const nextIdx = (idx + 1) % pane.tabs.length;
        ws.setActiveTab(ws.activePaneId, pane.tabs[nextIdx]);
      }
      return true;
    }
    case "editor: previous tab": {
      const pane = ws.panes[ws.activePaneId];
      if (pane && pane.tabs.length > 1) {
        const idx = pane.tabs.indexOf(pane.activeTab);
        const prevIdx = (idx - 1 + pane.tabs.length) % pane.tabs.length;
        ws.setActiveTab(ws.activePaneId, pane.tabs[prevIdx]);
      }
      return true;
    }
    case "editor: split right":
      ws.splitActivePane("row");
      return true;
    case "editor: split down":
      ws.splitActivePane("column");
      return true;
    case "editor: close pane":
      ws.closePane(ws.activePaneId);
      return true;
    case "editor: maximize pane":
      ws.toggleMaximizePane(ws.activePaneId);
      return true;
    case "editor: go to tab 1":
    case "editor: go to tab 2":
    case "editor: go to tab 3":
    case "editor: go to tab 4":
    case "editor: go to tab 5":
    case "editor: go to tab 6":
    case "editor: go to tab 7":
    case "editor: go to tab 8": {
      const tabNum = parseInt(action.slice(-1)) - 1;
      const pane = ws.panes[ws.activePaneId];
      if (pane && tabNum < pane.tabs.length) {
        ws.setActiveTab(ws.activePaneId, pane.tabs[tabNum]);
      }
      return true;
    }
    case "editor: go to last tab": {
      const pane = ws.panes[ws.activePaneId];
      if (pane && pane.tabs.length > 0) {
        ws.setActiveTab(ws.activePaneId, pane.tabs[pane.tabs.length - 1]);
      }
      return true;
    }

    case "go: back": {
      ws.navigateBack(ws.activePaneId);
      return true;
    }
    case "go: forward": {
      ws.navigateForward(ws.activePaneId);
      return true;
    }
    case "go: line":
      return false;

    case "search: project search":
      ws.setLeftPanel("search");
      if (!ws.leftDock.visible) ws.toggleLeftDock();
      return true;

    case "theme: select theme":
      ws.toggleThemePicker();
      return true;
    case "settings: open":
      ws.toggleSettings();
      return true;
    case "settings: open keymap":
      ws.toggleKeymapEditor();
      return true;

    case "project: collapse all":
      ws.collapseAll();
      return true;
    case "project: reveal active file": {
      const pane = ws.panes[ws.activePaneId];
      if (pane?.activeTab) ws.revealInProjectPanel(pane.activeTab);
      return true;
    }
    case "project: focus":
      ws.setLeftPanel("project");
      if (!ws.leftDock.visible) ws.toggleLeftDock();
      return true;

    case "terminal: new terminal":
      if (!ws.bottomDock.visible) ws.toggleBottomDock();
      ws.setBottomPanel("terminal");
      return true;

    case "git: focus":
    case "git: commit":
    case "git: push":
    case "git: pull":
      ws.setLeftPanel("git");
      if (!ws.leftDock.visible) ws.toggleLeftDock();
      return true;

    case "view: open browser tab":
      ws.openTab("tab:browser");
      return true;
    case "view: open ai panel":
      ws.toggleRightDock();
      return true;

    case "go: home":
      ws.goHome();
      return true;

    // pass through to editor
    case "edit: undo":
    case "edit: redo":
    case "edit: find in file":
    case "edit: find and replace":
    case "edit: select all":
    case "edit: cut":
    case "edit: copy":
    case "edit: paste":
    case "editor: toggle comment":
    case "editor: indent line":
    case "editor: outdent line":
    case "editor: move line up":
    case "editor: move line down":
    case "editor: duplicate line":
    case "editor: delete line":
    case "editor: select all occurrences":
    case "editor: add cursor above":
    case "editor: add cursor below":
    case "search: go to symbol":
    case "go: definition":
    case "go: references":
      return false;

    default:
      return false;
  }
}

function isChordPending(): boolean {
  return pendingChord !== null;
}

export function handleKeybinding(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  ) {
    if (e.key !== "Escape" && !(e.ctrlKey || e.metaKey)) {
      return false;
    }
  }

  if (e.key === "Escape") {
    const ws = useWorkspaceStore.getState();
    if (ws.settingsOpen) { ws.toggleSettings(); return true; }
    if (ws.themePickerOpen) { ws.toggleThemePicker(); return true; }
    if (ws.userMenuOpen) { ws.toggleUserMenu(); return true; }
    if (ws.ctrlKMenuOpen) { useWorkspaceStore.setState({ ctrlKMenuOpen: false }); clearChord(); return true; }
    if (ws.paletteOpen) { ws.closePalette(); return true; }
    if (ws.maximizedPaneId) { ws.toggleMaximizePane(ws.maximizedPaneId); return true; }
    if (ws.bottomDockMaximized) { ws.toggleBottomDockMaximized(); return true; }
    return false;
  }

  const keyStr = eventToKeyString(e);
  if (!keyStr) return false;

  const binding = matchBinding(keyStr);

  if (!binding && isChordPending()) {
    if (pendingChord === "Ctrl-K") {
      if (chordTimer) { clearTimeout(chordTimer); chordTimer = null; }
      useWorkspaceStore.setState({ ctrlKMenuOpen: true });
    }
    return true;
  }

  if (!binding) return false;

  const handled = executeAction(binding.action);
  return handled;
}
