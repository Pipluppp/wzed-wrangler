"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useNodepodStore } from "@/stores/nodepod-store";
import { FileUp, FolderUp, Loader2, Search } from "lucide-react";
import { writeWorkspaceFile } from "@/lib/workspace-repository";

export function ProjectPanel() {
  const [importing, setImporting] = useState(false);
  const [treeSearchOpen, setTreeSearchOpen] = useState(false);
  const projectPaths = useWorkspaceStore((s) => s.projectPaths);
  const instance = useNodepodStore((s) => s.instance);
  const hydratingTree = useNodepodStore((s) => s.hydratingTree);
  const refreshFileTree = useNodepodStore((s) => s.refreshFileTree);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<FileTreeHandle>(null);

  useEffect(() => {
    if (hydratingTree) setTreeSearchOpen(false);
  }, [hydratingTree]);

  const handleImportFiles = useCallback(async (files: FileList | null) => {
    if (!files || !instance) return;
    setImporting(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath = (file as any).webkitRelativePath || file.name;
        const targetPath = `/project/${relativePath}`;

        // Ensure parent directory exists
        const parentDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
        if (parentDir && parentDir !== "/project") {
          try { await instance.fs.mkdir(parentDir, { recursive: true }); } catch { /* exists */ }
        }

        const content = await file.text();
        await writeWorkspaceFile(targetPath, content, { updateBuffer: false });

        if ((i + 1) % 10 === 0) {
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
      await refreshFileTree();
    } finally {
      setImporting(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }, [instance, refreshFileTree]);

  return (
    <div className="flex flex-col h-full">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleImportFiles(e.target.files)}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleImportFiles(e.target.files)}
        // eslint-disable-next-line react/no-unknown-property
        {...{ webkitdirectory: "" } as any}
      />

      {/* Panel header */}
      <div className="flex items-center justify-between h-[35px] px-3 shrink-0 border-b border-border">
        <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">
          Project
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            title="Import files"
          >
            <FileUp size={12} />
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            title="Import folder"
          >
            <FolderUp size={12} />
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => treeRef.current?.toggleSearch()}
            className={`p-1 rounded hover:bg-hover ${treeSearchOpen ? "bg-hover text-accent" : "text-t4 hover:text-t3"}`}
            title={treeSearchOpen ? "Hide file search" : "Search files"}
            aria-label={treeSearchOpen ? "Hide file search" : "Search files"}
            aria-pressed={treeSearchOpen}
          >
            <Search size={12} />
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {importing && (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-t4 border-b border-border">
            <Loader2 size={12} className="animate-spin" />
            Importing files...
          </div>
        )}
        <div className="min-h-0 flex-1">
          {hydratingTree && projectPaths.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-t4">
              <Loader2 size={12} className="animate-spin" />
              Loading project files...
            </div>
          ) : (
            <FileTree
              ref={treeRef}
              paths={projectPaths}
              onSearchOpenChange={setTreeSearchOpen}
            />
          )}
        </div>
      </div>

    </div>
  );
}
