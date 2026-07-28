"use client";
import { useState, memo } from "react";
import { cn } from "@/lib/cn";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore, type Settings } from "@/stores/settings-store";
import { X, Search, ChevronRight, Minus, Square, ChevronsUpDown, ExternalLink, Check } from "lucide-react";
import { themes } from "@/lib/themes";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./ui/DropdownMenu";

interface SettingItem {
  key: keyof Settings;
  label: string;
  description: string;
  type: "toggle" | "select" | "text" | "number" | "password";
  options?: string[];
}

interface SettingGroup {
  heading: string;
  settings: SettingItem[];
}

interface SettingSection {
  title: string;
  groups: SettingGroup[];
}

const SETTING_SECTIONS: SettingSection[] = [
  {
    title: "General",
    groups: [
      {
        heading: "General Settings",
        settings: [
          { key: "redact_private", label: "Redact Private Values", description: "Hide the values of variables in private files.", type: "toggle" },
          { key: "telemetry", label: "Send Telemetry", description: "Share anonymous usage data to help improve the editor.", type: "toggle" },
        ],
      },
    ],
  },
  {
    title: "Appearance",
    groups: [
      {
        heading: "Theme",
        settings: [
          { key: "theme", label: "Theme", description: "The color theme for the editor and UI.", type: "select", options: themes.map((t) => t.name) },
        ],
      },
      {
        heading: "Font",
        settings: [
          { key: "ui_font_size", label: "UI Font Size", description: "Font size for the entire UI, including panels and menus.", type: "number" },
          { key: "ui_font_family", label: "UI Font Family", description: "Font family for the entire UI.", type: "text" },
          { key: "buffer_font_size", label: "Buffer Font Size", description: "Font size for the editor buffer.", type: "number" },
          { key: "buffer_font_family", label: "Buffer Font Family", description: "Font family for the editor buffer.", type: "text" },
        ],
      },
    ],
  },
  {
    title: "Keymap",
    groups: [
      {
        heading: "Keymap Settings",
        settings: [
          { key: "base_keymap", label: "Base Keymap", description: "The base keymap preset. Customize individual bindings in the Keymap Editor.", type: "select", options: ["VSCode", "JetBrains", "Sublime Text", "Atom", "Emacs", "Vim"] },
        ],
      },
    ],
  },
  {
    title: "Editor",
    groups: [
      {
        heading: "Display",
        settings: [
          { key: "line_numbers", label: "Line Numbers", description: "Controls the display of line numbers in the gutter.", type: "select", options: ["off", "on", "relative"] },
          { key: "minimap", label: "Show Minimap", description: "Display a minimap of the file on the right side.", type: "toggle" },
          { key: "word_wrap", label: "Soft Wrap", description: "Controls how lines should wrap in the editor.", type: "select", options: ["off", "editor_width", "preferred_line_length"] },
          { key: "indent_guides", label: "Indent Guides", description: "Show vertical indent guides in the editor.", type: "toggle" },
          { key: "inlay_hints", label: "Inlay Hints", description: "Show inline type and parameter hints.", type: "toggle" },
        ],
      },
      {
        heading: "Formatting",
        settings: [
          { key: "tab_size", label: "Tab Size", description: "The number of spaces a tab is equal to.", type: "number" },
          { key: "format_on_save", label: "Format on Save", description: "Automatically format the file when saving.", type: "toggle" },
          { key: "trim_whitespace", label: "Trim Trailing Whitespace", description: "Remove trailing whitespace on save.", type: "toggle" },
          { key: "final_newline", label: "Ensure Final Newline", description: "Insert a final newline at the end of the file.", type: "toggle" },
        ],
      },
      {
        heading: "Cursor",
        settings: [
          { key: "cursor_blink", label: "Cursor Blinking", description: "Controls the cursor animation style.", type: "select", options: ["blink", "smooth", "phase", "expand", "solid"] },
          { key: "cursor_shape", label: "Cursor Shape", description: "The shape of the cursor in the editor.", type: "select", options: ["bar", "block", "underline"] },
        ],
      },
    ],
  },
  {
    title: "Search & Files",
    groups: [
      {
        heading: "File Settings",
        settings: [
          { key: "auto_save", label: "Auto Save", description: "Controls auto save of editors after a delay.", type: "select", options: ["off", "afterDelay", "onFocusChange"] },
        ],
      },
    ],
  },
  {
    title: "Terminal",
    groups: [
      {
        heading: "Terminal Settings",
        settings: [
          { key: "terminal_font_size", label: "Font Size", description: "Controls the terminal font size.", type: "number" },
          { key: "terminal_font_family", label: "Font Family", description: "Controls the terminal font family.", type: "text" },
          { key: "terminal_cursor", label: "Cursor Style", description: "The cursor style in the terminal.", type: "select", options: ["block", "underline", "bar"] },
          { key: "terminal_blinking", label: "Blinking Cursor", description: "Whether the terminal cursor blinks.", type: "toggle" },
        ],
      },
    ],
  },
  {
    title: "Git",
    groups: [
      {
        heading: "GitHub Integration",
        settings: [
          { key: "github_token", label: "GitHub Token", description: "Personal access token for GitHub operations (push, pull, clone). Required for private repos and authenticated requests.", type: "password" },
        ],
      },
    ],
  },
];

