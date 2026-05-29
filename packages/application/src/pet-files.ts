import path from "node:path";

import { petFileDetailSchema } from "@bdta/contracts";
import type { PetFile } from "@bdta/domain";
import { idSchema, petFileSchema } from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

const MAX_PET_FILE_BYTES = 10 * 1024 * 1024;
const allowedExtensions = new Set(["jpg", "jpeg", "png", "gif", "pdf"]);

const extensionToMimeType: Record<string, "image/jpeg" | "image/png" | "image/gif" | "application/pdf"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  pdf: "application/pdf"
};

export class PetFileUploadError extends Error {
  constructor(
    public readonly code: "not_found" | "missing_file" | "file_too_large" | "invalid_extension" | "invalid_content_type" | "invalid_filename",
    message: string
  ) {
    super(message);
    this.name = "PetFileUploadError";
  }
}

type PetFileUploadInput = {
  originalName: string;
  description: string;
  content: Uint8Array;
};

type PersistedPetFileInput = {
  originalName: string;
  description: string;
  content: Uint8Array;
  fileExtension: "jpg" | "jpeg" | "png" | "gif" | "pdf";
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "application/pdf";
  fileType: "photo" | "document";
  fileSize: number;
  uploadedAt: string;
  uploadedByAdminUserId: string | null;
};

export type PetFileManagementDependencies = {
  now(): string;
  createPortalPetFile(clientId: string, petId: string, input: PersistedPetFileInput): Promise<PetFile | null>;
  createAdminPetFile(petId: string, input: PersistedPetFileInput): Promise<PetFile | null>;
};

const petFileUploadInputSchema = {
  parse(input: unknown): PetFileUploadInput {
    if (typeof input !== "object" || input == null) {
      throw new PetFileUploadError("missing_file", "No file was uploaded.");
    }

    const originalName = typeof (input as { originalName?: unknown }).originalName === "string"
      ? (input as { originalName: string }).originalName
      : "";
    const description = typeof (input as { description?: unknown }).description === "string"
      ? (input as { description: string }).description
      : "";
    const contentValue = (input as { content?: unknown }).content;

    if (!(contentValue instanceof Uint8Array)) {
      throw new PetFileUploadError("missing_file", "No file was uploaded.");
    }

    return {
      originalName,
      description,
      content: contentValue
    };
  }
};

function requirePortalSession(session: SessionSnapshot): string {
  if (session.actorType !== "portal_user") {
    throw new SessionActorError("unauthorized", "Portal session required.");
  }

  return session.actorId;
}

function requireAdminSession(session: SessionSnapshot): string {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  return session.actorId;
}

function sanitizeOriginalName(originalName: string): string {
  const baseName = path.basename(originalName.trim());
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replaceAll("/", "")
    .replaceAll("\\", "")
    .replaceAll("..", "");

  if (sanitized === "" || !sanitized.includes(".")) {
    throw new PetFileUploadError("invalid_filename", "Invalid uploaded file name.");
  }

  return sanitized;
}

function detectMimeType(content: Uint8Array): PersistedPetFileInput["mimeType"] | null {
  if (content.byteLength >= 4 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    content.byteLength >= 8
    && content[0] === 0x89
    && content[1] === 0x50
    && content[2] === 0x4e
    && content[3] === 0x47
    && content[4] === 0x0d
    && content[5] === 0x0a
    && content[6] === 0x1a
    && content[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    content.byteLength >= 6
    && content[0] === 0x47
    && content[1] === 0x49
    && content[2] === 0x46
    && content[3] === 0x38
    && (content[4] === 0x37 || content[4] === 0x39)
    && content[5] === 0x61
  ) {
    return "image/gif";
  }

  if (
    content.byteLength >= 5
    && content[0] === 0x25
    && content[1] === 0x50
    && content[2] === 0x44
    && content[3] === 0x46
    && content[4] === 0x2d
  ) {
    return "application/pdf";
  }

  return null;
}

function normalizePetFileUploadInput(
  input: unknown,
  uploadedAt: string,
  uploadedByAdminUserId: string | null
): PersistedPetFileInput {
  const parsed = petFileUploadInputSchema.parse(input);
  if (parsed.content.byteLength === 0) {
    throw new PetFileUploadError("missing_file", "No file was uploaded.");
  }

  if (parsed.content.byteLength > MAX_PET_FILE_BYTES) {
    throw new PetFileUploadError("file_too_large", "File is too large. Maximum size is 10MB.");
  }

  const originalName = sanitizeOriginalName(parsed.originalName);
  const fileExtension = path.extname(originalName).toLowerCase().replace(/^\./, "");
  if (!allowedExtensions.has(fileExtension)) {
    throw new PetFileUploadError("invalid_extension", "Invalid file type. Only JPG, PNG, GIF, and PDF files are allowed.");
  }

  const detectedMimeType = detectMimeType(parsed.content);
  if (detectedMimeType == null || extensionToMimeType[fileExtension] !== detectedMimeType) {
    throw new PetFileUploadError("invalid_content_type", "Invalid file type detected. File does not match its extension.");
  }

  return {
    originalName,
    description: parsed.description.trim(),
    content: parsed.content,
    fileExtension: fileExtension as PersistedPetFileInput["fileExtension"],
    mimeType: detectedMimeType,
    fileType: fileExtension === "pdf" ? "document" : "photo",
    fileSize: parsed.content.byteLength,
    uploadedAt,
    uploadedByAdminUserId
  };
}

export async function uploadPortalPetFile(
  session: SessionSnapshot,
  petId: string,
  input: unknown,
  dependencies: PetFileManagementDependencies
) {
  const clientId = requirePortalSession(session);
  const normalized = normalizePetFileUploadInput(input, dependencies.now(), null);
  const item = await dependencies.createPortalPetFile(clientId, idSchema.parse(petId), normalized);
  if (item == null) {
    throw new PetFileUploadError("not_found", "Pet not found.");
  }

  return petFileDetailSchema.parse({
    item: petFileSchema.parse(item)
  });
}

export async function uploadAdminPetFile(
  session: SessionSnapshot,
  petId: string,
  input: unknown,
  dependencies: PetFileManagementDependencies
) {
  const adminActorId = requireAdminSession(session);
  const normalized = normalizePetFileUploadInput(input, dependencies.now(), idSchema.parse(adminActorId));
  const item = await dependencies.createAdminPetFile(idSchema.parse(petId), normalized);
  if (item == null) {
    throw new PetFileUploadError("not_found", "Pet not found.");
  }

  return petFileDetailSchema.parse({
    item: petFileSchema.parse(item)
  });
}
