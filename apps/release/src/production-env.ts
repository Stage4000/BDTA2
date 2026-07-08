import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeResolvedEnvironment } from "@bdta/platform";

export type ProductionEnvValidationMode = "template" | "runtime";

export type ProductionEnvValidationResult = {
  valid: boolean;
  issues: string[];
  values: Record<string, string>;
};

export const syntheticValidationEnvMode = "synthetic";

const runtimePlaceholderPatterns: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "DATABASE_URL", patterns: [/db\.example\.com/i, /mysql:\/\/user:password@/i] },
  { key: "DB_HOST", patterns: [/db\.example\.com/i] },
  { key: "DB_PASSWORD", patterns: [/your_mysql_password/i, /replace_me/i] }
];

function parseEnvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key !== "") {
      values[key] = value;
    }
  }

  return values;
}

function toStringRecord(values: Record<string, string | undefined>): Record<string, string> {
  return Object.entries(values).reduce<Record<string, string>>((accumulator, [key, value]) => {
    if (value != null) {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
}

async function loadEnvFileIfPresent(filePath: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(filePath, "utf8");
    return parseEnvContent(content);
  } catch (error) {
    const code = typeof error === "object" && error != null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : undefined;
    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function detectMissingKeys(values: Record<string, string>): string[] {
  const hasDatabaseUrl = (values.DATABASE_URL ?? "").trim() !== "";
  const legacyMissing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    .filter((key) => (values[key] ?? "").trim() === "");

  if (hasDatabaseUrl || legacyMissing.length === 0) {
    return [];
  }

  return legacyMissing.map((key) => `Missing required environment key: ${key}.`);
}

function detectRuntimePlaceholders(values: Record<string, string>): string[] {
  return runtimePlaceholderPatterns.flatMap(({ key, patterns }) => {
    const value = values[key] ?? "";
    if (value.trim() === "") {
      return [];
    }

    return patterns.some((pattern) => pattern.test(value))
      ? [`Environment key ${key} still uses a placeholder deployment value.`]
      : [];
  });
}

export function validateProductionEnvRecord(
  values: Record<string, string | undefined>,
  mode: ProductionEnvValidationMode
): ProductionEnvValidationResult {
  const normalizedValues = toStringRecord(normalizeResolvedEnvironment(values));
  const issues = [
    ...detectMissingKeys(normalizedValues),
    ...(mode === "runtime" ? detectRuntimePlaceholders(normalizedValues) : [])
  ];

  return {
    valid: issues.length === 0,
    issues,
    values: normalizedValues
  };
}

export function validateProductionEnvValues(
  content: string,
  mode: ProductionEnvValidationMode
): ProductionEnvValidationResult {
  return validateProductionEnvRecord(parseEnvContent(content), mode);
}

export async function validateProductionEnvFile(
  filePath: string,
  mode: ProductionEnvValidationMode
): Promise<ProductionEnvValidationResult> {
  const content = await readFile(filePath, "utf8");
  return validateProductionEnvValues(content, mode);
}

export async function resolveLaunchReadinessEnvironment(options: {
  cwd: string;
  processEnv: NodeJS.ProcessEnv;
  envFileName?: string;
}): Promise<NodeJS.ProcessEnv> {
  const syntheticEnvValues = await loadEnvFileIfPresent(path.join(options.cwd, ".env.release-validation"));
  const productionEnvValues = await loadEnvFileIfPresent(path.join(options.cwd, options.envFileName ?? ".env.production"));

  return normalizeResolvedEnvironment({
    ...syntheticEnvValues,
    ...productionEnvValues,
    ...options.processEnv
  });
}
