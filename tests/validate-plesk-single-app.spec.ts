import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Script-level deployment validator stays as .mjs so Plesk can run it directly.
// @ts-expect-error No generated declaration file exists for this executable script module.
import { runPleskSingleAppValidation } from "../scripts/validate-plesk-single-app.mjs";

async function createFile(filePath: string, contents = ""): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function createRequiredDeploymentTree(root: string): Promise<void> {
  await Promise.all([
    createFile(path.join(root, "app.js"), 'await import("./dist/apps/platform/src/main.js");'),
    createFile(path.join(root, "dist", "apps", "platform", "src", "main.js"), 'console.log("platform");'),
    createFile(path.join(root, "dist", "apps", "release", "src", "env-validator-cli.js"), 'console.log("env-validator");'),
    createFile(path.join(root, "dist", "apps", "migrate", "src", "main.js"), 'console.log("{}");'),
    createFile(path.join(root, "docs", "deployment", "plesk-single-app.md"), "# Plesk Single-App Setup"),
    createFile(path.join(root, ".env.production.example"), [
      "DB_TYPE=mysql",
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=bdta_user",
      "DB_PASSWORD=your_mysql_password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n")),
    createFile(path.join(root, "public", "index.html"), "<html></html>")
  ]);
}

describe("plesk single-app validator", () => {
  it("passes artifact checks and reports skipped runtime validation when startup env is unavailable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-plesk-validator-skip-"));
    await createRequiredDeploymentTree(root);

    const result = await runPleskSingleAppValidation({
      appRoot: root,
      env: {},
      runEnvValidation: async ({ args }: { args: string[] }) => ({
        exitCode: 0,
        stdout: args.includes("template")
          ? "Environment validation passed for template."
          : "",
        stderr: ""
      })
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Single-app deployment artifacts: ready");
    expect(result.stdout).toContain("Runtime environment validation: skipped");
    expect(result.stdout).toContain("Launch preflight: skipped");
    expect(result.stderr).toBe("");
  });

  it("fails when runtime environment validation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-plesk-validator-env-fail-"));
    await createRequiredDeploymentTree(root);
    await createFile(path.join(root, ".env.production"), [
      "DB_HOST=db.example.com",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=user",
      "DB_PASSWORD=your_mysql_password"
    ].join("\n"));

    const result = await runPleskSingleAppValidation({
      appRoot: root,
      env: {},
      resolveStartupEnvironment: async ({ env }: { env: NodeJS.ProcessEnv }) => env,
      runEnvValidation: async ({ args }: { args: string[] }) => {
        if (args.includes("template")) {
          return {
            exitCode: 0,
            stdout: "Environment validation passed for template.",
            stderr: ""
          };
        }

        return {
          exitCode: 1,
          stdout: "",
          stderr: "Environment validation failed for startup environment (runtime).\n- Environment key DB_HOST still uses a placeholder deployment value."
        };
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Environment validation failed for startup environment");
    expect(result.stdout).not.toContain("Launch preflight: ready");
  });

  it("surfaces launch preflight blocking issues after runtime validation passes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-plesk-validator-preflight-fail-"));
    await createRequiredDeploymentTree(root);
    await createFile(path.join(root, ".env.production"), [
      "DB_HOST=db.internal",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=real_user",
      "DB_PASSWORD=real_password"
    ].join("\n"));

    const report = {
      blockingIssues: [
        "Provider readiness failed for stripe: Missing required stripe settings."
      ],
      preflightReport: {
        readyForLaunch: false,
        runtimeConfigAudits: [],
        providerAudits: [
          {
            provider: "stripe",
            configured: false,
            liveModeReady: false,
            mode: "unknown",
            issues: ["Missing required stripe settings."]
          }
        ],
        operationalAudits: []
      }
    };

    const result = await runPleskSingleAppValidation({
      appRoot: root,
      env: {},
      runEnvValidation: async ({ args }: { args: string[] }) => {
        return {
          exitCode: 0,
          stdout: args.includes("template")
            ? "Environment validation passed for template."
            : "Environment validation passed for startup environment.",
          stderr: ""
        };
      },
      resolveStartupEnvironment: async ({ env }: { env: NodeJS.ProcessEnv }) => env,
      runLaunchPreflight: async () => {
          return {
            exitCode: 1,
            stdout: JSON.stringify(report),
            stderr: ""
          };
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Launch preflight ready: no");
    expect(result.stderr).toContain("Launch preflight failed.");
    expect(result.stderr).toContain("Provider readiness failed for stripe");
  });
});
