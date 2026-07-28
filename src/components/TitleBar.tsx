"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNodepodStore } from "@/stores/nodepod-store";
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  Settings,
  Palette,
  Keyboard,
  Bug,
  Home,
  ChevronRight,
  Save,
  Share2,
  Check,
  Search,
  CloudUpload,
} from "lucide-react";
import { BugReportModal } from "./BugReportModal";
import { DeployDialog } from "./DeployDialog";
import { useDeployStore } from "@/stores/deploy-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./ui/DropdownMenu";

export function TitleBar() {
  const leftDockVisible = useWorkspaceStore((s) => s.leftDock.visible);
  const rightDockVisible = useWorkspaceStore((s) => s.rightDock.visible);
  const bottomDockVisible = useWorkspaceStore((s) => s.bottomDock.visible);
  const toggleLeftDock = useWorkspaceStore((s) => s.toggleLeftDock);
  const toggleRightDock = useWorkspaceStore((s) => s.toggleRightDock);
  const toggleBottomDock = useWorkspaceStore((s) => s.toggleBottomDock);
  const showHomeScreen = useWorkspaceStore((s) => s.showHomeScreen);
  const homeSearch = useWorkspaceStore((s) => s.homeSearch);
  const setHomeSearch = useWorkspaceStore((s) => s.setHomeSearch);
  const currentProject = useWorkspaceStore((s) => s.currentProject);
  const goHome = useWorkspaceStore((s) => s.goHome);
  const activeFileName = useWorkspaceStore((s) => {
    const pane = s.panes[s.activePaneId];
    const tab = pane?.activeTab;
    return tab ? (s.openFiles[tab]?.name ?? null) : null;
  });
  const userMenuOpen = useWorkspaceStore((s) => s.userMenuOpen);
  const toggleUserMenu = useWorkspaceStore((s) => s.toggleUserMenu);
  const toggleSettings = useWorkspaceStore((s) => s.toggleSettings);
  const toggleKeymapEditor = useWorkspaceStore((s) => s.toggleKeymapEditor);
  const toggleThemePicker = useWorkspaceStore((s) => s.toggleThemePicker);
  const bugReportOpen = useWorkspaceStore((s) => s.bugReportOpen);
  const toggleBugReport = useWorkspaceStore((s) => s.toggleBugReport);
  const saveSnapshot = useNodepodStore((s) => s.saveSnapshot);
  const dirty = useNodepodStore((s) => s.dirty);
  const getShareUrl = useNodepodStore((s) => s.getShareUrl);
  const openDeployDialog = useDeployStore((s) => s.openDialog);
  const currentTemplate = useWorkspaceStore((s) =>
    s.templates.find((template) => template.id === s.currentProject?.templateId),
  );

  const [saving, setSaving] = useState(false);
  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveSnapshot();
    } finally {
      setSaving(false);
    }
  }, [saving, saveSnapshot]);

  const [shareState, setShareState] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [shareError, setShareError] = useState("");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (shareTimer.current) clearTimeout(shareTimer.current); };
  }, []);
  const handleShare = useCallback(async () => {
    if (shareState === "loading") return;
    setShareState("loading");
    try {
      const result = await getShareUrl();
      if (!result) {
        setShareState("error");
        setShareError("No project open");
        if (shareTimer.current) clearTimeout(shareTimer.current);
        shareTimer.current = setTimeout(() => setShareState("idle"), 3000);
        return;
      }
      if ("error" in result) {
        setShareState("error");
        setShareError(result.error);
        if (shareTimer.current) clearTimeout(shareTimer.current);
        shareTimer.current = setTimeout(() => setShareState("idle"), 3000);
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setShareState("copied");
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShareState("idle"), 2000);
    } catch {
      setShareState("error");
      setShareError("Failed to copy");
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => setShareState("idle"), 2000);
    }
  }, [shareState, getShareUrl]);

  return (
    <div
      className={cn(
        "h-[38px] flex items-center justify-between px-3 select-none shrink-0",
        "bg-bg0 border-b border-border",
        "app-drag-region"
      )}
    >
      {/* Left: App name + home + project breadcrumb */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] text-t1 font-medium ml-2">wZed</span>
        {!showHomeScreen && (
          <>
            <button
              onClick={goHome}
              className="p-1 rounded hover:bg-hover transition-colors text-t4 hover:text-t2 ml-1"
              title="Home"
            >
              <Home size={13} />
            </button>
            {currentProject && (
              <>
                <ChevronRight size={11} className="text-t5" />
                <span className="text-[11px] text-t3 truncate max-w-[140px]">
                  {currentProject.name}
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* Center */}
      {showHomeScreen ? (
        <div className="absolute left-1/2 -translate-x-1/2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-t5" />
            <input
              type="text"
              value={homeSearch}
              onChange={(e) => setHomeSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-[280px] text-[12px] bg-bg1 border border-border rounded-md pl-8 pr-3 py-1 text-t2 placeholder:text-t5 outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-t4 font-medium absolute left-1/2 -translate-x-1/2 pointer-events-none">
          {activeFileName ? `${activeFileName} — wZed` : "wZed"}
        </div>
      )}

      {/* Right: Panel toggles + save + user */}
      <div className="flex items-center gap-1">
        {!showHomeScreen && (
          <>
            <button
              onClick={toggleLeftDock}
              className={cn(
                "p-1.5 rounded hover:bg-hover transition-colors",
                leftDockVisible ? "text-accent" : "text-t4"
              )}
              title="Toggle Left Panel"
            >
              <PanelLeft size={15} />
            </button>
            <button
              onClick={toggleBottomDock}
              className={cn(
                "p-1.5 rounded hover:bg-hover transition-colors",
                bottomDockVisible ? "text-accent" : "text-t4"
              )}
              title="Toggle Bottom Panel"
            >
              <PanelBottom size={15} />
            </button>
            <button
              onClick={toggleRightDock}
              className={cn(
                "p-1.5 rounded hover:bg-hover transition-colors",
                rightDockVisible ? "text-accent" : "text-t4"
              )}
              title="Toggle AI Panel"
            >
              <PanelRight size={15} />
            </button>

            <button
              onClick={toggleBugReport}
              className="p-1.5 rounded hover:bg-hover transition-colors text-t4 hover:text-warning"
              title="Report a Bug"
            >
              <Bug size={15} />
            </button>

            <div className="w-px h-4 bg-border mx-1" />

            {currentTemplate?.deploymentKind && (
              <button
                onClick={openDeployDialog}
                className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-bg0 transition-opacity hover:opacity-90"
                title="Deploy a temporary Cloudflare preview"
              >
                <CloudUpload size={13} />
                Deploy
              </button>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                saving
                  ? "bg-accent/20 text-accent animate-pulse cursor-default"
                  : !dirty
                    ? "bg-bg2 text-t5 cursor-default"
                    : "bg-accent/10 text-accent hover:bg-accent/20"
              )}
              title="Save project (Ctrl+S)"
            >
              <Save size={13} />
              {saving ? "Saving..." : "Save"}
            </button>

            {/* Share button */}
            <button
              onClick={handleShare}
              disabled={shareState === "loading"}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors max-w-[200px]",
                shareState === "copied"
                  ? "bg-added/20 text-added"
                  : shareState === "error"
                    ? "bg-deleted/20 text-deleted"
                    : shareState === "loading"
                      ? "bg-bg2 text-t4 animate-pulse cursor-default"
                      : "bg-bg2 text-t3 hover:bg-hover"
              )}
              title={shareState === "error" ? shareError : "Copy share link to clipboard"}
            >
              {shareState === "copied" ? <Check size={13} /> : <Share2 size={13} />}
              <span className="truncate">
                {shareState === "copied" ? "Copied!" : shareState === "error" ? "Too large" : "Share"}
              </span>
            </button>
          </>
        )}

        <div className="w-px h-4 bg-border mx-1" />

        {/* User avatar + dropdown */}
        <DropdownMenu open={userMenuOpen} onOpenChange={(v) => { if (v !== userMenuOpen) toggleUserMenu(); }}>
          <DropdownMenuTrigger
            className="w-6 h-6 rounded-full ml-1 flex items-center justify-center text-[10px] font-bold text-white hover:ring-1 hover:ring-accent/50"
            style={{
              background: "radial-gradient(at 25% 25%, var(--accent), var(--purple) 75%)",
            }}
          >
            Z
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span className="text-t1 font-medium">User</span>
              <span className="text-[10px] text-t4 bg-bg0 px-1.5 py-0.5 rounded">Free</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={toggleSettings} shortcut="Ctrl-,">
              <Settings size={13} className="text-t4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleKeymapEditor}>
              <Keyboard size={13} className="text-t4" />
              Key Bindings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleThemePicker} shortcut="Ctrl-K Ctrl-T">
              <Palette size={13} className="text-t4" />
              Themes...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {bugReportOpen && <BugReportModal onClose={toggleBugReport} />}
      <DeployDialog />
    </div>
  );
}
