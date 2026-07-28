"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";
import { Plus, X, Maximize2, Minimize2 } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNodepodStore } from "@/stores/nodepod-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getTheme } from "@/lib/themes";

interface TerminalTab {
  id: string;
  title: string;
}

function buildTerminalTheme(themeName: string) {
  const theme = getTheme(themeName);
  const c = theme.colors;
  return {
    background: c.bg0,
    foreground: c.text2,
    cursor: c.accent,
    selectionBackground: c.selection,
    black: c.bg0,
    red: c.deleted,
    green: c.added,
    yellow: c.warning,
    blue: c.accent,
    magenta: c.purple,
    cyan: c.syntaxType,
    white: c.text2,
    brightBlack: c.text4,
    brightRed: c.deleted,
    brightGreen: c.added,
    brightYellow: c.warning,
    brightBlue: c.accent,
    brightMagenta: c.purple,
    brightCyan: c.syntaxType,
    brightWhite: c.text1,
  };
}

export function TerminalPanel() {
  const bottomDockMaximized = useWorkspaceStore((s) => s.bottomDockMaximized);
  const toggleBottomDockMaximized = useWorkspaceStore((s) => s.toggleBottomDockMaximized);
  const bottomDockHeight = useWorkspaceStore((s) => s.bottomDock.height);
  const nodepodInstance = useNodepodStore((s) => s.instance);
  const runtimeId = useNodepodStore((s) => s.runtimeId);
  const startupCommand = useNodepodStore((s) => s.startupCommand);
  const themeName = useSettingsStore((s) => s.settings.theme);
  const termFontSize = useSettingsStore((s) => s.settings.terminal_font_size);
  const termFontFamily = useSettingsStore((s) => s.settings.terminal_font_family);
  const termCursor = useSettingsStore((s) => s.settings.terminal_cursor);
  const termBlinking = useSettingsStore((s) => s.settings.terminal_blinking);

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const terminalsRef = useRef<Map<string, any>>(new Map());
  const mountedRef = useRef<Set<string>>(new Set());
  const initialTabCreated = useRef(false);
  const startupExecutedRef = useRef(false);

  const disposeTerminals = useCallback(() => {
    for (const terminal of terminalsRef.current.values()) {
      try { terminal.detach(); } catch { /* ignore */ }
    }
    terminalsRef.current.clear();
    mountedRef.current.clear();
  }, []);

  useEffect(() => {
    disposeTerminals();
    initialTabCreated.current = false;
    startupExecutedRef.current = false;
    setTabs([]);
    setActiveTabId(null);

    if (nodepodInstance) {
      const id = `term-${Date.now()}`;
      initialTabCreated.current = true;
      setTabs([{ id, title: "terminal" }]);
      setActiveTabId(id);
    }

    return disposeTerminals;
  }, [disposeTerminals, nodepodInstance, runtimeId]);

  useEffect(() => {
    const theme = buildTerminalTheme(themeName);
    for (const terminal of terminalsRef.current.values()) {
      try { terminal.setTheme(theme); } catch { /* ignore */ }
    }
  }, [themeName]);

  useEffect(() => {
    for (const terminal of terminalsRef.current.values()) {
      try {
        const xterm = terminal._xterm ?? terminal.xterm;
        if (xterm) {
          xterm.options.fontSize = termFontSize;
          xterm.options.fontFamily = `'${termFontFamily}', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace`;
          xterm.options.cursorStyle = termCursor;
          xterm.options.cursorBlink = termBlinking;
        }
        try { terminal.fit(); } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
  }, [termFontSize, termFontFamily, termCursor, termBlinking]);

  useEffect(() => {
    const terminal = activeTabId ? terminalsRef.current.get(activeTabId) : null;
    if (terminal) {
      setTimeout(() => { try { terminal.fit(); } catch { /* ignore */ } }, 50);
    }
  }, [bottomDockHeight, bottomDockMaximized, activeTabId]);

  const addTab = useCallback(() => {
    const id = `term-${Date.now()}`;
    setTabs((prev) => [...prev, { id, title: "terminal" }]);
    setActiveTabId(id);
  }, []);

  const closeTermTab = useCallback((id: string) => {
    const terminal = terminalsRef.current.get(id);
    if (terminal) {
      try { terminal.detach(); } catch { /* ignore */ }
      terminalsRef.current.delete(id);
      mountedRef.current.delete(id);
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((currentActive) => {
        if (currentActive === id && next.length > 0) return next[0].id;
        if (next.length === 0) return null;
        return currentActive;
      });
      return next;
    });
  }, []);

  const mountTerminal = useCallback(
    async (tabId: string, container: HTMLElement) => {
      if (mountedRef.current.has(tabId)) return;
      if (!nodepodInstance) return;
      mountedRef.current.add(tabId);

      try {
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");

        const devTerminal = nodepodInstance.createTerminal({
          Terminal,
          FitAddon,
          theme: buildTerminalTheme(themeName),
          fontSize: termFontSize,
          fontFamily: `'${termFontFamily}', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace`,
        });

        devTerminal.attach(container);
        devTerminal.xterm.options.cursorStyle = termCursor;
        devTerminal.xterm.options.cursorBlink = termBlinking;
        devTerminal.showPrompt();
        terminalsRef.current.set(tabId, devTerminal);

        if (startupCommand && !startupExecutedRef.current) {
          startupExecutedRef.current = true;
          setTimeout(() => {
            try {
              devTerminal.input(startupCommand + "\r");
            } catch (e) {
              console.error("Failed to auto-execute startup command:", e);
            }
          }, 500);
        }
      } catch (e) {
        console.error("Failed to mount terminal:", e);
        mountedRef.current.delete(tabId);
      }
    },
    [nodepodInstance, themeName, startupCommand, termFontSize, termFontFamily, termCursor, termBlinking]
  );

  return (
    <div className="flex flex-col h-full bg-bg0">
      {/* Terminal tab bar */}
      <div className="flex items-center h-[35px] border-b border-border shrink-0">
        <div className="flex items-center h-full flex-1 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full text-[12px] cursor-pointer select-none border-r border-border group min-w-[100px]",
                activeTabId === tab.id
                  ? "bg-bg2 text-t1"
                  : "text-t4 hover:text-t3"
              )}
            >
              <span className="truncate flex-1">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTermTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 rounded p-0.5"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-0.5 px-2 border-l border-border h-full">
          <button
            onClick={addTab}
            className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            disabled={!nodepodInstance}
          >
            <Plus size={13} />
          </button>
          <button
            onClick={toggleBottomDockMaximized}
            className={cn(
              "p-1 rounded hover:bg-hover",
              bottomDockMaximized ? "text-accent" : "text-t4 hover:text-t3"
            )}
            title={bottomDockMaximized ? "Restore" : "Maximize"}
          >
            {bottomDockMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 relative overflow-hidden">
        {!nodepodInstance && (
          <div className="absolute inset-0 flex items-center justify-center text-t4 text-sm">
            Loading runtime...
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => {
              if (el && nodepodInstance) mountTerminal(tab.id, el);
            }}
            className={cn(
              "absolute inset-0",
              tab.id === activeTabId ? "visible" : "invisible"
            )}
          />
        ))}
      </div>
    </div>
  );
}
