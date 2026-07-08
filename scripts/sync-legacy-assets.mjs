import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryContents(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function copyPath(sourcePath, targetPath) {
  const info = await stat(sourcePath);

  if (info.isDirectory()) {
    await copyDirectoryContents(sourcePath, targetPath);
    return;
  }

  if (info.isFile()) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function syncBundledEditorAssets(rootDir) {
  const vendorRoot = path.join(rootDir, "public", "assets", "vendor", "editor");
  const manifest = [
    {
      source: path.join(rootDir, "node_modules", "grapesjs", "dist", "css"),
      target: path.join(vendorRoot, "grapesjs", "css")
    },
    {
      source: path.join(rootDir, "node_modules", "grapesjs", "dist", "grapes.min.js"),
      target: path.join(vendorRoot, "grapesjs", "grapes.min.js")
    },
    {
      source: path.join(rootDir, "node_modules", "grapesjs-blocks-basic", "dist"),
      target: path.join(vendorRoot, "grapesjs-blocks-basic")
    },
    {
      source: path.join(rootDir, "node_modules", "grapesjs-preset-webpage", "dist"),
      target: path.join(vendorRoot, "grapesjs-preset-webpage")
    },
    {
      source: path.join(rootDir, "node_modules", "bootstrap", "dist", "css"),
      target: path.join(vendorRoot, "bootstrap", "css")
    },
    {
      source: path.join(rootDir, "node_modules", "bootstrap", "dist", "js"),
      target: path.join(vendorRoot, "bootstrap", "js")
    },
    {
      source: path.join(rootDir, "node_modules", "@fortawesome", "fontawesome-free", "css"),
      target: path.join(vendorRoot, "fontawesome", "css")
    },
    {
      source: path.join(rootDir, "node_modules", "@fortawesome", "fontawesome-free", "webfonts"),
      target: path.join(vendorRoot, "fontawesome", "webfonts")
    }
  ];
  const missingSources = [];

  await rm(vendorRoot, { recursive: true, force: true });

  for (const entry of manifest) {
    if (!(await pathExists(entry.source))) {
      missingSources.push(entry.source);
      continue;
    }

    await copyPath(entry.source, entry.target);
  }

  if (missingSources.length > 0) {
    throw new Error(
      `Bundled visual-editor assets are missing. Run npm install before syncing assets.\nMissing:\n${missingSources.join("\n")}`
    );
  }
}

export async function syncLegacyAssets(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspaceRoot = path.resolve(rootDir, "..");
  const sourceDir = path.join(workspaceRoot, "legacy", "assets");
  const targetDir = path.join(rootDir, "public", "assets");
  const stdout = options.stdout ?? process.stdout;

  const sourceExists = await pathExists(sourceDir);
  const targetExists = await pathExists(targetDir);

  if (!sourceExists) {
    if (!targetExists) {
      throw new Error(`Legacy asset source is missing at ${sourceDir} and no vendored public/assets fallback exists.`);
    }

    stdout.write(`Using vendored assets from ${targetDir}\n`);
  } else {
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await copyDirectoryContents(sourceDir, targetDir);
  }

  await syncBundledEditorAssets(rootDir);
}

const isMainModule = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  await syncLegacyAssets();
}
