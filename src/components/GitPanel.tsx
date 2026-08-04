"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  GitBranch,
  RefreshCw,
  Plus,
  Minus,
  Check,
  Upload,
  Download,
  FolderGit2,
  FileText,
  ChevronDown,
  ChevronRight,
  Settings,
  KeyRound,
  Undo2,
} from "lucide-react";
import { useNodepodStore } from "@/stores/nodepod-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { refreshRepositoryStatus, useRepositoryStatusStore } from "@/stores/repository-status-store";

interface GitFileChange {
  path: string;
  status: "M" | "A" | "D" | "?" | "R" | "U" | string;
  staged: boolean;
}

async function gitExec(
  instance: any,
  args: string[],
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = await instance.spawn("git", args, {
    cwd: "/project",
    env,
  });
  const result = await Promise.race([
    proc.completion,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Git command timed out")), 15000)
    ),
  ]);
  return result;
}

function statusColor(s: string): string {
  switch (s) {
    case "M": return "text-warning";
    case "A": return "text-added";
    case "D": return "text-deleted";
    case "?": return "text-t4";
    default: return "text-t3";
  }
}

export function GitPanel() {
  const instance = useNodepodStore((s) => s.instance);
  const githubToken = useSettingsStore((s) => s.settings.github_token);
  const toggleSettings = useWorkspaceStore((s) => s.toggleSettings);

  const [isRepo, setIsRepo] = useState(false);
  const [branch, setBranch] = useState("");
  const [stagedFiles, setStagedFiles] = useState<GitFileChange[]>([]);
  const [unstagedFiles, setUnstagedFiles] = useState<GitFileChange[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; type: "info" | "error" } | null>(null);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [showTokenSetup, setShowTokenSetup] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearMsgRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMsg = () => {
    if (clearMsgRef.current) clearTimeout(clearMsgRef.current);
    clearMsgRef.current = setTimeout(() => { clearMsgRef.current = null; setActionMsg(null); }, 4000);
  };

  const gitEnv = useCallback(() => {
    const env: Record<string, string> = {};
    if (githubToken) env.GITHUB_TOKEN = githubToken;
    return env;
  }, [githubToken]);

  const refresh = useCallback(async () => {
    if (!instance) return;
    try {
      const { exitCode } = await gitExec(instance, ["rev-parse", "--is-inside-work-tree"]);
      if (exitCode !== 0) {
        setIsRepo(false);
        useRepositoryStatusStore.getState().clear();
        return;
      }
      setIsRepo(true);

      // Branch
      const branchResult = await gitExec(instance, ["branch", "--show-current"]);
      setBranch(branchResult.stdout.trim() || "HEAD (detached)");

      const changes = await refreshRepositoryStatus(instance);
      const staged: GitFileChange[] = changes
        .filter((change) => change.scope === "staged")
        .map((change) => ({ path: change.path, status: change.status, staged: true }));
      const unstaged: GitFileChange[] = changes
        .filter((change) => change.scope === "working")
        .map((change) => ({ path: change.path, status: change.status, staged: false }));

      setStagedFiles(staged);
      setUnstagedFiles(unstaged);
    } catch {
      setIsRepo(false);
      useRepositoryStatusStore.getState().clear();
    }
  }, [instance]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const initRepo = async () => {
    if (!instance) return;
    setLoading(true);
    try {
      await gitExec(instance, ["init"]);
      setActionMsg({ text: "Repository initialized", type: "info" });
      clearMsg();
      await refresh();
    } catch (e: any) {
      setActionMsg({ text: e.message || "Failed to init", type: "error" });
      clearMsg();
    }
    setLoading(false);
  };

  const stageFile = async (filePath: string) => {
    if (!instance) return;
    await gitExec(instance, ["add", filePath]);
    await refresh();
  };

  const unstageFile = async (filePath: string) => {
    if (!instance) return;
    await gitExec(instance, ["reset", "HEAD", filePath]);
    await refresh();
  };

  const stageAll = async () => {
    if (!instance) return;
    await gitExec(instance, ["add", "-A"]);
    await refresh();
  };

  const unstageAll = async () => {
    if (!instance) return;
    await gitExec(instance, ["reset", "HEAD"]);
    await refresh();
  };

  const discardFile = async (filePath: string) => {
    if (!instance) return;
    await gitExec(instance, ["checkout", "--", filePath]);
    await refresh();
  };

  const commit = async () => {
    if (!instance || !commitMsg.trim()) return;
    setLoading(true);
    try {
      const result = await gitExec(instance, ["commit", "-m", commitMsg.trim()]);
      if (result.exitCode !== 0) {
        setActionMsg({ text: result.stderr || "Commit failed", type: "error" });
      } else {
        setActionMsg({ text: "Changes committed", type: "info" });
        setCommitMsg("");
      }
      clearMsg();
      await refresh();
    } catch (e: any) {
      setActionMsg({ text: e.message || "Commit failed", type: "error" });
      clearMsg();
    }
    setLoading(false);
  };

  const push = async () => {
    if (!instance) return;
    if (!githubToken) {
      setShowTokenSetup(true);
      return;
    }
    setLoading(true);
    try {
      const result = await gitExec(instance, ["push"], gitEnv());
      if (result.exitCode !== 0) {
        setActionMsg({ text: result.stderr || "Push failed", type: "error" });
      } else {
        setActionMsg({ text: "Pushed to remote", type: "info" });
      }
      clearMsg();
    } catch (e: any) {
      setActionMsg({ text: e.message || "Push failed", type: "error" });
      clearMsg();
    }
    setLoading(false);
  };

  const pull = async () => {
    if (!instance) return;
    if (!githubToken) {
      setShowTokenSetup(true);
      return;
    }
    setLoading(true);
    try {
      const result = await gitExec(instance, ["pull"], gitEnv());
      if (result.exitCode !== 0) {
        setActionMsg({ text: result.stderr || "Pull failed", type: "error" });
      } else {
        setActionMsg({ text: "Pulled from remote", type: "info" });
      }
      clearMsg();
      await refresh();
    } catch (e: any) {
      setActionMsg({ text: e.message || "Pull failed", type: "error" });
      clearMsg();
    }
    setLoading(false);
  };

  if (!instance) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between h-[35px] px-3 border-b border-border shrink-0">
          <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">Git</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-[12px] text-t5">
          Waiting for runtime...
        </div>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between h-[35px] px-3 border-b border-border shrink-0">
          <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">Git</span>
          <button onClick={refresh} className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover" title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-t5 px-6">
          <FolderGit2 size={28} className="text-t5/50" />
          <div className="text-center">
            <p className="text-[12px] text-t4">No git repository</p>
            <p className="text-[11px] text-t5 mt-1">Initialize a repository to start tracking changes</p>
          </div>
          <button
            onClick={initRepo}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-white bg-accent hover:bg-accent/90 disabled:opacity-50"
          >
            <GitBranch size={12} />
            Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  if (showTokenSetup) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between h-[35px] px-3 border-b border-border shrink-0">
          <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">Git</span>
          <button onClick={() => setShowTokenSetup(false)} className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover text-[11px]">
            Back
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
          <KeyRound size={24} className="text-accent" />
          <div className="text-center">
            <p className="text-[13px] text-t1 font-medium">GitHub Token Required</p>
            <p className="text-[11px] text-t4 mt-1">
              Push and pull require a GitHub personal access token. Set it in Settings &gt; Git.
            </p>
          </div>
          <button
            onClick={() => { setShowTokenSetup(false); toggleSettings(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-white bg-accent hover:bg-accent/90"
          >
            <Settings size={12} />
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  const totalChanges = stagedFiles.length + unstagedFiles.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[35px] px-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">Git</span>
          <span className="text-[10px] text-accent font-mono">{branch}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={refresh} className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover" title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={cn(
          "px-3 py-1.5 text-[11px] border-b border-border",
          actionMsg.type === "error" ? "text-deleted bg-deleted/10" : "text-added bg-added/10"
        )}>
          {actionMsg.text}
        </div>
      )}

      {/* Commit input */}
      <div className="px-2 py-2 border-b border-border space-y-1.5">
        <input
          type="text"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && commitMsg.trim()) commit(); }}
          placeholder="Commit message..."
          className="w-full bg-bg3 border border-border rounded px-2 py-1 text-[12px] text-t1 placeholder-t4 outline-none focus:border-focus"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={commit}
            disabled={loading || !commitMsg.trim() || stagedFiles.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] text-white bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Commit staged changes"
          >
            <Check size={11} />
            Commit
          </button>
          <button
            onClick={pull}
            disabled={loading}
            className="p-1.5 rounded text-t4 hover:text-t3 hover:bg-hover border border-border"
            title="Pull"
          >
            <Download size={12} />
          </button>
          <button
            onClick={push}
            disabled={loading}
            className="p-1.5 rounded text-t4 hover:text-t3 hover:bg-hover border border-border"
            title="Push"
          >
            <Upload size={12} />
          </button>
        </div>
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {totalChanges === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-t5">
            <Check size={20} className="text-added/50" />
            <p className="text-[11px]">No changes</p>
          </div>
        ) : (
          <>
            {/* Staged changes */}
            <div>
              <button
                onClick={() => setStagedOpen(!stagedOpen)}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] text-t3 font-semibold uppercase tracking-wider hover:bg-hover"
              >
                <div className="flex items-center gap-1">
                  {stagedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  Staged ({stagedFiles.length})
                </div>
                {stagedFiles.length > 0 && (
                  <div
                    onClick={(e) => { e.stopPropagation(); unstageAll(); }}
                    className="p-0.5 rounded text-t4 hover:text-t3 hover:bg-hover cursor-pointer"
                    title="Unstage all"
                  >
                    <Minus size={11} />
                  </div>
                )}
              </button>
              {stagedOpen && stagedFiles.map((f) => (
                <div
                  key={`s-${f.path}`}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-hover group"
                >
                  <FileText size={12} className="text-t4 shrink-0" />
                  <span className="flex-1 text-[12px] text-t2 truncate">{f.path}</span>
                  <span className={cn("text-[10px] font-mono shrink-0", statusColor(f.status))}>
                    {f.status}
                  </span>
                  <button
                    onClick={() => unstageFile(f.path)}
                    className="p-0.5 rounded text-t4 hover:text-t3 opacity-0 group-hover:opacity-100"
                    title="Unstage"
                  >
                    <Minus size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Unstaged changes */}
            <div>
              <button
                onClick={() => setUnstagedOpen(!unstagedOpen)}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] text-t3 font-semibold uppercase tracking-wider hover:bg-hover"
              >
                <div className="flex items-center gap-1">
                  {unstagedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  Changes ({unstagedFiles.length})
                </div>
                <div className="flex items-center gap-0.5">
                  {unstagedFiles.length > 0 && (
                    <div
                      onClick={(e) => { e.stopPropagation(); stageAll(); }}
                      className="p-0.5 rounded text-t4 hover:text-t3 hover:bg-hover cursor-pointer"
                      title="Stage all"
                    >
                      <Plus size={11} />
                    </div>
                  )}
                </div>
              </button>
              {unstagedOpen && unstagedFiles.map((f) => (
                <div
                  key={`u-${f.path}`}
                  className="flex items-center gap-2 px-3 py-1 hover:bg-hover group"
                >
                  <FileText size={12} className="text-t4 shrink-0" />
                  <span className="flex-1 text-[12px] text-t2 truncate">{f.path}</span>
                  <span className={cn("text-[10px] font-mono shrink-0", statusColor(f.status))}>
                    {f.status}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => stageFile(f.path)}
                      className="p-0.5 rounded text-t4 hover:text-t3"
                      title="Stage"
                    >
                      <Plus size={11} />
                    </button>
                    {f.status !== "?" && (
                      <button
                        onClick={() => discardFile(f.path)}
                        className="p-0.5 rounded text-t4 hover:text-deleted"
                        title="Discard changes"
                      >
                        <Undo2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer — token status */}
      {!githubToken && (
        <div className="px-3 py-2 border-t border-border">
          <button
            onClick={() => setShowTokenSetup(true)}
            className="flex items-center gap-1.5 text-[10px] text-t4 hover:text-t3"
          >
            <KeyRound size={10} />
            Set up GitHub token for push/pull
          </button>
        </div>
      )}
    </div>
  );
}
