"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/cn";
import {
  Send,
  Bot,
  User,
  Wrench,
  Loader2,
  Plus,
  Crosshair,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Search,
  Check,
} from "lucide-react";
import { WarperComponent } from "@itsmeadarsh/warper";
import { useSettingsStore } from "@/stores/settings-store";
import { useNodepodStore } from "@/stores/nodepod-store";
import {
  type ChatMessage,
  type OpenRouterModel,
  type ErrorReportData,
  runAgentTurn,
  createNodepodToolExecutor,
  fetchOpenRouterModels,
} from "@/lib/ai-sdk";
import { ErrorReportModal } from "./ErrorReportModal";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "./ui/DropdownMenu";

interface UITextMessage {
  kind: "text";
  role: "user" | "assistant";
  content: string;
}

interface UIToolCallMessage {
  kind: "tool_call";
  callId: string;
  name: string;
  args: string;
  result?: string;
  collapsed?: boolean;
}

type UIMessage = UITextMessage | UIToolCallMessage;

let _persistedMessages: UIMessage[] = [];
let _persistedChatHistory: ChatMessage[] = [];
let _abortController: AbortController | null = null;

function ToolCallBubble({ msg }: { msg: UIToolCallMessage }) {
  const [collapsed, setCollapsed] = useState(msg.collapsed ?? true);

  let parsedArgs = "";
  try {
    const obj = JSON.parse(msg.args);
    parsedArgs = Object.entries(obj)
      .map(
        ([k, v]) =>
          `${k}: ${typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "..." : v}`,
      )
      .join(", ");
  } catch {
    parsedArgs = msg.args.slice(0, 100);
  }

  return (
    <div className="flex gap-2 items-start min-w-0">
      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 bg-warning/20 text-warning">
        <Wrench size={11} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-[11px] text-t3 hover:text-t1 font-mono max-w-full"
        >
          {collapsed ? (
            <ChevronRight size={10} className="shrink-0" />
          ) : (
            <ChevronDown size={10} className="shrink-0" />
          )}
          <span className="font-semibold shrink-0">{msg.name}</span>
          <span className="text-t5 truncate">({parsedArgs})</span>
        </button>
        {!collapsed && msg.result && (
          <pre className="mt-1 p-2 bg-bg0 border border-border rounded text-[10px] text-t3 font-mono overflow-x-auto max-h-[200px] whitespace-pre-wrap break-all">
            {msg.result}
          </pre>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: UIMessage }) {
  if (msg.kind === "tool_call") {
    return <ToolCallBubble msg={msg} />;
  }

  return (
    <div className="flex gap-2.5 items-start">
      <div
        className={cn(
          "w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5",
          msg.role === "assistant"
            ? "bg-purple/20 text-purple"
            : "bg-accent/20 text-accent",
        )}
      >
        {msg.role === "assistant" ? <Bot size={12} /> : <User size={12} />}
      </div>
      <div className="text-[12px] text-t3 leading-relaxed whitespace-pre-wrap min-w-0 flex-1 break-words overflow-hidden">
        {msg.content}
      </div>
    </div>
  );
}

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 340;
const MODEL_ROW_HEIGHT = 40;

function VirtualModelList({
  models,
  selectedId,
  height,
  onSelect,
  formatPrice,
}: {
  models: OpenRouterModel[];
  selectedId: string;
  height: number;
  onSelect: (id: string) => void;
  formatPrice: (p: string) => string;
}) {
  return (
    <WarperComponent
      itemCount={models.length}
      estimateSize={() => MODEL_ROW_HEIGHT}
      overscan={5}
      height={height}
      className="scrollbar-thin"
    >
      {(index) => {
        const m = models[index];
        if (!m) return null;
        const isSelected = m.id === selectedId;
        return (
          <button
            onClick={() => onSelect(m.id)}
            className={cn(
              "w-full flex items-center gap-2 px-2.5 text-left rounded-sm hover:bg-hover transition-colors",
              isSelected && "bg-accent/10",
            )}
            style={{ height: MODEL_ROW_HEIGHT, pointerEvents: "auto" }}
          >
            <span className="w-3.5 shrink-0 flex items-center justify-center">
              {isSelected && <Check size={11} className="text-accent" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-t2 truncate leading-tight">
                {m.name}
              </div>
              <div className="text-[10px] text-t5 truncate leading-tight">
                {m.id} · {(m.context_length / 1000).toFixed(0)}k
              </div>
            </div>
            <div className="text-[10px] text-t5 shrink-0 text-right leading-tight">
              <div>{formatPrice(m.pricing.prompt)}/M in</div>
              <div>{formatPrice(m.pricing.completion)}/M out</div>
            </div>
          </button>
        );
      }}
    </WarperComponent>
  );
}

function ModelSelector({
  model,
  apiKey,
  onSelect,
}: {
  model: string;
  apiKey: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !apiKey) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchOpenRouterModels(apiKey)
      .then((m) => {
        if (!cancelled) {
          setModels(m);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Failed to load models");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiKey]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSearch("");
    }
  }, [open]);

  const filtered = useMemo(
    () =>
      search
        ? models.filter(
            (m) =>
              m.name.toLowerCase().includes(search.toLowerCase()) ||
              m.id.toLowerCase().includes(search.toLowerCase()),
          )
        : models,
    [models, search],
  );

  const displayName = model.includes("/")
    ? (model.split("/").pop() ?? model)
    : model;

  const formatPrice = (p: string) => {
    const n = parseFloat(p);
    if (!n || isNaN(n)) return "free";
    const perM = n * 1_000_000;
    if (perM < 0.01) return "<$0.01";
    if (perM >= 100) return `$${perM.toFixed(0)}`;
    if (perM >= 1) return `$${perM.toFixed(2)}`;
    return `$${perM.toFixed(3)}`;
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="flex items-center gap-1 bg-transparent text-[11px] text-t4 outline-none cursor-pointer hover:text-t3 px-1 py-0.5 rounded hover:bg-hover max-w-[160px]">
        <span className="truncate">{displayName}</span>
        <ChevronDown size={10} className="shrink-0 opacity-60" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="end"
        className="overflow-hidden bg-bg1 border-border"
        style={{ width: POPOVER_WIDTH, height: POPOVER_HEIGHT }}
      >
        {/* Search bar */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <Search size={12} className="text-t5 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="flex-1 bg-transparent text-[12px] text-t1 placeholder-t5 outline-none min-w-0"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>

        <div className="w-full h-px border-t border-border my-1"></div>

        {/* Model list */}
        <div style={{ height: POPOVER_HEIGHT - 52 }}>
          {loading ? (
            <div className="p-1.5 space-y-0.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-2 rounded"
                >
                  <div className="flex-1 space-y-1.5">
                    <div
                      className="h-3 bg-bg3 rounded animate-pulse"
                      style={{ width: `${60 + (i % 3) * 15}%` }}
                    />
                    <div
                      className="h-2.5 bg-bg3/60 rounded animate-pulse"
                      style={{ width: `${40 + (i % 4) * 10}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-red-400">{error}</p>
              <button
                onClick={() => {
                  setLoading(true);
                  setError("");
                  fetchOpenRouterModels(apiKey)
                    .then(setModels)
                    .catch((e) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
                className="mt-2 text-[11px] text-accent hover:underline"
              >
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-t5">
              No models match &ldquo;{search}&rdquo;
            </div>
          ) : (
            <VirtualModelList
              models={filtered}
              selectedId={model}
              height={POPOVER_HEIGHT - 52}
              onSelect={(id) => {
                onSelect(id);
                setOpen(false);
              }}
              formatPrice={formatPrice}
            />
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AIPanel() {
  const [messages, setMessages] = useState<UIMessage[]>(_persistedMessages);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(
    _persistedChatHistory,
  );
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [showConfig, setShowConfig] = useState(
    !useSettingsStore.getState().settings.openrouter_api_key,
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [errorReport, setErrorReport] = useState<{
    data: ErrorReportData;
    resolve: (reported: boolean) => void;
  } | null>(null);
  const [followMode, setFollowMode] = useState(false);

  const apiKey = useSettingsStore((s) => s.settings.openrouter_api_key);
  const model = useSettingsStore((s) => s.settings.openrouter_model);
  const setSetting = useSettingsStore((s) => s.set);
  const nodepod = useNodepodStore((s) => s.instance);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    _persistedMessages = messages;
  }, [messages]);

  useEffect(() => {
    _persistedChatHistory = chatHistory;
  }, [chatHistory]);

  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    if (streamingContent) {
      scrollTimerRef.current = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 80);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current); };
  }, [messages, streamingContent]);

  useEffect(() => {
    if (apiKey) setShowConfig(false);
    else setShowConfig(true);
  }, [apiKey]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isRunning) return;
    if (!apiKey) {
      setShowConfig(true);
      return;
    }

    const userMessage = input.trim();
    setInput("");
    setIsRunning(true);
    setStreamingContent("");

    const newUIMessages: UIMessage[] = [
      ...messages,
      { kind: "text", role: "user", content: userMessage },
    ];
    setMessages(newUIMessages);

    const newHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: userMessage },
    ];
    setChatHistory(newHistory);

    const toolExecutor = nodepod
      ? createNodepodToolExecutor(nodepod, {
          onReportError: (data) =>
            new Promise<boolean>((resolve) => {
              setErrorReport({ data, resolve });
            }),
        })
      : async () => "Error: Nodepod not available";

    _abortController = new AbortController();

    let currentContent = "";
    const uiUpdates: UIMessage[] = [...newUIMessages];

    try {
      const finalHistory = await runAgentTurn(
        apiKey,
        model,
        newHistory,
        toolExecutor,
        {
          onToken: (token) => {
            currentContent += token;
            setStreamingContent(currentContent);
          },
          onToolCall: (call) => {
            if (currentContent) {
              uiUpdates.push({
                kind: "text",
                role: "assistant",
                content: currentContent,
              });
              currentContent = "";
              setStreamingContent("");
            }
            let argsStr = call.function.arguments;
            try {
              argsStr = JSON.stringify(
                JSON.parse(call.function.arguments),
                null,
                2,
              );
            } catch {
              /* keep raw */
            }
            uiUpdates.push({
              kind: "tool_call",
              callId: call.id,
              name: call.function.name,
              args: argsStr,
            });
            setMessages([...uiUpdates]);
          },
          onToolResult: (callId, _name, result) => {
            const idx = uiUpdates.findIndex(
              (m) => m.kind === "tool_call" && m.callId === callId,
            );
            if (idx >= 0) {
              (uiUpdates[idx] as UIToolCallMessage).result = result;
              setMessages([...uiUpdates]);
            }
          },
          onComplete: (assistantMsg) => {
            if (assistantMsg.content && !assistantMsg.tool_calls?.length) {
              uiUpdates.push({
                kind: "text",
                role: "assistant",
                content: assistantMsg.content,
              });
              currentContent = "";
              setStreamingContent("");
              setMessages([...uiUpdates]);
            }
          },
          onError: (error) => {
            uiUpdates.push({
              kind: "text",
              role: "assistant",
              content: `Error: ${error}`,
            });
            setMessages([...uiUpdates]);
          },
        },
        _abortController.signal,
      );

      setChatHistory(finalHistory);

      if (currentContent) {
        uiUpdates.push({
          kind: "text",
          role: "assistant",
          content: currentContent,
        });
        setStreamingContent("");
        setMessages([...uiUpdates]);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        uiUpdates.push({
          kind: "text",
          role: "assistant",
          content: "(Cancelled)",
        });
      } else {
        const errMsg = e instanceof Error ? e.message : "Unknown error";
        uiUpdates.push({
          kind: "text",
          role: "assistant",
          content: `Error: ${errMsg}`,
        });
      }
      setMessages([...uiUpdates]);
      setStreamingContent("");
    } finally {
      setIsRunning(false);
      _abortController = null;
      setErrorReport(null);
    }
  }, [input, isRunning, apiKey, model, nodepod, messages, chatHistory]);

  const handleStop = () => {
    if (_abortController) {
      _abortController.abort();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setChatHistory([]);
    setStreamingContent("");
    _persistedMessages = [];
    _persistedChatHistory = [];
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden bg-bg0">
      {/* Header */}
      <div className="flex items-center h-[35px] px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold text-t3">New thread</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowConfig(!showConfig)}
          className={cn(
            "p-1 rounded hover:bg-hover",
            showConfig ? "text-accent" : "text-t5 hover:text-t3",
          )}
          title="API Key"
        >
          <KeyRound size={12} />
        </button>
        <button
          onClick={handleClear}
          className="p-1 rounded text-t5 hover:text-t3 hover:bg-hover"
          title="New thread"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin p-3 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {streamingContent && (
          <div className="flex gap-2.5 items-start">
            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 bg-purple/20 text-purple">
              <Bot size={12} />
            </div>
            <div className="text-[12px] text-t3 leading-relaxed whitespace-pre-wrap min-w-0 flex-1 break-words overflow-hidden">
              {streamingContent}
              <span className="inline-block w-1.5 h-3.5 bg-accent ml-0.5 animate-pulse" />
            </div>
          </div>
        )}
        {isRunning && !streamingContent && (
          <div className="flex gap-2.5 items-center">
            <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 bg-purple/20 text-purple">
              <Loader2 size={12} className="animate-spin" />
            </div>
            <span className="text-[11px] text-t4">Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border shrink-0 bg-bg1 min-w-0 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 120) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            apiKey ? "Ask the AI to help..." : "Set your API key first..."
          }
          rows={3}
          className="w-full bg-transparent text-[12px] text-t1 placeholder-t5 outline-none resize-none min-h-[50px] px-3 pt-2 pb-1"
          disabled={!apiKey}
        />
        {/* Actions row */}
        <div className="flex items-center h-[30px] px-1.5">
          <button
            className="p-1 rounded text-t5 hover:text-t3 hover:bg-hover"
            title="Attachments"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setFollowMode(!followMode)}
            className={cn(
              "p-1 rounded transition-colors",
              followMode
                ? "text-red-400 bg-red-400/10 hover:bg-red-400/20"
                : "text-t5 hover:text-t3 hover:bg-hover"
            )}
            title="Follow mode"
          >
            <Crosshair size={14} />
          </button>
          <div className="flex-1" />
          <ModelSelector
            model={model}
            apiKey={apiKey}
            onSelect={(id) => setSetting("openrouter_model", id)}
          />
          {isRunning ? (
            <button
              onClick={handleStop}
              className="p-1 rounded text-warning hover:bg-warning/10 shrink-0"
              title="Stop"
            >
              <div className="w-3.5 h-3.5 rounded-sm bg-warning" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() || !apiKey}
              className={cn(
                "p-1 rounded shrink-0",
                input.trim() && apiKey
                  ? "text-accent hover:bg-accent/10"
                  : "text-t5",
              )}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Config panel (API key) */}
      {showConfig && (
        <div className="px-3 py-2.5 border-t border-border bg-bg0 shrink-0 min-w-0 overflow-hidden">
          <label className="block text-[10px] text-t4 uppercase tracking-wider font-semibold mb-1">
            OpenRouter API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setSetting("openrouter_api_key", e.target.value)}
            placeholder="sk-or-..."
            className="w-full bg-bg3 border border-border rounded px-2.5 py-1.5 text-[12px] text-t1 placeholder-t5 outline-none focus:border-focus font-mono"
          />
          <p className="text-[10px] text-t5 mt-1">
            Get your key at openrouter.ai
          </p>
        </div>
      )}

      {errorReport && (
        <ErrorReportModal
          data={errorReport.data}
          onConfirm={() => {
            errorReport.resolve(true);
            setErrorReport(null);
          }}
          onDismiss={() => {
            errorReport.resolve(false);
            setErrorReport(null);
          }}
        />
      )}
    </div>
  );
}
