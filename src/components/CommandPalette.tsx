"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { cn } from "@/lib/cn";
import { COMMANDS, type FileNode } from "@/lib/mock-data";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { executeAction } from "@/lib/keybind-dispatcher";
import { useShallow } from "zustand/react/shallow";
import { FileIcon } from "./ui/FileIcon";
import { recordUsage, getRecencyBoost } from "@/lib/palette-history";
import {
  Clock, FileText, Settings, Terminal, GitBranch, Search, Eye,
  FolderTree, ArrowRight,
  SplitSquareHorizontal, Type, Hash,
} from "lucide-react";

// maps command palette ids to keybind-dispatcher action strings
const CMD_TO_ACTION: Record<string, string> = {
  "file.open": "file: open",
  "file.save": "file: save",
  "file.save-all": "file: save all",
  "file.new": "file: new file",
  "search.project": "search: project search",
  "editor.split-right": "editor: split right",
  "editor.split-down": "editor: split down",
  "editor.close-tab": "editor: close tab",
  "editor.close-all": "editor: close all tabs",
  "editor.maximize": "editor: maximize pane",
  "view.toggle-terminal": "view: toggle terminal",
  "view.toggle-sidebar": "view: toggle sidebar",
  "view.toggle-git": "git: focus",
  "view.toggle-minimap": "view: toggle minimap",
  "view.zoom-in": "view: zoom in",
  "view.zoom-out": "view: zoom out",
  "view.zoom-reset": "view: reset zoom",
  "view.maximize-panel": "view: maximize panel",
  "view.keymap": "settings: open keymap",
  "view.browser-tab": "view: open browser tab",
  "view.ai-panel": "view: open ai panel",
  "theme.select": "theme: select theme",
  "settings.open": "settings: open",
  "terminal.new": "terminal: new terminal",
  "git.commit": "git: commit",
  "git.push": "git: push",
  "git.pull": "git: pull",
  "project.reveal": "project: reveal active file",
  "project.collapse": "project: collapse all",
  "go.home": "go: home",
  "go.back": "go: back",
  "go.forward": "go: forward",
};

const EDITOR_SHORTCUTS: Record<string, { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }> = {
  "edit.undo": { key: "z", ctrl: true },
  "edit.redo": { key: "z", ctrl: true, shift: true },
  "edit.find": { key: "f", ctrl: true },
  "edit.replace": { key: "h", ctrl: true },
  "go.definition": { key: "F12" },
  "go.references": { key: "F12", shift: true },
  "go.line": { key: "g", ctrl: true },
  "search.symbol": { key: "t", ctrl: true },
};

function triggerEditorShortcut(opts: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }) {
  setTimeout(() => {
    const ta = document.querySelector(".monaco-editor textarea") as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      setTimeout(() => {
        ta.dispatchEvent(new KeyboardEvent("keydown", {
          key: opts.key,
          code: opts.key.length === 1 ? `Key${opts.key.toUpperCase()}` : opts.key,
          ctrlKey: opts.ctrl ?? false,
          shiftKey: opts.shift ?? false,
          altKey: opts.alt ?? false,
          bubbles: true,
          cancelable: true,
        }));
      }, 16);
    }
  }, 60);
}

// --- fuzzy matching ---

interface MatchResult {
  match: boolean;
  score: number;
  indices: number[];
}

function fuzzyMatch(query: string, text: string): MatchResult {
  if (!query) return { match: true, score: 0, indices: [] };
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  const indices: number[] = [];
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      score += 1 + consecutive;
      if (i === 0 || text[i - 1] === " " || text[i - 1] === ":" || text[i - 1] === "/" || text[i - 1] === ".") score += 5;
      consecutive++;
      indices.push(i);
      qi++;
    } else {
      consecutive = 0;
    }
  }
  return { match: qi === q.length, score, indices };
}

function bestKeywordMatch(query: string, keywords: string[]): MatchResult {
  let best: MatchResult = { match: false, score: 0, indices: [] };
  for (const kw of keywords) {
    const result = fuzzyMatch(query, kw);
    if (result.match && result.score > best.score) best = result;
  }
  return best;
}

