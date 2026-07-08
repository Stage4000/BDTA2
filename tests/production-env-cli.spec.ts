import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runProductionEnvValidationCli } from "../apps/release/src/env-validator-cli.js";

async function createFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

describe("production env validation cli", () => {
  it("passes for a valid template env file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-env-cli-ok-"));
    const filePath = path.join(root, ".env.production.example");

    await createFile(filePath, [
      "DB_TYPE=mysql",
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=bdta_user",
      "DB_PASSWORD=your_mysql_password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"));

    const result = await runProductionEnvValidationCli(["--file", ".env.production.example", "--mode", "template"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Environment validation passed");
    expect(result.stderr).toBe("");
  });

  it("fails for a runtime env file that still uses placeholders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-env-cli-fail-"));
    const filePath = path.join(root, ".env.production");

    await createFile(filePath, [
      "DATABASE_URL=mysql://user:password@db.example.com:3306/bdta",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"));

    const result = await runProductionEnvValidationCli(["--file", ".env.production", "--mode", "runtime"], root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).not.toContain("GOOGLE_OAUTH_CLIENT_SECRET");
  });

  it("validates the merged startup environment when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-env-cli-startup-ok-"));
    const filePath = path.join(root, ".env.production");

    await createFile(filePath, [
      "DB_HOST=db.internal",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=real_user",
      "DB_PASSWORD=real_password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"));

    const result = await runProductionEnvValidationCli(["--use-startup-env", "--mode", "runtime"], root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("startup environment");
    expect(result.stderr).toBe("");
  });
});
