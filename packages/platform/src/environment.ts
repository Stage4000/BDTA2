function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function encodeDatabasePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function parsePositiveInteger(value: string | undefined, envName: string, defaultValue: number): number {
  if (value == null || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName} value.`);
  }

  return parsed;
}

export function resolveDatabaseUrl(env: Record<string, string | undefined>): string {
  const directUrl = readOptionalString(env.DATABASE_URL);
  if (directUrl != null) {
    return directUrl;
  }

  const host = readOptionalString(env.DB_HOST);
  const port = readOptionalString(env.DB_PORT) ?? "3306";
  const databaseName = readOptionalString(env.DB_NAME);
  const username = readOptionalString(env.DB_USER);
  const password = readOptionalString(env.DB_PASSWORD);

  if (host == null || databaseName == null || username == null || password == null) {
    throw new Error("Missing required database configuration. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.");
  }

  return `mysql://${encodeDatabasePathSegment(username)}:${encodeDatabasePathSegment(password)}@${host}:${port}/${encodeDatabasePathSegment(databaseName)}`;
}

export function resolveSessionTtlSeconds(
  env: Record<string, string | undefined>,
  defaultValue = 60 * 60 * 24 * 14
): number {
  const sessionValue = readOptionalString(env.SESSION_TTL_SECONDS);
  if (sessionValue != null) {
    return parsePositiveInteger(sessionValue, "SESSION_TTL_SECONDS", defaultValue);
  }

  const legacyValue = readOptionalString(env.SESSION_LIFETIME_SECONDS);
  if (legacyValue != null) {
    return parsePositiveInteger(legacyValue, "SESSION_LIFETIME_SECONDS", defaultValue);
  }

  return defaultValue;
}

export function resolveOptionalPortalBaseUrl(env: Record<string, string | undefined>): string | undefined {
  return readOptionalString(env.PORTAL_BASE_URL);
}

export function normalizeResolvedEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const normalized = { ...env };

  try {
    normalized.DATABASE_URL = resolveDatabaseUrl(env);
  } catch {
    // Preserve the source environment for downstream validation errors.
  }

  if (normalized.SESSION_TTL_SECONDS == null || normalized.SESSION_TTL_SECONDS.trim() === "") {
    const legacyValue = readOptionalString(env.SESSION_LIFETIME_SECONDS);
    if (legacyValue != null) {
      normalized.SESSION_TTL_SECONDS = legacyValue;
    }
  }

  return normalized;
}
