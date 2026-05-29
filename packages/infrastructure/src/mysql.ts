import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdminCalendarSyncDependencies,
  AdminIdentity,
  AdminLoginDependencies,
  AdminOperationsDependencies,
  AchievementDependencies,
  ApiDependencies,
  AdminActorProfileDependencies,
  AdminDashboardDependencies,
  AdminResourceReadDependencies,
  BackgroundProcessorDependencies,
  ClientProfileDependencies,
  ContentManagementDependencies,
  ContactManagementDependencies,
  IntegrationCallbackDependencies,
  MigrationAuditDependencies,
  PetFileManagementDependencies,
  PortalCommerceDependencies,
  PublicDocumentAccessDependencies,
  PortalResourceReadDependencies,
  PortalSummaryDependencies,
  PortalActorProfileDependencies,
  PortalLoginDependencies,
  PublicBookingDependencies
} from "@bdta/application";
import type {
  AchievementType,
  BlogPost,
  Booking,
  Client,
  ClientAchievement,
  ClientContact,
  ClientProfile,
  Contract,
  Credit,
  FormSubmission,
  Invoice,
  OutboundEmailMessage,
  Package,
  Pet,
  PetFile,
  PublicAccessToken,
  Quote
  ,
  Setting,
  SitePage
} from "@bdta/domain";
import { outboundEmailSchema } from "@bdta/domain";
import { jobEnvelopeSchema, type JobEnvelope, type SupportedJobKind } from "@bdta/contracts";
import { compare, hash } from "bcryptjs";
import { createPool, type Pool, type PoolOptions } from "mysql2/promise.js";

export type SqlResultHeader = {
  insertId?: number;
  affectedRows?: number;
};

export interface SqlExecutor {
  execute<T>(sql: string, params?: unknown[]): Promise<[T, SqlResultHeader]>;
}

type MySqlApiOptions = {
  now?: () => string;
  portalBaseUrl?: string;
  captchaVerifier?: (token: string) => Promise<boolean>;
  passwordVerifier?: (password: string, hash: string) => Promise<boolean>;
  petUploadsBaseDir?: string;
  petFileContentLoader?: (petId: string, fileName: string) => Promise<Buffer | null>;
  petFileContentWriter?: (petId: string, fileName: string, content: Uint8Array) => Promise<void>;
  petFileContentDeleter?: (petId: string, fileName: string) => Promise<void>;
};

type SessionStoreOptions = {
  now?: () => string;
  ttlSeconds?: number;
};

