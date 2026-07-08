import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateProductionEnvFile,
  validateProductionEnvRecord,
  type ProductionEnvValidationMode
} from "./production-env.js";
import { resolveStartupEnvironment } from "@bdta/platform";

export type EnvValidatorCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function parseOption(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

export async function runProductionEnvValidationCli(
  args: readonly string[],
  cwd: string
): Promise<EnvValidatorCliResult> {
  const resolvedFile = parseOption(args, "--file") ?? ".env.production";
  const requestedMode = parseOption(args, "--mode");
  const useStartupEnvironment = hasFlag(args, "--use-startup-env");
  const mode: ProductionEnvValidationMode = requestedMode === "template" || requestedMode === "runtime"
    ? requestedMode
    : resolvedFile.endsWith(".example")
      ? "template"
      : "runtime";
  const filePath = path.resolve(cwd, resolvedFile);

  try {
    const validationTarget = useStartupEnvironment
      ? `${cwd} startup environment`
      : filePath;
    const result = useStartupEnvironment
      ? validateProductionEnvRecord(await resolveStartupEnvironment({
        cwd,
        processEnv: process.env,
        envFileName: resolvedFile
      }), mode)
      : await validateProductionEnvFile(filePath, mode);
    if (!result.valid) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: [
          `Environment validation failed for ${validationTarget} (${mode}).`,
          ...result.issues.map((issue) => `- ${issue}`)
        ].join("\n")
      };
    }

    return {
      exitCode: 0,
      stdout: `Environment validation passed for ${validationTarget} (${mode}).`,
      stderr: ""
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Environment validation failed for ${useStartupEnvironment ? `${cwd} startup environment` : filePath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function main(): Promise<void> {
  const result = await runProductionEnvValidationCli(process.argv.slice(2), process.cwd());
  if (result.stdout !== "") {
    process.stdout.write(`${result.stdout}\n`);
  }
  if (result.stderr !== "") {
    process.stderr.write(`${result.stderr}\n`);
  }
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] != null ? path.resolve(process.argv[1]) : null;
const currentModulePath = path.resolve(fileURLToPath(import.meta.url));

if (invokedPath != null && invokedPath === currentModulePath) {
  void main();
}