// --- highlighted text rendering ---

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const parts: { text: string; highlight: boolean }[] = [];
  let current = "";
  let isHighlight = false;
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== isHighlight && current) {
      parts.push({ text: current, highlight: isHighlight });
      current = "";
    }
    current += text[i];
    isHighlight = h;
  }
  if (current) parts.push({ text: current, highlight: isHighlight });
  return (
    <>
      {parts.map((p, i) =>
        p.highlight ? <span key={i} className="text-accent font-medium">{p.text}</span> : <span key={i}>{p.text}</span>
      )}
    </>
  );
}

// --- category icons ---

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  File: <FileText size={14} />,
  Edit: <Type size={14} />,
  Search: <Search size={14} />,
  Editor: <SplitSquareHorizontal size={14} />,
  View: <Eye size={14} />,
  Go: <ArrowRight size={14} />,
  Terminal: <Terminal size={14} />,
  Git: <GitBranch size={14} />,
  Project: <FolderTree size={14} />,
  Preferences: <Settings size={14} />,
};

// --- mode detection ---

type PaletteMode = "file" | "command" | "symbol" | "goto-line";

function detectMode(raw: string): { mode: PaletteMode; query: string } {
  if (raw.startsWith(">")) return { mode: "command", query: raw.slice(1).trimStart() };
  if (raw.startsWith("@")) return { mode: "symbol", query: raw.slice(1) };
  if (raw.startsWith(":")) return { mode: "goto-line", query: raw.slice(1) };
  return { mode: "file", query: raw };
}

// --- file helpers ---

function flattenFiles(nodes: FileNode[], parentPath = ""): { name: string; dir: string; path: string }[] {
  const result: { name: string; dir: string; path: string }[] = [];
  for (const node of nodes) {
    const relPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === "file") {
      result.push({ name: node.name, dir: parentPath ? `${parentPath}/` : "", path: node.path || `/project/${relPath}` });
    }
    if (node.children) {
      result.push(...flattenFiles(node.children, relPath));
    }
  }
  return result;
}

// --- scored item types ---

interface ScoredCommand {
  kind: "command";
  id: string;
  label: string;
  shortcut?: string;
  category: string;
  description?: string;
  score: number;
  indices: number[];
}

interface ScoredFile {
  kind: "file";
  id: string;
  name: string;
  dir: string;
  path: string;
  recent: boolean;
  score: number;
  indices: number[];
}

interface GotoLineItem {
  kind: "goto-line";
  id: string;
  label: string;
  lineNumber: number;
}

type ScoredItem = ScoredCommand | ScoredFile | GotoLineItem;

interface PaletteGroup {
  id: string;
  label: string;
  items: ScoredItem[];
}

// --- command scoring ---

