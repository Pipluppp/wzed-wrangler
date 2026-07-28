import { describe, expect, it } from "vitest";
import { getTemplateDefinition, TEMPLATE_DEFINITIONS } from "../src/templates";

describe("project templates", () => {
  it("uses one unique definition per template", () => {
    const ids = TEMPLATE_DEFINITIONS.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(["vite", "react"])("configures %s as a static SPA preview", (id) => {
    const template = getTemplateDefinition(id);
    const manifest = JSON.parse(template.files["/project/package.json"]);
    const wrangler = JSON.parse(template.files["/project/wrangler.jsonc"]);

    expect(template.deploymentKind).toBe("static");
    expect(manifest.scripts.build).toBe("vite build");
    expect(manifest.devDependencies.vite).toMatch(/^\^8\./);
    expect(wrangler.assets).toEqual({
      directory: "./dist",
      not_found_handling: "single-page-application",
    });
    expect(template.files["/project/public/_headers"]).toBeUndefined();
  });

  it("uses an already bundled JavaScript entrypoint for the Worker preview", () => {
    const template = getTemplateDefinition("cloudflare");
    const wrangler = JSON.parse(template.files["/project/wrangler.jsonc"]);

    expect(template.deploymentKind).toBe("worker");
    expect(wrangler.main).toBe("src/index.js");
    expect(template.files["/project/src/index.js"]).toContain("export default");
  });
});
