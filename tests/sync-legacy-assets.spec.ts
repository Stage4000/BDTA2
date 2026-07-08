import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

describe("sync-legacy-assets script", () => {
  it("keeps vendored public assets when the legacy workspace is unavailable", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "bdta-sync-assets-"));
    const workspaceRoot = path.join(fixtureRoot, "workspace");
    const refactorRoot = path.join(workspaceRoot, "refactor");
    const scriptDir = path.join(refactorRoot, "scripts");
    const targetDir = path.join(refactorRoot, "public", "assets");
    const grapesCssDir = path.join(refactorRoot, "node_modules", "grapesjs", "dist", "css");
    const grapesJsDir = path.join(refactorRoot, "node_modules", "grapesjs", "dist");
    const blocksDir = path.join(refactorRoot, "node_modules", "grapesjs-blocks-basic", "dist");
    const presetDir = path.join(refactorRoot, "node_modules", "grapesjs-preset-webpage", "dist");
    const bootstrapCssDir = path.join(refactorRoot, "node_modules", "bootstrap", "dist", "css");
    const bootstrapJsDir = path.join(refactorRoot, "node_modules", "bootstrap", "dist", "js");
    const fontawesomeCssDir = path.join(refactorRoot, "node_modules", "@fortawesome", "fontawesome-free", "css");
    const fontawesomeWebfontsDir = path.join(refactorRoot, "node_modules", "@fortawesome", "fontawesome-free", "webfonts");

    await mkdir(scriptDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await mkdir(grapesCssDir, { recursive: true });
    await mkdir(grapesJsDir, { recursive: true });
    await mkdir(blocksDir, { recursive: true });
    await mkdir(presetDir, { recursive: true });
    await mkdir(bootstrapCssDir, { recursive: true });
    await mkdir(bootstrapJsDir, { recursive: true });
    await mkdir(fontawesomeCssDir, { recursive: true });
    await mkdir(fontawesomeWebfontsDir, { recursive: true });

    const sourceScript = await readFile(
      path.join(import.meta.dirname, "..", "scripts", "sync-legacy-assets.mjs"),
      "utf8"
    );

    await writeFile(path.join(scriptDir, "sync-legacy-assets.mjs"), sourceScript, "utf8");
    await writeFile(path.join(targetDir, "vendored.txt"), "keep-me", "utf8");
    await writeFile(path.join(grapesCssDir, "grapes.min.css"), ".gjs{}", "utf8");
    await writeFile(path.join(grapesJsDir, "grapes.min.js"), "window.grapesjs = {};", "utf8");
    await writeFile(path.join(blocksDir, "index.js"), "window.grapesjsBlocksBasic = {};", "utf8");
    await writeFile(path.join(presetDir, "index.js"), "window.grapesjsPresetWebpage = {};", "utf8");
    await writeFile(path.join(bootstrapCssDir, "bootstrap.min.css"), ".btn{}", "utf8");
    await writeFile(path.join(bootstrapJsDir, "bootstrap.bundle.min.js"), "window.bootstrap = {};", "utf8");
    await writeFile(path.join(fontawesomeCssDir, "all.min.css"), "@font-face{}", "utf8");
    await writeFile(path.join(fontawesomeWebfontsDir, "fa-solid-900.woff2"), "font", "utf8");

    const outputChunks: string[] = [];
    const moduleUrl = pathToFileURL(path.join(scriptDir, "sync-legacy-assets.mjs")).href;
    const scriptModule = await import(moduleUrl);
    await scriptModule.syncLegacyAssets({
      rootDir: refactorRoot,
      stdout: {
        write(chunk: string) {
          outputChunks.push(String(chunk));
        }
      }
    });
    const vendoredAsset = await readFile(path.join(targetDir, "vendored.txt"), "utf8");
    const vendoredEditorJs = await readFile(
      path.join(targetDir, "vendor", "editor", "grapesjs", "grapes.min.js"),
      "utf8"
    );
    const vendoredBootstrapCss = await readFile(
      path.join(targetDir, "vendor", "editor", "bootstrap", "css", "bootstrap.min.css"),
      "utf8"
    );

    expect(outputChunks.join("")).toContain("Using vendored assets");
    expect(vendoredAsset).toBe("keep-me");
    expect(vendoredEditorJs).toContain("window.grapesjs");
    expect(vendoredBootstrapCss).toContain(".btn");
  });
});
