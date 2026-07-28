"use client";
import { useState, useCallback, useRef, useEffect, memo } from "react";
import { cn } from "@/lib/cn";
import { TabBar } from "./TabBar";
import { Breadcrumbs } from "./ui/Breadcrumbs";
import { CodeEditor } from "./CodeEditor";
import { KeymapEditorContent } from "./KeymapEditor";
import { BrowserPanel } from "./BrowserPanel";
import { AIPanel } from "./AIPanel";
import { useWorkspaceStore, type SplitNode, type DropZone, getTabType } from "@/stores/workspace-store";
import { useResizable } from "@/hooks/use-resizable";
import { ErrorBoundary } from "./ui/ErrorBoundary";

function DropZoneOverlay({
  onDrop,
}: {
  onDrop: (zone: DropZone, e: React.DragEvent) => void;
}) {
  const [activeZone, setActiveZone] = useState<DropZone | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const getZone = useCallback((e: React.DragEvent): DropZone => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return "center";
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0.25) return "left";
    if (x > 0.75) return "right";
    if (y < 0.25) return "top";
    if (y > 0.75) return "bottom";
    return "center";
  }, []);

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setActiveZone(getZone(e));
      }}
      onDragLeave={() => setActiveZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const zone = getZone(e);
        setActiveZone(null);
        onDrop(zone, e);
      }}
    >
      {activeZone && activeZone !== "center" && (
        <div
          className={cn(
            "absolute bg-focus/20 border-2 border-focus/40 rounded transition-all pointer-events-none",
            activeZone === "left" && "top-1 bottom-1 left-1 w-[48%]",
            activeZone === "right" && "top-1 bottom-1 right-1 w-[48%]",
            activeZone === "top" && "top-1 left-1 right-1 h-[48%]",
            activeZone === "bottom" && "bottom-1 left-1 right-1 h-[48%]",
          )}
        />
      )}
      {activeZone === "center" && (
        <div className="absolute inset-2 bg-focus/10 border-2 border-focus/30 rounded pointer-events-none" />
      )}
    </div>
  );
}

const PaneContent = memo(function PaneContent({ paneId }: { paneId: string }) {
  const activeTab = useWorkspaceStore((s) => s.panes[paneId]?.activeTab ?? "");
  const tabs = useWorkspaceStore((s) => s.panes[paneId]?.tabs ?? []);
  const tabType = getTabType(activeTab);
  // Keep BrowserPanel always mounted (hidden when not active) to preserve iframe state
  const hasBrowserTab = tabs.some((t) => getTabType(t) === "browser");

  return (
    <ErrorBoundary>
      {hasBrowserTab && (
        <div className={cn("flex flex-col h-full w-full", tabType !== "browser" && "hidden")}>
          <BrowserPanel />
        </div>
      )}
      {tabType === "keymap" && <KeymapEditorContent />}
      {tabType === "ai" && <AIPanel />}
      {(tabType === "file" || !activeTab) && (
        <>
          <Breadcrumbs paneId={paneId} />
          <CodeEditor paneId={paneId} />
        </>
      )}
    </ErrorBoundary>
  );
});

