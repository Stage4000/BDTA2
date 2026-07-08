import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(scriptDir, "..");
const startupEnvKeys = ["DATABASE_URL", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];

const requiredFiles = [
  { label: "startup wrapper", relativePath: "app.js" },
  { label: "platform build output", relativePath: "dist/apps/platform/src/main.js" },
  { label: "release env validator", relativePath: "dist/apps/release/src/env-validator-cli.js" },
  { label: "migration preflight runtime", relativePath: "dist/apps/migrate/src/main.js" },
  { label: "public document root", relativePath: "public" },
  { label: "Plesk setup guide", relativePath: "docs/deployment/plesk-single-app.md" },
  { label: "production env template", relativePath: ".env.production.example" }
] ;

function readRequiredEnvKeys(appRoot) {
  const templatePath = path.join(appRoot, ".env.production.example");
  if (!existsSync(templatePath)) {
    return [];
  }

  return readFileSync(templatePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((key) => key !== "");
}

function trimOutput(value) {
  return value.trim();
}

function hasStartupEnvironment(appRoot, env) {
  if (existsSync(path.join(appRoot, ".env.production"))) {
    return true;
  }

  return startupEnvKeys.some((key) => (env[key] ?? "").trim() !== "");
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatLaunchPreflightSummary(report) {
  const providerFailures = Array.isArray(report?.preflightReport?.providerAudits)
    ? report.preflightReport.providerAudits.filter((audit) => audit.issues.length > 0).length
    : 0;
  const runtimeFailures = Array.isArray(report?.preflightReport?.runtimeConfigAudits)
    ? report.preflightReport.runtimeConfigAudits.filter((audit) => audit.issues.length > 0).length
    : 0;
  const operationsFailures = Array.isArray(report?.preflightReport?.operationalAudits)
    ? report.preflightReport.operationalAudits.filter((audit) => audit.issues.length > 0).length
    : 0;

  return [
    `Launch preflight ready: ${report?.preflightReport?.readyForLaunch ? "yes" : "no"}`,
    `Blocking issues: ${Array.isArray(report?.blockingIssues) ? report.blockingIssues.length : 0}`,
    `Runtime audits failing: ${runtimeFailures}`,
    `Provider audits failing: ${providerFailures}`,
    `Operational audits failing: ${operationsFailures}`
  ];
}

async function defaultRunEnvValidation(input) {
  const { runProductionEnvValidationCli } = await import(
    pathToFileURL(path.join(input.appRoot, "dist", "apps", "release", "src", "env-validator-cli.js")).href
  );
  return runProductionEnvValidationCli(input.args, input.cwd);
}

async function defaultResolveStartupEnvironment(input) {
  const { resolveStartupEnvironment } = await import(
    pathToFileURL(path.join(input.appRoot, "dist", "packages", "platform", "src", "startup-environment.js")).href
  );
  return resolveStartupEnvironment({
    cwd: input.cwd,
    processEnv: input.env
  });
}

async function defaultRunLaunchPreflight(input) {
  const { runMigrationCli } = await import(
    pathToFileURL(path.join(input.appRoot, "dist", "apps", "migrate", "src", "cli.js")).href
  );
  const outputLines = [];

  try {
    const exitCode = await runMigrationCli({
      env: input.env,
      writeLine(line) {
        outputLines.push(line);
      }
    });

    return {
      exitCode,
      stdout: outputLines.join("\n"),
      stderr: ""
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: outputLines.join("\n"),
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runPleskSingleAppValidation(options = {}) {
  const appRoot = options.appRoot ?? defaultAppRoot;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const runEnvValidation = options.runEnvValidation ?? defaultRunEnvValidation;
  const resolveStartupEnvironment = options.resolveStartupEnvironment ?? defaultResolveStartupEnvironment;
  const runLaunchPreflight = options.runLaunchPreflight ?? defaultRunLaunchPreflight;
  const stdoutLines = [];
  const stderrLines = [];

  stdoutLines.push("BDTA Plesk single-app preflight");
  stdoutLines.push(`Application Root: ${appRoot}`);
  stdoutLines.push("Application Mode: production");
  stdoutLines.push("Document Root: public");
  stdoutLines.push("Startup File: app.js");
  stdoutLines.push("Build Commands:");
  stdoutLines.push("- npm install");
  stdoutLines.push("- npm run build");
  stdoutLines.push("Validation Commands:");
  stdoutLines.push("- npm run validate:plesk");
  stdoutLines.push("- npm run validate:env -- --use-startup-env --mode runtime");

  const envKeys = readRequiredEnvKeys(appRoot);
  if (envKeys.length > 0) {
    stdoutLines.push("Environment Template Keys:");
    for (const key of envKeys) {
      stdoutLines.push(`- ${key}`);
    }
  }

  const missing = requiredFiles.filter((item) => !pathExists(path.join(appRoot, item.relativePath)));
  if (missing.length > 0) {
    stderrLines.push("Missing required single-app deployment artifacts:");
    for (const item of missing) {
      stderrLines.push(`- ${item.label}: ${item.relativePath}`);
    }

    return {
      exitCode: 1,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n")
    };
  }

  stdoutLines.push("Single-app deployment artifacts: ready");

  const templateValidation = await runEnvValidation({
    appRoot,
    cwd: appRoot,
    args: ["--file", ".env.production.example", "--mode", "template"]
  });
  if (templateValidation.exitCode !== 0) {
    stderrLines.push(trimOutput(templateValidation.stderr) || "Environment template validation failed.");
    return {
      exitCode: 1,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n")
    };
  }

  stdoutLines.push(trimOutput(templateValidation.stdout) || "Environment template validation passed.");

  if (!hasStartupEnvironment(appRoot, env)) {
    stdoutLines.push("Runtime environment validation: skipped");
    stdoutLines.push("Launch preflight: skipped");
    stdoutLines.push("Reason: no .env.production file or exported DB runtime values were available in this shell.");
    stdoutLines.push("Use the Plesk-managed Node.js app env, create .env.production, or export DB_* / DATABASE_URL before rerunning validate:plesk for full launch validation.");
    return {
      exitCode: 0,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n")
    };
  }

  const startupEnvironment = await resolveStartupEnvironment({
    appRoot,
    cwd: appRoot,
    env
  });
  const runtimeValidation = await runEnvValidation({
    appRoot,
    cwd: appRoot,
    args: ["--use-startup-env", "--mode", "runtime"]
  });
  if (runtimeValidation.exitCode !== 0) {
    stderrLines.push(trimOutput(runtimeValidation.stderr) || "Runtime environment validation failed.");
    return {
      exitCode: 1,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n")
    };
  }

  stdoutLines.push(trimOutput(runtimeValidation.stdout) || "Runtime environment validation passed.");

  const launchPreflight = await runLaunchPreflight({
    appRoot,
    cwd: appRoot,
    env: {
      ...startupEnvironment,
      MIGRATION_DRY_RUN: "true",
      MIGRATION_APPLY_BOOTSTRAP: "false",
      MIGRATION_REQUIRE_READY: "true",
      MIGRATION_REHEARSAL_ID: startupEnvironment.MIGRATION_REHEARSAL_ID?.trim() || "plesk-preflight"
    }
  });
  const parsedReport = tryParseJson(trimOutput(launchPreflight.stdout));

  if (parsedReport != null) {
    stdoutLines.push(...formatLaunchPreflightSummary(parsedReport));
  } else if (trimOutput(launchPreflight.stdout) !== "") {
    stdoutLines.push("Launch preflight output:");
    stdoutLines.push(trimOutput(launchPreflight.stdout));
  }

  if (launchPreflight.exitCode !== 0) {
    stderrLines.push("Launch preflight failed.");
    if (Array.isArray(parsedReport?.blockingIssues) && parsedReport.blockingIssues.length > 0) {
      for (const issue of parsedReport.blockingIssues) {
        stderrLines.push(`- ${issue}`);
      }
    } else if (trimOutput(launchPreflight.stderr) !== "") {
      stderrLines.push(trimOutput(launchPreflight.stderr));
    }

    return {
      exitCode: 1,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n")
    };
  }

  stdoutLines.push("Launch preflight: ready");
  return {
    exitCode: 0,
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n")
  };
}

async function main() {
  const result = await runPleskSingleAppValidation();
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
  await main();
}
