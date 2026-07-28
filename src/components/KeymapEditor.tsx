"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/cn";
import { useKeymapStore, type KeyBinding } from "@/stores/keymap-store";
import {
  Search,
  Plus,
  RotateCcw,
  Code,
  X,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/DropdownMenu";

// turn a KeyboardEvent into something like "Ctrl-Shift-K"
function eventToKeyString(e: KeyboardEvent): string | null {
  // Ignore lone modifier presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  let key = e.key;
  // Normalize key names
  if (key === " ") key = "Space";
  else if (key === "ArrowUp") key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight") key = "Right";
  else if (key === "Escape") key = "Escape";
  else if (key === "Enter") key = "Enter";
  else if (key === "Backspace") key = "Backspace";
  else if (key === "Delete") key = "Delete";
  else if (key === "Tab") key = "Tab";
  else if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join("-");
}

function KeyBadge({ keys }: { keys: string }) {
  if (!keys) return <span className="text-t5 text-[11px] italic">unset</span>;
  return (
    <span className="inline-flex gap-1">
      {keys.split(" ").map((chord) => (
        <span key={chord} className="px-1.5 py-0.5 rounded bg-bg0 border border-border text-[11px] text-t2 font-mono">
          {chord}
        </span>
      ))}
    </span>
  );
}

function KeyCaptureInput({ onChange, onCancel }: { onChange: (v: string) => void; onCancel: () => void }) {
  const [captured, setCaptured] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onCancel();
      return;
    }

    const keyStr = eventToKeyString(e.nativeEvent);
    if (!keyStr) return;

    setCaptured((prev) => {
      const next = [...prev, keyStr];
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        onChange(next.join(" "));
      }, 800);
      return next;
    });
  }, [onChange, onCancel]);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        className="bg-bg0 border border-focus rounded px-2 py-0.5 text-[11px] text-t1 font-mono outline-none w-[180px]"
        value={captured.length > 0 ? captured.join(" ") : "Press keys..."}
        readOnly
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
      />
      <span className="text-[10px] text-t5">Press Escape to cancel</span>
    </div>
  );
}

