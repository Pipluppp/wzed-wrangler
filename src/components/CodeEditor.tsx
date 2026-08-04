"use client";
import { useRef, useEffect, useCallback, memo } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useShallow } from "zustand/react/shallow";
import { getTheme, getMonacoThemeData } from "@/lib/themes";
import { saveWorkspaceFile } from "@/lib/workspace-repository";

const LANG_MAP: Record<string, string> = {
  rust: "rust",
  typescript: "typescript",
  typescriptreact: "typescriptreact",
  javascript: "javascript",
  javascriptreact: "javascriptreact",
  json: "json",
  toml: "toml",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  xml: "xml",
  yaml: "yaml",
  python: "python",
  shell: "shell",
  svelte: "svelte",
  vue: "vue",
  graphql: "graphql",
  sql: "sql",
  dockerfile: "dockerfile",
};

const CURSOR_BLINK_MAP: Record<string, string> = {
  blink: "blink",
  smooth: "smooth",
  phase: "phase",
  expand: "expand",
  solid: "solid",
};

const CURSOR_STYLE_MAP: Record<string, "line" | "block" | "underline"> = {
  bar: "line",
  block: "block",
  underline: "underline",
};

const LINE_NUMBERS_MAP: Record<string, string> = {
  off: "off",
  on: "on",
  relative: "relative",
};

const WORD_WRAP_MAP: Record<string, "off" | "on" | "wordWrapColumn" | "bounded"> = {
  off: "off",
  editor_width: "on",
  preferred_line_length: "wordWrapColumn",
};

interface CodeEditorProps {
  paneId: string;
}

