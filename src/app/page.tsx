"use client";
import { useEffect, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNodepodStore } from "@/stores/nodepod-store";
import { getTheme } from "@/lib/themes";
import { handleKeybinding } from "@/lib/keybind-dispatcher";
import { TitleBar } from "@/components/TitleBar";
import { DockPanel } from "@/components/DockPanel";
import { EditorArea, MaximizedPane } from "@/components/EditorPane";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette, FileFinder } from "@/components/CommandPalette";
import { CtrlKMenu } from "@/components/CtrlKMenu";
import { SettingsModal } from "@/components/SettingsModal";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { HomeScreen } from "@/components/HomeScreen";
import { LoadingOverlay } from "@/components/ui/LoadingOverlay";
import type { Snapshot } from "@scelar/nodepod";

export default function ZedClone() {
  const leftDock = useWorkspaceStore((s) => s.leftDock);
  const rightDock = useWorkspaceStore((s) => s.rightDock);
  const bottomDock = useWorkspaceStore((s) => s.bottomDock);
  const resizeLeftDock = useWorkspaceStore((s) => s.resizeLeftDock);
  const resizeRightDock = useWorkspaceStore((s) => s.resizeRightDock);
  const resizeBottomDock = useWorkspaceStore((s) => s.resizeBottomDock);
  const maximizedPaneId = useWorkspaceStore((s) => s.maximizedPaneId);
  const bottomDockMaximized = useWorkspaceStore((s) => s.bottomDockMaximized);
  const toggleBottomDock = useWorkspaceStore((s) => s.toggleBottomDock);
  const showHomeScreen = useWorkspaceStore((s) => s.showHomeScreen);
  const hydrateProjects = useWorkspaceStore((s) => s.hydrateProjects);
  const importFromShare = useWorkspaceStore((s) => s.importFromShare);
  const uiFontSize = useSettingsStore((s) => s.settings.ui_font_size);
  const uiFontFamily = useSettingsStore((s) => s.settings.ui_font_family);
  const themeName = useSettingsStore((s) => s.settings.theme);
  const nodepodInstance = useNodepodStore((s) => s.instance);
  const nodepodBooting = useNodepodStore((s) => s.booting);

  const startupCommand = useNodepodStore((s) => s.startupCommand);

  // Hydrate projects from localStorage on mount + check for share URL
  useEffect(() => {
    hydrateProjects();

    // Check for ?share= param and auto-import (only once)
    const shareData = new URLSearchParams(window.location.search).get("share");
    if (shareData) {
      // Remove param immediately to prevent re-import on HMR/remount
      window.history.replaceState({}, "", window.location.pathname);

      (async () => {
        try {
          const { decompressFromBase64 } = await import("@/lib/share");
          const payload = await decompressFromBase64<{
            version: number;
            name: string;
            templateId: string;
            snapshot: Snapshot;
          }>(shareData);
          if (
            payload?.version === 1 &&
            payload.snapshot &&
            typeof payload.name === "string"
          ) {
            importFromShare(payload.name, payload.templateId, payload.snapshot);
          }
        } catch (e) {
          console.error("Failed to import from share URL:", e);
        }
      })();
    }
  }, [hydrateProjects, importFromShare]);

  // Auto-open terminal when there's a startup command
  useEffect(() => {
    if (startupCommand && nodepodInstance) {
      // Read latest dock state to avoid stale closure
      const isVisible = useWorkspaceStore.getState().bottomDock.visible;
      if (!isVisible) toggleBottomDock();
    }
  }, [startupCommand, nodepodInstance, toggleBottomDock]);

  // Apply theme CSS variables
  useEffect(() => {
    const theme = getTheme(themeName);
    const c = theme.colors;
    const root = document.documentElement;
    // Batch CSS variable updates via setAttribute to trigger a single style recalc
    const vars: [string, string][] = [
      ["--bg0", c.bg0],
      ["--bg1", c.bg1],
      ["--bg2", c.bg2],
      ["--bg3", c.bg3],
      ["--bg4", c.bg4],
      ["--border", c.border],
      ["--hover", c.hover],
      ["--selection", c.selection],
      ["--text1", c.text1],
      ["--text2", c.text2],
      ["--text3", c.text3],
      ["--text4", c.text4],
      ["--text5", c.text5],
      ["--accent", c.accent],
      ["--accent-hover", c.accentHover],
      ["--focus", c.focus],
      ["--added", c.added],
      ["--modified", c.modified],
      ["--deleted", c.deleted],
      ["--warning", c.warning],
      ["--git-branch", c.gitBranch],
      ["--purple", c.purple],
      ["--scroll-thumb", c.scrollThumb],
      ["--scroll-thumb-hover", c.scrollThumbHover],
    ];
    for (const [k, v] of vars) root.style.setProperty(k, v);
    root.style.colorScheme = theme.appearance;
  }, [themeName]);

  // Apply UI font settings to document root
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiFontSize}px`;
  }, [uiFontSize]);

  useEffect(() => {
    const safeFontFamily = uiFontFamily.replace(/'/g, "");
    document.documentElement.style.fontFamily = `'${safeFontFamily}', system-ui, sans-serif`;
  }, [uiFontFamily]);

  // Global keyboard shortcuts — driven by keymap store
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const handled = handleKeybinding(e);
    if (handled) e.preventDefault();
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (showHomeScreen) {
    return (
      <div className="flex flex-col h-screen w-full overflow-hidden bg-bg0 text-t3 font-sans">
        <TitleBar />
        <HomeScreen />
        <SettingsModal />
        {nodepodBooting && <LoadingOverlay />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-bg0 text-t3 font-sans">
      <TitleBar />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Dock */}
        {leftDock.visible && (
          <>
            <div style={{ width: leftDock.width }} className="shrink-0 h-full">
              <DockPanel
                position="left"
                panels={["project", "search", "git"]}
              />
            </div>
            <ResizeHandle direction="horizontal" onDelta={resizeLeftDock} />
          </>
        )}

        {/* Center: Editor + Bottom dock */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <EditorArea />

          {/* Bottom dock — always mounted to preserve terminal state; hidden via CSS */}
          {bottomDock.visible && !bottomDockMaximized && (
            <ResizeHandle direction="vertical" onDelta={resizeBottomDock} />
          )}
          <div
            className={
              !bottomDock.visible
                ? "hidden"
                : bottomDockMaximized
                  ? "fixed inset-0 top-[38px] z-40 p-2"
                  : "shrink-0 w-full"
            }
            style={
              !bottomDock.visible || bottomDockMaximized
                ? undefined
                : { height: bottomDock.height }
            }
          >
            <div
              className={
                bottomDockMaximized
                  ? "w-full h-full rounded-lg overflow-hidden shadow-2xl shadow-black/50 border border-border"
                  : "h-full"
              }
            >
              <DockPanel position="bottom" panels={["terminal"]} />
            </div>
          </div>
        </div>

        {/* Right Dock — AI */}
        {rightDock.visible && (
          <>
            <ResizeHandle direction="horizontal" onDelta={resizeRightDock} />
            <div style={{ width: rightDock.width }} className="shrink-0 h-full">
              <DockPanel position="right" panels={["ai"]} />
            </div>
          </>
        )}
      </div>

      {maximizedPaneId && <MaximizedPane paneId={maximizedPaneId} />}
      {nodepodBooting && <LoadingOverlay />}

      <CommandPalette />
      <FileFinder />
      <CtrlKMenu />
      <SettingsModal />
      <StatusBar />
    </div>
  );
}
