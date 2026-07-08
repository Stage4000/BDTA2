import { readFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

import {
  resolveLaunchReadinessEnvironment,
  validateProductionEnvFile,
  validateProductionEnvValues
} from "../apps/release/src/production-env.js";

describe("production env validation", () => {
  it("accepts the checked-in production env example as a valid template", async () => {
    const filePath = path.join(process.cwd(), ".env.production.example");
    const content = await readFile(filePath, "utf8");

    const result = validateProductionEnvValues(content, "template");

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects runtime env content with placeholder deployment values", () => {
    const result = validateProductionEnvValues([
      "DB_HOST=db.example.com",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=user",
      "DB_PASSWORD=your_mysql_password"
    ].join("\n"), "runtime");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("DB_HOST"),
      expect.stringContaining("DB_PASSWORD")
    ]));
  });

  it("validates env files from disk using the requested mode", async () => {
    const result = await validateProductionEnvFile(path.join(process.cwd(), ".env.production.example"), "template");

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("loads .env.production values for launch readiness when process env is missing them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-launch-env-"));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".env.production"), [
      "DB_HOST=db.internal",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=real-user",
      "DB_PASSWORD=real-password"
    ].join("\n"), "utf8");

    const environment = await resolveLaunchReadinessEnvironment({
      cwd: root,
      processEnv: {}
    });

    expect(environment.DATABASE_URL).toBe("mysql://real-user:real-password@db.internal:3306/bdta");
    expect(environment.DB_HOST).toBe("db.internal");
  });

  it("loads .env.release-validation when .env.production is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-launch-env-validation-"));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".env.release-validation"), [
      "BDTA_VALIDATION_ENV_MODE=synthetic",
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta_validation",
      "DB_USER=validation",
      "DB_PASSWORD=validation"
    ].join("\n"), "utf8");

    const environment = await resolveLaunchReadinessEnvironment({
      cwd: root,
      processEnv: {}
    });

    expect(environment.BDTA_VALIDATION_ENV_MODE).toBe("synthetic");
    expect(environment.DATABASE_URL).toBe("mysql://validation:validation@localhost:3306/bdta_validation");
    expect(environment.DB_NAME).toBe("bdta_validation");
  });

  it("prefers explicit process env values over .env.production overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bdta-launch-env-override-"));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, ".env.release-validation"), [
      "BDTA_VALIDATION_ENV_MODE=synthetic",
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta_validation",
      "DB_USER=validation",
      "DB_PASSWORD=validation"
    ].join("\n"), "utf8");
    await writeFile(path.join(root, ".env.production"), [
      "DB_HOST=db.internal",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=file-user",
      "DB_PASSWORD=file-password",
      "BDTA_VALIDATION_ENV_MODE=synthetic"
    ].join("\n"), "utf8");

    const environment = await resolveLaunchReadinessEnvironment({
      cwd: root,
      processEnv: {
        DATABASE_URL: "mysql://env-user:env-password@db.internal:3306/bdta"
      }
    });

    expect(environment.DATABASE_URL).toBe("mysql://env-user:env-password@db.internal:3306/bdta");
    expect(environment.DB_USER).toBe("file-user");
  });
});