const EditorPaneLeaf = memo(function EditorPaneLeaf({ paneId }: { paneId: string }) {
  const activePaneId = useWorkspaceStore((s) => s.activePaneId);
  const isTabDragging = useWorkspaceStore((s) => s.dragState?.dragging ?? false);
  const isActive = activePaneId === paneId;
  const [isFileDragging, setIsFileDragging] = useState(false);
  const fileDragCounter = useRef(0);

  useEffect(() => {
    const reset = () => {
      fileDragCounter.current = 0;
      setIsFileDragging(false);
    };
    document.addEventListener("dragend", reset);
    document.addEventListener("drop", reset);
    return () => {
      document.removeEventListener("dragend", reset);
      document.removeEventListener("drop", reset);
    };
  }, []);

  const showOverlay = isTabDragging || isFileDragging;

  const handleOverlayDrop = useCallback(
    (zone: DropZone, e: React.DragEvent) => {
      const s = useWorkspaceStore.getState();
      // 1. Tab drag (store-driven)
      if (s.dragState) {
        s.splitPaneWith(paneId, zone, s.dragState.fileName, s.dragState.sourcePaneId);
        s.endTabDrag();
        setIsFileDragging(false);
        fileDragCounter.current = 0;
        return;
      }

      const fileData = e.dataTransfer.getData("application/wzed-file");
      if (fileData) {
        setIsFileDragging(false);
        fileDragCounter.current = 0;
        if (zone === "center") {
          s.openTab(fileData, paneId);
        } else {
          s.splitPaneWith(paneId, zone, fileData, paneId);
        }
        return;
      }

      const tabData = e.dataTransfer.getData("application/wzed-tab");
      if (tabData) {
        const data = JSON.parse(tabData);
        s.splitPaneWith(paneId, zone, data.fileName, data.paneId);
        s.endTabDrag();
        setIsFileDragging(false);
        fileDragCounter.current = 0;
      }
    },
    [paneId]
  );

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full min-w-0 min-h-0 bg-bg2 relative",
        isActive && ""
      )}
      onClick={() => useWorkspaceStore.getState().setActivePaneId(paneId)}
      onDragEnter={(e) => {
        if (
          e.dataTransfer.types.includes("application/wzed-file") ||
          e.dataTransfer.types.includes("application/wzed-tab")
        ) {
          fileDragCounter.current++;
          setIsFileDragging(true);
        }
      }}
      onDragLeave={() => {
        fileDragCounter.current--;
        if (fileDragCounter.current <= 0) {
          fileDragCounter.current = 0;
          setIsFileDragging(false);
        }
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes("application/wzed-file") ||
          e.dataTransfer.types.includes("application/wzed-tab")
        ) {
          e.preventDefault();
        }
      }}
    >
      <TabBar paneId={paneId} />
      <div className="relative flex-1 flex flex-col min-h-0">
        <PaneContent paneId={paneId} />

        {showOverlay && (
          <DropZoneOverlay onDrop={handleOverlayDrop} />
        )}
      </div>
    </div>
  );
});

function SplitResizeHandle({
  parentId,
  childIndex,
  direction,
}: {
  parentId: string;
  childIndex: number;
  direction: "row" | "column";
}) {
  const resizeSplit = useWorkspaceStore((s) => s.resizeSplit);
  const onMouseDown = useResizable(
    direction === "row" ? "horizontal" : "vertical",
    (delta) => resizeSplit(parentId, childIndex, delta),
  );

  return (
    <div
      className={cn(
        "flex-shrink-0 relative z-20 flex items-center justify-center",
        direction === "row"
          ? "w-[9px] -mx-[4px] cursor-col-resize"
          : "h-[9px] -my-[4px] cursor-row-resize",
      )}
      onMouseDown={onMouseDown}
    >
      <div
        className={cn(
          "bg-border transition-colors",
          direction === "row"
            ? "w-[1px] h-full"
            : "h-[1px] w-full"
        )}
      />
      <div
        className={cn(
          "absolute opacity-0 hover:opacity-100 transition-opacity",
          direction === "row"
            ? "top-0 left-[2px] w-[5px] h-full bg-focus/40"
            : "left-0 top-[2px] h-[5px] w-full bg-focus/40"
        )}
      />
    </div>
  );
}

const SplitLayoutInner = memo(function SplitLayoutInner({ node }: { node: SplitNode }) {
  if (node.type === "leaf" && node.paneId) {
    return <EditorPaneLeaf paneId={node.paneId} />;
  }

  if (!node.children || node.children.length === 0) return null;

  const isRow = node.type === "row";
  const sizes = node.sizes || node.children.map(() => 1);
  const total = sizes.reduce((a, b) => a + b, 0);

  return (
    <div
      className={cn(
        "flex w-full h-full min-w-0 min-h-0",
        isRow ? "flex-row" : "flex-col"
      )}
    >
      {node.children.map((child, idx) => (
        <div key={child.id} className="contents">
          {idx > 0 && (
            <SplitResizeHandle
              parentId={node.id}
              childIndex={idx - 1}
              direction={node.type as "row" | "column"}
            />
          )}
          <div
            className="min-w-0 min-h-0 overflow-hidden"
            style={{
              flex: `${(sizes[idx] / total) * 100} 0 0%`,
            }}
          >
            <SplitLayoutInner node={child} />
          </div>
        </div>
      ))}
    </div>
  );
});

export function EditorArea() {
  const splitLayout = useWorkspaceStore((s) => s.splitLayout);
  return (
    <div className="flex-1 min-w-0 min-h-0 h-full overflow-hidden">
      <SplitLayoutInner node={splitLayout} />
    </div>
  );
}

export function MaximizedPane({ paneId }: { paneId: string }) {
  return (
    <div className="fixed inset-0 top-[38px] z-40 p-2 pointer-events-none">
      <div className="w-full h-full rounded-lg overflow-hidden shadow-2xl shadow-black/50 border border-border pointer-events-auto">
        <EditorPaneLeaf paneId={paneId} />
      </div>
    </div>
  );
}
