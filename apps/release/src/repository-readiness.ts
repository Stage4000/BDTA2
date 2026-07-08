import { existsSync } from "node:fs";
import path from "node:path";
import { validateProductionEnvFile } from "./production-env.js";

export type RepositoryReadinessAudit = {
  area: "deployment_artifacts" | "vendored_public_assets" | "production_dependencies" | "production_env_template";
  ready: boolean;
  issues: string[];
};

export type RepositoryReadinessAssessment = {
  audits: RepositoryReadinessAudit[];
  blockingIssues: string[];
};

type RepositoryReadinessOptions = {
  refactorRoot: string;
  productionAuditReportJson: string;
};

const requiredDeploymentArtifacts = [
  "app.js",
  "Dockerfile",
  ".dockerignore",
  "docker-compose.production.yml",
  ".env.release-validation",
  ".github/workflows/ci.yml",
  "docs/deployment/container-stack.md",
  "docs/deployment/plesk-single-app.md",
  "scripts/validate-plesk-single-app.mjs",
  ".env.production.example"
] as const;

const requiredVendoredPublicAssets = [
  "public/assets/images/hero-dog-real.jpg",
  "public/assets/favicon.svg"
] as const;

type ParsedAuditReport = {
  metadata?: {
    vulnerabilities?: {
      total?: number;
    };
  };
  vulnerabilities?: Record<string, { severity?: string }>;
};

function buildFileAudit(
  refactorRoot: string,
  area: RepositoryReadinessAudit["area"],
  filePaths: readonly string[],
  label: string
): RepositoryReadinessAudit {
  const issues = filePaths
    .filter((relativePath) => !existsSync(path.join(refactorRoot, relativePath)))
    .map((relativePath) => `Missing required ${label}: ${relativePath}.`);

  return {
    area,
    ready: issues.length === 0,
    issues
  };
}

function buildProductionDependencyAudit(productionAuditReportJson: string): RepositoryReadinessAudit {
  let parsed: ParsedAuditReport;

  try {
    parsed = JSON.parse(productionAuditReportJson) as ParsedAuditReport;
  } catch {
    return {
      area: "production_dependencies",
      ready: false,
      issues: ["Production dependency audit output could not be parsed as JSON."]
    };
  }

  const vulnerabilityTotal = parsed.metadata?.vulnerabilities?.total ?? 0;
  const vulnerabilityNames = Object.keys(parsed.vulnerabilities ?? {});
  const issues: string[] = [];

  if (vulnerabilityTotal > 0) {
    issues.push(`Production dependency audit reported ${vulnerabilityTotal} vulnerability${vulnerabilityTotal === 1 ? "" : "ies"}.`);
  }

  if (vulnerabilityNames.length > 0) {
    issues.push(`Affected packages: ${vulnerabilityNames.join(", ")}.`);
  }

  return {
    area: "production_dependencies",
    ready: issues.length === 0,
    issues
  };
}

async function buildProductionEnvTemplateAudit(refactorRoot: string): Promise<RepositoryReadinessAudit> {
  const filePath = path.join(refactorRoot, ".env.production.example");
  if (!existsSync(filePath)) {
    return {
      area: "production_env_template",
      ready: false,
      issues: ["Missing required deployment artifact: .env.production.example."]
    };
  }

  const result = await validateProductionEnvFile(filePath, "template");
  return {
    area: "production_env_template",
    ready: result.valid,
    issues: result.issues
  };
}

export async function buildRepositoryReadinessAssessment(options: RepositoryReadinessOptions): Promise<RepositoryReadinessAssessment> {
  const audits: RepositoryReadinessAudit[] = [
    buildFileAudit(options.refactorRoot, "deployment_artifacts", requiredDeploymentArtifacts, "deployment artifact"),
    buildFileAudit(options.refactorRoot, "vendored_public_assets", requiredVendoredPublicAssets, "vendored public asset"),
    buildProductionDependencyAudit(options.productionAuditReportJson),
    await buildProductionEnvTemplateAudit(options.refactorRoot)
  ];

  return {
    audits,
    blockingIssues: audits.flatMap((audit) =>
      audit.ready
        ? []
        : audit.issues.map((issue) => `Repository readiness failed for ${audit.area}: ${issue}`)
    )
  };
}
