export interface OpenFile {
  id: string;
  name: string;
  path: string;
  language: string;
  content: string;
  modified?: boolean;
}

export function detectLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const lower = name.toLowerCase();

  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === ".gitignore" || lower === ".npmignore" || lower === ".env" || lower.startsWith(".env.")) return "plaintext";

  const map: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescriptreact",
    jsx: "javascriptreact",
    json: "json",
    jsonc: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    py: "python",
    rs: "rust",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    txt: "plaintext",
    log: "plaintext",
    svelte: "svelte",
    vue: "vue",
    graphql: "graphql",
    gql: "graphql",
    sql: "sql",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    php: "php",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    r: "r",
    lua: "lua",
    perl: "perl",
    pl: "perl",
    ini: "ini",
    conf: "ini",
    cfg: "ini",
    lock: "plaintext",
  };
  return map[ext ?? ""] ?? "plaintext";
}

export interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  keywords?: string[];
  description?: string;
}

export const COMMANDS: CommandItem[] = [
  // file
  { id: "file.open", label: "Open File", shortcut: "Ctrl+P", category: "File", keywords: ["quick open", "go to file"] },
  { id: "file.save", label: "Save", shortcut: "Ctrl+S", category: "File" },
  { id: "file.save-all", label: "Save All", shortcut: "Ctrl+Shift+S", category: "File" },
  { id: "file.new", label: "New File", shortcut: "Ctrl+N", category: "File", keywords: ["create", "add"] },

  // edit
  { id: "edit.undo", label: "Undo", shortcut: "Ctrl+Z", category: "Edit" },
  { id: "edit.redo", label: "Redo", shortcut: "Ctrl+Shift+Z", category: "Edit" },
  { id: "edit.find", label: "Find in File", shortcut: "Ctrl+F", category: "Edit", keywords: ["search", "locate"] },
  { id: "edit.replace", label: "Find and Replace", shortcut: "Ctrl+H", category: "Edit", keywords: ["substitute", "swap"] },

  // search
  { id: "search.project", label: "Search in Project", shortcut: "Ctrl+Shift+F", category: "Search", keywords: ["find", "grep", "global"] },
  { id: "search.symbol", label: "Go to Symbol", shortcut: "Ctrl+T", category: "Search", keywords: ["function", "class", "method"] },

  // editor
  { id: "editor.split-right", label: "Split Right", shortcut: "Ctrl+K \u2192", category: "Editor", keywords: ["pane", "side by side"] },
  { id: "editor.split-down", label: "Split Down", shortcut: "Ctrl+K \u2193", category: "Editor", keywords: ["pane", "vertical"] },
  { id: "editor.close-tab", label: "Close Tab", shortcut: "Ctrl+W", category: "Editor" },
  { id: "editor.close-all", label: "Close All Tabs", shortcut: "Ctrl+K Ctrl+W", category: "Editor" },
  { id: "editor.maximize", label: "Maximize Editor Pane", shortcut: "Ctrl+Shift+M", category: "Editor", keywords: ["fullscreen", "expand"] },

  // view
  { id: "view.toggle-terminal", label: "Toggle Terminal", shortcut: "Ctrl+`", category: "View", keywords: ["console", "shell", "bash", "cli"] },
  { id: "view.toggle-sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", category: "View", keywords: ["panel", "explorer"] },
  { id: "view.toggle-ai", label: "Toggle AI Panel", shortcut: "Ctrl+Shift+B", category: "View", keywords: ["assistant", "chat", "copilot"] },
  { id: "view.toggle-git", label: "Toggle Git Panel", shortcut: "Ctrl+Shift+G", category: "View", keywords: ["source control", "version"] },
  { id: "view.command-palette", label: "Command Palette", shortcut: "Ctrl+Shift+P", category: "View" },
  { id: "view.toggle-minimap", label: "Toggle Minimap", category: "View", keywords: ["overview", "scroll map"] },
  { id: "view.zoom-in", label: "Zoom In", shortcut: "Ctrl+=", category: "View", keywords: ["bigger", "enlarge", "font size"] },
  { id: "view.zoom-out", label: "Zoom Out", shortcut: "Ctrl+-", category: "View", keywords: ["smaller", "shrink", "font size"] },
  { id: "view.zoom-reset", label: "Reset Zoom", shortcut: "Ctrl+0", category: "View" },
  { id: "view.maximize-panel", label: "Maximize Bottom Panel", category: "View", keywords: ["fullscreen", "expand"] },

  // go
  { id: "go.definition", label: "Go to Definition", shortcut: "F12", category: "Go", keywords: ["jump", "navigate"] },
  { id: "go.references", label: "Find All References", shortcut: "Shift+F12", category: "Go", keywords: ["usages"] },
  { id: "go.line", label: "Go to Line", shortcut: "Ctrl+G", category: "Go", keywords: ["jump", "number"] },
  { id: "go.back", label: "Navigate Back", shortcut: "Alt+\u2190", category: "Go", keywords: ["previous", "history"] },
  { id: "go.forward", label: "Navigate Forward", shortcut: "Alt+\u2192", category: "Go", keywords: ["next", "history"] },
  { id: "go.home", label: "Go Home", category: "Go", keywords: ["start", "welcome", "dashboard"] },

  // terminal
  { id: "terminal.new", label: "New Terminal", shortcut: "Ctrl+Shift+`", category: "Terminal", keywords: ["console", "shell", "create"] },

  // git
  { id: "git.commit", label: "Git: Commit", category: "Git", keywords: ["save", "checkpoint"] },
  { id: "git.push", label: "Git: Push", category: "Git", keywords: ["upload", "deploy"] },
  { id: "git.pull", label: "Git: Pull", category: "Git", keywords: ["fetch", "download", "sync"] },

  // project
  { id: "project.reveal", label: "Reveal Active File in Explorer", shortcut: "Ctrl+Shift+.", category: "Project", keywords: ["show", "locate", "sidebar"] },
  { id: "project.collapse", label: "Collapse All Folders", category: "Project", keywords: ["close", "minimize", "tree"] },

  // preferences
  { id: "theme.select", label: "Theme: Select Theme", shortcut: "Ctrl+K Ctrl+T", category: "Preferences", keywords: ["color", "dark", "light", "appearance"] },
  { id: "settings.open", label: "Open Settings", shortcut: "Ctrl+,", category: "Preferences", keywords: ["preferences", "config", "options"] },
  { id: "view.keymap", label: "Open Keymap Editor", shortcut: "Ctrl+K Ctrl+S", category: "View", keywords: ["shortcuts", "keybindings", "hotkeys"] },
  { id: "view.browser-tab", label: "Open Browser in Tab", shortcut: "Ctrl+Shift+I", category: "View", keywords: ["preview", "web", "localhost"] },
  { id: "view.ai-panel", label: "Open AI Assistant", category: "View", keywords: ["chat", "copilot", "help"] },
];