const NAV_ITEMS = SETTING_SECTIONS.map((s) => s.title);

const darkThemes = themes.filter((t) => t.appearance === "dark");
const lightThemes = themes.filter((t) => t.appearance === "light");

export function SettingsModal() {
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);
  const toggleSettings = useWorkspaceStore((s) => s.toggleSettings);
  const toggleKeymapEditor = useWorkspaceStore((s) => s.toggleKeymapEditor);
  const [activeSection, setActiveSection] = useState("General");
  const [filter, setFilter] = useState("");
  const [maximized, setMaximized] = useState(false);

  if (!settingsOpen) return null;

  const filteredSections = filter
    ? SETTING_SECTIONS.map((sec) => ({
        ...sec,
        groups: sec.groups
          .map((g) => ({
            ...g,
            settings: g.settings.filter(
              (s) =>
                s.label.toLowerCase().includes(filter.toLowerCase()) ||
                s.description.toLowerCase().includes(filter.toLowerCase())
            ),
          }))
          .filter((g) => g.settings.length > 0),
      })).filter((sec) => sec.groups.length > 0)
    : SETTING_SECTIONS.filter((s) => s.title === activeSection);

  const openKeymapEditor = () => {
    toggleSettings();
    toggleKeymapEditor();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={toggleSettings} />

      <div className={cn(
        "relative bg-bg0 border border-border shadow-2xl shadow-black/60 flex flex-col overflow-hidden",
        maximized
          ? "w-full h-full max-w-full max-h-full rounded-none"
          : "w-[820px] h-[560px] max-w-[92vw] max-h-[85vh] rounded-lg"
      )}>
        {/* Title bar */}
        <div className="flex items-center justify-between h-[38px] px-3 border-b border-border shrink-0">
          <span className="text-[13px] text-t1 font-medium">Settings</span>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSettings}
              className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => setMaximized(!maximized)}
              className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            >
              <Square size={11} />
            </button>
            <button
              onClick={toggleSettings}
              className="p-1 rounded text-t4 hover:text-t3 hover:bg-hover"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[200px] shrink-0 border-r border-border flex flex-col">
            {/* Search */}
            <div className="p-2 shrink-0">
              <div className="flex items-center bg-bg3 border border-scroll-thumb rounded-md focus-within:border-focus">
                <Search size={12} className="text-t4 ml-2 shrink-0" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search settings..."
                  className="flex-1 bg-transparent px-2 py-1.5 text-[12px] text-t1 placeholder-t4 outline-none min-w-0"
                  autoFocus
                />
              </div>
            </div>

            {/* Nav items */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-0.5">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item}
                  onClick={() => { setActiveSection(item); setFilter(""); }}
                  className={cn(
                    "flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[12px] rounded-md",
                    activeSection === item && !filter
                      ? "text-t1 bg-selection"
                      : "text-t3 hover:text-t1 hover:bg-hover"
                  )}
                >
                  <ChevronRight size={11} className="text-t4 shrink-0" />
                  <span>{item}</span>
                </button>
              ))}
            </div>

            {/* Bottom hint */}
            <div className="px-3 py-2 border-t border-border text-[10px] text-t5 font-mono shrink-0">
              <kbd className="text-t4">Ctrl-,</kbd> <span className="ml-1">Settings</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {/* Top bar */}
            {!filter && (
              <div className="flex items-center px-6 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-accent">User</span>
                  <span className="text-t4">nodepod</span>
                </div>
              </div>
            )}

            <div className="px-6 py-4">
              {filteredSections.map((section) => (
                <div key={section.title} className="mb-6">
                  <h2 className="text-[18px] text-t1 font-medium mb-4">
                    {section.title}
                  </h2>

                  {section.groups.map((group) => (
                    <div key={group.heading} className="mb-5">
                      <h3 className="text-[13px] text-accent font-medium mb-3">
                        {group.heading}
                      </h3>

                      <div className="space-y-5">
                        {group.settings.map((setting) => (
                          <SettingRow key={setting.key} setting={setting} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Keymap section: add "Open Keymap Editor" button */}
                  {section.title === "Keymap" && (
                    <div className="mt-4">
                      <button
                        onClick={openKeymapEditor}
                        className="flex items-center gap-2 px-4 py-2 rounded-md bg-bg3 border border-border text-[12px] text-t2 hover:text-t1 hover:bg-hover hover:border-scroll-thumb transition-colors"
                      >
                        <ExternalLink size={13} />
                        Open Keymap Editor
                        <span className="ml-auto text-[10px] text-t5 font-mono">Ctrl-K Ctrl-S</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SettingRow = memo(function SettingRow({ setting }: { setting: SettingItem }) {
  const value = useSettingsStore((s) => s.settings[setting.key]);
  const setSetting = useSettingsStore((s) => s.set);

  if (setting.key === "theme") {
    return (
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[13px] text-t1 font-medium">{setting.label}</div>
          <div className="text-[12px] text-t4 mt-0.5">{setting.description}</div>
        </div>
        <div className="shrink-0 mt-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger className="appearance-none bg-bg3 border border-scroll-thumb rounded-md pl-3 pr-7 py-1 text-[12px] text-t1 outline-none focus:border-focus min-w-[200px] cursor-pointer text-left flex items-center relative">
              <span className="flex-1 truncate">{value as string}</span>
              <ChevronsUpDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto scrollbar-thin min-w-[200px]">
              <DropdownMenuLabel>Dark</DropdownMenuLabel>
              {darkThemes.map((t) => (
                <DropdownMenuItem
                  key={t.name}
                  onSelect={() => setSetting(setting.key, t.name as Settings[typeof setting.key])}
                >
                  <span className="w-3.5 shrink-0 flex items-center justify-center">
                    {value === t.name && <Check size={11} className="text-accent" />}
                  </span>
                  {t.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Light</DropdownMenuLabel>
              {lightThemes.map((t) => (
                <DropdownMenuItem
                  key={t.name}
                  onSelect={() => setSetting(setting.key, t.name as Settings[typeof setting.key])}
                >
                  <span className="w-3.5 shrink-0 flex items-center justify-center">
                    {value === t.name && <Check size={11} className="text-accent" />}
                  </span>
                  {t.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[13px] text-t1 font-medium">{setting.label}</div>
        <div className="text-[12px] text-t4 mt-0.5">{setting.description}</div>
      </div>

      <div className="shrink-0 mt-0.5">
        {setting.type === "toggle" ? (
          <Toggle
            value={value as boolean}
            onChange={(v) => setSetting(setting.key, v as Settings[typeof setting.key])}
          />
        ) : setting.type === "select" ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="appearance-none bg-bg3 border border-scroll-thumb rounded-md pl-3 pr-7 py-1 text-[12px] text-t1 outline-none focus:border-focus min-w-[160px] cursor-pointer text-left flex items-center relative">
              <span className="flex-1 truncate">{value as string}</span>
              <ChevronsUpDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-t4 pointer-events-none" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              {setting.options?.map((opt) => (
                <DropdownMenuItem
                  key={opt}
                  onSelect={() => setSetting(setting.key, opt as Settings[typeof setting.key])}
                >
                  <span className="w-3.5 shrink-0 flex items-center justify-center">
                    {value === opt && <Check size={11} className="text-accent" />}
                  </span>
                  {opt}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : setting.type === "number" ? (
          <input
            type="number"
            value={value as number}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n > 0) setSetting(setting.key, n as Settings[typeof setting.key]);
            }}
            className="bg-bg3 border border-scroll-thumb rounded-md px-3 py-1 text-[12px] text-t1 outline-none focus:border-focus w-[160px]"
          />
        ) : (
          <input
            type={setting.type === "password" ? "password" : "text"}
            value={value as string}
            onChange={(e) => setSetting(setting.key, e.target.value as Settings[typeof setting.key])}
            className="bg-bg3 border border-scroll-thumb rounded-md px-3 py-1 text-[12px] text-t1 outline-none focus:border-focus w-[160px]"
          />
        )}
      </div>
    </div>
  );
});

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "w-[36px] h-[20px] rounded-full relative transition-colors",
        value ? "bg-accent" : "bg-scroll-thumb"
      )}
    >
      <div
        className={cn(
          "w-[14px] h-[14px] rounded-full bg-white absolute top-[3px] transition-transform",
          value ? "translate-x-[19px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );
}