function BindingRow({ binding }: { binding: KeyBinding }) {
  const [editing, setEditing] = useState(false);
  const updateBinding = useKeymapStore((s) => s.updateBinding);
  const resetBinding = useKeymapStore((s) => s.resetBinding);

  return (
    <tr className="border-b border-border/50 hover:bg-hover/50 group">
      <td className="py-1.5 px-3 text-[11px] text-t2">{binding.action}</td>
      <td className="py-1.5 px-3">
        {editing ? (
          <KeyCaptureInput
            onChange={(keys) => { updateBinding(binding.id, keys); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="hover:bg-bg3 rounded px-1 py-0.5 -mx-1 transition-colors"
            title="Click to rebind"
          >
            <KeyBadge keys={binding.keys} />
          </button>
        )}
      </td>
      <td className="py-1.5 px-3 text-[11px] text-t4">{binding.context}</td>
      <td className="py-1.5 px-3 text-[11px]">
        <span className={binding.source === "User" ? "text-accent" : "text-t5"}>
          {binding.source}
        </span>
      </td>
      <td className="py-1.5 px-2 w-8">
        {binding.source === "User" && (
          <button
            onClick={() => resetBinding(binding.id)}
            className="p-0.5 rounded text-t5 hover:text-t3 hover:bg-hover opacity-0 group-hover:opacity-100 transition-opacity"
            title="Reset to default"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </td>
    </tr>
  );
}

function CreateBindingRow({ onCreated }: { onCreated: () => void }) {
  const [action, setAction] = useState("");
  const [context, setContext] = useState("Global");
  const [capturingKeys, setCapturingKeys] = useState(false);
  const addBinding = useKeymapStore((s) => s.addBinding);

  if (capturingKeys) {
    return (
      <tr className="border-b border-border/50 bg-bg3/50">
        <td className="py-1.5 px-3 text-[11px] text-t2">{action}</td>
        <td className="py-1.5 px-3" colSpan={4}>
          <KeyCaptureInput
            onChange={(keys) => {
              addBinding(action, keys, context);
              setCapturingKeys(false);
              setAction("");
              onCreated();
            }}
            onCancel={() => setCapturingKeys(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/50 bg-bg3/30">
      <td className="py-1.5 px-3">
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action name..."
          className="bg-transparent text-[11px] text-t1 placeholder-t5 outline-none w-full"
        />
      </td>
      <td className="py-1.5 px-3">
        <button
          onClick={() => { if (action.trim()) setCapturingKeys(true); }}
          className={cn(
            "text-[11px] px-2 py-0.5 rounded",
            action.trim() ? "text-accent hover:bg-accent/10" : "text-t5 cursor-not-allowed"
          )}
          disabled={!action.trim()}
        >
          Set keys...
        </button>
      </td>
      <td className="py-1.5 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="bg-bg0 border border-border rounded pl-1.5 pr-6 py-0.5 text-[11px] text-t2 outline-none cursor-pointer text-left min-w-[90px] flex items-center relative">
            <span className="flex-1">{context}</span>
            <ChevronsUpDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            {["Global", "Editor", "Terminal"].map((opt) => (
              <DropdownMenuItem key={opt} onSelect={() => setContext(opt)}>
                <span className="w-3 shrink-0 flex items-center justify-center">
                  {context === opt && <Check size={10} className="text-accent" />}
                </span>
                {opt}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
      <td colSpan={2} />
    </tr>
  );
}

export function KeymapEditorContent() {
  const bindings = useKeymapStore((s) => s.bindings);
  const getJSON = useKeymapStore((s) => s.getJSON);
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => filterRef.current?.focus(), 100);
  }, []);

  const filtered = filter
    ? bindings.filter(
        (b) =>
          b.action.toLowerCase().includes(filter.toLowerCase()) ||
          b.keys.toLowerCase().includes(filter.toLowerCase()) ||
          b.context.toLowerCase().includes(filter.toLowerCase())
      )
    : bindings;

  return (
    <div className="flex flex-col h-full bg-bg1">
      {/* Header */}
      <div className="flex items-center justify-between h-[44px] px-4 border-b border-border shrink-0">
        <span className="text-[13px] text-t1 font-semibold">Keymap Editor</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowJSON(!showJSON)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors",
              showJSON ? "text-accent bg-accent/10" : "text-t4 hover:text-t3 hover:bg-hover"
            )}
            title="Edit in JSON"
          >
            <Code size={12} />
            Edit in JSON
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-t4 hover:text-t3 hover:bg-hover transition-colors"
            title="Create Keybinding"
          >
            <Plus size={12} />
            Create Keybinding
          </button>
        </div>
      </div>

      {showJSON ? (
        /* JSON View */
        <div className="flex-1 min-h-0 p-4 overflow-auto">
          <pre className="bg-bg0 border border-border rounded-lg p-4 text-[11px] text-t2 font-mono overflow-auto h-full whitespace-pre-wrap">
            {getJSON() || "[]"}
          </pre>
        </div>
      ) : (
        <>
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
            <Search size={13} className="text-t4 shrink-0" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter action names..."
              className="flex-1 bg-transparent text-[12px] text-t1 placeholder-t5 outline-none"
            />
            {filter && (
              <button onClick={() => setFilter("")} className="p-0.5 rounded text-t5 hover:text-t3">
                <X size={12} />
              </button>
            )}
            <span className="text-[10px] text-t5">{filtered.length} bindings</span>
          </div>

          {/* Table */}
          <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
            <table className="w-full">
              <thead className="sticky top-0 bg-bg1 z-10">
                <tr className="border-b border-border text-[10px] text-t5 uppercase tracking-wider font-semibold">
                  <th className="text-left py-2 px-3 w-[35%]">Action</th>
                  <th className="text-left py-2 px-3 w-[25%]">Keystrokes</th>
                  <th className="text-left py-2 px-3 w-[20%]">Context</th>
                  <th className="text-left py-2 px-3 w-[12%]">Source</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {showCreate && (
                  <CreateBindingRow onCreated={() => setShowCreate(false)} />
                )}
                {filtered.map((binding) => (
                  <BindingRow key={binding.id} binding={binding} />
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="flex items-center justify-center py-12 text-t5 text-[12px]">
                No bindings match &ldquo;{filter}&rdquo;
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
