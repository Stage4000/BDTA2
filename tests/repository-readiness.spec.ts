import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildRepositoryReadinessAssessment } from "../apps/release/src/repository-readiness.js";

async function createFile(filePath: string, contents = ""): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

describe("repository readiness assessment", () => {
  it("passes when deployment artifacts, vendored assets, and production audit are clean", async () => {
    const refactorRoot = await mkdtemp(path.join(os.tmpdir(), "bdta-repo-ready-"));

    await Promise.all([
      createFile(path.join(refactorRoot, "app.js"), 'await import("./dist/apps/platform/src/main.js");'),
      createFile(path.join(refactorRoot, "Dockerfile"), "FROM node:22"),
      createFile(path.join(refactorRoot, ".dockerignore"), "node_modules/"),
      createFile(path.join(refactorRoot, "docker-compose.production.yml"), "services: {}"),
      createFile(path.join(refactorRoot, ".env.release-validation"), "BDTA_VALIDATION_ENV_MODE=synthetic"),
      createFile(path.join(refactorRoot, ".github", "workflows", "ci.yml"), "name: ci"),
      createFile(path.join(refactorRoot, "docs", "deployment", "container-stack.md"), "# Container Stack"),
      createFile(path.join(refactorRoot, "docs", "deployment", "plesk-single-app.md"), "# Plesk Single-App Setup"),
      createFile(path.join(refactorRoot, "scripts", "validate-plesk-single-app.mjs"), 'console.log("ok");'),
      createFile(path.join(refactorRoot, ".env.production.example"), [
        "DB_TYPE=mysql",
        "DB_HOST=localhost",
        "DB_PORT=3306",
        "DB_NAME=bdta",
        "DB_USER=bdta_user",
        "DB_PASSWORD=your_mysql_password",
        "SESSION_LIFETIME_SECONDS=1209600"
      ].join("\n")),
      createFile(path.join(refactorRoot, "public", "assets", "images", "hero-dog-real.jpg")),
      createFile(path.join(refactorRoot, "public", "assets", "favicon.svg"))
    ]);

    const assessment = await buildRepositoryReadinessAssessment({
      refactorRoot,
      productionAuditReportJson: JSON.stringify({
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
            total: 0
          }
        },
        vulnerabilities: {}
      })
    });

    expect(assessment.blockingIssues).toEqual([]);
    expect(assessment.audits.every((audit) => audit.ready)).toBe(true);
  });

  it("reports missing deployment files and production vulnerabilities", async () => {
    const refactorRoot = await mkdtemp(path.join(os.tmpdir(), "bdta-repo-not-ready-"));
    await createFile(path.join(refactorRoot, "public", "assets", "images", "hero-dog-real.jpg"));

    const assessment = await buildRepositoryReadinessAssessment({
      refactorRoot,
      productionAuditReportJson: JSON.stringify({
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 1,
            critical: 0,
            total: 1
          }
        },
        vulnerabilities: {
          mysql2: {
            name: "mysql2",
            severity: "high"
          }
        }
      })
    });

    expect(assessment.blockingIssues).toContain("Repository readiness failed for deployment_artifacts: Missing required deployment artifact: Dockerfile.");
    expect(assessment.blockingIssues).toContain("Repository readiness failed for vendored_public_assets: Missing required vendored public asset: public/assets/favicon.svg.");
    expect(assessment.blockingIssues).toContain("Repository readiness failed for production_dependencies: Production dependency audit reported 1 vulnerability.");
  });

  it("reports invalid production env template coverage", async () => {
    const refactorRoot = await mkdtemp(path.join(os.tmpdir(), "bdta-repo-env-template-"));

    await Promise.all([
      createFile(path.join(refactorRoot, "app.js"), 'await import("./dist/apps/platform/src/main.js");'),
      createFile(path.join(refactorRoot, "Dockerfile"), "FROM node:22"),
      createFile(path.join(refactorRoot, ".dockerignore"), "node_modules/"),
      createFile(path.join(refactorRoot, "docker-compose.production.yml"), "services: {}"),
      createFile(path.join(refactorRoot, ".env.release-validation"), "BDTA_VALIDATION_ENV_MODE=synthetic"),
      createFile(path.join(refactorRoot, ".github", "workflows", "ci.yml"), "name: ci"),
      createFile(path.join(refactorRoot, "docs", "deployment", "container-stack.md"), "# Container Stack"),
      createFile(path.join(refactorRoot, "docs", "deployment", "plesk-single-app.md"), "# Plesk Single-App Setup"),
      createFile(path.join(refactorRoot, "scripts", "validate-plesk-single-app.mjs"), 'console.log("ok");'),
      createFile(path.join(refactorRoot, ".env.production.example"), [
        "DB_HOST=localhost",
        "DB_PORT=3306"
      ].join("\n")),
      createFile(path.join(refactorRoot, "public", "assets", "images", "hero-dog-real.jpg")),
      createFile(path.join(refactorRoot, "public", "assets", "favicon.svg"))
    ]);

    const assessment = await buildRepositoryReadinessAssessment({
      refactorRoot,
      productionAuditReportJson: JSON.stringify({
        metadata: {
          vulnerabilities: {
            total: 0
          }
        },
        vulnerabilities: {}
      })
    });

    expect(assessment.blockingIssues).toContain("Repository readiness failed for production_env_template: Missing required environment key: DB_NAME.");
  });
});
