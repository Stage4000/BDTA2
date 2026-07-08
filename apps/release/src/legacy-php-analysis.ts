export type LegacyPhpFailureCategory =
  | "environment_missing_driver"
  | "environment_missing_extension"
  | "assertion_failure"
  | "runtime_error"
  | "unknown_failure";

export type LegacyPhpFailureAnalysis = {
  category: LegacyPhpFailureCategory;
  environmentBlocked: boolean;
  summary: string;
};

export type LegacyPhpFailureSummary = {
  total: number;
  passed: number;
  failed: number;
  environmentBlocked: number;
  behaviorFailures: number;
  categoryCounts: Partial<Record<LegacyPhpFailureCategory, number>>;
};

export type LegacyPhpResultLike = {
  file?: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  failureAnalysis?: LegacyPhpFailureAnalysis | null;
};

export type LegacyBehaviorReconciliationItem = {
  file: string;
  status: "reconciled" | "unresolved";
  summary: string;
  reason: string;
  evidence: string[];
  missingEvidence: string[];
};

export type LegacyBehaviorReconciliation = {
  total: number;
  reconciled: number;
  unresolved: number;
  items: LegacyBehaviorReconciliationItem[];
};

type LegacyBehaviorReconciliationInput = {
  results: LegacyPhpResultLike[];
  passedFeatureCategories: string[];
  cleanCapturedPages: string[];
  coveredTables: string[];
  mysqlSource: string;
};

type LegacyBehaviorRule = {
  reason: string;
  requiredFeatureCategories?: string[];
  requiredPages?: string[];
  requiredTables?: string[];
  requiredSqlPatterns?: Array<{
    label: string;
    pattern: RegExp;
  }>;
  unresolvedByDefault?: boolean;
  unresolvedReason?: string;
};

const legacyBehaviorRules: Record<string, LegacyBehaviorRule> = {
  "test_achievements_feature.php": {
    reason: "TypeScript achievements, certificate rendering, and admin/portal achievement flows are covered by release validation.",
    requiredFeatureCategories: ["portal-self-service", "admin-crm-content-ops"],
    requiredPages: [
      "portal-achievement-detail",
      "portal-achievement-certificate",
      "admin-client-achievement-detail",
      "admin-client-achievement-certificate"
    ],
    requiredTables: ["achievement_types", "client_achievements"]
  },
  "test_blog_cover_photo_helper.php": {
    reason: "TypeScript public/admin blog cover-photo behavior is covered by release validation.",
    requiredFeatureCategories: ["public-site-booking", "admin-crm-content-ops"],
    requiredPages: ["public-blog-index", "public-blog-post", "admin-blog-post-detail"],
    requiredTables: ["blog_posts"]
  },
  "test_email_message_id_indexes.php": {
    reason: "TypeScript MySQL bootstrap includes the required safe-prefix message_id indexes.",
    requiredTables: ["inbound_emails"],
    requiredSqlPatterns: [
      {
        label: "idx_inbound_emails_provider_message_id",
        pattern: /\bidx_inbound_emails_provider_message_id\b/
      },
      {
        label: "idx_inbound_emails_message_id",
        pattern: /\bidx_inbound_emails_message_id\b/
      }
    ]
  },
  "test_follow_up_portal_source.php": {
    reason: "TypeScript follow-up note portal review and notification parity is covered by release validation.",
    requiredFeatureCategories: ["portal-self-service", "documents-commerce"],
    requiredPages: ["portal-forms", "portal-form-detail", "portal-notifications"],
    requiredTables: ["form_submissions", "notifications"]
  },
  "test_pet_sitting_notes_field.php": {
    reason: "TypeScript pet profile mapping and portal/admin pet views now cover pet sitting notes.",
    requiredFeatureCategories: ["portal-self-service", "admin-crm-content-ops"],
    requiredPages: ["portal-pets", "admin-pets"],
    requiredTables: ["pets"]
  }
};

