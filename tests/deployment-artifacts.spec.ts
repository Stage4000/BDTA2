import { access, readFile } from "node:fs/promises";
import path from "node:path";

const refactorRoot = path.resolve(import.meta.dirname, "..");

describe("deployment artifacts", () => {
  it("includes container, workflow, and deployment docs artifacts", async () => {
    const requiredFiles = [
      path.join(refactorRoot, "Dockerfile"),
      path.join(refactorRoot, ".dockerignore"),
      path.join(refactorRoot, "docker-compose.production.yml"),
      path.join(refactorRoot, ".env.release-validation"),
      path.join(refactorRoot, ".github", "workflows", "ci.yml"),
      path.join(refactorRoot, "docs", "deployment", "container-stack.md"),
      path.join(refactorRoot, "docs", "deployment", "plesk-single-app.md"),
      path.join(refactorRoot, "public", "assets", "images", "hero-dog-real.jpg"),
      path.join(refactorRoot, "public", "assets", "vendor", "editor", "grapesjs", "grapes.min.js"),
      path.join(refactorRoot, "public", "assets", "vendor", "editor", "bootstrap", "css", "bootstrap.min.css"),
      path.join(refactorRoot, "public", "assets", "vendor", "editor", "fontawesome", "css", "all.min.css")
    ];

    await Promise.all(requiredFiles.map((filePath) => access(filePath)));
  });

  it("wires build and ci to release validation and asset syncing", async () => {
    const packageJson = await readFile(path.join(refactorRoot, "package.json"), "utf8");
    const packageLock = await readFile(path.join(refactorRoot, "package-lock.json"), "utf8");
    const dockerfile = await readFile(path.join(refactorRoot, "Dockerfile"), "utf8");
    const workflow = await readFile(path.join(refactorRoot, ".github", "workflows", "ci.yml"), "utf8");
    const deploymentDoc = await readFile(path.join(refactorRoot, "docs", "deployment", "container-stack.md"), "utf8");
    const pleskDoc = await readFile(path.join(refactorRoot, "docs", "deployment", "plesk-single-app.md"), "utf8");

    expect(packageJson).toContain("\"sync:legacy-assets\"");
    expect(packageJson).toContain("\"validate:env\"");
    expect(packageJson).toContain("\"start:platform\"");
    expect(packageJson).toContain("npm run sync:legacy-assets");
    expect(packageJson).toContain("node ./node_modules/typescript/bin/tsc -p tsconfig.build.json");
    expect(packageJson).toContain("node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit");
    expect(packageJson).toContain("node dist/apps/release/src/env-validator-cli.js");
    expect(packageJson).toContain("\"grapesjs\"");
    expect(packageJson).toContain("\"bootstrap\"");
    expect(packageJson).toContain("\"@fortawesome/fontawesome-free\"");
    expect(packageLock).toContain("\"playwright\"");
    expect(packageLock).toContain("\"grapesjs\"");
    expect(packageLock).toContain("\"bootstrap\"");
    expect(packageLock).toContain("\"@fortawesome/fontawesome-free\"");
    expect(dockerfile).toContain("dist/apps/api/src/main.js");
    expect(dockerfile).toContain("COPY --from=build /app/public ./public");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run validate:release");
    expect(workflow).not.toContain("validate:env");
    expect(deploymentDoc).toContain("npm run validate:env -- --file .env.production --mode runtime");
    expect(deploymentDoc).toContain("npm run validate:release");
    expect(deploymentDoc).toContain("reports/release-validation/latest.json");
    expect(deploymentDoc).toContain("RELEASE_VALIDATION_DATE=2026-06-06 npm run validate:release");
    expect(pleskDoc).toContain("dist/apps/platform/src/main.js");
    expect(pleskDoc).toContain("npm run start:platform");
    expect(pleskDoc).toContain("npm run validate:env -- --use-startup-env --mode runtime");
    expect(pleskDoc).toContain("stripe_webhook_secret");
    expect(pleskDoc).toContain("public/assets/vendor/editor");
  });
});
