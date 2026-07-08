import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type ReleaseCliRunner = () => Promise<{
  report: {
    summary: {
      validationReadinessPassed: boolean;
    };
  };
  reportPath: string;
}>;

type ReleaseCliDependencies = {
  writeLine(line: string): void;
  writeError?(line: string): void;
  runReleaseValidation?: ReleaseCliRunner;
};

async function runReleaseValidationFromCompiledEntry(): Promise<{
  report: {
    summary: {
      validationReadinessPassed: boolean;
    };
  };
  reportPath: string;
}> {
  const releaseMainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "main.js");
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const child = spawn(process.execPath, [releaseMainPath], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(stderrChunks.join("").trim() || `Release validation failed with exit code ${exitCode ?? "unknown"}.`);
  }

  const reportPath = stdoutChunks
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);

  if (reportPath == null) {
    throw new Error("Release validation did not emit a report path.");
  }

  const reportJsonPath = path.join(path.dirname(reportPath), "report.json");
  const report = JSON.parse(await readFile(reportJsonPath, "utf8")) as {
    summary: {
      validationReadinessPassed: boolean;
    };
  };

  return {
    report,
    reportPath
  };
}

export async function runReleaseCli(dependencies: ReleaseCliDependencies): Promise<number> {
  const runReleaseValidation = dependencies.runReleaseValidation ?? runReleaseValidationFromCompiledEntry;
  try {
    const result = await runReleaseValidation();
    dependencies.writeLine(result.reportPath);
    return result.report.summary.validationReadinessPassed ? 0 : 1;
  } catch (error) {
    if (dependencies.writeError != null) {
      dependencies.writeError(error instanceof Error ? error.stack ?? error.message : String(error));
    } else {
      dependencies.writeLine(error instanceof Error ? error.stack ?? error.message : String(error));
    }
    return 1;
  }
}
