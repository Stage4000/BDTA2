import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distNodeModulesDir = path.join(rootDir, "dist", "node_modules", "@bdta");

const packages = [
  "application",
  "contracts",
  "domain",
  "infrastructure",
  "platform"
];

for (const packageName of packages) {
  const packageDir = path.join(distNodeModulesDir, packageName);
  await mkdir(packageDir, { recursive: true });

  const relativeEntry = `../../../packages/${packageName}/src/index.js`;
  await writeFile(
    path.join(packageDir, "index.js"),
    `export * from "${relativeEntry}";\n`,
    "utf8"
  );
  const packageJson = {
    name: `@bdta/${packageName}`,
    private: true,
    type: "module",
    main: "./index.js",
    exports: {
      ".": "./index.js"
    }
  };

  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8"
  );
}
