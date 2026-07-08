import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const applicationRoot = path.dirname(fileURLToPath(import.meta.url));
const platformEntryPath = path.join(applicationRoot, "dist", "apps", "platform", "src", "main.js");

if (!existsSync(platformEntryPath)) {
  console.error(
    [
      "BDTA platform build output is missing.",
      "Run `npm install` and `npm run build` from application root before starting Plesk app.",
      `Expected startup target: ${platformEntryPath}`
    ].join("\n")
  );
  process.exit(1);
}

void import(pathToFileURL(platformEntryPath).href).catch((error) => {
  console.error(error);
  process.exit(1);
});
