export type DeploymentKind = "worker" | "static";

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  startupCommand?: string;
  deploymentKind?: DeploymentKind;
  files: Record<string, string>;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

// Rolldown 1.1.5 allows @napi-rs/wasm-runtime ^1.1.6, but 1.2 moved to
// emnapi 2.x peers while its WASI binding still pins emnapi 1.11. Keep the
// browser-compatible graph explicit until Rolldown narrows that range.
const viteWasiDependencies = {
  "@rolldown/binding-wasm32-wasi": "1.1.5",
  "@napi-rs/wasm-runtime": "1.1.6",
  "@emnapi/core": "1.11.1",
  "@emnapi/runtime": "1.11.1",
  "@emnapi/wasi-threads": "1.2.2",
} as const;

const nodeFiles: Record<string, string> = {
  "/project/package.json": json({
    name: "nodepod-server",
    version: "1.0.0",
    private: true,
    scripts: { dev: "node index.js" },
  }),
  "/project/index.js": `const http = require("http");

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<main style='font-family:system-ui;padding:4rem'><h1>Hello from Nodepod</h1><p>This server is running entirely in your browser.</p></main>");
});

server.listen(3000, () => console.log("Server running on port 3000"));
`,
  "/project/README.md":
    "# Nodepod server\n\nThe local preview starts automatically with `npm run dev`.\n",
};

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    id: "blank",
    name: "Empty Project",
    description: "Start from scratch",
    files: {
      "/project/package.json": json({
        name: "my-project",
        version: "1.0.0",
        private: true,
      }),
      "/project/index.js": 'console.log("Hello world!");\n',
    },
  },
  {
    id: "react",
    name: "React",
    description: "Vite 8 + React starter",
    startupCommand: "npm install && npm run dev",
    deploymentKind: "static",
    files: {
      "/project/package.json": json({
        name: "react-app",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: { dev: "vite", build: "vite build" },
        dependencies: { react: "^19.2.8", "react-dom": "^19.2.8" },
        devDependencies: {
          vite: "^8.1.5",
          "@vitejs/plugin-react": "^6.0.4",
          ...viteWasiDependencies,
        },
      }),
      "/project/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React Preview</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
`,
      "/project/src/main.jsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>,
);
`,
      "/project/src/App.jsx": `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <span className="eyebrow">WZED PREVIEW</span>
      <h1>Vite + React</h1>
      <p>Edit <code>src/App.jsx</code>, preview locally, then deploy the same app.</p>
      <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
    </main>
  );
}
`,
      "/project/src/style.css": `:root { font-family: Inter, system-ui, sans-serif; color: #f6f7fb; background: #101217; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
main { width: min(560px, calc(100vw - 4rem)); padding: 4rem; border: 1px solid #2b303b; border-radius: 24px; background: #171a21; }
.eyebrow { color: #8ca7ff; font-size: .75rem; letter-spacing: .16em; }
h1 { margin: .65rem 0; font-size: clamp(2.5rem, 8vw, 5rem); letter-spacing: -.06em; }
p { color: #aeb5c3; line-height: 1.6; }
code { color: #c5d1ff; }
button { margin-top: 1rem; padding: .75rem 1rem; border: 0; border-radius: 10px; color: #101217; background: #a9bcff; font: inherit; font-weight: 700; cursor: pointer; }
`,
      "/project/vite.config.js": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({ plugins: [react()] });
`,
      "/project/wrangler.jsonc": json({
        $schema: "./node_modules/wrangler/config-schema.json",
        name: "wzed-react-preview",
        compatibility_date: "2026-07-28",
        assets: {
          directory: "./dist",
          not_found_handling: "single-page-application",
        },
      }),
    },
  },
  {
    id: "node",
    name: "Node.js",
    description: "Node.js server",
    startupCommand: "npm run dev",
    files: nodeFiles,
  },
  {
    id: "vite",
    name: "Vite",
    description: "Vanilla JavaScript with Vite 8",
    startupCommand: "npm install && npm run dev",
    deploymentKind: "static",
    files: {
      "/project/package.json": json({
        name: "vite-app",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: { dev: "vite", build: "vite build" },
        devDependencies: {
          vite: "^8.1.5",
          ...viteWasiDependencies,
        },
      }),
      "/project/index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite Preview</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main><span>WZED PREVIEW</span><h1>Vanilla Vite</h1><p id="info"></p></main>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`,
      "/project/main.js":
        'document.querySelector("#info").textContent = "Running locally in Nodepod — ready for a temporary Cloudflare deployment.";\n',
      "/project/style.css": `:root { font-family: Inter, system-ui, sans-serif; color: #eef2ff; background: #11131a; }
body { min-height: 100vh; margin: 0; display: grid; place-items: center; }
main { width: min(650px, calc(100vw - 4rem)); }
span { color: #91a9ff; font-size: .75rem; letter-spacing: .18em; }
h1 { margin: .5rem 0; font-size: clamp(3rem, 10vw, 6rem); letter-spacing: -.07em; }
p { max-width: 520px; color: #aeb5c5; font-size: 1.1rem; line-height: 1.65; }
`,
      "/project/wrangler.jsonc": json({
        $schema: "./node_modules/wrangler/config-schema.json",
        name: "wzed-vite-preview",
        compatibility_date: "2026-07-28",
        assets: {
          directory: "./dist",
          not_found_handling: "single-page-application",
        },
      }),
    },
  },
  {
    id: "cloudflare",
    name: "Cloudflare Worker",
    description: "Worker API with a live temporary deployment",
    deploymentKind: "worker",
    files: {
      "/project/package.json": json({
        name: "cloudflare-worker",
        version: "1.0.0",
        private: true,
        type: "module",
      }),
      "/project/wrangler.jsonc": json({
        $schema: "./node_modules/wrangler/config-schema.json",
        name: "wzed-worker-preview",
        main: "src/index.js",
        compatibility_date: "2026-07-28",
      }),
      "/project/src/index.js": `export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/hello") {
      return Response.json({ message: "Hello from a temporary Cloudflare Worker" });
    }
    return new Response(
      "<!doctype html><html><body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#101217;color:#f5f7ff;font-family:system-ui'><main><small style='color:#8ca7ff;letter-spacing:.18em'>TEMPORARY WORKER</small><h1 style='font-size:clamp(3rem,10vw,6rem);letter-spacing:-.06em;margin:.5rem 0'>It works.</h1><p style='color:#aeb5c3'>Edit src/index.js and deploy again before claiming.</p></main></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  },
};
`,
      "/project/README.md":
        "# Temporary Cloudflare Worker\n\nUse the **Deploy** button in wZed. No Cloudflare account is required until you choose to claim the preview.\n",
    },
  },
] as const;

export function getTemplateDefinition(id?: string): TemplateDefinition {
  return (
    TEMPLATE_DEFINITIONS.find((template) => template.id === id) ??
    TEMPLATE_DEFINITIONS.find((template) => template.id === "node")!
  );
}