function extractMessage(output: string): string {
  const trimmed = output.trim();
  if (trimmed === "") {
    return "Unknown failure.";
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}...` : firstLine;
}

export function analyzeLegacyPhpFailure(result: LegacyPhpResultLike): LegacyPhpFailureAnalysis | null {
  if (result.passed) {
    return null;
  }

  const combinedOutput = `${result.stderr}\n${result.stdout}`.trim();
  const normalized = combinedOutput.toLowerCase();

  if (normalized.includes("could not find driver")) {
    return {
      category: "environment_missing_driver",
      environmentBlocked: true,
      summary: "Missing PDO driver in the local PHP environment."
    };
  }

  if (normalized.includes("call to undefined function mb_")) {
    return {
      category: "environment_missing_extension",
      environmentBlocked: true,
      summary: "Missing required mbstring function in the local PHP environment."
    };
  }

  if (normalized.includes("call to undefined function")) {
    return {
      category: "runtime_error",
      environmentBlocked: false,
      summary: extractMessage(combinedOutput)
    };
  }

  if (
    normalized.includes("expected ")
    || normalized.includes("assertion")
    || normalized.includes("failed asserting")
  ) {
    return {
      category: "assertion_failure",
      environmentBlocked: false,
      summary: extractMessage(combinedOutput)
    };
  }

  return {
    category: "unknown_failure",
    environmentBlocked: false,
    summary: extractMessage(combinedOutput)
  };
}

export function summarizeLegacyPhpResults(results: LegacyPhpResultLike[]): LegacyPhpFailureSummary {
  const categoryCounts: Partial<Record<LegacyPhpFailureCategory, number>> = {};
  let passed = 0;
  let environmentBlocked = 0;

  for (const result of results) {
    if (result.passed) {
      passed += 1;
      continue;
    }

    const analysis = analyzeLegacyPhpFailure(result);
    if (analysis == null) {
      continue;
    }

    categoryCounts[analysis.category] = (categoryCounts[analysis.category] ?? 0) + 1;
    if (analysis.environmentBlocked) {
      environmentBlocked += 1;
    }
  }

  const failed = results.length - passed;
  return {
    total: results.length,
    passed,
    failed,
    environmentBlocked,
    behaviorFailures: failed - environmentBlocked,
    categoryCounts
  };
}

export function reconcileLegacyBehaviorFailures(input: LegacyBehaviorReconciliationInput): LegacyBehaviorReconciliation {
  const passedFeatures = new Set(input.passedFeatureCategories);
  const cleanPages = new Set(input.cleanCapturedPages);
  const coveredTables = new Set(input.coveredTables);

  const items = input.results
    .filter((result) => !result.passed)
    .map((result) => {
      const analysis = result.failureAnalysis ?? analyzeLegacyPhpFailure(result);
      if (analysis == null || analysis.environmentBlocked) {
        return null;
      }

      const file = result.file ?? "unknown";
      const rule = legacyBehaviorRules[file];
      if (rule == null) {
        return {
          file,
          status: "unresolved" as const,
          summary: analysis.summary,
          reason: "No TypeScript parity reconciliation rule exists for this legacy behavior failure yet.",
          evidence: [],
          missingEvidence: ["rule-missing"]
        };
      }

      if (rule.unresolvedByDefault) {
        return {
          file,
          status: "unresolved" as const,
          summary: analysis.summary,
          reason: rule.reason,
          evidence: [],
          missingEvidence: [rule.unresolvedReason ?? "manual-review"]
        };
      }

      const evidence: string[] = [];
      const missingEvidence: string[] = [];

      for (const category of rule.requiredFeatureCategories ?? []) {
        if (passedFeatures.has(category)) {
          evidence.push(`feature:${category}`);
        } else {
          missingEvidence.push(`feature:${category}`);
        }
      }

      for (const page of rule.requiredPages ?? []) {
        if (cleanPages.has(page)) {
          evidence.push(`page:${page}`);
        } else {
          missingEvidence.push(`page:${page}`);
        }
      }

      for (const table of rule.requiredTables ?? []) {
        if (coveredTables.has(table)) {
          evidence.push(`table:${table}`);
        } else {
          missingEvidence.push(`table:${table}`);
        }
      }

      for (const sqlPattern of rule.requiredSqlPatterns ?? []) {
        if (sqlPattern.pattern.test(input.mysqlSource)) {
          evidence.push(`sql:${sqlPattern.label}`);
        } else {
          missingEvidence.push(`sql:${sqlPattern.label}`);
        }
      }

      return {
        file,
        status: missingEvidence.length === 0 ? "reconciled" as const : "unresolved" as const,
        summary: analysis.summary,
        reason: rule.reason,
        evidence,
        missingEvidence
      };
    })
    .filter((item): item is LegacyBehaviorReconciliationItem => item != null);

  return {
    total: items.length,
    reconciled: items.filter((item) => item.status === "reconciled").length,
    unresolved: items.filter((item) => item.status === "unresolved").length,
    items
  };
}
