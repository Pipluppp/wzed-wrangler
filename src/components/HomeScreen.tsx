"use client";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";
import { useWorkspaceStore, type ProjectInfo } from "@/stores/workspace-store";
import {
  Folder,
  Clock,
  MoreHorizontal,
  Pencil,
  Trash2,
  Code2,
  Globe,
  Cloud,
  Server,
  FileCode,
  Link,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react";

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const TEMPLATE_ICONS: Record<string, typeof Code2> = {
  blank: FileCode,
  react: Code2,
  node: Server,
  vite: Globe,
  cloudflare: Cloud,
};

function getTemplateIcon(templateId: string) {
  return TEMPLATE_ICONS[templateId] || FileCode;
}

function ProjectCard({
  project,
  onOpen,
  onRename,
  onDelete,
  onShare,
}: {
  project: ProjectInfo;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onShare: () => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(project.name);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shareCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const Icon = getTemplateIcon(project.templateId || "blank");

  useEffect(() => {
    return () => {
      if (shareCopiedTimer.current) clearTimeout(shareCopiedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  function handleRenameSubmit() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed);
    }
    setRenaming(false);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex flex-col justify-between p-5 rounded-lg border border-border bg-bg1 transition-all cursor-pointer focus:outline-none focus:border-accent min-h-[120px]",
        "hover:border-accent/40 hover:shadow-sm",
      )}
      onClick={() => {
        if (!renaming && !menuOpen) onOpen();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !renaming && !menuOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {/* Top: icon + menu */}
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-md bg-bg2 border border-border flex items-center justify-center">
          <Icon size={18} className="text-accent" />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-1.5 rounded hover:bg-bg3 text-t5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-50 w-[150px] rounded-md bg-bg3 border border-border shadow-lg py-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setRenameValue(project.name);
                  setRenaming(true);
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-t2 hover:bg-hover transition-colors text-left"
              >
                <Pencil size={12} className="text-t4" />
                Rename
              </button>
              <button
                disabled={shareLoading}
                onClick={async (e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setShareLoading(true);
                  try {
                    await onShare();
                    setShareCopied(true);
                    if (shareCopiedTimer.current)
                      clearTimeout(shareCopiedTimer.current);
                    shareCopiedTimer.current = setTimeout(
                      () => setShareCopied(false),
                      2000,
                    );
                  } finally {
                    setShareLoading(false);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-t2 hover:bg-hover transition-colors text-left",
                  shareLoading && "opacity-50 cursor-wait",
                )}
              >
                {shareLoading ? (
                  <Loader2 size={12} className="text-t4 animate-spin" />
                ) : shareCopied ? (
                  <Check size={12} className="text-added" />
                ) : (
                  <Link size={12} className="text-t4" />
                )}
                {shareLoading
                  ? "Sharing..."
                  : shareCopied
                    ? "Copied!"
                    : "Copy link"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-deleted hover:bg-hover transition-colors text-left"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: name + meta */}
      <div className="mt-4">
        {renaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-[13px] font-medium text-t1 bg-bg3 border border-accent rounded px-1.5 py-0.5 outline-none w-full"
          />
        ) : (
          <div className="text-[13px] font-medium text-t1 truncate">
            {project.name}
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] text-t5 mt-1">
          <span className="flex items-center gap-1">
            <Clock size={9} />
            {timeAgo(project.lastOpened)}
          </span>
          <span className="text-border">·</span>
          <span className="capitalize">{project.templateId || "blank"}</span>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: { id: string; name: string; description: string };
  onSelect: () => void;
}) {
  const Icon = getTemplateIcon(template.id);

  return (
    <button
      onClick={onSelect}
      className="flex flex-col justify-between p-5 rounded-lg bg-bg1 border border-border hover:border-accent/30 hover:bg-hover/50 transition-all text-left group min-h-[120px]"
    >
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-md bg-bg2 border border-border flex items-center justify-center">
          <Icon
            size={17}
            className="text-t4 group-hover:text-accent transition-colors"
          />
        </div>
        <ArrowRight
          size={13}
          className="text-t5 opacity-0 group-hover:opacity-100 transition-opacity mt-1"
        />
      </div>
      <div className="mt-4">
        <div className="text-[13px] text-t2 group-hover:text-t1 font-medium">
          {template.name}
        </div>
        <div className="text-[10px] text-t5 mt-0.5">{template.description}</div>
      </div>
    </button>
  );
}

export function HomeScreen() {
  const projects = useWorkspaceStore((s) => s.projects);
  const templates = useWorkspaceStore((s) => s.templates);
  const openProject = useWorkspaceStore((s) => s.openProject);
  const openTemplate = useWorkspaceStore((s) => s.openTemplate);
  const deleteProject = useWorkspaceStore((s) => s.deleteProject);
  const renameProject = useWorkspaceStore((s) => s.renameProject);
  const search = useWorkspaceStore((s) => s.homeSearch);

  async function handleShareProject(project: ProjectInfo) {
    try {
      const { loadProjectSnapshot } = await import("@/lib/snapshot-db");
      const { createShareUrl } = await import("@/lib/share");
      const snapshot = await loadProjectSnapshot(project.id);
      if (!snapshot) {
        alert("No saved snapshot for this project. Open and save it first.");
        return;
      }
      await new Promise<void>((r) =>
        requestAnimationFrame(() => setTimeout(r, 0)),
      );
      const result = await createShareUrl(
        project.name,
        project.templateId || "blank",
        snapshot,
      );
      if ("error" in result) {
        alert(result.error);
        return;
      }
      await navigator.clipboard.writeText(result.url);
    } catch (e) {
      console.error("Failed to share project:", e);
      alert("Failed to create share link");
    }
  }

  const sorted = [...projects]
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .filter((p) =>
      search ? p.name.toLowerCase().includes(search.toLowerCase()) : true,
    );

  const hasProjects = projects.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-bg0 select-none overflow-y-auto">
      <div className="w-full max-w-[860px] mx-auto px-8 py-8">
        {/* Recent Projects — on top */}
        {hasProjects && (
          <section className="mb-10">
            <h2 className="text-[11px] text-t4 uppercase tracking-wider font-medium mb-3">
              Recent Projects
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sorted.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProject(project.id)}
                  onRename={(name) => renameProject(project.id, name)}
                  onDelete={() => deleteProject(project.id)}
                  onShare={() => handleShareProject(project)}
                />
              ))}
              {sorted.length === 0 && search && (
                <div className="col-span-full text-center text-t5 text-[12px] py-8">
                  No projects match &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          </section>
        )}

        {/* New Project */}
        <section>
          <h2 className="text-[11px] text-t4 uppercase tracking-wider font-medium mb-3">
            Start New
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={() => openTemplate(template.id)}
              />
            ))}
          </div>
        </section>

        {/* Empty state */}
        {!hasProjects && (
          <div className="text-center py-16">
            <Folder size={32} className="text-t5 mx-auto mb-3" />
            <p className="text-t4 text-[13px] mb-1">No projects yet</p>
            <p className="text-t5 text-[11px]">
              Choose a template above to create your first project.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
