import path from "node:path";

const DEFAULT_LOCALHOST_URL = "http://localhost:8000";
const LEGACY_BLOG_UPLOAD_DIRECTORY = "/backend/uploads/blog";

export function isValidBlogCoverPhotoPath(input: string): boolean {
  const value = input.trim();
  if (value === "") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return value.startsWith("/") && !value.startsWith("//") && !value.includes("..");
  }
}

export function normalizeBlogCoverPhotoPath(input: string): string {
  const value = input.trim();
  return isValidBlogCoverPhotoPath(value) ? value : "";
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function getBlogCoverPhotoAbsoluteUrl(input: string, baseUrl: string = DEFAULT_LOCALHOST_URL): string {
  const normalizedPath = normalizeBlogCoverPhotoPath(input);
  if (normalizedPath === "") {
    return "";
  }

  if (/^https:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  const resolvedBaseUrl = normalizeBaseUrl(baseUrl);
  return resolvedBaseUrl === "" ? normalizedPath : `${resolvedBaseUrl}${normalizedPath}`;
}

export function getBlogCoverPhotoLocalPath(
  input: string,
  repoRoot: string = path.resolve(process.cwd(), "..")
): string {
  const normalizedPath = normalizeBlogCoverPhotoPath(input);
  if (normalizedPath === "" || /^https:\/\//i.test(normalizedPath)) {
    return "";
  }

  if (path.posix.dirname(normalizedPath) !== LEGACY_BLOG_UPLOAD_DIRECTORY) {
    return "";
  }

  const filename = path.posix.basename(normalizedPath);
  if (filename === "" || filename === "." || filename === "..") {
    return "";
  }

  return path.join(repoRoot, "backend", "uploads", "blog", filename);
}

export function normalizeNullableBlogCoverPhotoPath(input: string | null): string | null {
  if (input == null) {
    return null;
  }

  const normalized = normalizeBlogCoverPhotoPath(input);
  return normalized === "" ? null : normalized;
}