let _languagesRegistered = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerCustomLanguages(monaco: any) {
  if (_languagesRegistered) return;
  _languagesRegistered = true;

  // Svelte
  monaco.languages.register({ id: "svelte", extensions: [".svelte"] });
  monaco.languages.setMonarchTokensProvider("svelte", {
    defaultToken: "",
    tokenPostfix: ".svelte",
    ignoreCase: true,
    tokenizer: {
      root: [
        [/<style(\s[^>]*)?>/, { token: "tag", next: "@cssBlock", nextEmbedded: "text/css" }],
        [/<script(\s[^>]*)?>/, { token: "tag", next: "@jsBlock", nextEmbedded: "text/javascript" }],
        [/\{#(if|each|await|key)\b/, "keyword"],
        [/\{:(else|then|catch)\b/, "keyword"],
        [/\{\/(if|each|await|key)\b/, "keyword"],
        [/\{@(html|debug|const)\b/, "keyword"],
        [/\{/, { token: "delimiter.bracket", next: "@expression" }],
        [/<!--/, "comment", "@comment"],
        [/<\/?\w+/, "tag"],
        [/\/?>/, "tag"],
        [/=/, "delimiter"],
        [/"[^"]*"/, "attribute.value"],
        [/'[^']*'/, "attribute.value"],
        [/\w+/, "attribute.name"],
        [/\s+/, ""],
      ],
      expression: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        [/[{}()]/, "delimiter.bracket"],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/`/, "string", "@templateString"],
        [/\b(let|const|var|if|else|function|return|await|async|true|false|null|undefined)\b/, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/[=><!+\-*/%&|^~?:]+/, "operator"],
        [/\w+/, "identifier"],
        [/\s+/, ""],
      ],
      templateString: [
        [/`/, "string", "@pop"],
        [/\$\{/, { token: "delimiter.bracket", next: "@expression" }],
        [/./, "string"],
      ],
      comment: [
        [/-->/, "comment", "@pop"],
        [/./, "comment"],
      ],
      cssBlock: [
        [/<\/style\s*>/, { token: "tag", next: "@pop", nextEmbedded: "@pop" }],
        [/./, ""],
      ],
      jsBlock: [
        [/<\/script\s*>/, { token: "tag", next: "@pop", nextEmbedded: "@pop" }],
        [/./, ""],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("svelte", {
    brackets: [["<", ">"], ["{", "}"], ["(", ")"], ["[", "]"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "`", close: "`", notIn: ["string", "comment"] },
      { open: "<!--", close: "-->", notIn: ["comment", "string"] },
    ],
    surroundingPairs: [
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "<", close: ">" },
    ],
    comments: { blockComment: ["<!--", "-->"] },
  });

  // Vue
  monaco.languages.register({ id: "vue", extensions: [".vue"] });
  monaco.languages.setMonarchTokensProvider("vue", {
    defaultToken: "",
    tokenPostfix: ".vue",
    ignoreCase: true,
    tokenizer: {
      root: [
        [/<style(\s[^>]*)?>/, { token: "tag", next: "@cssBlock", nextEmbedded: "text/css" }],
        [/<script(\s[^>]*)?>/, { token: "tag", next: "@jsBlock", nextEmbedded: "text/javascript" }],
        [/<template(\s[^>]*)?>/, "tag"],
        [/\{\{/, { token: "delimiter.bracket", next: "@expression" }],
        [/<!--/, "comment", "@comment"],
        [/<\/?\w+/, "tag"],
        [/\/?>/, "tag"],
        [/=/, "delimiter"],
        [/"[^"]*"/, "attribute.value"],
        [/'[^']*'/, "attribute.value"],
        [/[@:#]\w+/, "keyword"],
        [/v-\w+/, "keyword"],
        [/\w+/, "attribute.name"],
        [/\s+/, ""],
      ],
      expression: [
        [/\}\}/, { token: "delimiter.bracket", next: "@pop" }],
        [/"[^"]*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b(true|false|null|undefined)\b/, "keyword"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/[=><!+\-*/%&|^~?:]+/, "operator"],
        [/\w+/, "identifier"],
        [/\s+/, ""],
      ],
      comment: [
        [/-->/, "comment", "@pop"],
        [/./, "comment"],
      ],
      cssBlock: [
        [/<\/style\s*>/, { token: "tag", next: "@pop", nextEmbedded: "@pop" }],
        [/./, ""],
      ],
      jsBlock: [
        [/<\/script\s*>/, { token: "tag", next: "@pop", nextEmbedded: "@pop" }],
        [/./, ""],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("vue", {
    brackets: [["<", ">"], ["{", "}"], ["(", ")"], ["[", "]"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: "'", close: "'", notIn: ["string", "comment"] },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "<!--", close: "-->", notIn: ["comment", "string"] },
    ],
    comments: { blockComment: ["<!--", "-->"] },
  });

  // GraphQL
  monaco.languages.register({ id: "graphql", extensions: [".graphql", ".gql"] });
  monaco.languages.setMonarchTokensProvider("graphql", {
    defaultToken: "",
    tokenPostfix: ".graphql",
    keywords: ["query", "mutation", "subscription", "fragment", "on", "type", "interface", "union", "enum", "scalar", "input", "extend", "schema", "directive", "implements", "repeatable"],
    typeKeywords: ["String", "Int", "Float", "Boolean", "ID"],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"""/, "string", "@blockString"],
        [/"/, "string", "@string"],
        [/\b(true|false|null)\b/, "keyword"],
        [/\$\w+/, "variable"],
        [/@\w+/, "annotation"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/[{}()[\]]/, "delimiter.bracket"],
        [/[!:=|&]/, "operator"],
        [/\b[A-Z]\w*\b/, "type"],
        [/\b\w+\b/, {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "type",
            "@default": "identifier",
          },
        }],
        [/\s+/, ""],
      ],
      string: [
        [/[^"\\]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, "string", "@pop"],
      ],
      blockString: [
        [/"""/, "string", "@pop"],
        [/./, "string"],
      ],
    },
  });
}

// so monaco understands JSX
const REACT_TYPE_DEFS = `
declare module "react" {
  export type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  export interface ReactElement<P = any> { type: any; props: P; key: string | null; }
  export type JSXElementConstructor<P> = (props: P) => ReactElement | null;
  export type FC<P = {}> = (props: P & { children?: ReactNode }) => ReactElement | null;
  export type FunctionComponent<P = {}> = FC<P>;
  export type ComponentType<P = {}> = FC<P>;
  export type PropsWithChildren<P = {}> = P & { children?: ReactNode };
  export type Key = string | number;
  export interface RefObject<T> { current: T | null; }
  export type Ref<T> = RefObject<T> | ((instance: T | null) => void) | null;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export type DependencyList = readonly any[];
  export type EffectCallback = () => void | (() => void);
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: EffectCallback, deps?: DependencyList): void;
  export function useLayoutEffect(effect: EffectCallback, deps?: DependencyList): void;
  export function useRef<T>(initialValue: T): RefObject<T>;
  export function useRef<T>(initialValue: T | null): RefObject<T>;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: DependencyList): T;
  export function useMemo<T>(factory: () => T, deps: DependencyList): T;
  export function useContext<T>(context: Context<T>): T;
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S): [S, Dispatch<A>];
  export function useId(): string;
  export function memo<P>(component: FC<P>): FC<P>;
  export function forwardRef<T, P = {}>(render: (props: P, ref: Ref<T>) => ReactElement | null): FC<P & { ref?: Ref<T> }>;
  export function createContext<T>(defaultValue: T): Context<T>;
  export interface Context<T> { Provider: FC<{ value: T; children?: ReactNode }>; Consumer: FC<{ children: (value: T) => ReactNode }>; }
  export function createElement(type: any, props?: any, ...children: any[]): ReactElement;
  export function cloneElement(element: ReactElement, props?: any, ...children: any[]): ReactElement;
  export function isValidElement(object: any): object is ReactElement;
  export const Fragment: symbol;
  export const StrictMode: FC<{ children?: ReactNode }>;
  export const Suspense: FC<{ fallback?: ReactNode; children?: ReactNode }>;
  export function lazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): T;
  export function startTransition(scope: () => void): void;
  export function useTransition(): [boolean, (scope: () => void) => void];
  export function useDeferredValue<T>(value: T): T;
  export type ChangeEvent<T = Element> = { target: T; currentTarget: T; };
  export type FormEvent<T = Element> = { target: T; currentTarget: T; preventDefault(): void; };
  export type MouseEvent<T = Element> = { target: T; currentTarget: T; clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void; };
  export type KeyboardEvent<T = Element> = { target: T; currentTarget: T; key: string; code: string; preventDefault(): void; };
  export type CSSProperties = Record<string, string | number>;
  export interface HTMLAttributes<T> { className?: string; id?: string; style?: CSSProperties; onClick?: (e: MouseEvent<T>) => void; onChange?: (e: ChangeEvent<T>) => void; onSubmit?: (e: FormEvent<T>) => void; onKeyDown?: (e: KeyboardEvent<T>) => void; onKeyUp?: (e: KeyboardEvent<T>) => void; children?: ReactNode; key?: Key; ref?: Ref<T>; dangerouslySetInnerHTML?: { __html: string }; [key: string]: any; }
  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> { type?: string; value?: string | number; defaultValue?: string | number; placeholder?: string; disabled?: boolean; checked?: boolean; name?: string; readOnly?: boolean; required?: boolean; autoFocus?: boolean; }
  export interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> { type?: "button" | "submit" | "reset"; disabled?: boolean; }
  export interface SelectHTMLAttributes<T> extends HTMLAttributes<T> { value?: string | number; defaultValue?: string | number; disabled?: boolean; multiple?: boolean; }
  export interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> { value?: string; defaultValue?: string; placeholder?: string; disabled?: boolean; rows?: number; cols?: number; }
  export interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> { href?: string; target?: string; rel?: string; download?: any; }
  export interface ImgHTMLAttributes<T> extends HTMLAttributes<T> { src?: string; alt?: string; width?: number | string; height?: number | string; loading?: "eager" | "lazy"; }
  export interface FormHTMLAttributes<T> extends HTMLAttributes<T> { action?: string; method?: string; onSubmit?: (e: FormEvent<T>) => void; }
  export interface SVGAttributes<T> extends HTMLAttributes<T> { viewBox?: string; fill?: string; stroke?: string; strokeWidth?: number | string; d?: string; cx?: number | string; cy?: number | string; r?: number | string; x?: number | string; y?: number | string; width?: number | string; height?: number | string; xmlns?: string; }
}
declare module "react/jsx-runtime" {
  export function jsx(type: any, props: any, key?: any): any;
  export function jsxs(type: any, props: any, key?: any): any;
  export const Fragment: symbol;
}
declare module "react/jsx-dev-runtime" {
  export function jsxDEV(type: any, props: any, key?: any): any;
  export const Fragment: symbol;
}
declare module "react-dom" {
  export function render(element: any, container: Element | null): void;
  export function createPortal(children: any, container: Element): any;
  export function flushSync(fn: () => void): void;
}
declare module "react-dom/client" {
  export interface Root { render(element: any): void; unmount(): void; }
  export function createRoot(container: Element | DocumentFragment): Root;
  export function hydrateRoot(container: Element | Document, initialChildren: any): Root;
}
declare namespace JSX {
  type Element = import("react").ReactElement;
  interface IntrinsicElements {
    [elemName: string]: any;
    div: import("react").HTMLAttributes<HTMLDivElement>;
    span: import("react").HTMLAttributes<HTMLSpanElement>;
    p: import("react").HTMLAttributes<HTMLParagraphElement>;
    h1: import("react").HTMLAttributes<HTMLHeadingElement>;
    h2: import("react").HTMLAttributes<HTMLHeadingElement>;
    h3: import("react").HTMLAttributes<HTMLHeadingElement>;
    h4: import("react").HTMLAttributes<HTMLHeadingElement>;
    h5: import("react").HTMLAttributes<HTMLHeadingElement>;
    h6: import("react").HTMLAttributes<HTMLHeadingElement>;
    a: import("react").AnchorHTMLAttributes<HTMLAnchorElement>;
    img: import("react").ImgHTMLAttributes<HTMLImageElement>;
    input: import("react").InputHTMLAttributes<HTMLInputElement>;
    button: import("react").ButtonHTMLAttributes<HTMLButtonElement>;
    select: import("react").SelectHTMLAttributes<HTMLSelectElement>;
    textarea: import("react").TextareaHTMLAttributes<HTMLTextAreaElement>;
    form: import("react").FormHTMLAttributes<HTMLFormElement>;
    label: import("react").HTMLAttributes<HTMLLabelElement>;
    ul: import("react").HTMLAttributes<HTMLUListElement>;
    ol: import("react").HTMLAttributes<HTMLOListElement>;
    li: import("react").HTMLAttributes<HTMLLIElement>;
    nav: import("react").HTMLAttributes<HTMLElement>;
    header: import("react").HTMLAttributes<HTMLElement>;
    footer: import("react").HTMLAttributes<HTMLElement>;
    main: import("react").HTMLAttributes<HTMLElement>;
    section: import("react").HTMLAttributes<HTMLElement>;
    article: import("react").HTMLAttributes<HTMLElement>;
    aside: import("react").HTMLAttributes<HTMLElement>;
    table: import("react").HTMLAttributes<HTMLTableElement>;
    thead: import("react").HTMLAttributes<HTMLTableSectionElement>;
    tbody: import("react").HTMLAttributes<HTMLTableSectionElement>;
    tr: import("react").HTMLAttributes<HTMLTableRowElement>;
    td: import("react").HTMLAttributes<HTMLTableCellElement>;
    th: import("react").HTMLAttributes<HTMLTableCellElement>;
    pre: import("react").HTMLAttributes<HTMLPreElement>;
    code: import("react").HTMLAttributes<HTMLElement>;
    br: import("react").HTMLAttributes<HTMLBRElement>;
    hr: import("react").HTMLAttributes<HTMLHRElement>;
    strong: import("react").HTMLAttributes<HTMLElement>;
    em: import("react").HTMLAttributes<HTMLElement>;
    svg: import("react").SVGAttributes<SVGSVGElement>;
    path: import("react").SVGAttributes<SVGPathElement>;
    circle: import("react").SVGAttributes<SVGCircleElement>;
    rect: import("react").SVGAttributes<SVGRectElement>;
    line: import("react").SVGAttributes<SVGLineElement>;
    g: import("react").SVGAttributes<SVGGElement>;
    video: import("react").HTMLAttributes<HTMLVideoElement> & { src?: string; controls?: boolean; autoPlay?: boolean; loop?: boolean; muted?: boolean; };
    audio: import("react").HTMLAttributes<HTMLAudioElement> & { src?: string; controls?: boolean; autoPlay?: boolean; loop?: boolean; };
    canvas: import("react").HTMLAttributes<HTMLCanvasElement> & { width?: number | string; height?: number | string; };
    iframe: import("react").HTMLAttributes<HTMLIFrameElement> & { src?: string; title?: string; sandbox?: string; allow?: string; };
    script: import("react").HTMLAttributes<HTMLScriptElement> & { src?: string; type?: string; async?: boolean; defer?: boolean; };
    link: import("react").HTMLAttributes<HTMLLinkElement> & { rel?: string; href?: string; type?: string; };
    meta: import("react").HTMLAttributes<HTMLMetaElement> & { name?: string; content?: string; property?: string; };
    style: import("react").HTMLAttributes<HTMLStyleElement> & { type?: string; };
  }
}
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function configureLanguageDefaults(monaco: any) {
  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;

  const compilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    allowImportingTsExtensions: true,
    noSemanticValidation: false,
    noSyntaxValidation: false,
  };

  tsDefaults.setCompilerOptions(compilerOptions);
  jsDefaults.setCompilerOptions(compilerOptions);

  tsDefaults.addExtraLib(REACT_TYPE_DEFS, "file:///node_modules/@types/react/index.d.ts");
  jsDefaults.addExtraLib(REACT_TYPE_DEFS, "file:///node_modules/@types/react/index.d.ts");

  const suppressedCodes = [2307, 2304, 2691, 7016, 1259, 2792, 2874];

  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: suppressedCodes,
  });
  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    diagnosticCodesToIgnore: suppressedCodes,
  });
}

let _cachedEditorOptions: ReturnType<typeof buildEditorOptions> | null = null;
let _cachedSettingsKey = "";

function buildEditorOptions(settings: ReturnType<typeof useSettingsStore.getState>["settings"]) {
  return {
    fontFamily: `'${settings.buffer_font_family}', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', monospace`,
    fontSize: settings.buffer_font_size,
    lineHeight: Math.round(settings.buffer_font_size * 1.7),
    letterSpacing: 0.3,
    minimap: { enabled: settings.minimap },
    scrollBeyondLastLine: true,
    smoothScrolling: true,
    cursorBlinking: (CURSOR_BLINK_MAP[settings.cursor_blink] || "smooth") as "blink" | "smooth" | "phase" | "expand" | "solid",
    cursorSmoothCaretAnimation: "explicit" as const,
    cursorWidth: settings.cursor_shape === "bar" ? 2 : undefined,
    cursorStyle: CURSOR_STYLE_MAP[settings.cursor_shape] || "line",
    renderLineHighlight: "all" as const,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    folding: true,
    foldingHighlight: false,
    lineNumbers: (LINE_NUMBERS_MAP[settings.line_numbers] || "on") as "off" | "on" | "relative",
    lineNumbersMinChars: 4,
    glyphMargin: true,
    renderWhitespace: "none" as const,
    tabSize: settings.tab_size,
    wordWrap: WORD_WRAP_MAP[settings.word_wrap] || "off",
    guides: {
      indentation: settings.indent_guides,
      bracketPairs: true,
    },
    bracketPairColorization: { enabled: true },
    padding: { top: 8, bottom: 8 },
    inlayHints: { enabled: (settings.inlay_hints ? "on" : "off") as "on" | "off" },
    scrollbar: {
      vertical: "auto" as const,
      horizontal: "auto" as const,
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      verticalSliderSize: 6,
      horizontalSliderSize: 6,
    },
    suggest: {
      showMethods: true,
      showFunctions: true,
      showConstructors: true,
      showFields: true,
      showVariables: true,
      showClasses: true,
      showStructs: true,
      showInterfaces: true,
      showModules: true,
      showProperties: true,
      showEvents: true,
      showOperators: true,
      showUnits: true,
      showValues: true,
      showConstants: true,
      showEnums: true,
      showEnumMembers: true,
      showKeywords: true,
      showWords: true,
      showColors: true,
      showFiles: true,
      showReferences: true,
      showSnippets: true,
    },
  };
}

function getEditorOptions(settings: ReturnType<typeof useSettingsStore.getState>["settings"]) {
  const key = `${settings.buffer_font_size}|${settings.buffer_font_family}|${settings.minimap}|${settings.line_numbers}|${settings.word_wrap}|${settings.indent_guides}|${settings.tab_size}|${settings.cursor_blink}|${settings.cursor_shape}|${settings.inlay_hints}`;
  if (_cachedSettingsKey === key && _cachedEditorOptions) return _cachedEditorOptions;
  _cachedSettingsKey = key;
  _cachedEditorOptions = buildEditorOptions(settings);
  return _cachedEditorOptions;
}

export const CodeEditor = memo(function CodeEditor({ paneId }: CodeEditorProps) {
  const activeTab = useWorkspaceStore((s) => s.panes[paneId]?.activeTab ?? "");
  const file = useWorkspaceStore((s) => {
    const tab = s.panes[paneId]?.activeTab;
    return tab ? s.openFiles[tab] : undefined;
  });
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId);
  const updateFileContent = useWorkspaceStore((s) => s.updateFileContent);
  const settings = useSettingsStore(useShallow((s) => s.settings));
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const fileRef = useRef(file);
  fileRef.current = file;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const modelsRef = useRef<Map<string, any>>(new Map());
  const currentModelPathRef = useRef<string>("");

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions(getEditorOptions(settings));
  }, [
    settings.buffer_font_size,
    settings.buffer_font_family,
    settings.minimap,
    settings.line_numbers,
    settings.word_wrap,
    settings.indent_guides,
    settings.tab_size,
    settings.cursor_blink,
    settings.cursor_shape,
    settings.inlay_hints,
  ]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const theme = getTheme(settings.theme);
    const themeData = getMonacoThemeData(theme.colors, theme.appearance);
    monaco.editor.defineTheme("wzed-theme", themeData);
    monaco.editor.setTheme("wzed-theme");
  }, [settings.theme]);

  const fileReady = !!file;
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !fileReady || !activeTab) return;
    const f = fileRef.current;
    if (!f) return;

    if (currentModelPathRef.current === activeTab && modelsRef.current.has(activeTab)) return;

    if (storeUpdateTimer.current) {
      clearTimeout(storeUpdateTimer.current);
      storeUpdateTimer.current = null;
      const prevTab = currentModelPathRef.current;
      const prevModel = modelsRef.current.get(prevTab);
      if (prevTab && prevModel) {
        try { updateFileContent(prevTab, prevModel.getValue()); } catch { /* disposed */ }
      }
    }

    try { editor.getModel(); } catch { return; }

    currentModelPathRef.current = activeTab;
    const language = LANG_MAP[f.language] || f.language || "plaintext";

    let model = modelsRef.current.get(activeTab);
    if (!model) {
      const uri = monaco.Uri.parse(`file://${activeTab}`);
      model = monaco.editor.getModel(uri) || monaco.editor.createModel(f.content, language, uri);
      modelsRef.current.set(activeTab, model);
    } else {
      const currentLang = model.getLanguageId?.() ?? model.getModeId?.();
      if (currentLang !== language) {
        monaco.editor.setModelLanguage(model, language);
      }
    }

    editor.setModel(model);
  }, [activeTab, fileReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // sync external content changes (e.g. replace-all)
  useEffect(() => {
    if (!file || !activeTab) return;
    const model = modelsRef.current.get(activeTab);
    if (!model) return;
    try {
      const modelValue = model.getValue();
      if (modelValue !== file.content) {
        model.setValue(file.content);
      }
    } catch { /* model disposed */ }
  }, [file?.content, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const storeUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleChange = useCallback(
    (value: string | undefined) => {
      const currentFile = fileRef.current;
      const tab = activeTabRef.current;
      if (!tab || !currentFile) return;
      if (value === undefined || value === currentFile.content) return;

      if (storeUpdateTimer.current) clearTimeout(storeUpdateTimer.current);
      storeUpdateTimer.current = setTimeout(() => {
        storeUpdateTimer.current = null;
        const editor = editorRef.current;
        const model = editor?.getModel?.();
        const latest = model ? model.getValue() : value;
        updateFileContent(tab, latest);
      }, 50);
    },
    [updateFileContent]
  );

  useEffect(() => {
    return () => {
      if (storeUpdateTimer.current) {
        clearTimeout(storeUpdateTimer.current);
        const editor = editorRef.current;
        const tab = activeTabRef.current;
        const model = editor?.getModel?.();
        if (tab && model) {
          try { updateFileContent(tab, model.getValue()); } catch { /* disposed */ }
        }
      }
    };
  }, [updateFileContent]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || settings.auto_save !== "onFocusChange") return;
    const disposable = editor.onDidBlurEditorWidget(() => {
      const ws = useWorkspaceStore.getState();
      const p = ws.panes[paneId];
      if (!p) return;
      const model = editor.getModel();
      if (model && p.activeTab) ws.updateFileContent(p.activeTab, model.getValue());
      const f = useWorkspaceStore.getState().openFiles[p.activeTab];
      if (f?.modified && f.path) {
        void saveWorkspaceFile(p.activeTab).catch((error) => {
          console.error("Failed to save file on focus change:", f.path, error);
        });
      }
    });
    return () => disposable.dispose();
  }, [settings.auto_save, paneId]);

  useEffect(() => {
    return () => {
      modelsRef.current.clear();
      currentModelPathRef.current = "";
    };
  }, []);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; lineNumber?: number }>).detail;
      const command = detail?.command;
      const workspace = useWorkspaceStore.getState();
      if (command === "flush-all" || command === "flush") {
        if (command === "flush" && workspace.activePaneId !== paneId) return;
        const tab = workspace.panes[paneId]?.activeTab;
        const model = editorRef.current?.getModel?.();
        if (tab && model) workspace.updateFileContent(tab, model.getValue());
        return;
      }
      if (workspace.activePaneId !== paneId) return;
      const editor = editorRef.current;
      if (!editor) return;
      if (command === "focus") editor.focus();
      else if (command === "undo") editor.trigger("wzed", "undo", null);
      else if (command === "redo") editor.trigger("wzed", "redo", null);
      else if (command === "go-to-line" && detail.lineNumber) {
        editor.setPosition({ lineNumber: detail.lineNumber, column: 1 });
        editor.revealLineInCenter(detail.lineNumber);
        editor.focus();
      }
    };
    window.addEventListener("wzed:editor-command", handleCommand);
    return () => window.removeEventListener("wzed:editor-command", handleCommand);
  }, [paneId]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    registerCustomLanguages(monaco);
    configureLanguageDefaults(monaco);

    const theme = getTheme(settingsRef.current.theme);
    const themeData = getMonacoThemeData(theme.colors, theme.appearance);
    monaco.editor.defineTheme("wzed-theme", themeData);
    monaco.editor.setTheme("wzed-theme");
    editor.updateOptions(getEditorOptions(settingsRef.current));

    const tab = activeTabRef.current;
    const f = fileRef.current;
    if (f && tab) {
      const lang = LANG_MAP[f.language] || f.language || "plaintext";
      const uri = monaco.Uri.parse(`file://${tab}`);
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(f.content, lang, uri);
      }
      modelsRef.current.set(tab, model);
      currentModelPathRef.current = tab;
      editor.setModel(model);
    }

    editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (model) {
        handleChange(model.getValue());
      }
    });

    editor.addAction({
      id: "wzed.save",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        const ws = useWorkspaceStore.getState();
        const p = ws.panes[paneId];
        if (!p) return;
        const fl = ws.openFiles[p.activeTab];
        const model = editor.getModel();
        if (model && p.activeTab) ws.updateFileContent(p.activeTab, model.getValue());
        if (fl?.path) {
          void saveWorkspaceFile(p.activeTab).catch((error) => {
            console.error("Failed to save file:", fl.path, error);
          });
        }
      },
    });

    editor.addAction({ id: "wzed.goToDefinition", label: "Go to Definition", keybindings: [monaco.KeyCode.F12], contextMenuGroupId: "1_navigation", contextMenuOrder: 1, run: (ed: any) => { ed.trigger("wzed", "editor.action.revealDefinition", null); } });
    editor.addAction({ id: "wzed.goToDeclaration", label: "Go to Declaration", contextMenuGroupId: "1_navigation", contextMenuOrder: 2, run: (ed: any) => { ed.trigger("wzed", "editor.action.revealDeclaration", null); } });
    editor.addAction({ id: "wzed.goToTypeDefinition", label: "Go to Type Definition", contextMenuGroupId: "1_navigation", contextMenuOrder: 3, run: (ed: any) => { ed.trigger("wzed", "editor.action.goToTypeDefinition", null); } });
    editor.addAction({ id: "wzed.goToImplementation", label: "Go to Implementation", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12], contextMenuGroupId: "1_navigation", contextMenuOrder: 4, run: (ed: any) => { ed.trigger("wzed", "editor.action.goToImplementation", null); } });
    editor.addAction({ id: "wzed.findAllReferences", label: "Find All References", keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: "1_navigation", contextMenuOrder: 5, run: (ed: any) => { ed.trigger("wzed", "editor.action.referenceSearch.trigger", null); } });
    editor.addAction({ id: "wzed.renameSymbol", label: "Rename Symbol", keybindings: [monaco.KeyCode.F2], contextMenuGroupId: "2_refactor", contextMenuOrder: 1, run: (ed: any) => { ed.trigger("wzed", "editor.action.rename", null); } });
    editor.addAction({ id: "wzed.formatBuffer", label: "Format Buffer", keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF], contextMenuGroupId: "2_refactor", contextMenuOrder: 2, run: (ed: any) => { ed.trigger("wzed", "editor.action.formatDocument", null); } });
    editor.addAction({ id: "wzed.codeActions", label: "Show Code Actions", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period], contextMenuGroupId: "2_refactor", contextMenuOrder: 3, run: (ed: any) => { ed.trigger("wzed", "editor.action.quickFix", null); } });

    editor.addAction({
      id: "wzed.copyAndTrim",
      label: "Copy and Trim",
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 2.5,
      run: (ed: any) => {
        const sel = ed.getSelection();
        if (sel) {
          const text = ed.getModel()?.getValueInRange(sel) ?? "";
          const trimmed = text.split("\n").map((l: string) => l.trimEnd()).join("\n").trim();
          navigator.clipboard.writeText(trimmed);
        }
      },
    });

    editor.addAction({
      id: "wzed.revealInExplorer",
      label: "Reveal in File Explorer",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR],
      contextMenuGroupId: "4_file",
      contextMenuOrder: 1,
      run: () => {
        const ws = useWorkspaceStore.getState();
        if (!ws.leftDock.visible) ws.toggleLeftDock();
        if (ws.leftDock.activePanel !== "project") {
          useWorkspaceStore.setState((s) => ({ leftDock: { ...s.leftDock, activePanel: "project" } }));
        }
      },
    });
    editor.addAction({ id: "wzed.openInTerminal", label: "Open in Terminal", contextMenuGroupId: "4_file", contextMenuOrder: 2, run: () => { const ws = useWorkspaceStore.getState(); if (!ws.bottomDock.visible) ws.toggleBottomDock(); } });
    editor.addAction({
      id: "wzed.copyRelativePath",
      label: "Copy Relative Path",
      contextMenuGroupId: "4_file",
      contextMenuOrder: 3,
      run: () => {
        const ws = useWorkspaceStore.getState();
        const p = ws.panes[paneId];
        if (p) { const fl = ws.openFiles[p.activeTab]; navigator.clipboard.writeText(fl?.path?.replace(/^\/project\/?/, "") || p.activeTab); }
      },
    });
    editor.addAction({
      id: "wzed.copyAbsolutePath",
      label: "Copy Absolute Path",
      contextMenuGroupId: "4_file",
      contextMenuOrder: 4,
      run: () => {
        const ws = useWorkspaceStore.getState();
        const p = ws.panes[paneId];
        if (p) { const fl = ws.openFiles[p.activeTab]; navigator.clipboard.writeText(fl?.path || p.activeTab); }
      },
    });
  };

  return (
    <div className="flex-1 w-full h-full relative" onClick={() => setActivePaneId(paneId)}>
      <Editor
        height="100%"
        defaultLanguage="plaintext"
        defaultValue=""
        onMount={handleMount}
        theme="wzed-theme"
        options={getEditorOptions(settings)}
        keepCurrentModel={true}
      />
      {!file && (
        <div className="absolute inset-0 flex items-center justify-center text-t4 bg-bg2 z-10">
          <div className="text-center">
            <div className="text-[40px] mb-4 opacity-20">&#8984;</div>
            <div className="text-sm mb-1">No file open</div>
            <div className="text-xs text-t5">Open a file from the sidebar or press Ctrl-P</div>
          </div>
        </div>
      )}
    </div>
  );
});
