"use client";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/cn";
import { useNodepodStore } from "@/stores/nodepod-store";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  Shield,
  X,
  Plus,
  Globe,
  Send,
} from "lucide-react";
import { RequestSender } from "./RequestSender";

interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

let nextTabId = 1;
function createTab(url = "about:blank", title = "Preview"): BrowserTab {
  return { id: `btab-${nextTabId++}`, title, url };
}

function getPreviewPort(url: string): number | null {
  const m = url.match(/\/__(?:virtual|preview)\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : null;
}

function isNodepodPreview(url: string): boolean {
  return /\/__(?:virtual|preview)\//.test(url);
}

function previewTitle(url: string): string {
  const port = getPreviewPort(url);
  if (port) return `localhost:${port}`;
  try {
    return new URL(url, window.location.origin).host || "Preview";
  } catch {
    return "Preview";
  }
}

export function BrowserPanel() {
  const serverPorts = useNodepodStore((s) => s.serverPorts);
  const runtimeId = useNodepodStore((s) => s.runtimeId);
  const externalPreviewUrl = useNodepodStore((s) => s.externalPreviewUrl);
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [
    createTab(),
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [inputValue, setInputValue] = useState(tabs[0].url);
  const [isLoading, setIsLoading] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigatedPortsRef = useRef<Set<number>>(new Set());

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const firstPreview = useMemo(() => {
    for (const entry of serverPorts) return entry;
    return null;
  }, [serverPorts]);

  useEffect(() => {
    const tab = createTab();
    navigatedPortsRef.current.clear();
    setTabs([tab]);
    setActiveTabId(tab.id);
    setInputValue(tab.url);
    setIsLoading(false);
    setShowSender(false);
  }, [runtimeId]);

  useEffect(() => {
    for (const [port, url] of serverPorts) {
      if (!navigatedPortsRef.current.has(port)) {
        navigatedPortsRef.current.add(port);
        const previewUrl = url.endsWith("/") ? url : `${url}/`;
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, url: previewUrl, title: `localhost:${port}` } : t
          )
        );
        setInputValue(previewUrl);
        setIsLoading(true);
        break;
      }
    }
  }, [serverPorts, activeTabId]);

  useEffect(() => {
    if (!externalPreviewUrl) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, url: externalPreviewUrl, title: previewTitle(externalPreviewUrl) }
          : tab,
      ),
    );
    setInputValue(externalPreviewUrl);
    setIsLoading(true);
  }, [activeTabId, externalPreviewUrl]);

  const navigate = useCallback(
    (url: string) => {
      let resolved = url.trim();
      if (!resolved) return;

      if (isNodepodPreview(resolved) || /^https?:\/\//i.test(resolved)) {
        // Nodepod and deployed preview URLs can be used directly.
      } else if (/^localhost:\d+/i.test(resolved)) {
        const m = resolved.match(/^localhost:(\d+)(\/.*)?$/i);
        if (m) {
          const base = serverPorts.get(Number(m[1]));
          if (!base) return;
          resolved = new URL((m[2] || "/").replace(/^\//, ""), `${base}/`).toString();
        }
      }
      else if (/^https?:\/\/localhost:\d+/i.test(resolved)) {
        const m = resolved.match(/^https?:\/\/localhost:(\d+)(\/.*)?$/i);
        if (m) {
          const base = serverPorts.get(Number(m[1]));
          if (!base) return;
          resolved = new URL((m[2] || "/").replace(/^\//, ""), `${base}/`).toString();
        }
      }
      else if (resolved.startsWith("/")) {
        const port = getPreviewPort(activeTab.url);
        const base = (port && serverPorts.get(port)) || firstPreview?.[1];
        if (!base) return;
        resolved = new URL(resolved.replace(/^\//, ""), `${base}/`).toString();
      }
      else {
        return;
      }

      const title = previewTitle(resolved);

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, url: resolved, title } : t
        )
      );
      setInputValue(resolved);
      setIsLoading(true);
    },
    [activeTabId, activeTab.url, firstPreview, serverPorts]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigate(inputValue);
      inputRef.current?.blur();
    }
  };

  const reload = () => {
    const iframe = iframeRef.current;
    if (iframe) {
      setIsLoading(true);
      iframe.src = activeTab.url;
    }
  };

  const goHome = () => {
    if (firstPreview) {
      navigate(firstPreview[1]);
    } else if (externalPreviewUrl) {
      navigate(externalPreviewUrl);
    } else {
      return;
    }
  };

  const addTab = () => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setInputValue(tab.url);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  };

  const closeTab = (id: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      const newActive = newTabs[Math.min(idx, newTabs.length - 1)];
      setActiveTabId(newActive.id);
      setInputValue(newActive.url);
    }
  };

  const switchTab = (id: string) => {
    setActiveTabId(id);
    const tab = tabs.find((t) => t.id === id);
    if (tab) setInputValue(tab.url);
  };

  const senderBaseUrl = isNodepodPreview(activeTab.url)
    ? activeTab.url
    : firstPreview
      ? firstPreview[1]
      : "/";

  return (
    <div className="flex flex-col h-full bg-bg0">
      {/* Tab bar */}
      <div className="flex items-center h-[35px] border-b border-border shrink-0">
        <div className="flex items-center flex-1 min-w-0 h-full overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full min-w-[100px] max-w-[180px] cursor-pointer select-none border-r border-border group",
                tab.id === activeTabId
                  ? "bg-bg2 text-t1"
                  : "bg-bg0 text-t4 hover:text-t3 hover:bg-bg1"
              )}
            >
              <Globe size={11} className="shrink-0 text-t4" />
              <span className="truncate text-[12px] flex-1">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={cn(
                    "p-0.5 rounded hover:bg-hover",
                    tab.id === activeTabId
                      ? "opacity-60 hover:opacity-100"
                      : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                  )}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addTab}
          className="p-1.5 mx-1 rounded text-t4 hover:text-t3 hover:bg-hover shrink-0"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-1.5 h-[34px] px-2 border-b border-border shrink-0">
        <button
          onClick={() => { try { iframeRef.current?.contentWindow?.history.back(); } catch { /* cross-origin */ } }}
          className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
          aria-label="Go back"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => { try { iframeRef.current?.contentWindow?.history.forward(); } catch { /* cross-origin */ } }}
          className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
          aria-label="Go forward"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={reload}
          className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
        >
          <RotateCw size={12} className={isLoading ? "animate-spin" : ""} />
        </button>
        <button
          onClick={goHome}
          className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
          title="Home"
        >
          <Home size={13} />
        </button>

        <div className="flex-1 flex items-center bg-bg3 border border-border rounded-md px-2.5 py-1 gap-2 focus-within:border-focus min-w-0">
          <Shield size={11} className="text-t4 shrink-0" />
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(e) => e.target.select()}
            placeholder="Enter local path or localhost:port/path"
            className="flex-1 bg-transparent text-[12px] text-t1 placeholder-t4 outline-none min-w-0"
            spellCheck={false}
          />
        </div>

        {/* API Sender toggle */}
        <button
          onClick={() => setShowSender((v) => !v)}
          className={cn(
            "p-1 rounded hover:bg-hover",
            showSender ? "text-accent" : "text-t4 hover:text-t3"
          )}
          title="API Request Sender"
        >
          <Send size={13} />
        </button>
      </div>

      {/* Browser viewport or Sender */}
      <div className="flex-1 min-h-0 bg-white relative">
        {showSender ? (
          <RequestSender baseUrl={senderBaseUrl} />
        ) : (
          <>
            {isLoading && (
              <div className="absolute top-0 left-0 right-0 h-[2px] z-10">
                <div className="h-full bg-accent animate-pulse" style={{ width: "60%" }} />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={activeTab.url}
              className="w-full h-full border-none"
              allow="cross-origin-isolated"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              onLoad={() => setIsLoading(false)}
              title="Browser"
            />
          </>
        )}
      </div>
    </div>
  );
}
