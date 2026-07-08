import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function decodeEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }

  return trimmed;
}

export function serializeEnvValue(value: string): string {
  if (value === "") {
    return "";
  }

  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")}"`;
}

export function parseEnvContent(content: string): Record<string, string> {
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
    const value = decodeEnvValue(line.slice(separatorIndex + 1));
    if (key !== "") {
      values[key] = value;
    }
  }

  return values;
}

export async function loadEnvFileIfPresent(filePath: string): Promise<Record<string, string>> {
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

export function mergeEnvContent(content: string, updates: Record<string, string>): string {
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const updatedKeys = new Set<string>();
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return line;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!(key in updates)) {
      return line;
    }

    updatedKeys.add(key);
    return `${key}=${serializeEnvValue(updates[key] ?? "")}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      nextLines.push(`${key}=${serializeEnvValue(value)}`);
    }
  }

  const normalized = nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export async function updateEnvFileValues(options: {
  filePath: string;
  updates: Record<string, string>;
  templateFilePath?: string;
}): Promise<void> {
  let content = "";

  try {
    content = await readFile(options.filePath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error != null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : undefined;
    if (code !== "ENOENT") {
      throw error;
    }

    if (options.templateFilePath != null) {
      try {
        await copyFile(options.templateFilePath, options.filePath);
        content = await readFile(options.filePath, "utf8");
      } catch (copyError) {
        const copyCode = typeof copyError === "object" && copyError != null && "code" in copyError
          ? String((copyError as { code?: unknown }).code ?? "")
          : undefined;
        if (copyCode !== "ENOENT") {
          throw copyError;
        }
      }
    }
  }

  await writeFile(options.filePath, mergeEnvContent(content, options.updates), "utf8");
}

export async function resolveStartupEnvironment(options: {
  cwd?: string;
  processEnv: NodeJS.ProcessEnv;
  envFileName?: string;
}): Promise<NodeJS.ProcessEnv> {
  const cwd = options.cwd ?? process.cwd();
  const envFileName = options.envFileName ?? ".env.production";
  const fileValues = await loadEnvFileIfPresent(path.join(cwd, envFileName));

  return {
    ...fileValues,
    ...options.processEnv
  };
}