function scoreCommands(query: string): ScoredCommand[] {
  const results: ScoredCommand[] = [];
  for (const cmd of COMMANDS) {
    const labelResult = fuzzyMatch(query, cmd.label);
    const keywordResult = cmd.keywords ? bestKeywordMatch(query, cmd.keywords) : { match: false, score: 0, indices: [] };
    const descResult = cmd.description ? fuzzyMatch(query, cmd.description) : { match: false, score: 0, indices: [] };

    const matched = labelResult.match || keywordResult.match || descResult.match;
    if (!matched && query) continue;

    const score = (labelResult.score * 10) + (keywordResult.score * 5) + (descResult.score) + getRecencyBoost(`cmd:${cmd.id}`);

    results.push({
      kind: "command",
      id: cmd.id,
      label: cmd.label,
      shortcut: cmd.shortcut,
      category: cmd.category || "Other",
      description: cmd.description,
      score,
      indices: labelResult.indices,
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

// --- group commands by category ---

function groupCommands(commands: ScoredCommand[]): PaletteGroup[] {
  const byCategory = new Map<string, ScoredCommand[]>();
  for (const cmd of commands) {
    const cat = cmd.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(cmd);
  }
  return Array.from(byCategory.entries()).map(([label, items]) => ({
    id: `cat-${label.toLowerCase().replace(/\s+/g, "-")}`,
    label,
    items,
  }));
}

// --- score files ---

function scoreFiles(query: string, allFiles: { name: string; dir: string; path: string }[], recentPaths: Set<string>): ScoredFile[] {
  if (!query) {
    const recent = allFiles.filter((f) => recentPaths.has(f.path));
    const others = allFiles.filter((f) => !recentPaths.has(f.path));
    return [...recent, ...others].map((f) => ({
      kind: "file",
      id: f.path,
      name: f.name,
      dir: f.dir,
      path: f.path,
      recent: recentPaths.has(f.path),
      score: recentPaths.has(f.path) ? 1000 : 0,
      indices: [],
    }));
  }
  return allFiles
    .map((f) => {
      const nameResult = fuzzyMatch(query, f.name);
      const pathResult = fuzzyMatch(query, f.dir + f.name);
      const matched = nameResult.match || pathResult.match;
      if (!matched) return null;
      const score = (nameResult.score * 10) + pathResult.score + getRecencyBoost(`file:${f.path}`) + (recentPaths.has(f.path) ? 20 : 0);
      return {
        kind: "file" as const,
        id: f.path,
        name: f.name,
        dir: f.dir,
        path: f.path,
        recent: recentPaths.has(f.path),
        score,
        indices: nameResult.indices,
      };
    })
    .filter((f): f is ScoredFile => f !== null)
    .sort((a, b) => b.score - a.score);
}

function groupFiles(files: ScoredFile[], query: string): PaletteGroup[] {
  if (query) return [{ id: "results", label: "", items: files }];
  const recent = files.filter((f) => f.recent);
  const others = files.filter((f) => !f.recent);
  const groups: PaletteGroup[] = [];
  if (recent.length) groups.push({ id: "recent", label: "Recent", items: recent });
  if (others.length) groups.push({ id: "files", label: "Files", items: others });
  return groups;
}

// --- shortcut badge ---

function ShortcutBadge({ shortcut }: { shortcut: string }) {
  const parts = shortcut.split("+").map((p) => p.trim());
  return (
    <span className="flex items-center gap-0.5 ml-4 shrink-0">
      {parts.map((p, i) => (
        <kbd key={i} className="text-[11px] font-mono text-t4 bg-bg1 rounded px-1.5 py-0.5">
          {p}
        </kbd>
      ))}
    </span>
  );
}

// --- mode label ---

function ModeIndicator({ mode }: { mode: PaletteMode }) {
  switch (mode) {
    case "command": return <span className="text-accent mr-2 text-sm font-medium select-none" aria-hidden>{">"}</span>;
    case "symbol": return <span className="text-accent mr-2 text-sm font-medium select-none" aria-hidden>@</span>;
    case "goto-line": return <span className="text-accent mr-2 text-sm font-medium select-none" aria-hidden>:</span>;
    default: return null;
  }
}

function getPlaceholder(mode: PaletteMode): string {
  switch (mode) {
    case "command": return "Type a command...";
    case "file": return "Search files by name (type > for commands)...";
    case "symbol": return "Go to symbol in editor...";
    case "goto-line": return "Type a line number...";
  }
}

// --- main palette component ---

export function CommandPalette() {
  const paletteOpen = useWorkspaceStore((s) => s.paletteOpen);
  const paletteInitialPrefix = useWorkspaceStore((s) => s.paletteInitialPrefix);
  const closePalette = useWorkspaceStore((s) => s.closePalette);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const openFilePaths = useWorkspaceStore(useShallow((s) => Object.keys(s.openFiles)));
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);

  const [rawInput, setRawInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { mode, query } = useMemo(() => detectMode(rawInput), [rawInput]);

  const allProjectFiles = useMemo(() => flattenFiles(projectFiles), [projectFiles]);
  const recentPaths = useMemo(() => new Set(openFilePaths), [openFilePaths]);

  // build groups based on mode
  const groups = useMemo((): PaletteGroup[] => {
    switch (mode) {
      case "command":
        return groupCommands(scoreCommands(query));
      case "file":
        return groupFiles(scoreFiles(query, allProjectFiles, recentPaths), query);
      case "goto-line": {
        const n = parseInt(query, 10);
        if (n > 0) {
          return [{ id: "goto", label: "", items: [{ kind: "goto-line", id: "goto-line", label: `Go to line ${n}`, lineNumber: n }] }];
        }
        return [];
      }
      case "symbol":
        return [];
    }
  }, [mode, query, allProjectFiles, recentPaths]);

  // flat list of all selectable items for keyboard nav
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // reset on open
  useEffect(() => {
    if (paletteOpen) {
      setRawInput(paletteInitialPrefix);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [paletteOpen, paletteInitialPrefix]);

  // reset selection on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [rawInput]);

  // scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-idx="${selectedIndex}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeItem = useCallback((item: ScoredItem) => {
    closePalette();

    if (item.kind === "command") {
      recordUsage(`cmd:${item.id}`);

      const action = CMD_TO_ACTION[item.id];
      if (action) {
        executeAction(action);
        return;
      }

      const shortcut = EDITOR_SHORTCUTS[item.id];
      if (shortcut) {
        triggerEditorShortcut(shortcut);
        return;
      }

      if (item.id === "view.toggle-ai") {
        useWorkspaceStore.getState().toggleRightDock();
      }
    } else if (item.kind === "file") {
      recordUsage(`file:${item.path}`);
      openTab(item.path);
    } else if (item.kind === "goto-line") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).monaco as { editor?: { getEditors?: () => Array<{ setPosition: (p: { lineNumber: number; column: number }) => void; revealLineInCenter: (n: number) => void; focus: () => void }> } } | undefined;
      const editors = editor?.editor?.getEditors?.();
      if (editors?.[0]) {
        const ed = editors[0];
        ed.setPosition({ lineNumber: item.lineNumber, column: 1 });
        ed.revealLineInCenter(item.lineNumber);
        ed.focus();
      }
    }
  }, [closePalette, openTab]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        closePalette();
        break;
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatItems[selectedIndex]) executeItem(flatItems[selectedIndex]);
        break;
      case "Home":
        e.preventDefault();
        setSelectedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setSelectedIndex(Math.max(flatItems.length - 1, 0));
        break;
      case "PageDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 10, flatItems.length - 1));
        break;
      case "PageUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 10, 0));
        break;
    }
  };

  if (!paletteOpen) return null;

  const totalCount = flatItems.length;
  const isFileMode = mode === "file";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/50" onClick={closePalette} />

      <div className="relative w-[560px] bg-bg3 border border-border rounded-lg shadow-2xl shadow-black/50 overflow-hidden flex flex-col">
        {/* input */}
        <div className="flex items-center px-3 border-b border-border">
          <ModeIndicator mode={mode} />
          <input
            ref={inputRef}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder(mode)}
            className="flex-1 bg-transparent py-3 text-[14px] text-t1 placeholder-t5 outline-none"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="palette-listbox"
            aria-activedescendant={flatItems[selectedIndex] ? `palette-item-${selectedIndex}` : undefined}
          />
          {mode === "file" && (
            <span className="text-[11px] text-t5 ml-2 shrink-0 select-none">
              {totalCount} file{totalCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* results */}
        <div ref={listRef} id="palette-listbox" role="listbox" className="max-h-[360px] overflow-y-auto scrollbar-thin py-1" aria-label="Results">
          {mode === "symbol" && (
            <div className="px-3 py-6 text-center text-t5 text-[13px]">
              Symbol search coming soon
            </div>
          )}

          {mode === "goto-line" && !query && (
            <div className="px-3 py-6 text-center text-t5 text-[13px]">
              Type a line number and press Enter
            </div>
          )}

          {groups.map((group) => {
            const groupStartIdx = flatItems.indexOf(group.items[0]);
            return (
              <div key={group.id} role="group" aria-labelledby={group.label ? `palette-group-${group.id}` : undefined}>
                {group.label && (
                  <div
                    id={`palette-group-${group.id}`}
                    role="presentation"
                    className="text-[10px] font-semibold uppercase tracking-wider text-t5 px-3 pt-2.5 pb-1 select-none"
                  >
                    {group.label}
                  </div>
                )}
                {group.items.map((item, itemIdx) => {
                  const flatIdx = groupStartIdx + itemIdx;
                  const isSelected = flatIdx === selectedIndex;

                  if (item.kind === "command") {
                    return (
                      <div
                        key={item.id}
                        data-idx={flatIdx}
                        id={`palette-item-${flatIdx}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => executeItem(item)}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 cursor-pointer text-[13px]",
                          isSelected ? "bg-selection text-t1" : "text-t3 hover:bg-hover"
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={cn("w-5 shrink-0 flex items-center justify-center", isSelected ? "text-t2" : "text-t4")}>
                            {CATEGORY_ICONS[item.category] || <FileText size={14} />}
                          </span>
                          <span className="truncate">
                            <HighlightedText text={item.label} indices={item.indices} />
                          </span>
                          {item.description && (
                            <span className="text-[11px] text-t5 truncate">{item.description}</span>
                          )}
                        </div>
                        {item.shortcut && <ShortcutBadge shortcut={item.shortcut} />}
                      </div>
                    );
                  }

                  if (item.kind === "file") {
                    return (
                      <div
                        key={item.id}
                        data-idx={flatIdx}
                        id={`palette-item-${flatIdx}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => executeItem(item)}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-[5px] cursor-pointer text-[13px] mx-1.5 rounded-md",
                          isSelected ? "bg-selection text-t1" : "text-t3"
                        )}
                      >
                        <FileIcon name={item.name} size={14} />
                        <span className="truncate font-medium text-t1">
                          <HighlightedText text={item.name} indices={item.indices} />
                        </span>
                        <span className="text-[11px] text-t5 truncate">{item.dir.replace(/\/$/, "").replaceAll("/", "\\")}</span>
                        <span className="ml-auto shrink-0">
                          {item.recent && (
                            <Clock size={12} className={isSelected ? "text-t3" : "text-t5"} />
                          )}
                        </span>
                      </div>
                    );
                  }

                  if (item.kind === "goto-line") {
                    return (
                      <div
                        key={item.id}
                        data-idx={flatIdx}
                        id={`palette-item-${flatIdx}`}
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => executeItem(item)}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[13px]",
                          isSelected ? "bg-selection text-t1" : "text-t3 hover:bg-hover"
                        )}
                      >
                        <Hash size={14} className="text-t4 shrink-0" />
                        <span>{item.label}</span>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            );
          })}

          {totalCount === 0 && mode !== "symbol" && mode !== "goto-line" && (
            <div className="px-3 py-6 text-center text-t5 text-[13px]">
              {mode === "command" ? "No matching commands" : "No matching files"}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-t4 shrink-0">
          <div className="flex items-center gap-3">
            {isFileMode && (
              <div className="flex items-center gap-1.5">
                <SplitSquareHorizontal size={12} />
                <span>Split</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <kbd className="text-[10px] text-t5 font-mono bg-bg1 rounded px-1 py-0.5">{"\u2191\u2193"}</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="text-[10px] text-t5 font-mono bg-bg1 rounded px-1 py-0.5">{"\u23CE"}</kbd>
              <span>{isFileMode ? "Open" : "Run"}</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="text-[10px] text-t5 font-mono bg-bg1 rounded px-1 py-0.5">Esc</kbd>
              <span>Close</span>
            </div>
          </div>
        </div>
      </div>

      {/* screen reader live region */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {totalCount} result{totalCount !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

// backward compat — page.tsx renders both
export function FileFinder() {
  return null;
}