type MySqlJobProcessorOptions = {
  now?: () => string;
  handlers?: Partial<Record<SupportedJobKind, (job: JobEnvelope) => Promise<string>>>;
  sendEmail?: (message: OutboundEmailMessage) => Promise<void>;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function buildPortalUrl(baseUrl: string, clientId: string, requestedReturnTo: string | null): string {
  if (requestedReturnTo != null && requestedReturnTo.trim() !== "") {
    return requestedReturnTo;
  }

  return `${baseUrl}?client=${encodeURIComponent(clientId)}`;
}

function toAppointmentDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function toAppointmentTime(timestamp: string): string {
  return timestamp.slice(11, 19);
}

function toDurationMinutes(start: string, end: string): number {
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}

function toTimestamp(date: string, time: string): string {
  return `${date}T${time}.000Z`;
}

function toCalendarTimestamp(timestamp: string): string {
  return timestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildGoogleCalendarTemplateUrl(booking: Booking): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `BDTA Booking - ${booking.serviceId}`,
    dates: `${toCalendarTimestamp(booking.startsAt)}/${toCalendarTimestamp(booking.endsAt)}`,
    details: "Brook's Dog Training Academy booking"
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function fromLegacyBookingRow(row: {
  id: number;
  client_id?: number | null;
  service_type: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  ical_token?: string | null;
}): Booking {
  const startsAt = toTimestamp(row.appointment_date, row.appointment_time);
  const endsAt = new Date(Date.parse(startsAt) + row.duration_minutes * 60_000).toISOString();

  return {
    id: String(row.id),
    clientId: String(row.client_id ?? ""),
    petIds: [],
    serviceId: row.service_type,
    startsAt,
    endsAt,
    status: row.status,
    icalAccess: row.ical_token == null ? null : {
      token: row.ical_token,
      issuedAt: startsAt,
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

function toClientRecord(row: { id: number; name: string; email: string; is_archived: number }): Client {
  const trimmed = row.name.trim();
  const [firstName, ...rest] = trimmed.split(/\s+/);
  return {
    id: String(row.id),
    email: row.email,
    firstName: firstName || trimmed || row.email,
    lastName: rest.join(" ") || firstName || trimmed || row.email,
    archived: Number(row.is_archived) === 1
  };
}

function toContactRecord(row: {
  id: number;
  client_id: number;
  name: string;
  email: string;
  phone: string;
  is_primary: number;
}): ClientContact {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: row.name,
    email: row.email,
    phone: row.phone,
    isPrimary: Number(row.is_primary) === 1
  };
}

function toClientProfileRecord(row: {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_admin: number;
  is_archived: number;
}): ClientProfile {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    address: row.address ?? "",
    notes: row.notes ?? "",
    isAdmin: Number(row.is_admin) === 1,
    archived: Number(row.is_archived) === 1
  };
}

function toBlogPostRecord(row: {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  cover_photo: string | null;
  author: string | null;
  published: number;
  publish_date: string | null;
  created_at: string;
  updated_at: string;
}): BlogPost {
  return {
    id: String(row.id),
    title: row.title,
    slug: row.slug,
    content: row.content,
    excerpt: row.excerpt ?? "",
    coverPhoto: row.cover_photo,
    author: row.author ?? "BDTA",
    published: Number(row.published) === 1,
    publishDate: row.publish_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSitePageRecord(row: {
  id: number;
  slug: string;
  title: string;
  html_content: string | null;
  css_content: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  is_homepage: number;
  is_published: number;
  sort_order: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}): SitePage {
  return {
    id: String(row.id),
    slug: row.slug,
    title: row.title,
    htmlContent: row.html_content ?? "",
    cssContent: row.css_content ?? "",
    metaDescription: row.meta_description ?? "",
    metaKeywords: row.meta_keywords ?? "",
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImage: row.og_image,
    isHomepage: Number(row.is_homepage) === 1,
    published: Number(row.is_published) === 1,
    sortOrder: Number(row.sort_order),
    updatedByAdminUserId: row.updated_by == null ? null : String(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSettingRecord(row: {
  id: number;
  setting_key: string;
  setting_value: string | null;
  setting_type: string;
  category: string;
  label: string;
  description: string | null;
  is_secret: number;
  updated_at: string;
}): Setting {
  return {
    id: String(row.id),
    key: row.setting_key,
    value: row.setting_value ?? "",
    type: row.setting_type,
    category: row.category,
    label: row.label,
    description: row.description ?? "",
    secret: Number(row.is_secret) === 1,
    updatedAt: row.updated_at
  };
}

function toPackageRecord(row: { id: number; name: string; is_active: number; price: number }): Package {
  return {
    id: String(row.id),
    name: row.name,
    active: Number(row.is_active) === 1,
    price: Number(row.price)
  };
}

function toPetRecord(row: {
  id: number;
  client_id: number;
  name: string;
  species: string;
  is_active: number;
}): Pet {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: row.name,
    species: row.species,
    archived: Number(row.is_active) !== 1
  };
}

function toPetFileRecord(row: {
  id: number;
  pet_id: number;
  file_type: "photo" | "document";
  file_name: string;
  original_name: string;
  file_size: number;
  mime_type: string;
  description: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}): PetFile {
  return {
    id: String(row.id),
    petId: String(row.pet_id),
    fileType: row.file_type,
    fileName: row.file_name,
    originalName: row.original_name,
    fileSize: Number(row.file_size),
    mimeType: row.mime_type,
    description: row.description ?? "",
    uploadedByAdminUserId: row.uploaded_by == null ? null : String(row.uploaded_by),
    uploadedAt: row.uploaded_at
  };
}

function toAchievementTypeRecord(row: {
  id: number;
  title: string;
  description: string | null;
  scope_type: "general" | "custom";
  award_mode: "badge_only" | "certificate_only" | "badge_certificate";
  badge_icon_path: string | null;
  certificate_template_path: string | null;
  certificate_body_html: string | null;
  is_active: number;
}): AchievementType {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description ?? "",
    scopeType: row.scope_type,
    awardMode: row.award_mode,
    badgeIconPath: row.badge_icon_path,
    certificateTemplatePath: row.certificate_template_path,
    certificateBodyHtml: row.certificate_body_html,
    active: Number(row.is_active) === 1
  };
}

function toClientAchievementRecord(row: {
  id: number;
  client_id: number;
  achievement_type_id: number;
  title: string;
  description: string | null;
  scope_type: "general" | "custom";
  award_mode: "badge_only" | "certificate_only" | "badge_certificate";
  badge_icon_path: string | null;
  certificate_template_path: string | null;
  certificate_body_html: string | null;
  status: "awarded" | "revoked";
  awarded_on: string;
  dog_name: string;
  program_name: string | null;
  notes: string | null;
  awarded_by: number | null;
  updated_by: number | null;
  revoked_by: number | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}): ClientAchievement {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    achievementTypeId: String(row.achievement_type_id),
    title: row.title,
    description: row.description ?? "",
    scopeType: row.scope_type,
    awardMode: row.award_mode,
    badgeIconPath: row.badge_icon_path,
    certificateTemplatePath: row.certificate_template_path,
    certificateBodyHtml: row.certificate_body_html,
    status: row.status,
    awardedOn: row.awarded_on,
    dogName: row.dog_name,
    programName: row.program_name,
    notes: row.notes ?? "",
    awardedByAdminUserId: row.awarded_by == null ? null : String(row.awarded_by),
    updatedByAdminUserId: row.updated_by == null ? null : String(row.updated_by),
    revokedByAdminUserId: row.revoked_by == null ? null : String(row.revoked_by),
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCreditRecord(row: {
  id: number;
  client_id: number;
  package_id: number | null;
  total_credits: number;
  used_credits: number;
}): Credit {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    packageId: row.package_id == null ? null : String(row.package_id),
    remainingUnits: Math.max(0, Number(row.total_credits) - Number(row.used_credits))
  };
}

function createIcalToken(bookingId: string, issuedAt: string): PublicAccessToken {
  return {
    token: `ical-${bookingId}-${randomBytes(8).toString("hex")}`,
    issuedAt,
    expiresAt: null,
    legacySourceId: null
  };
}

function createPetFileContentLoader(baseDir: string) {
  return async (petId: string, fileName: string): Promise<Buffer | null> => {
    try {
      const filePath = path.resolve(baseDir, petId, fileName);
      return await readFile(filePath);
    } catch {
      return null;
    }
  };
}

function createPetFileContentWriter(baseDir: string) {
  return async (petId: string, fileName: string, content: Uint8Array): Promise<void> => {
    const petDir = path.resolve(baseDir, petId);
    await mkdir(petDir, { recursive: true });
    await writeFile(path.resolve(petDir, fileName), content);
  };
}

function createPetFileContentDeleter(baseDir: string) {
  return async (petId: string, fileName: string): Promise<void> => {
    try {
      await unlink(path.resolve(baseDir, petId, fileName));
    } catch {
      return;
    }
  };
}

function createStoredPetFileName(petId: string, fileExtension: string): string {
  return `pet_${petId}_${randomBytes(8).toString("hex")}.${fileExtension}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAchievementCertificateHtml(
  achievement: ClientAchievement,
  options: { audience: "portal" | "admin"; download: boolean; backPath: string }
): string {
  const awardedOn = new Date(`${achievement.awardedOn}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  const title = escapeHtml(achievement.title);
  const dogName = escapeHtml(achievement.dogName ?? "Achievement Recipient");
  const programName = escapeHtml(achievement.programName ?? "");
  const notes = escapeHtml(achievement.notes ?? "");
  const backPath = escapeHtml(options.backPath);
  const certificateBodyHtml = achievement.certificateBodyHtml ?? `<p>${dogName} completed ${programName || "training"}.</p>`;

  return [
    "<!doctype html>",
    `<html lang="en" data-audience="${options.audience}" data-download="${options.download ? "1" : "0"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${title} Certificate</title>`,
    "<style>",
    "body { font-family: Georgia, serif; background: #f7f2e8; color: #1f2933; margin: 0; }",
    ".sheet { max-width: 860px; margin: 24px auto; background: white; padding: 48px; border: 8px solid #d8c08c; }",
    ".eyebrow { text-transform: uppercase; letter-spacing: 0.18em; font-size: 12px; color: #6b7280; }",
    "h1 { font-size: 42px; margin: 12px 0 8px; }",
    ".dog { font-size: 28px; margin: 12px 0; }",
    ".meta { margin-top: 24px; color: #4b5563; }",
    ".actions { margin-top: 32px; font-family: Arial, sans-serif; }",
    ".actions a { color: #1d4ed8; text-decoration: none; }",
    "</style>",
    "</head>",
    "<body>",
    '<main class="sheet">',
    '<div class="eyebrow">Brook&apos;s Dog Training Academy</div>',
    `<h1>${title}</h1>`,
    `<p class="dog">${dogName}</p>`,
    certificateBodyHtml,
    `<p class="meta">Awarded ${escapeHtml(awardedOn)}${programName ? ` for ${programName}` : ""}.</p>`,
    notes ? `<p class="meta">${notes}</p>` : "",
    `<div class="actions"><a href="${backPath}">Back</a></div>`,
    "</main>",
    "</body>",
    "</html>"
  ].filter(Boolean).join("");
}

export function createMySqlApiDependencies(executor: SqlExecutor, options: MySqlApiOptions = {}): ApiDependencies {
  const now = options.now ?? defaultNow;
  const portalBaseUrl = options.portalBaseUrl ?? "http://localhost:3000/portal";
  const captchaVerifier = options.captchaVerifier ?? (async () => true);
  const passwordVerifier = options.passwordVerifier ?? (async (password: string, hash: string) => compare(password, hash));
  const petUploadsBaseDir = options.petUploadsBaseDir ?? path.resolve(process.cwd(), "..", "backend", "uploads", "pets");
  const petFileContentLoader = options.petFileContentLoader ?? createPetFileContentLoader(petUploadsBaseDir);
  const petFileContentWriter = options.petFileContentWriter ?? createPetFileContentWriter(petUploadsBaseDir);
  const petFileContentDeleter = options.petFileContentDeleter ?? createPetFileContentDeleter(petUploadsBaseDir);

  const publicBooking: PublicBookingDependencies = {
    now,
    generateId: (prefix) => `${prefix}-${randomUUID()}`,
    verifyCaptcha: captchaVerifier,
    async isTimeSlotAvailable(input) {
      const appointmentDate = toAppointmentDate(input.requestedStart);
      const appointmentTime = toAppointmentTime(input.requestedStart);
      const requestedEnd = toAppointmentTime(input.requestedEnd);

      const [rows] = await executor.execute<Array<{ overlapCount: number }>>(
        [
          "SELECT COUNT(*) AS overlapCount FROM bookings",
          "WHERE service_type = ?",
          "AND appointment_date = ?",
          "AND status IN ('pending', 'confirmed')",
          "AND appointment_time < ?",
          "AND ADDTIME(appointment_time, SEC_TO_TIME(duration_minutes * 60)) > ?"
        ].join(" "),
        [input.serviceId, appointmentDate, requestedEnd, appointmentTime]
      );

      return Number(rows[0]?.overlapCount ?? 0) === 0;
    },
    async ensureClientForBooking(email) {
      const [rows] = await executor.execute<Array<{ id: number; name: string; password_hash: string | null }>>(
        [
          "SELECT id, name, password_hash FROM clients",
          "WHERE email = ? AND COALESCE(is_archived, 0) = 0",
          "LIMIT 1"
        ].join(" "),
        [email]
      );

      const existing = rows[0];
      if (existing != null) {
        const clientId = String(existing.id);
        return {
          clientId,
          portalUserId: existing.password_hash ? clientId : null,
          displayName: existing.name
        };
      }

      const displayName = email;
      const [, result] = await executor.execute(
        [
          "INSERT INTO clients (name, email, created_at, updated_at)",
          "VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ].join(" "),
        [displayName, email]
      );

      return {
        clientId: String(result.insertId ?? 0),
        portalUserId: null,
        displayName
      };
    },
    async issueIcalToken(input) {
      return createIcalToken(input.bookingId, input.issuedAt);
    },
    async saveBooking({ booking, request, client }) {
      await executor.execute(
        [
          "INSERT INTO bookings (",
          "client_name, client_email, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token, created_at, updated_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ].join(" "),
        [
          client.displayName,
          request.clientEmail,
          request.serviceId,
          toAppointmentDate(booking.startsAt),
          toAppointmentTime(booking.startsAt),
          toDurationMinutes(booking.startsAt, booking.endsAt),
          booking.status,
          booking.icalAccess?.token ?? null
        ]
      );
    },
    async queueConfirmationEmail(message) {
      await executor.execute(
        [
          "INSERT INTO email_outbox (recipient, subject, html_body, template_key, status, created_at)",
          "VALUES (?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)"
        ].join(" "),
        [message.to[0] ?? "", message.subject, message.html, message.templateKey]
      );
    },
    async queueJob(job) {
      await executor.execute(
        [
          "INSERT INTO job_queue (job_id, job_kind, run_at, payload_json, status, created_at)",
          "VALUES (?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)"
        ].join(" "),
        [job.jobId, job.kind, job.scheduledFor, JSON.stringify(job.payload)]
      );
    },
    buildPortalReturnUrl(clientId) {
      return buildPortalUrl(portalBaseUrl, clientId, null);
    }
  };

  const integrationCallbacks: IntegrationCallbackDependencies = {
    now,
    generateId: (prefix) => `${prefix}-${randomUUID()}`,
    async applyStripeInvoiceUpdate(input) {
      await executor.execute(
        [
          "UPDATE invoices SET status = ?, outstanding_amount = ?",
          "WHERE id = ?"
        ].join(" "),
        [input.paymentStatus, input.outstandingAmount, input.invoiceId]
      );
    },
    async applyGoogleCalendarSyncUpdate(input) {
      await executor.execute(
        [
          "INSERT INTO calendar_sync_links (",
          "sync_link_id, booking_id, provider, external_event_id, external_event_url, synced_at, created_at",
          ") VALUES (?, ?, 'google_calendar', ?, ?, ?, CURRENT_TIMESTAMP)",
          "ON DUPLICATE KEY UPDATE",
          "external_event_id = VALUES(external_event_id),",
          "external_event_url = VALUES(external_event_url),",
          "synced_at = VALUES(synced_at)"
        ].join(" "),
        [randomUUID(), input.bookingId, input.externalEventId, input.externalEventUrl, input.syncedAt]
      );
    },
    async recordIntegrationCallback(record) {
      await executor.execute(
        [
          "INSERT INTO integration_callbacks (callback_id, provider, received_at, payload_json, queued_job_id, created_at)",
          "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)"
        ].join(" "),
        [record.callbackId, record.provider, record.receivedAt, JSON.stringify(record.payload), record.queuedJobId]
      );
    },
    async queueJob(job) {
      await executor.execute(
        [
          "INSERT INTO job_queue (job_id, job_kind, run_at, payload_json, status, created_at)",
          "VALUES (?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)"
        ].join(" "),
        [job.jobId, job.kind, job.scheduledFor, JSON.stringify(job.payload)]
      );
    }
  };

  const portalLogin: PortalLoginDependencies = {
    now,
    async findPortalUserByEmail(email) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        password_hash: string | null;
        is_archived: number;
      }>>(
        [
          "SELECT id, name, email, password_hash, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "WHERE email = ?",
          "AND (is_admin = 0 OR is_admin IS NULL)",
          "AND COALESCE(is_archived, 0) = 0",
          "AND password_hash IS NOT NULL AND password_hash != ''",
          "LIMIT 1"
        ].join(" "),
        [email]
      );

      const user = rows[0];
      if (user == null || user.password_hash == null) {
        return null;
      }

      return {
        clientId: String(user.id),
        email: user.email,
        displayName: user.name,
        passwordHash: user.password_hash,
        archived: Number(user.is_archived) === 1
      };
    },
    verifyPassword: passwordVerifier,
    buildPortalReturnUrl(clientId, requestedReturnTo) {
      return buildPortalUrl(portalBaseUrl, clientId, requestedReturnTo);
    },
    async recordSuccessfulLogin(clientId) {
      await executor.execute(
        "UPDATE clients SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
        [clientId]
      );
    }
  };

  const adminLogin: AdminLoginDependencies = {
    now,
    async findAdminUserByUsername(username) {
      const [rows] = await executor.execute<Array<{
        id: number;
        username: string;
        password_hash: string;
        account_type: "owner" | "admin" | "accountant" | "staff" | "main" | "standard";
      }>>(
        [
          "SELECT id, username, password_hash, account_type",
          "FROM admin_users",
          "WHERE username = ?",
          "LIMIT 1"
        ].join(" "),
        [username]
      );

      const user = rows[0];
      if (user == null) {
        return null;
      }

      return {
        actorId: String(user.id),
        source: "admin_user",
        username: user.username,
        displayName: user.username,
        passwordHash: user.password_hash,
        role: user.account_type === "accountant" ? "accountant" : "admin"
      };
    },
    async findAdminClientByEmail(email) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        password_hash: string | null;
      }>>(
        [
          "SELECT id, name, email, password_hash",
          "FROM clients",
          "WHERE email = ?",
          "AND is_admin = 1",
          "AND COALESCE(is_archived, 0) = 0",
          "AND password_hash IS NOT NULL AND password_hash != ''",
          "LIMIT 1"
        ].join(" "),
        [email]
      );

      const user = rows[0];
      if (user == null || user.password_hash == null) {
        return null;
      }

      return {
        actorId: String(user.id),
        source: "client_admin",
        email: user.email,
        displayName: user.name,
        passwordHash: user.password_hash,
        role: "admin"
      };
    },
    verifyPassword: passwordVerifier,
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/client/index.php",
    async recordSuccessfulLogin(identity: AdminIdentity) {
      if (identity.source !== "client_admin") {
        return;
      }

      await executor.execute(
        "UPDATE clients SET last_login = CURRENT_TIMESTAMP WHERE id = ?",
        [identity.actorId]
      );
    }
  };

  const portalActorProfile: PortalActorProfileDependencies = {
    async findPortalActorById(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        is_archived: number;
      }>>(
        [
          "SELECT id, name, email, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );

      const actor = rows[0];
      if (actor == null) {
        return null;
      }

      return {
        clientId: String(actor.id),
        email: actor.email,
        displayName: actor.name,
        archived: Number(actor.is_archived) === 1
      };
    }
  };

  const adminActorProfile: AdminActorProfileDependencies = {
    async findAdminActorById(actorId) {
      const [adminRows] = await executor.execute<Array<{
        id: number;
        username: string;
        account_type: "owner" | "admin" | "accountant" | "staff" | "main" | "standard";
      }>>(
        [
          "SELECT id, username, account_type",
          "FROM admin_users",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [actorId]
      );

      const adminUser = adminRows[0];
      if (adminUser != null) {
        return {
          actorId: String(adminUser.id),
          source: "admin_user",
          username: adminUser.username,
          displayName: adminUser.username,
          role: adminUser.account_type === "accountant" ? "accountant" : "admin",
          active: true
        };
      }

      const [clientRows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
      }>>(
        [
          "SELECT id, name, email",
          "FROM clients",
          "WHERE id = ?",
          "AND is_admin = 1",
          "AND COALESCE(is_archived, 0) = 0",
          "LIMIT 1"
        ].join(" "),
        [actorId]
      );

      const clientAdmin = clientRows[0];
      if (clientAdmin == null) {
        return null;
      }

      return {
        actorId: String(clientAdmin.id),
        source: "client_admin",
        email: clientAdmin.email,
        displayName: clientAdmin.name,
        role: "admin",
        active: true
      };
    }
  };

  const clientProfiles: ClientProfileDependencies = {
    async findPortalProfile(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        phone: string | null;
        address: string | null;
        notes: string | null;
        is_admin: number;
        is_archived: number;
      }>>(
        [
          "SELECT id, name, email, phone, address, notes, COALESCE(is_admin, 0) AS is_admin, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );

      const row = rows[0];
      return row == null ? null : toClientProfileRecord(row);
    },
    async verifyPortalCurrentPassword(clientId, currentPassword) {
      const [rows] = await executor.execute<Array<{ password_hash: string | null }>>(
        [
          "SELECT password_hash",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );

      const passwordHash = rows[0]?.password_hash;
      if (passwordHash == null || passwordHash === "") {
        return false;
      }

      return passwordVerifier(currentPassword, passwordHash);
    },
    async updatePortalProfile(clientId, input) {
      if (input.newPassword != null) {
        const passwordHash = await hash(input.newPassword, 10);
        await executor.execute(
          [
            "UPDATE clients",
            "SET name = ?, email = ?, phone = ?, address = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE id = ?"
          ].join(" "),
          [input.name, input.email, input.phone, input.address, passwordHash, clientId]
        );
      } else {
        await executor.execute(
          [
            "UPDATE clients",
            "SET name = ?, email = ?, phone = ?, address = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE id = ?"
          ].join(" "),
          [input.name, input.email, input.phone, input.address, clientId]
        );
      }

      return await clientProfiles.findPortalProfile(clientId);
    },
    async findAdminClientProfile(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        phone: string | null;
        address: string | null;
        notes: string | null;
        is_admin: number;
        is_archived: number;
      }>>(
        [
          "SELECT id, name, email, phone, address, notes, COALESCE(is_admin, 0) AS is_admin, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );

      const row = rows[0];
      return row == null ? null : toClientProfileRecord(row);
    },
    async createAdminClientProfile(input) {
      const [, result] = await executor.execute(
        [
          "INSERT INTO clients (name, email, phone, address, notes, is_admin, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ].join(" "),
        [input.name, input.email, input.phone, input.address, input.notes, input.isAdmin ? 1 : 0]
      );

      return await clientProfiles.findAdminClientProfile(String(result.insertId ?? 0)) as ClientProfile;
    },
    async updateAdminClientProfile(clientId, input) {
      await executor.execute(
        [
          "UPDATE clients",
          "SET name = ?, email = ?, phone = ?, address = ?, notes = ?, is_admin = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [input.name, input.email, input.phone, input.address, input.notes, input.isAdmin ? 1 : 0, clientId]
      );

      return await clientProfiles.findAdminClientProfile(clientId);
    },
    async isClientEmailInUse(email, excludeClientId) {
      const [rows] = await executor.execute<Array<{ id: number }>>(
        [
          "SELECT id",
          "FROM clients",
          excludeClientId == null ? "WHERE email = ?" : "WHERE email = ? AND id != ?",
          "LIMIT 1"
        ].join(" "),
        excludeClientId == null ? [email] : [email, excludeClientId]
      );

      return rows.length > 0;
    }
  };

  const portalSummary: PortalSummaryDependencies = {
    async listBookingsForPortalActor(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "WHERE client_id = ?",
          "ORDER BY appointment_date ASC, appointment_time ASC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => fromLegacyBookingRow(row));
    },
    async listInvoicesForPortalActor(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Invoice["status"];
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, outstanding_amount, due_at",
          "FROM invoices",
          "WHERE client_id = ?",
          "AND outstanding_amount > 0",
          "ORDER BY COALESCE(due_at, CURRENT_TIMESTAMP) ASC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        outstandingAmount: Number(row.outstanding_amount),
        dueAt: row.due_at
      }));
    },
    async listQuotesForPortalActor(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, access_token",
          "FROM quotes",
          "WHERE client_id = ?",
          "AND status IN ('draft', 'sent', 'expired')",
          "ORDER BY id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    }
  };

  const adminDashboard: AdminDashboardDependencies = {
    async countPendingBookings() {
      const [rows] = await executor.execute<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM bookings WHERE status = 'pending'"
      );
      return Number(rows[0]?.count ?? 0);
    },
    async countTodaysBookings() {
      const [rows] = await executor.execute<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM bookings WHERE appointment_date = ?",
        [now().slice(0, 10)]
      );
      return Number(rows[0]?.count ?? 0);
    },
    async countOverdueInvoices() {
      const [rows] = await executor.execute<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM invoices WHERE status = 'overdue'"
      );
      return Number(rows[0]?.count ?? 0);
    },
    async countActiveClients() {
      const [rows] = await executor.execute<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM clients WHERE COALESCE(is_archived, 0) = 0"
      );
      return Number(rows[0]?.count ?? 0);
    },
    async listRecentBookings() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "ORDER BY created_at DESC",
          "LIMIT 5"
        ].join(" ")
      );

      return rows.map((row) => fromLegacyBookingRow(row));
    }
  };

  const adminCalendarSync: AdminCalendarSyncDependencies = {
    async syncAdminBookingCalendar(bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [bookingId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      const booking = fromLegacyBookingRow({
        id: Number(row.id),
        client_id: row.client_id,
        service_type: row.service_type,
        appointment_date: row.appointment_date,
        appointment_time: row.appointment_time,
        duration_minutes: row.duration_minutes,
        status: row.status,
        ical_token: row.ical_token
      });
      const syncedAt = now();
      const externalEventId = `google-calendar-${booking.id}-${syncedAt.slice(0, 10)}`;
      const externalEventUrl = buildGoogleCalendarTemplateUrl(booking);

      await executor.execute(
        [
          "INSERT INTO calendar_sync_links (",
          "sync_link_id, booking_id, provider, external_event_id, external_event_url, synced_at, created_at",
          ") VALUES (?, ?, 'google_calendar', ?, ?, ?, CURRENT_TIMESTAMP)",
          "ON DUPLICATE KEY UPDATE external_event_id = VALUES(external_event_id), external_event_url = VALUES(external_event_url), synced_at = VALUES(synced_at)"
        ].join(" "),
        [randomUUID(), booking.id, externalEventId, externalEventUrl, syncedAt]
      );

      return {
        booking,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };
    },
    async getAdminBookingCalendarSync(bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
        external_event_id: string;
        external_event_url: string | null;
        synced_at: string;
      }>>(
        [
          "SELECT",
          "b.id, b.client_id, b.service_type, b.appointment_date, b.appointment_time, b.duration_minutes, b.status, b.ical_token,",
          "csl.external_event_id, csl.external_event_url, csl.synced_at",
          "FROM bookings b",
          "JOIN calendar_sync_links csl ON csl.booking_id = CAST(b.id AS CHAR) AND csl.provider = 'google_calendar'",
          "WHERE b.id = ?",
          "LIMIT 1"
        ].join(" "),
        [bookingId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        booking: fromLegacyBookingRow(row),
        provider: "google_calendar" as const,
        externalEventId: row.external_event_id,
        externalEventUrl: row.external_event_url,
        syncedAt: row.synced_at
      };
    }
  };

  const adminOperations: AdminOperationsDependencies = {
    async listAdminJobLogs() {
      const [rows] = await executor.execute<Array<{
        job_id: string;
        job_kind: SupportedJobKind;
        run_at: string;
        payload_json: string | Record<string, unknown>;
        status: "queued" | "processing" | "processed" | "failed";
        processed_at: string | null;
      }>>(
        [
          "SELECT job_id, job_kind, run_at, payload_json, status, processed_at",
          "FROM job_queue",
          "ORDER BY created_at DESC",
          "LIMIT 100"
        ].join(" ")
      );

      return rows.map((row) => ({
        jobId: row.job_id,
        kind: row.job_kind,
        scheduledFor: row.run_at,
        status: row.status,
        processedAt: row.processed_at,
        summary: null,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
      }));
    },
    async findAdminJobLogById(jobId) {
      const [rows] = await executor.execute<Array<{
        job_id: string;
        job_kind: SupportedJobKind;
        run_at: string;
        payload_json: string | Record<string, unknown>;
        status: "queued" | "processing" | "processed" | "failed";
        processed_at: string | null;
      }>>(
        [
          "SELECT job_id, job_kind, run_at, payload_json, status, processed_at",
          "FROM job_queue",
          "WHERE job_id = ?",
          "LIMIT 1"
        ].join(" "),
        [jobId]
      );

      const row = rows[0];
      return row == null ? null : {
        jobId: row.job_id,
        kind: row.job_kind,
        scheduledFor: row.run_at,
        status: row.status,
        processedAt: row.processed_at,
        summary: null,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
      };
    },
    async listAdminIntegrationCallbackLogs() {
      const [rows] = await executor.execute<Array<{
        callback_id: string;
        provider: "stripe" | "google_calendar" | "mail_provider" | "imap";
        received_at: string;
        payload_json: string | Record<string, unknown>;
        queued_job_id: string | null;
      }>>(
        [
          "SELECT callback_id, provider, received_at, payload_json, queued_job_id",
          "FROM integration_callbacks",
          "ORDER BY created_at DESC",
          "LIMIT 100"
        ].join(" ")
      );

      return rows.map((row) => ({
        callbackId: row.callback_id,
        provider: row.provider,
        receivedAt: row.received_at,
        queuedJobId: row.queued_job_id,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
      }));
    },
    async findAdminIntegrationCallbackLogById(callbackId) {
      const [rows] = await executor.execute<Array<{
        callback_id: string;
        provider: "stripe" | "google_calendar" | "mail_provider" | "imap";
        received_at: string;
        payload_json: string | Record<string, unknown>;
        queued_job_id: string | null;
      }>>(
        [
          "SELECT callback_id, provider, received_at, payload_json, queued_job_id",
          "FROM integration_callbacks",
          "WHERE callback_id = ?",
          "LIMIT 1"
        ].join(" "),
        [callbackId]
      );

      const row = rows[0];
      return row == null ? null : {
        callbackId: row.callback_id,
        provider: row.provider,
        receivedAt: row.received_at,
        queuedJobId: row.queued_job_id,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
      };
    }
  };

  const petFiles: PetFileManagementDependencies = {
    now,
    async createPortalPetFile(clientId, petId, input) {
      const [petRows] = await executor.execute<Array<{ id: number }>>(
        [
          "SELECT id FROM pets",
          "WHERE id = ? AND client_id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId, clientId]
      );
      if (petRows[0] == null) {
        return null;
      }

      const storedFileName = createStoredPetFileName(petId, input.fileExtension);
      await petFileContentWriter(petId, storedFileName, input.content);

      try {
        const [, result] = await executor.execute(
          [
            "INSERT INTO pet_files (",
            "pet_id, file_type, file_name, original_name, file_size, mime_type, description, uploaded_by, uploaded_at",
            ") VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)"
          ].join(" "),
          [
            petId,
            input.fileType,
            storedFileName,
            input.originalName,
            input.fileSize,
            input.mimeType,
            input.description,
            input.uploadedAt
          ]
        );

        return {
          id: String(result.insertId ?? 0),
          petId,
          fileType: input.fileType,
          fileName: storedFileName,
          originalName: input.originalName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          description: input.description,
          uploadedByAdminUserId: null,
          uploadedAt: input.uploadedAt
        };
      } catch (error) {
        await petFileContentDeleter(petId, storedFileName);
        throw error;
      }
    },
    async createAdminPetFile(petId, input) {
      const [petRows] = await executor.execute<Array<{ id: number }>>(
        [
          "SELECT id FROM pets",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId]
      );
      if (petRows[0] == null) {
        return null;
      }

      const storedFileName = createStoredPetFileName(petId, input.fileExtension);
      await petFileContentWriter(petId, storedFileName, input.content);

      try {
        const [, result] = await executor.execute(
          [
            "INSERT INTO pet_files (",
            "pet_id, file_type, file_name, original_name, file_size, mime_type, description, uploaded_by, uploaded_at",
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [
            petId,
            input.fileType,
            storedFileName,
            input.originalName,
            input.fileSize,
            input.mimeType,
            input.description,
            input.uploadedByAdminUserId,
            input.uploadedAt
          ]
        );

        return {
          id: String(result.insertId ?? 0),
          petId,
          fileType: input.fileType,
          fileName: storedFileName,
          originalName: input.originalName,
          fileSize: input.fileSize,
          mimeType: input.mimeType,
          description: input.description,
          uploadedByAdminUserId: input.uploadedByAdminUserId,
          uploadedAt: input.uploadedAt
        };
      } catch (error) {
        await petFileContentDeleter(petId, storedFileName);
        throw error;
      }
    }
  };

  const content: ContentManagementDependencies = {
    now,
    async listPublicBlogPosts() {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        slug: string;
        content: string;
        excerpt: string | null;
        cover_photo: string | null;
        author: string | null;
        published: number;
        publish_date: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, title, slug, content, excerpt, cover_photo, author, published, publish_date, created_at, updated_at",
          "FROM blog_posts",
          "WHERE published = 1",
          "ORDER BY COALESCE(publish_date, created_at) DESC, created_at DESC"
        ].join(" ")
      );

      return rows.map(toBlogPostRecord);
    },
    async findPublicBlogPostBySlug(slug) {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        slug: string;
        content: string;
        excerpt: string | null;
        cover_photo: string | null;
        author: string | null;
        published: number;
        publish_date: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, title, slug, content, excerpt, cover_photo, author, published, publish_date, created_at, updated_at",
          "FROM blog_posts",
          "WHERE published = 1 AND slug = ?",
          "LIMIT 1"
        ].join(" "),
        [slug]
      );

      const row = rows[0];
      return row == null ? null : toBlogPostRecord(row);
    },
    async findPublicSitePageBySlug(slug) {
      const [rows] = await executor.execute<Array<{
        id: number;
        slug: string;
        title: string;
        html_content: string | null;
        css_content: string | null;
        meta_description: string | null;
        meta_keywords: string | null;
        og_title: string | null;
        og_description: string | null;
        og_image: string | null;
        is_homepage: number;
        is_published: number;
        sort_order: number;
        updated_by: number | null;
        created_at: string;
        updated_at: string;
      }>>(
        slug == null
          ? [
              "SELECT id, slug, title, html_content, css_content, meta_description, meta_keywords, og_title, og_description, og_image, is_homepage, is_published, sort_order, updated_by, created_at, updated_at",
              "FROM site_pages",
              "WHERE is_homepage = 1 AND is_published = 1",
              "LIMIT 1"
            ].join(" ")
          : [
              "SELECT id, slug, title, html_content, css_content, meta_description, meta_keywords, og_title, og_description, og_image, is_homepage, is_published, sort_order, updated_by, created_at, updated_at",
              "FROM site_pages",
              "WHERE slug = ? AND is_published = 1",
              "LIMIT 1"
            ].join(" "),
        slug == null ? [] : [slug]
      );

      const row = rows[0];
      return row == null ? null : toSitePageRecord(row);
    },
    async listAdminBlogPosts() {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        slug: string;
        content: string;
        excerpt: string | null;
        cover_photo: string | null;
        author: string | null;
        published: number;
        publish_date: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, title, slug, content, excerpt, cover_photo, author, published, publish_date, created_at, updated_at",
          "FROM blog_posts",
          "ORDER BY COALESCE(publish_date, created_at) DESC, created_at DESC"
        ].join(" ")
      );

      return rows.map(toBlogPostRecord);
    },
    async findAdminBlogPostById(postId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        slug: string;
        content: string;
        excerpt: string | null;
        cover_photo: string | null;
        author: string | null;
        published: number;
        publish_date: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, title, slug, content, excerpt, cover_photo, author, published, publish_date, created_at, updated_at",
          "FROM blog_posts",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [postId]
      );

      const row = rows[0];
      return row == null ? null : toBlogPostRecord(row);
    },
    async createAdminBlogPost(input) {
      const [, result] = await executor.execute(
        [
          "INSERT INTO blog_posts (title, slug, content, excerpt, cover_photo, author, published, publish_date, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ].join(" "),
        [
          input.title,
          input.slug,
          input.content,
          input.excerpt,
          input.coverPhoto,
          input.author,
          input.published ? 1 : 0,
          input.publishDate
        ]
      );

      const item = await content.findAdminBlogPostById(String(result.insertId ?? 0));
      if (item == null) {
        throw new Error("Failed to load created blog post.");
      }
      return item;
    },
    async updateAdminBlogPost(postId, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE blog_posts",
          "SET title = ?, slug = ?, content = ?, excerpt = ?, cover_photo = ?, author = ?, published = ?, publish_date = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [
          input.title,
          input.slug,
          input.content,
          input.excerpt,
          input.coverPhoto,
          input.author,
          input.published ? 1 : 0,
          input.publishDate,
          postId
        ]
      );

      if (Number(result.affectedRows ?? 0) === 0) {
        return null;
      }

      return content.findAdminBlogPostById(postId);
    },
    async listAdminSitePages() {
      const [rows] = await executor.execute<Array<{
        id: number;
        slug: string;
        title: string;
        html_content: string | null;
        css_content: string | null;
        meta_description: string | null;
        meta_keywords: string | null;
        og_title: string | null;
        og_description: string | null;
        og_image: string | null;
        is_homepage: number;
        is_published: number;
        sort_order: number;
        updated_by: number | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, slug, title, html_content, css_content, meta_description, meta_keywords, og_title, og_description, og_image, is_homepage, is_published, sort_order, updated_by, created_at, updated_at",
          "FROM site_pages",
          "ORDER BY sort_order ASC, title ASC"
        ].join(" ")
      );

      return rows.map(toSitePageRecord);
    },
    async findAdminSitePageById(pageId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        slug: string;
        title: string;
        html_content: string | null;
        css_content: string | null;
        meta_description: string | null;
        meta_keywords: string | null;
        og_title: string | null;
        og_description: string | null;
        og_image: string | null;
        is_homepage: number;
        is_published: number;
        sort_order: number;
        updated_by: number | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT id, slug, title, html_content, css_content, meta_description, meta_keywords, og_title, og_description, og_image, is_homepage, is_published, sort_order, updated_by, created_at, updated_at",
          "FROM site_pages",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [pageId]
      );

      const row = rows[0];
      return row == null ? null : toSitePageRecord(row);
    },
    async createAdminSitePage(adminUserId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isHomepage) {
          await executor.execute(
            "UPDATE site_pages SET is_homepage = 0, updated_at = CURRENT_TIMESTAMP WHERE is_homepage = 1"
          );
        }

        const [, result] = await executor.execute(
          [
            "INSERT INTO site_pages (slug, title, html_content, css_content, meta_description, meta_keywords, og_title, og_description, og_image, is_homepage, is_published, sort_order, updated_by, created_at, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
          ].join(" "),
          [
            input.slug,
            input.title,
            input.htmlContent,
            input.cssContent,
            input.metaDescription,
            input.metaKeywords,
            input.ogTitle,
            input.ogDescription,
            input.ogImage,
            input.isHomepage ? 1 : 0,
            input.published ? 1 : 0,
            input.sortOrder,
            adminUserId
          ]
        );

        const item = await content.findAdminSitePageById(String(result.insertId ?? 0));
        await executor.execute("COMMIT");
        if (item == null) {
          throw new Error("Failed to load created site page.");
        }
        return item;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async updateAdminSitePage(pageId, adminUserId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isHomepage) {
          await executor.execute(
            "UPDATE site_pages SET is_homepage = 0, updated_at = CURRENT_TIMESTAMP WHERE is_homepage = 1 AND id != ?",
            [pageId]
          );
        }

        const [, result] = await executor.execute(
          [
            "UPDATE site_pages",
            "SET slug = ?, title = ?, html_content = ?, css_content = ?, meta_description = ?, meta_keywords = ?, og_title = ?, og_description = ?, og_image = ?, is_homepage = ?, is_published = ?, sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE id = ?"
          ].join(" "),
          [
            input.slug,
            input.title,
            input.htmlContent,
            input.cssContent,
            input.metaDescription,
            input.metaKeywords,
            input.ogTitle,
            input.ogDescription,
            input.ogImage,
            input.isHomepage ? 1 : 0,
            input.published ? 1 : 0,
            input.sortOrder,
            adminUserId,
            pageId
          ]
        );

        if (Number(result.affectedRows ?? 0) === 0) {
          await executor.execute("ROLLBACK");
          return null;
        }

        const item = await content.findAdminSitePageById(pageId);
        await executor.execute("COMMIT");
        return item;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async listAdminSettings() {
      const [rows] = await executor.execute<Array<{
        id: number;
        setting_key: string;
        setting_value: string | null;
        setting_type: string;
        category: string;
        label: string;
        description: string | null;
        is_secret: number;
        updated_at: string;
      }>>(
        [
          "SELECT id, setting_key, setting_value, setting_type, category, label, description, is_secret, updated_at",
          "FROM settings",
          "ORDER BY category ASC, label ASC"
        ].join(" ")
      );

      return rows.map(toSettingRecord);
    },
    async findAdminSettingByKey(key) {
      const [rows] = await executor.execute<Array<{
        id: number;
        setting_key: string;
        setting_value: string | null;
        setting_type: string;
        category: string;
        label: string;
        description: string | null;
        is_secret: number;
        updated_at: string;
      }>>(
        [
          "SELECT id, setting_key, setting_value, setting_type, category, label, description, is_secret, updated_at",
          "FROM settings",
          "WHERE setting_key = ?",
          "LIMIT 1"
        ].join(" "),
        [key]
      );

      const row = rows[0];
      return row == null ? null : toSettingRecord(row);
    },
    async updateAdminSetting(key, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE settings",
          "SET setting_value = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE setting_key = ?"
        ].join(" "),
        [input.value, key]
      );

      if (Number(result.affectedRows ?? 0) === 0) {
        return null;
      }

      return content.findAdminSettingByKey(key);
    }
  };

  const achievements: AchievementDependencies = {
    async listPortalAchievements(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        achievement_type_id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        status: "awarded" | "revoked";
        awarded_on: string;
        dog_name: string;
        program_name: string | null;
        notes: string | null;
        awarded_by: number | null;
        updated_by: number | null;
        revoked_by: number | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT ca.id, ca.client_id, ca.achievement_type_id, at.title, at.description, at.scope_type, at.award_mode,",
          "at.badge_icon_path, at.certificate_template_path, at.certificate_body_html, ca.status, ca.awarded_on,",
          "ca.dog_name, ca.program_name, ca.notes, ca.awarded_by, ca.updated_by, ca.revoked_by, ca.revoked_at,",
          "ca.created_at, ca.updated_at",
          "FROM client_achievements ca",
          "JOIN achievement_types at ON at.id = ca.achievement_type_id",
          "WHERE ca.client_id = ?",
          "ORDER BY ca.awarded_on DESC, ca.created_at DESC"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toClientAchievementRecord(row));
    },
    async findPortalAchievementById(clientId, achievementId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        achievement_type_id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        status: "awarded" | "revoked";
        awarded_on: string;
        dog_name: string;
        program_name: string | null;
        notes: string | null;
        awarded_by: number | null;
        updated_by: number | null;
        revoked_by: number | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT ca.id, ca.client_id, ca.achievement_type_id, at.title, at.description, at.scope_type, at.award_mode,",
          "at.badge_icon_path, at.certificate_template_path, at.certificate_body_html, ca.status, ca.awarded_on,",
          "ca.dog_name, ca.program_name, ca.notes, ca.awarded_by, ca.updated_by, ca.revoked_by, ca.revoked_at,",
          "ca.created_at, ca.updated_at",
          "FROM client_achievements ca",
          "JOIN achievement_types at ON at.id = ca.achievement_type_id",
          "WHERE ca.client_id = ? AND ca.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, achievementId]
      );

      const row = rows[0];
      return row == null ? null : toClientAchievementRecord(row);
    },
    async listAdminAchievementTypes() {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, title, description, scope_type, award_mode, badge_icon_path,",
          "certificate_template_path, certificate_body_html, is_active",
          "FROM achievement_types",
          "WHERE is_active = 1",
          "ORDER BY title ASC"
        ].join(" ")
      );

      return rows.map((row) => toAchievementTypeRecord(row));
    },
    async findAdminAchievementTypeById(achievementTypeId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, title, description, scope_type, award_mode, badge_icon_path,",
          "certificate_template_path, certificate_body_html, is_active",
          "FROM achievement_types",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [achievementTypeId]
      );

      const row = rows[0];
      return row == null ? null : toAchievementTypeRecord(row);
    },
    async listAdminClientAchievements(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        achievement_type_id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        status: "awarded" | "revoked";
        awarded_on: string;
        dog_name: string;
        program_name: string | null;
        notes: string | null;
        awarded_by: number | null;
        updated_by: number | null;
        revoked_by: number | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT ca.id, ca.client_id, ca.achievement_type_id, at.title, at.description, at.scope_type, at.award_mode,",
          "at.badge_icon_path, at.certificate_template_path, at.certificate_body_html, ca.status, ca.awarded_on,",
          "ca.dog_name, ca.program_name, ca.notes, ca.awarded_by, ca.updated_by, ca.revoked_by, ca.revoked_at,",
          "ca.created_at, ca.updated_at",
          "FROM client_achievements ca",
          "JOIN achievement_types at ON at.id = ca.achievement_type_id",
          "WHERE ca.client_id = ?",
          "ORDER BY ca.awarded_on DESC, ca.created_at DESC"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toClientAchievementRecord(row));
    },
    async findAdminClientAchievementById(clientId, achievementId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        achievement_type_id: number;
        title: string;
        description: string | null;
        scope_type: "general" | "custom";
        award_mode: "badge_only" | "certificate_only" | "badge_certificate";
        badge_icon_path: string | null;
        certificate_template_path: string | null;
        certificate_body_html: string | null;
        status: "awarded" | "revoked";
        awarded_on: string;
        dog_name: string;
        program_name: string | null;
        notes: string | null;
        awarded_by: number | null;
        updated_by: number | null;
        revoked_by: number | null;
        revoked_at: string | null;
        created_at: string;
        updated_at: string;
      }>>(
        [
          "SELECT ca.id, ca.client_id, ca.achievement_type_id, at.title, at.description, at.scope_type, at.award_mode,",
          "at.badge_icon_path, at.certificate_template_path, at.certificate_body_html, ca.status, ca.awarded_on,",
          "ca.dog_name, ca.program_name, ca.notes, ca.awarded_by, ca.updated_by, ca.revoked_by, ca.revoked_at,",
          "ca.created_at, ca.updated_at",
          "FROM client_achievements ca",
          "JOIN achievement_types at ON at.id = ca.achievement_type_id",
          "WHERE ca.client_id = ? AND ca.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, achievementId]
      );

      const row = rows[0];
      return row == null ? null : toClientAchievementRecord(row);
    },
    async buildAchievementCertificateHtml(achievement, options) {
      return renderAchievementCertificateHtml(achievement, options);
    },
    buildPortalCertificateBackPath() {
      return "/portal/achievements";
    },
    buildAdminCertificateBackPath(clientId) {
      return `/client/client_achievements.php?client_id=${encodeURIComponent(clientId)}`;
    }
  };

  const portalResources: PortalResourceReadDependencies = {
    listPortalBookings: portalSummary.listBookingsForPortalActor,
    async findPortalBookingById(clientId, bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, bookingId]
      );

      const row = rows[0];
      return row == null ? null : fromLegacyBookingRow(row);
    },
    async listPortalPets(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        species: string;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, COALESCE(is_active, 1) AS is_active",
          "FROM pets",
          "WHERE client_id = ?",
          "ORDER BY name ASC, id ASC",
          "LIMIT 50"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toPetRecord(row));
    },
    async findPortalPetById(clientId, petId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        species: string;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, COALESCE(is_active, 1) AS is_active",
          "FROM pets",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, petId]
      );

      const row = rows[0];
      return row == null ? null : toPetRecord(row);
    },
    async listPortalPetFiles(clientId, petId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT pf.id, pf.pet_id, pf.file_type, pf.file_name, pf.original_name, pf.file_size, pf.mime_type, pf.description, pf.uploaded_by, pf.uploaded_at",
          "FROM pet_files pf",
          "JOIN pets p ON p.id = pf.pet_id",
          "WHERE p.client_id = ? AND pf.pet_id = ?",
          "ORDER BY pf.uploaded_at DESC, pf.id DESC"
        ].join(" "),
        [clientId, petId]
      );

      return rows.map((row) => toPetFileRecord(row));
    },
    async findPortalPetFileById(clientId, petId, fileId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT pf.id, pf.pet_id, pf.file_type, pf.file_name, pf.original_name, pf.file_size, pf.mime_type, pf.description, pf.uploaded_by, pf.uploaded_at",
          "FROM pet_files pf",
          "JOIN pets p ON p.id = pf.pet_id",
          "WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, petId, fileId]
      );

      const row = rows[0];
      return row == null ? null : toPetFileRecord(row);
    },
    async loadPortalPetFileContent(clientId, petId, fileId, download) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT pf.id, pf.pet_id, pf.file_type, pf.file_name, pf.original_name, pf.file_size, pf.mime_type, pf.description, pf.uploaded_by, pf.uploaded_at",
          "FROM pet_files pf",
          "JOIN pets p ON p.id = pf.pet_id",
          "WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, petId, fileId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      const content = await petFileContentLoader(String(row.pet_id), row.file_name);
      if (content == null) {
        return null;
      }

      return {
        item: toPetFileRecord(row),
        fileName: row.original_name,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: content.toString("base64")
      };
    },
    async deletePortalPetFile(clientId, petId, fileId) {
      const [rows] = await executor.execute<Array<{ file_name: string }>>(
        [
          "SELECT pf.file_name",
          "FROM pet_files pf",
          "JOIN pets p ON p.id = pf.pet_id",
          "WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, petId, fileId]
      );
      const row = rows[0];
      if (row == null) {
        return false;
      }

      const [, result] = await executor.execute(
        [
          "DELETE pf FROM pet_files pf",
          "JOIN pets p ON p.id = pf.pet_id",
          "WHERE p.client_id = ? AND pf.pet_id = ? AND pf.id = ?"
        ].join(" "),
        [clientId, petId, fileId]
      );

      const deleted = Number(result.affectedRows ?? 0) > 0;
      if (deleted) {
        await petFileContentDeleter(petId, row.file_name);
      }

      return deleted;
    },
    listPortalInvoices: portalSummary.listInvoicesForPortalActor,
    async findPortalInvoiceById(clientId, invoiceId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Invoice["status"];
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, outstanding_amount, due_at",
          "FROM invoices",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, invoiceId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        outstandingAmount: Number(row.outstanding_amount),
        dueAt: row.due_at
      };
    },
    listPortalQuotes: portalSummary.listQuotesForPortalActor,
    async findPortalQuoteById(clientId, quoteId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, access_token",
          "FROM quotes",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, quoteId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listPortalContracts(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, access_token",
          "FROM contracts",
          "WHERE client_id = ?",
          "ORDER BY id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    },
    async findPortalContractById(clientId, contractId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, access_token",
          "FROM contracts",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, contractId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listPortalForms(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
      }>>(
        [
          "SELECT id, template_id, client_id, submitted_at, access_token",
          "FROM form_submissions",
          "WHERE client_id = ?",
          "ORDER BY id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => ({
        id: String(row.id),
        templateId: String(row.template_id),
        clientId: String(row.client_id),
        submittedAt: row.submitted_at,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    },
    async findPortalFormById(clientId, formId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
      }>>(
        [
          "SELECT id, template_id, client_id, submitted_at, access_token",
          "FROM form_submissions",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, formId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        templateId: String(row.template_id),
        clientId: String(row.client_id),
        submittedAt: row.submitted_at,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listPortalPackages(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
      }>>(
        [
          "SELECT DISTINCT p.id, p.name, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.price, 0) AS price",
          "FROM packages p",
          "JOIN client_packages cp ON cp.package_id = p.id",
          "JOIN client_package_credits cpc ON cpc.client_package_id = cp.id",
          "WHERE cp.client_id = ? AND COALESCE(cp.is_active, 1) = 1",
          "ORDER BY cp.purchased_at DESC, p.id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toPackageRecord(row));
    },
    async findPortalPackageById(clientId, packageId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
      }>>(
        [
          "SELECT DISTINCT p.id, p.name, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.price, 0) AS price",
          "FROM packages p",
          "JOIN client_packages cp ON cp.package_id = p.id",
          "JOIN client_package_credits cpc ON cpc.client_package_id = cp.id",
          "WHERE cp.client_id = ? AND p.id = ? AND COALESCE(cp.is_active, 1) = 1",
          "LIMIT 1"
        ].join(" "),
        [clientId, packageId]
      );

      const row = rows[0];
      return row == null ? null : toPackageRecord(row);
    },
    async listPortalCredits(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.total_credits, cpc.used_credits",
          "FROM client_package_credits cpc",
          "JOIN client_packages cp ON cp.id = cpc.client_package_id",
          "WHERE cpc.client_id = ? AND COALESCE(cp.is_active, 1) = 1",
          "ORDER BY cpc.updated_at DESC, cpc.id DESC",
          "LIMIT 50"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toCreditRecord(row));
    },
    async findPortalCreditById(clientId, creditId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.total_credits, cpc.used_credits",
          "FROM client_package_credits cpc",
          "JOIN client_packages cp ON cp.id = cpc.client_package_id",
          "WHERE cpc.client_id = ? AND cpc.id = ? AND COALESCE(cp.is_active, 1) = 1",
          "LIMIT 1"
        ].join(" "),
        [clientId, creditId]
      );

      const row = rows[0];
      return row == null ? null : toCreditRecord(row);
    }
  };

  const adminResources: AdminResourceReadDependencies = {
    async listAdminClients() {
      const [rows] = await executor.execute<Array<{ id: number; name: string; email: string; is_archived: number }>>(
        [
          "SELECT id, name, email, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "ORDER BY updated_at DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => toClientRecord(row));
    },
    async findAdminClientById(clientId) {
      const [rows] = await executor.execute<Array<{ id: number; name: string; email: string; is_archived: number }>>(
        [
          "SELECT id, name, email, COALESCE(is_archived, 0) AS is_archived",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );

      const row = rows[0];
      return row == null ? null : toClientRecord(row);
    },
    async listAdminPets() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        species: string;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, COALESCE(is_active, 1) AS is_active",
          "FROM pets",
          "ORDER BY name ASC, id ASC",
          "LIMIT 100"
        ].join(" ")
      );

      return rows.map((row) => toPetRecord(row));
    },
    async findAdminPetById(petId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        species: string;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, COALESCE(is_active, 1) AS is_active",
          "FROM pets",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId]
      );

      const row = rows[0];
      return row == null ? null : toPetRecord(row);
    },
    async listAdminPetFiles(petId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT id, pet_id, file_type, file_name, original_name, file_size, mime_type, description, uploaded_by, uploaded_at",
          "FROM pet_files",
          "WHERE pet_id = ?",
          "ORDER BY uploaded_at DESC, id DESC"
        ].join(" "),
        [petId]
      );

      return rows.map((row) => toPetFileRecord(row));
    },
    async findAdminPetFileById(petId, fileId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT id, pet_id, file_type, file_name, original_name, file_size, mime_type, description, uploaded_by, uploaded_at",
          "FROM pet_files",
          "WHERE pet_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId, fileId]
      );

      const row = rows[0];
      return row == null ? null : toPetFileRecord(row);
    },
    async loadAdminPetFileContent(petId, fileId, download) {
      const [rows] = await executor.execute<Array<{
        id: number;
        pet_id: number;
        file_type: "photo" | "document";
        file_name: string;
        original_name: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_by: number | null;
        uploaded_at: string;
      }>>(
        [
          "SELECT id, pet_id, file_type, file_name, original_name, file_size, mime_type, description, uploaded_by, uploaded_at",
          "FROM pet_files",
          "WHERE pet_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId, fileId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      const content = await petFileContentLoader(String(row.pet_id), row.file_name);
      if (content == null) {
        return null;
      }

      return {
        item: toPetFileRecord(row),
        fileName: row.original_name,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: content.toString("base64")
      };
    },
    async deleteAdminPetFile(petId, fileId) {
      const [rows] = await executor.execute<Array<{ file_name: string }>>(
        [
          "SELECT file_name FROM pet_files",
          "WHERE pet_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [petId, fileId]
      );
      const row = rows[0];
      if (row == null) {
        return false;
      }

      const [, result] = await executor.execute(
        "DELETE FROM pet_files WHERE pet_id = ? AND id = ?",
        [petId, fileId]
      );

      const deleted = Number(result.affectedRows ?? 0) > 0;
      if (deleted) {
        await petFileContentDeleter(petId, row.file_name);
      }

      return deleted;
    },
    listAdminBookings: adminDashboard.listRecentBookings,
    async findAdminBookingById(bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [bookingId]
      );

      const row = rows[0];
      return row == null ? null : fromLegacyBookingRow(row);
    },
    async listAdminInvoices() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Invoice["status"];
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, outstanding_amount, due_at",
          "FROM invoices",
          "ORDER BY id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        outstandingAmount: Number(row.outstanding_amount),
        dueAt: row.due_at
      }));
    },
    async findAdminInvoiceById(invoiceId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Invoice["status"];
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, outstanding_amount, due_at",
          "FROM invoices",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [invoiceId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        outstandingAmount: Number(row.outstanding_amount),
        dueAt: row.due_at
      };
    },
    async listAdminQuotes() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, access_token",
          "FROM quotes",
          "ORDER BY id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    },
    async findAdminQuoteById(quoteId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, access_token",
          "FROM quotes",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [quoteId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listAdminContracts() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, access_token",
          "FROM contracts",
          "ORDER BY id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    },
    async findAdminContractById(contractId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, access_token",
          "FROM contracts",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [contractId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listAdminForms() {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
      }>>(
        [
          "SELECT id, template_id, client_id, submitted_at, access_token",
          "FROM form_submissions",
          "ORDER BY id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => ({
        id: String(row.id),
        templateId: String(row.template_id),
        clientId: String(row.client_id),
        submittedAt: row.submitted_at,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      }));
    },
    async findAdminFormById(formId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
      }>>(
        [
          "SELECT id, template_id, client_id, submitted_at, access_token",
          "FROM form_submissions",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [formId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        templateId: String(row.template_id),
        clientId: String(row.client_id),
        submittedAt: row.submitted_at,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async listAdminPackages() {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
      }>>(
        [
          "SELECT id, name, COALESCE(is_active, 1) AS is_active, COALESCE(price, 0) AS price",
          "FROM packages",
          "ORDER BY updated_at DESC, id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => toPackageRecord(row));
    },
    async findAdminPackageById(packageId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
      }>>(
        [
          "SELECT id, name, COALESCE(is_active, 1) AS is_active, COALESCE(price, 0) AS price",
          "FROM packages",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [packageId]
      );

      const row = rows[0];
      return row == null ? null : toPackageRecord(row);
    },
    async listAdminCredits() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.total_credits, cpc.used_credits",
          "FROM client_package_credits cpc",
          "JOIN client_packages cp ON cp.id = cpc.client_package_id",
          "ORDER BY cpc.updated_at DESC, cpc.id DESC",
          "LIMIT 100"
        ].join(" ")
      );

      return rows.map((row) => toCreditRecord(row));
    },
    async findAdminCreditById(creditId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.total_credits, cpc.used_credits",
          "FROM client_package_credits cpc",
          "JOIN client_packages cp ON cp.id = cpc.client_package_id",
          "WHERE cpc.id = ?",
          "LIMIT 1"
        ].join(" "),
        [creditId]
      );

      const row = rows[0];
      return row == null ? null : toCreditRecord(row);
    }
  };

  const contacts: ContactManagementDependencies = {
    async listPortalContacts(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        email: string;
        phone: string;
        is_primary: number;
      }>>(
        [
          "SELECT id, client_id, name, email, phone, is_primary",
          "FROM client_contacts",
          "WHERE client_id = ?",
          "ORDER BY is_primary DESC, name ASC"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toContactRecord(row));
    },
    async findPortalContactById(clientId, contactId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        email: string;
        phone: string;
        is_primary: number;
      }>>(
        [
          "SELECT id, client_id, name, email, phone, is_primary",
          "FROM client_contacts",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, contactId]
      );

      const row = rows[0];
      return row == null ? null : toContactRecord(row);
    },
    async createPortalContact(clientId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isPrimary) {
          await executor.execute(
            "UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?",
            [clientId]
          );
        }

        const [, result] = await executor.execute(
          [
            "INSERT INTO client_contacts (client_id, name, email, phone, is_primary, created_at, updated_at)",
            "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
          ].join(" "),
          [clientId, input.name, input.email, input.phone, input.isPrimary ? 1 : 0]
        );

        const contactId = String(result.insertId ?? 0);
        const contact = await contacts.findPortalContactById(clientId, contactId);
        await executor.execute("COMMIT");

        if (contact == null) {
          throw new Error("Failed to load newly created portal contact.");
        }

        return contact;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async updatePortalContact(clientId, contactId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isPrimary) {
          await executor.execute(
            "UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND id != ?",
            [clientId, contactId]
          );
        }

        const [, result] = await executor.execute(
          [
            "UPDATE client_contacts",
            "SET name = ?, email = ?, phone = ?, is_primary = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE client_id = ? AND id = ?"
          ].join(" "),
          [input.name, input.email, input.phone, input.isPrimary ? 1 : 0, clientId, contactId]
        );

        if (Number(result.affectedRows ?? 0) === 0) {
          await executor.execute("ROLLBACK");
          return null;
        }

        const contact = await contacts.findPortalContactById(clientId, contactId);
        await executor.execute("COMMIT");
        return contact;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async deletePortalContact(clientId, contactId) {
      const [, result] = await executor.execute(
        "DELETE FROM client_contacts WHERE client_id = ? AND id = ?",
        [clientId, contactId]
      );

      return Number(result.affectedRows ?? 0) > 0;
    },
    async listAdminClientContacts(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        email: string;
        phone: string;
        is_primary: number;
      }>>(
        [
          "SELECT id, client_id, name, email, phone, is_primary",
          "FROM client_contacts",
          "WHERE client_id = ?",
          "ORDER BY is_primary DESC, name ASC"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => toContactRecord(row));
    },
    async findAdminClientContactById(clientId, contactId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        name: string;
        email: string;
        phone: string;
        is_primary: number;
      }>>(
        [
          "SELECT id, client_id, name, email, phone, is_primary",
          "FROM client_contacts",
          "WHERE client_id = ? AND id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, contactId]
      );

      const row = rows[0];
      return row == null ? null : toContactRecord(row);
    },
    async createAdminClientContact(clientId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isPrimary) {
          await executor.execute(
            "UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?",
            [clientId]
          );
        }

        const [, result] = await executor.execute(
          [
            "INSERT INTO client_contacts (client_id, name, email, phone, is_primary, created_at, updated_at)",
            "VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
          ].join(" "),
          [clientId, input.name, input.email, input.phone, input.isPrimary ? 1 : 0]
        );

        const contactId = String(result.insertId ?? 0);
        const contact = await contacts.findAdminClientContactById(clientId, contactId);
        await executor.execute("COMMIT");

        if (contact == null) {
          throw new Error("Failed to load newly created admin client contact.");
        }

        return contact;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async updateAdminClientContact(clientId, contactId, input) {
      await executor.execute("START TRANSACTION");
      try {
        if (input.isPrimary) {
          await executor.execute(
            "UPDATE client_contacts SET is_primary = 0 WHERE client_id = ? AND id != ?",
            [clientId, contactId]
          );
        }

        const [, result] = await executor.execute(
          [
            "UPDATE client_contacts",
            "SET name = ?, email = ?, phone = ?, is_primary = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE client_id = ? AND id = ?"
          ].join(" "),
          [input.name, input.email, input.phone, input.isPrimary ? 1 : 0, clientId, contactId]
        );

        if (Number(result.affectedRows ?? 0) === 0) {
          await executor.execute("ROLLBACK");
          return null;
        }

        const contact = await contacts.findAdminClientContactById(clientId, contactId);
        await executor.execute("COMMIT");
        return contact;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async deleteAdminClientContact(clientId, contactId) {
      const [, result] = await executor.execute(
        "DELETE FROM client_contacts WHERE client_id = ? AND id = ?",
        [clientId, contactId]
      );

      return Number(result.affectedRows ?? 0) > 0;
    }
  };

  const portalCommerce: PortalCommerceDependencies = {
    async acceptPortalQuote(clientId, quoteId) {
      await executor.execute(
        [
          "UPDATE quotes",
          "SET status = 'accepted'",
          "WHERE client_id = ? AND id = ? AND status IN ('draft', 'sent')"
        ].join(" "),
        [clientId, quoteId]
      );

      return await portalResources.findPortalQuoteById(clientId, quoteId);
    },
    async signPortalContract(clientId, contractId) {
      await executor.execute(
        [
          "UPDATE contracts",
          "SET status = 'signed', signed_at = CURRENT_TIMESTAMP",
          "WHERE client_id = ? AND id = ? AND status = 'sent'"
        ].join(" "),
        [clientId, contractId]
      );

      return await portalResources.findPortalContractById(clientId, contractId);
    },
    async submitPortalForm(clientId, formId) {
      await executor.execute(
        [
          "UPDATE form_submissions",
          "SET submitted_at = CURRENT_TIMESTAMP",
          "WHERE client_id = ? AND id = ? AND submitted_at IS NULL"
        ].join(" "),
        [clientId, formId]
      );

      return await portalResources.findPortalFormById(clientId, formId);
    },
    async createInvoicePaymentSession(clientId, invoiceId, input) {
      const invoice = await portalResources.findPortalInvoiceById(clientId, invoiceId);
      if (invoice == null) {
        return null;
      }

      return {
        invoice,
        paymentSession: {
          provider: "stripe" as const,
          checkoutUrl: `${input.returnUrl}?invoice=${encodeURIComponent(invoiceId)}`,
          expiresAt: new Date(Date.parse(now()) + 60 * 60 * 1000).toISOString()
        }
      };
    }
  };

  const publicDocuments: PublicDocumentAccessDependencies = {
    now,
    async findPublicQuoteById(quoteId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Quote["status"];
        total_amount: number;
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, total_amount, access_token",
          "FROM quotes",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [quoteId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        totalAmount: Number(row.total_amount),
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async findPublicContractById(contractId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        status: Contract["status"];
        access_token: string | null;
      }>>(
        [
          "SELECT id, client_id, status, access_token",
          "FROM contracts",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [contractId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        clientId: String(row.client_id),
        status: row.status,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async findPublicFormSubmissionById(submissionId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        template_id: number;
        client_id: number;
        submitted_at: string | null;
        access_token: string | null;
      }>>(
        [
          "SELECT id, template_id, client_id, submitted_at, access_token",
          "FROM form_submissions",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [submissionId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: String(row.id),
        templateId: String(row.template_id),
        clientId: String(row.client_id),
        submittedAt: row.submitted_at,
        publicAccess: row.access_token == null ? null : {
          token: row.access_token,
          issuedAt: now(),
          expiresAt: null,
          legacySourceId: String(row.id)
        }
      };
    },
    async findPublicBookingIcalById(bookingId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        service_type: string;
        appointment_date: string;
        appointment_time: string;
        duration_minutes: number;
        status: "pending" | "confirmed" | "completed" | "cancelled";
        ical_token: string | null;
      }>>(
        [
          "SELECT id, client_id, service_type, appointment_date, appointment_time, duration_minutes, status, ical_token",
          "FROM bookings",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [bookingId]
      );

      const row = rows[0];
      return row == null ? null : fromLegacyBookingRow(row);
    }
  };

  return {
    publicBooking,
    integrationCallbacks,
    portalLogin,
    adminLogin,
    portalActorProfile,
    adminActorProfile,
    clientProfiles,
    portalSummary,
    adminDashboard,
    adminOperations,
    content,
    achievements,
    portalResources,
    adminResources,
    petFiles,
    contacts,
    adminCalendarSync,
    portalCommerce,
    publicDocuments
  };
}

export function createMySqlJobProcessorDependencies(
  executor: SqlExecutor,
  options: MySqlJobProcessorOptions = {}
): BackgroundProcessorDependencies {
  const now = options.now ?? defaultNow;
  const handlers = options.handlers ?? {};
  const sendEmail = options.sendEmail ?? (async () => undefined);
  const claimedEmails = new Map<string, OutboundEmailMessage>();

  return {
    now,
    async claimDueJobs(limit) {
      const [rows] = await executor.execute<Array<{
        job_id: string;
        job_kind: SupportedJobKind;
        run_at: string;
        payload_json: string | Record<string, unknown>;
      }>>(
        [
          "SELECT job_id, job_kind, run_at, payload_json",
          "FROM job_queue",
          "WHERE status = 'queued' AND run_at <= ?",
          "ORDER BY run_at ASC",
          "LIMIT ?"
        ].join(" "),
        [now(), limit]
      );

      const jobs = rows.map((row) => jobEnvelopeSchema.parse({
        jobId: row.job_id,
        kind: row.job_kind,
        scheduledFor: row.run_at,
        payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json
      }));

      for (const job of jobs) {
        await executor.execute(
          "UPDATE job_queue SET status = 'processing' WHERE job_id = ?",
          [job.jobId]
        );
      }

      return jobs;
    },
    async completeJob(result) {
      await executor.execute(
        "UPDATE job_queue SET status = 'processed', processed_at = ? WHERE job_id = ?",
        [result.processedAt, result.jobId]
      );
    },
    async failJob(result) {
      await executor.execute(
        "UPDATE job_queue SET status = 'failed', processed_at = ? WHERE job_id = ?",
        [result.processedAt, result.jobId]
      );
    },
    async claimQueuedEmails(limit) {
      const [rows] = await executor.execute<Array<{
        id: number;
        recipient: string;
        subject: string;
        html_body: string;
        template_key: string;
      }>>(
        [
          "SELECT id, recipient, subject, html_body, template_key",
          "FROM email_outbox",
          "WHERE status = 'queued'",
          "ORDER BY created_at ASC",
          "LIMIT ?"
        ].join(" "),
        [limit]
      );

      const claimed = [];
      for (const row of rows) {
        const message = outboundEmailSchema.parse({
          to: [row.recipient],
          subject: row.subject,
          html: row.html_body,
          templateKey: row.template_key
        });
        const emailId = String(row.id);
        claimedEmails.set(emailId, message);
        await executor.execute(
          "UPDATE email_outbox SET status = 'processing' WHERE id = ?",
          [emailId]
        );
        claimed.push({
          emailId,
          message
        });
      }

      return claimed;
    },
    async sendEmail(message) {
      await sendEmail(message);
    },
    async markEmailSent(emailId, processedAt) {
      claimedEmails.delete(emailId);
      await executor.execute(
        "UPDATE email_outbox SET status = 'sent', processed_at = ? WHERE id = ?",
        [processedAt, emailId]
      );
    },
    async markEmailFailed(emailId, _reason, processedAt) {
      claimedEmails.delete(emailId);
      await executor.execute(
        "UPDATE email_outbox SET status = 'failed', processed_at = ? WHERE id = ?",
        [processedAt, emailId]
      );
    },
    handlers
  };
}

export function createMySqlSessionStore(executor: SqlExecutor, options: SessionStoreOptions = {}) {
  const now = options.now ?? defaultNow;
  const ttlSeconds = options.ttlSeconds ?? 60 * 60 * 24 * 14;

  return {
    async save(sessionId: string, sessionData: string): Promise<void> {
      const expiresAt = new Date(Date.parse(now()) + ttlSeconds * 1000).toISOString();
      await executor.execute(
        [
          "INSERT INTO app_sessions (session_id, session_data, expires_at, created_at, updated_at)",
          "VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
          "ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), expires_at = VALUES(expires_at), updated_at = CURRENT_TIMESTAMP"
        ].join(" "),
        [sessionId, sessionData, expiresAt]
      );
    },
    async load(sessionId: string): Promise<string | null> {
      const [rows] = await executor.execute<Array<{ session_data: string; expires_at: string }>>(
        [
          "SELECT session_data, expires_at FROM app_sessions",
          "WHERE session_id = ? AND expires_at > ?",
          "LIMIT 1"
        ].join(" "),
        [sessionId, now()]
      );

      return rows[0]?.session_data ?? null;
    },
    async delete(sessionId: string): Promise<void> {
      await executor.execute("DELETE FROM app_sessions WHERE session_id = ?", [sessionId]);
    },
    async purgeExpired(): Promise<void> {
      await executor.execute("DELETE FROM app_sessions WHERE expires_at <= ?", [now()]);
    }
  };
}

const supportedMigrationTables = new Set([
  "admin_users",
  "bookings",
  "client_package_credits",
  "clients",
  "contracts",
  "form_submissions",
  "invoices",
  "notifications",
  "packages",
  "pets",
  "quotes",
  "scheduled_tasks",
  "workflows"
]);

const supportedMigrationTokenFields: Record<string, Set<string>> = {
  bookings: new Set(["ical_token"]),
  contracts: new Set(["access_token"]),
  form_submissions: new Set(["access_token"]),
  quotes: new Set(["access_token"])
};

function assertSupportedMigrationTable(table: string): void {
  if (!supportedMigrationTables.has(table)) {
    throw new Error(`Unsupported legacy migration table: ${table}`);
  }
}

function assertSupportedMigrationTokenField(table: string, field: string): void {
  assertSupportedMigrationTable(table);
  if (!supportedMigrationTokenFields[table]?.has(field)) {
    throw new Error(`Unsupported migration token field: ${table}.${field}`);
  }
}

export function createMySqlMigrationAuditDependencies(
  executor: SqlExecutor,
  options: { now?: () => string } = {}
): MigrationAuditDependencies {
  const now = options.now ?? defaultNow;

  return {
    now,
    async countLegacyRows(table) {
      assertSupportedMigrationTable(table);
      const [rows] = await executor.execute<Array<{ rowCount: number }>>(
        `SELECT COUNT(*) AS rowCount FROM ${table}`
      );
      return Number(rows[0]?.rowCount ?? 0);
    },
    async countRowsMissingToken(table, tokenField) {
      assertSupportedMigrationTokenField(table, tokenField);
      const [rows] = await executor.execute<Array<{ rowCount: number }>>(
        `SELECT COUNT(*) AS rowCount FROM ${table} WHERE ${tokenField} IS NULL OR TRIM(${tokenField}) = ''`
      );
      return Number(rows[0]?.rowCount ?? 0);
    }
  };
}

export function getMySqlBootstrapStatements(): string[] {
  return [
    [
      "CREATE TABLE IF NOT EXISTS email_outbox (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "recipient VARCHAR(255) NOT NULL,",
      "subject VARCHAR(255) NOT NULL,",
      "html_body MEDIUMTEXT NOT NULL,",
      "template_key VARCHAR(100) NOT NULL,",
      "status VARCHAR(32) NOT NULL DEFAULT 'queued',",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
      "processed_at TIMESTAMP NULL",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS job_queue (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "job_id VARCHAR(128) NOT NULL UNIQUE,",
      "job_kind VARCHAR(64) NOT NULL,",
      "run_at TIMESTAMP NOT NULL,",
      "payload_json JSON NOT NULL,",
      "status VARCHAR(32) NOT NULL DEFAULT 'queued',",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
      "processed_at TIMESTAMP NULL",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS inbound_emails (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "inbound_email_id VARCHAR(128) NOT NULL UNIQUE,",
      "provider VARCHAR(64) NOT NULL,",
      "mailbox VARCHAR(255) NOT NULL,",
      "message_id VARCHAR(255) NOT NULL,",
      "received_at TIMESTAMP NOT NULL,",
      "from_email VARCHAR(255) NOT NULL,",
      "subject VARCHAR(255) NOT NULL,",
      "matched_client_id VARCHAR(128) NULL,",
      "raw_payload_json JSON NOT NULL,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS unmatched_emails (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "unmatched_email_id VARCHAR(128) NOT NULL UNIQUE,",
      "inbound_email_id VARCHAR(128) NOT NULL,",
      "reason VARCHAR(64) NOT NULL,",
      "detected_at TIMESTAMP NOT NULL,",
      "resolved_at TIMESTAMP NULL,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS integration_callbacks (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "callback_id VARCHAR(128) NOT NULL UNIQUE,",
      "provider VARCHAR(64) NOT NULL,",
      "received_at TIMESTAMP NOT NULL,",
      "payload_json JSON NOT NULL,",
      "queued_job_id VARCHAR(128) NULL,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS calendar_sync_links (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "sync_link_id VARCHAR(128) NOT NULL UNIQUE,",
      "booking_id VARCHAR(128) NOT NULL,",
      "provider VARCHAR(64) NOT NULL,",
      "external_event_id VARCHAR(255) NOT NULL,",
      "external_event_url VARCHAR(1024) NULL,",
      "synced_at TIMESTAMP NOT NULL,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
      "UNIQUE KEY uniq_calendar_sync_links_booking_provider (booking_id, provider)",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS workflows (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "workflow_id VARCHAR(128) NOT NULL UNIQUE,",
      "workflow_name VARCHAR(255) NOT NULL,",
      "workflow_trigger VARCHAR(64) NOT NULL,",
      "active TINYINT(1) NOT NULL DEFAULT 1,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ")"
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS workflow_enrollments (",
      "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
      "workflow_enrollment_id VARCHAR(128) NOT NULL UNIQUE,",
      "workflow_id VARCHAR(128) NOT NULL,",
      "client_id VARCHAR(128) NOT NULL,",
      "enrolled_at TIMESTAMP NOT NULL,",
      "next_run_at TIMESTAMP NOT NULL,",
      "completed_at TIMESTAMP NULL,",
      "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
      ")"
    ].join(" "),
    "CREATE INDEX idx_inbound_emails_provider_received_at ON inbound_emails(provider, received_at)",
    "CREATE INDEX idx_unmatched_emails_reason_detected_at ON unmatched_emails(reason, detected_at)",
    "CREATE INDEX idx_integration_callbacks_provider_received_at ON integration_callbacks(provider, received_at)",
    "CREATE INDEX idx_calendar_sync_links_provider_synced_at ON calendar_sync_links(provider, synced_at)",
    "CREATE INDEX idx_workflows_active_trigger ON workflows(active, workflow_trigger)",
    "CREATE INDEX idx_workflow_enrollments_run_at ON workflow_enrollments(completed_at, next_run_at)",
    "CREATE INDEX idx_job_queue_status_run_at ON job_queue(status, run_at)",
    "CREATE INDEX idx_email_outbox_status_created_at ON email_outbox(status, created_at)"
  ];
}

export function createMySqlPoolFromDatabaseUrl(databaseUrl: string, overrides: Partial<PoolOptions> = {}): Pool {
  const url = new URL(databaseUrl);

  return createPool({
    host: url.hostname,
    port: url.port === "" ? 3306 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    ...overrides
  });
}
