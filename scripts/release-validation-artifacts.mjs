import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function usage() {
  throw new Error(
    "Usage: node scripts/release-validation-artifacts.mjs prepare <dir> | record <dir> <name> <exitCode>"
  );
}

const mode = process.argv[2];
const targetDir = process.argv[3];

if (mode == null || targetDir == null) {
  usage();
}

const resolvedDir = path.resolve(process.cwd(), targetDir);

if (mode === "prepare") {
  await rm(resolvedDir, { recursive: true, force: true });
  await mkdir(resolvedDir, { recursive: true });
} else if (mode === "record") {
  const name = process.argv[4];
  const exitCodeText = process.argv[5];
  if (name == null || exitCodeText == null) {
    usage();
  }

  const exitCode = Number.parseInt(exitCodeText, 10);
  if (!Number.isInteger(exitCode) || exitCode < 0) {
    throw new Error("Expected a non-negative integer exit code.");
  }

  await mkdir(resolvedDir, { recursive: true });
  await writeFile(path.join(resolvedDir, `${name}.exitcode`), `${exitCode}\n`, "utf8");
} else {
  usage();
}
