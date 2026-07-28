"use client";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/cn";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  Search,
  Replace,
  CaseSensitive,
  Regex,
  WholeWord,
  ChevronDown,
  ChevronRight,
  FileCode,
  Loader2,
} from "lucide-react";

const BINARY_EXTS = new Set(["png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "otf", "mp3", "mp4", "webm", "zip", "tar", "gz", "wasm"]);
let _nodepodStoreCache: typeof import("@/stores/nodepod-store") | null = null;

interface SearchResult {
  file: string;       // relative path from /project
  fileName: string;   // just the filename
  fullPath: string;   // full VFS path for opening tabs
  line: number;
  content: string;
  matchStart: number;
  matchEnd: number;
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openTab = useWorkspaceStore((s) => s.openTab);

  const doSearch = useCallback(async (q: string, cs: boolean, ww: boolean, rx: boolean) => {
    if (!q.trim()) {
      setResults([]);
      setSearchedQuery("");
      return;
    }

    setSearching(true);
    setSearchedQuery(q);

    try {
      if (!_nodepodStoreCache) _nodepodStoreCache = await import("@/stores/nodepod-store");
      const nodepod = _nodepodStoreCache.useNodepodStore.getState().instance;
      if (!nodepod) { setResults([]); setSearching(false); return; }
      const activeNodepod = nodepod;

      let pattern: string;
      let flags = "g";
      if (!cs) flags += "i";
      if (rx) {
        pattern = q;
      } else {
        pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      if (ww) pattern = `\\b${pattern}\\b`;

      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch {
        setResults([]);
        setSearching(false);
        return;
      }

      const found: SearchResult[] = [];
      const MAX_RESULTS = 500;

      let _fileCount = 0;
      async function searchDir(dirPath: string, relPrefix: string) {
        if (found.length >= MAX_RESULTS) return;
        let entries: string[];
        try {
          entries = await activeNodepod.fs.readdir(dirPath);
        } catch { return; }

        for (const name of entries) {
          if (found.length >= MAX_RESULTS) break;
          if (name === "node_modules" || name === ".cache" || name === ".npm" || name === ".git") continue;

          const fullPath = dirPath.endsWith("/") ? `${dirPath}${name}` : `${dirPath}/${name}`;
          const relPath = relPrefix ? `${relPrefix}/${name}` : name;

          try {
            const stat = await activeNodepod.fs.stat(fullPath);
            if (stat.isDirectory) {
              await searchDir(fullPath, relPath);
            } else {
              const ext = name.split(".").pop()?.toLowerCase() ?? "";
              if (BINARY_EXTS.has(ext)) continue;

              let content: string;
              try {
                content = await activeNodepod.fs.readFile(fullPath, "utf-8");
                if (typeof content !== "string") continue;
              } catch { continue; }

              if (++_fileCount % 20 === 0) {
                await new Promise<void>((r) => setTimeout(r, 0));
              }

              const lines = content.split("\n");
              for (let i = 0; i < lines.length && found.length < MAX_RESULTS; i++) {
                const line = lines[i];
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(line)) !== null && found.length < MAX_RESULTS) {
                  found.push({
                    file: relPath,
                    fileName: name,
                    fullPath: fullPath,
                    line: i + 1,
                    content: line.length > 300 ? line.slice(0, 300) : line,
                    matchStart: m.index,
                    matchEnd: m.index + m[0].length,
                  });
                  if (m[0].length === 0) re.lastIndex++;
                }
              }
            }
          } catch { /* skip */ }
        }
      }

      await searchDir("/project", "");
      setResults(found);
      setExpandedFiles(new Set(found.map(r => r.file)));
    } catch (e) {
      console.error("Search error:", e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults([]);
      setSearchedQuery("");
      return;
    }
    searchTimer.current = setTimeout(() => {
      doSearch(query, caseSensitive, wholeWord, useRegex);
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, caseSensitive, wholeWord, useRegex, doSearch]);

  const groupedResults = useMemo(() => results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.file]) acc[r.file] = [];
    acc[r.file].push(r);
    return acc;
  }, {}), [results]);

  const toggleFile = (file: string) => {
    const next = new Set(expandedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    setExpandedFiles(next);
  };

  const handleResultClick = (r: SearchResult) => {
    openTab(r.fullPath);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-[35px] px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-wider text-t4 uppercase">
          Search
        </span>
      </div>

      {/* Search input */}
      <div className="p-2 border-b border-border space-y-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowReplace(!showReplace)}
            className="p-0.5 rounded text-t4 hover:text-t3"
          >
            {showReplace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className="flex-1 min-w-0 flex items-center bg-bg3 border border-border rounded focus-within:border-focus">
            <Search size={12} className="text-t4 ml-2 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // Immediate search on Enter
                  if (searchTimer.current) clearTimeout(searchTimer.current);
                  doSearch(query, caseSensitive, wholeWord, useRegex);
                }
              }}
              placeholder="Search"
              className="flex-1 min-w-0 bg-transparent px-2 py-1 text-[12px] text-t1 placeholder-t5 outline-none"
            />
            <div className="flex items-center gap-0.5 pr-1">
              <button
                onClick={() => setCaseSensitive(!caseSensitive)}
                className={cn(
                  "p-0.5 rounded",
                  caseSensitive ? "text-accent bg-accent/10" : "text-t4 hover:text-t3"
                )}
                aria-label="Match Case"
                aria-pressed={caseSensitive}
              >
                <CaseSensitive size={14} />
              </button>
              <button
                onClick={() => setWholeWord(!wholeWord)}
                className={cn(
                  "p-0.5 rounded",
                  wholeWord ? "text-accent bg-accent/10" : "text-t4 hover:text-t3"
                )}
                aria-label="Match Whole Word"
                aria-pressed={wholeWord}
              >
                <WholeWord size={14} />
              </button>
              <button
                onClick={() => setUseRegex(!useRegex)}
                className={cn(
                  "p-0.5 rounded",
                  useRegex ? "text-accent bg-accent/10" : "text-t4 hover:text-t3"
                )}
                aria-label="Use Regular Expression"
                aria-pressed={useRegex}
              >
                <Regex size={14} />
              </button>
            </div>
          </div>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1 ml-5">
            <div className="flex-1 min-w-0 flex items-center bg-bg3 border border-border rounded focus-within:border-focus">
              <Replace size={12} className="text-t4 ml-2 shrink-0" />
              <input
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace"
                className="flex-1 min-w-0 bg-transparent px-2 py-1 text-[12px] text-t1 placeholder-t5 outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {searching ? (
          <div className="flex items-center justify-center h-full text-t5 text-[12px] gap-2">
            <Loader2 size={14} className="animate-spin" />
            Searching...
          </div>
        ) : searchedQuery ? (
          <div className="py-1">
            <div className="px-3 py-1 text-[11px] text-t4">
              {results.length >= 500 ? "500+ results" : `${results.length} result${results.length !== 1 ? "s" : ""}`} in {Object.keys(groupedResults).length} file{Object.keys(groupedResults).length !== 1 ? "s" : ""}
            </div>
            {Object.entries(groupedResults).map(([file, fileResults]) => (
              <div key={file}>
                <div
                  className="flex items-center gap-1.5 px-3 py-[3px] text-[12px] cursor-pointer hover:bg-hover"
                  onClick={() => toggleFile(file)}
                >
                  {expandedFiles.has(file) ? (
                    <ChevronDown size={10} className="text-t4" />
                  ) : (
                    <ChevronRight size={10} className="text-t4" />
                  )}
                  <FileCode size={12} className="text-[#dea584]" />
                  <span className="text-t1 truncate">{file}</span>
                  <span className="text-t5 text-[10px] ml-auto">{fileResults.length}</span>
                </div>
                {expandedFiles.has(file) && fileResults.map((r) => (
                  <div
                    key={`${r.file}:${r.line}:${r.matchStart}`}
                    className="flex items-center gap-2 px-3 py-[2px] text-[12px] hover:bg-hover cursor-pointer"
                    style={{ paddingLeft: 28 }}
                    onClick={() => handleResultClick(r)}
                  >
                    <span className="text-t5 w-6 text-right flex-shrink-0 font-mono text-[11px]">
                      {r.line}
                    </span>
                    <span className="text-t3 truncate font-mono text-[11px]">
                      {r.content.slice(0, r.matchStart)}
                      <span className="bg-[#d19a6640] text-t1">
                        {r.content.slice(r.matchStart, r.matchEnd)}
                      </span>
                      {r.content.slice(r.matchEnd)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {results.length === 0 && (
              <div className="px-3 py-2 text-t5 text-[12px]">
                No results found
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-t5 text-[12px]">
            Type to search across project files
          </div>
        )}
      </div>
    </div>
  );
}
