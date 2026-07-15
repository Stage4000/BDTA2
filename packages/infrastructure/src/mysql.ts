import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AdminConfigurationDependencies,
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
  LaunchPreflightDependencies,
  PetFileManagementDependencies,
  PortalCommerceDependencies,
  PublicDocumentAccessDependencies,
  PortalResourceReadDependencies,
  PortalSummaryDependencies,
  PortalActorProfileDependencies,
  PortalLoginDependencies,
  PublicContactDependencies,
  PublicPackagePurchaseDependencies,
  PublicBookingDependencies,
  WorkflowManagementDependencies
} from "@bdta/application";
import type {
  AchievementType,
  AppointmentType,
  BlogPost,
  Booking,
  Client,
  ClientAchievement,
  ClientContact,
  ClientProfile,
  Contract,
  Credit,
  Expense,
  FormSubmission,
  FormTemplate,
  Invoice,
  OutboundEmailMessage,
  Package,
  Pet,
  PetFile,
  PublicAccessToken,
  Quote,
  EmailTemplate,
  ScheduledTask,
  Setting,
  SitePage,
  Workflow,
  WorkflowAutoEnrollmentTrigger,
  WorkflowEnrollment,
  WorkflowStep
} from "@bdta/domain";
import { outboundEmailSchema } from "@bdta/domain";
import { jobEnvelopeSchema, type JobEnvelope, type SupportedJobKind } from "@bdta/contracts";
import { managedSettingsCatalog } from "@bdta/platform";
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
  stripeClient?: StripeClient;
};

type StripeCheckoutSessionCreateInput = {
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  amountTotal: number;
  itemName: string;
  itemDescription?: string | null;
  metadata: Record<string, string>;
};

async function verifyPasswordWithLegacyBcryptSupport(password: string, passwordHash: string): Promise<boolean> {
  const normalizedHash = passwordHash.trim();
  if (normalizedHash === "") {
    return false;
  }

  try {
    if (await compare(password, normalizedHash)) {
      return true;
    }
  } catch {
    // ponytail: fall through to the PHP bcrypt compatibility retry below.
  }

  if (!normalizedHash.startsWith("$2y$")) {
    return false;
  }

  try {
    return await compare(password, `$2b$${normalizedHash.slice(4)}`);
  } catch {
    return false;
  }
}

type StripeCheckoutSessionSnapshot = {
  sessionId: string;
  checkoutUrl: string;
  expiresAt: string | null;
  paymentStatus: string;
  amountTotal: number;
  paymentIntentId: string | null;
  metadata: Record<string, string>;
};

type StripeClient = {
  createCheckoutSession(input: StripeCheckoutSessionCreateInput): Promise<StripeCheckoutSessionSnapshot>;
  fetchCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionSnapshot | null>;
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

function normalizeWebsiteBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === "") {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }

  return `https://${trimmed.replace(/\/$/, "")}`;
}

function normalizeStripeMetadata(input: unknown): Record<string, string> {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string | number | boolean] => (
        typeof entry[0] === "string"
        && ["string", "number", "boolean"].includes(typeof entry[1])
      ))
      .map(([key, value]) => [key, String(value)])
  );
}

function readStripePaymentIntentId(input: unknown): string | null {
  if (typeof input === "string" && input.trim() !== "") {
    return input.trim();
  }

  if (input != null && typeof input === "object" && "id" in input && typeof input.id === "string" && input.id.trim() !== "") {
    return input.id.trim();
  }

  return null;
}

function toIsoTimestampFromUnixSeconds(input: unknown): string | null {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return null;
  }

  return new Date(input * 1000).toISOString();
}

async function readStripeResponsePayload(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    return await response.json() as Record<string, unknown>;
  }

  const text = await response.text();
  return text.trim() === "" ? {} : { message: text };
}

function readStripeErrorMessage(payload: Record<string, unknown>): string {
  const errorPayload = payload.error;
  if (errorPayload != null && typeof errorPayload === "object" && "message" in errorPayload && typeof errorPayload.message === "string") {
    return errorPayload.message;
  }

  if (typeof payload.message === "string" && payload.message.trim() !== "") {
    return payload.message.trim();
  }

  return "Stripe request failed.";
}

function parseStripeSignatureHeader(signatureHeader: string): {
  timestamp: string;
  signatures: string[];
} | null {
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of signatureHeader.split(",")) {
    const [key, ...valueParts] = part.split("=");
    const normalizedKey = key?.trim() ?? "";
    const normalizedValue = valueParts.join("=").trim();
    if (normalizedKey === "t" && normalizedValue !== "") {
      timestamp = normalizedValue;
    }
    if (normalizedKey === "v1" && normalizedValue !== "") {
      signatures.push(normalizedValue);
    }
  }

  return timestamp !== "" && signatures.length > 0
    ? {
      timestamp,
      signatures
    }
    : null;
}

function secureCompare(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const candidateBuffer = Buffer.from(candidate, "utf8");
  return expectedBuffer.length === candidateBuffer.length
    && timingSafeEqual(expectedBuffer, candidateBuffer);
}

function createHttpStripeClient(resolveSecretKey: () => Promise<string>): StripeClient {
  return {
    async createCheckoutSession(input) {
      const params = new URLSearchParams();
      params.set("mode", "payment");
      params.set("success_url", input.successUrl);
      params.set("cancel_url", input.cancelUrl);
      params.set("payment_method_types[0]", "card");
      params.set("line_items[0][quantity]", "1");
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][unit_amount]", String(Math.max(0, Math.round(input.amountTotal))));
      params.set("line_items[0][price_data][product_data][name]", input.itemName.trim() === "" ? "Brook's Dog Training Academy" : input.itemName.trim());

      const description = input.itemDescription?.trim() ?? "";
      if (description !== "") {
        params.set("line_items[0][price_data][product_data][description]", description);
      }

      const customerEmail = input.customerEmail?.trim() ?? "";
      if (customerEmail !== "") {
        params.set("customer_email", customerEmail);
      }

      for (const [key, value] of Object.entries(input.metadata)) {
        if (key.trim() !== "" && value.trim() !== "") {
          params.set(`metadata[${key}]`, value);
        }
      }

      const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await resolveSecretKey()}`,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: params
      });

      const payload = await readStripeResponsePayload(response);
      if (!response.ok) {
        throw new Error(readStripeErrorMessage(payload));
      }

      const sessionId = typeof payload.id === "string" ? payload.id.trim() : "";
      const checkoutUrl = typeof payload.url === "string" ? payload.url.trim() : "";
      if (sessionId === "" || checkoutUrl === "") {
        throw new Error("Stripe checkout session response was missing the checkout URL.");
      }

      return {
        sessionId,
        checkoutUrl,
        expiresAt: toIsoTimestampFromUnixSeconds(payload.expires_at),
        paymentStatus: typeof payload.payment_status === "string" ? payload.payment_status : "unpaid",
        amountTotal: typeof payload.amount_total === "number" ? payload.amount_total : Math.max(0, Math.round(input.amountTotal)),
        paymentIntentId: readStripePaymentIntentId(payload.payment_intent),
        metadata: normalizeStripeMetadata(payload.metadata)
      };
    },
    async fetchCheckoutSession(sessionId) {
      const normalizedSessionId = sessionId.trim();
      if (normalizedSessionId === "") {
        return null;
      }

      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(normalizedSessionId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await resolveSecretKey()}`
        }
      });

      const payload = await readStripeResponsePayload(response);
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(readStripeErrorMessage(payload));
      }

      const returnedSessionId = typeof payload.id === "string" ? payload.id.trim() : normalizedSessionId;
      return {
        sessionId: returnedSessionId,
        checkoutUrl: typeof payload.url === "string" ? payload.url.trim() : "",
        expiresAt: toIsoTimestampFromUnixSeconds(payload.expires_at),
        paymentStatus: typeof payload.payment_status === "string" ? payload.payment_status : "unpaid",
        amountTotal: typeof payload.amount_total === "number" ? payload.amount_total : 0,
        paymentIntentId: readStripePaymentIntentId(payload.payment_intent),
        metadata: normalizeStripeMetadata(payload.metadata)
      };
    }
  };
}

export async function resolveMySqlPortalBaseUrl(
  executor: SqlExecutor,
  override?: string | null
): Promise<string> {
  const normalizedOverride = normalizeWebsiteBaseUrl(override ?? "");
  if (normalizedOverride !== "") {
    return normalizedOverride;
  }

  const [rows] = await executor.execute<Array<{ setting_value: string | null }>>(
    [
      "SELECT setting_value",
      "FROM settings",
      "WHERE setting_key = ?",
      "LIMIT 1"
    ].join(" "),
    ["base_url"]
  );

  const configuredWebsiteBaseUrl = normalizeWebsiteBaseUrl(rows[0]?.setting_value ?? "");
  if (configuredWebsiteBaseUrl !== "") {
    return `${configuredWebsiteBaseUrl}/portal`;
  }

  return "http://localhost:3000/portal";
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

function normalizeLegacyOptionalToken(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 16 ? normalized : null;
}

function normalizeLegacyReferenceId(
  value: string | number | null | undefined,
  fallback: string
): string {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? String(value) : fallback;
  }

  const normalized = value?.trim() ?? "";
  return normalized === "" ? fallback : normalized;
}

function normalizeLegacyOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? undefined : normalized;
}

function isLegacyZeroDateValue(value: string): boolean {
  return /^0{4}-0{2}-0{2}(?:[ T]0{2}:0{2}(?::0{2})?)?$/.test(value.trim());
}

function normalizeLegacyFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized === "") {
      return fallback;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function buildLegacyPublicAccessToken(
  tokenValue: string | null | undefined,
  issuedAt: string,
  legacySourceId: string
): PublicAccessToken | null {
  const token = normalizeLegacyOptionalToken(tokenValue);
  return token == null
    ? null
    : {
        token,
        issuedAt,
        expiresAt: null,
        legacySourceId
      };
}

function normalizeLegacyInvoiceStatus(status: string | null | undefined): Invoice["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "sent":
      return "sent";
    case "partial":
    case "partially_paid":
      return "partially_paid";
    case "paid":
    case "settled":
      return "paid";
    case "overdue":
      return "overdue";
    case "cancelled":
    case "canceled":
    case "refunded":
    case "void":
      return "void";
    default:
      return "draft";
  }
}

function normalizeLegacyBookingStatus(status: string | null | undefined): Booking["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "confirmed":
    case "scheduled":
    case "rescheduled":
    case "in_progress":
      return "confirmed";
    case "completed":
    case "complete":
    case "done":
      return "completed";
    case "cancelled":
    case "canceled":
    case "no_show":
    case "noshow":
      return "cancelled";
    default:
      return "pending";
  }
}

function normalizeLegacyQuoteStatus(status: string | null | undefined): Quote["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "sent":
    case "viewed":
      return "sent";
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    default:
      return "draft";
  }
}

function normalizeLegacyContractStatus(status: string | null | undefined): Contract["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "sent":
      return "sent";
    case "signed":
      return "signed";
    case "expired":
    case "cancelled":
    case "canceled":
    case "void":
      return "void";
    default:
      return "draft";
  }
}

function normalizeLegacyTimestampValue(value: string | Date | null | undefined): string | null | undefined {
  if (value == null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const trimmed = value.trim();
  return trimmed === "" || isLegacyZeroDateValue(trimmed) ? null : trimmed;
}

function normalizeLegacyDateValue(value: string | Date | null | undefined): string | null | undefined {
  if (value == null) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const trimmed = value.trim();
  return trimmed === "" || isLegacyZeroDateValue(trimmed) ? null : trimmed;
}

function normalizeLegacyTimeOfDay(value: string): string {
  const normalized = value.trim();
  if (/^\d{1,2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  const meridiemMatch = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(normalized);
  if (meridiemMatch != null) {
    const hours = Number.parseInt(meridiemMatch[1] ?? "0", 10);
    const minutes = Number.parseInt(meridiemMatch[2] ?? "0", 10);
    const meridiem = (meridiemMatch[3] ?? "").toUpperCase();
    const normalizedHours = meridiem === "PM"
      ? hours % 12 + 12
      : hours % 12;
    return `${String(normalizedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  }

  return "00:00:00";
}

function toTimestamp(date: string, time: string): string {
  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? date.trim() : "1970-01-01";
  const timestamp = `${normalizedDate}T${normalizeLegacyTimeOfDay(time)}.000Z`;
  return Number.isNaN(Date.parse(timestamp)) ? "1970-01-01T00:00:00.000Z" : timestamp;
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
  status: string | null;
  ical_token?: string | null;
}): Booking {
  const startsAt = toTimestamp(row.appointment_date, row.appointment_time);
  const durationMinutes = normalizeLegacyFiniteNumber(row.duration_minutes, 60) > 0
    ? normalizeLegacyFiniteNumber(row.duration_minutes, 60)
    : 60;
  const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();

  return {
    id: String(row.id),
    clientId: normalizeLegacyReferenceId(row.client_id, `legacy-client-${row.id}`),
    petIds: [],
    serviceId: normalizeLegacyReferenceId(row.service_type, `legacy-service-${row.id}`),
    startsAt,
    endsAt,
    status: normalizeLegacyBookingStatus(row.status),
    icalAccess: buildLegacyPublicAccessToken(row.ical_token, startsAt, String(row.id))
  };
}

function toInvoiceRecord(row: {
  id: number;
  client_id: number | null;
  status: string | null;
  total_amount: number;
  outstanding_amount: number;
  due_at: string | Date | null;
}): Invoice {
  return {
    id: String(row.id),
    clientId: normalizeLegacyReferenceId(row.client_id, `legacy-client-${row.id}`),
    status: normalizeLegacyInvoiceStatus(row.status),
    totalAmount: normalizeLegacyFiniteNumber(row.total_amount),
    outstandingAmount: normalizeLegacyFiniteNumber(row.outstanding_amount),
  dueAt: normalizeLegacyTimestampValue(row.due_at) ?? null
  };
}

function toExpenseRecord(row: {
  id: number;
  client_id: number | null;
  client_name?: string | null;
  category: string | null;
  description: string | null;
  amount: number;
  expense_date: string | Date | null;
  receipt_file?: string | null;
  billable?: number | string | boolean | null;
  invoiced?: number | string | boolean | null;
  notes?: string | null;
  created_at?: string | Date | null;
}): Expense {
  return {
    id: String(row.id),
    clientId: row.client_id == null ? null : normalizeLegacyReferenceId(row.client_id, `legacy-client-${row.id}`),
    clientName: normalizeLegacyOptionalText(row.client_name),
    category: normalizeLegacyOptionalText(row.category) ?? "Uncategorized",
    description: normalizeLegacyOptionalText(row.description) ?? "Expense",
    amount: normalizeLegacyFiniteNumber(row.amount),
    expenseDate: normalizeLegacyDateValue(row.expense_date) ?? null,
    receiptFile: normalizeLegacyOptionalText(row.receipt_file),
    billable: Number(row.billable ?? 0) === 1,
    invoiced: Number(row.invoiced ?? 0) === 1,
    notes: row.notes?.trim() ?? "",
    createdAt: normalizeLegacyTimestampValue(row.created_at)
  };
}

function toQuoteRecord(row: {
  id: number;
  client_id: number | null;
  status: string | null;
  total_amount: number;
  access_token: string | null;
  quote_number?: string | null;
  title?: string | null;
  description?: string | null;
  expiration_date?: string | Date | null;
  accepted_at?: string | Date | null;
  declined_at?: string | Date | null;
  items?: Quote["items"];
}): Quote {
  return {
    id: String(row.id),
    clientId: normalizeLegacyReferenceId(row.client_id, `legacy-client-${row.id}`),
    status: normalizeLegacyQuoteStatus(row.status),
    totalAmount: normalizeLegacyFiniteNumber(row.total_amount),
    quoteNumber: normalizeLegacyOptionalText(row.quote_number),
    title: normalizeLegacyOptionalText(row.title),
    description: row.description ?? "",
    expiresAt: normalizeLegacyTimestampValue(row.expiration_date),
    acceptedAt: normalizeLegacyTimestampValue(row.accepted_at),
    declinedAt: normalizeLegacyTimestampValue(row.declined_at),
    items: row.items,
    publicAccess: buildLegacyPublicAccessToken(row.access_token, defaultNow(), String(row.id))
  };
}

function toContractRecord(row: {
  id: number;
  client_id: number;
  status: string | null;
  access_token: string | null;
  contract_number?: string | null;
  title?: string | null;
  description?: string | null;
  contract_text?: string | null;
  effective_date?: string | Date | null;
  signed_date?: string | Date | null;
  signature_typed_name?: string | null;
  signature_font?: string | null;
}): Contract {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    status: normalizeLegacyContractStatus(row.status),
    contractNumber: row.contract_number ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? "",
    contractText: row.contract_text ?? "",
    effectiveDate: normalizeLegacyDateValue(row.effective_date),
    signedAt: normalizeLegacyTimestampValue(row.signed_date),
    signatureTypedName: row.signature_typed_name,
    signatureFont: row.signature_font,
    publicAccess: buildLegacyPublicAccessToken(row.access_token, defaultNow(), String(row.id))
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

function toOptionalTrimmedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return null;
}

function toSettingRecord(row: {
  id: string | number;
  setting_key: string;
  setting_value: string | null;
  setting_type?: string | Date | null;
  category?: string | Date | null;
  label?: string | Date | null;
  description?: string | null;
  is_secret?: number | null;
  updated_at?: string | Date | null;
}): Setting {
  const settingType = toOptionalTrimmedString(row.setting_type) ?? "text";
  const category = toOptionalTrimmedString(row.category) ?? "general";
  const label = toOptionalTrimmedString(row.label) ?? row.setting_key;
  const updatedAt = toOptionalTrimmedString(row.updated_at) ?? "1970-01-01T00:00:00.000Z";

  return {
    id: String(row.id),
    key: row.setting_key,
    value: row.setting_value ?? "",
    type: settingType,
    category,
    label,
    description: row.description ?? "",
    secret: Number(row.is_secret ?? 0) === 1,
    updatedAt
  };
}

function toAdminSettingsUserRecord(row: {
  id: string | number;
  username?: string | null;
  email?: string | null;
  account_type?: string | null;
  can_manage_admin_users?: number | null;
  can_manage_api_keys?: number | null;
}) {
  const normalizedEmail = row.email?.trim() ?? "";
  const username = row.username?.trim() || normalizedEmail || `admin-${String(row.id)}`;
  const accountTypeValue = row.account_type?.trim().toLowerCase() ?? "standard";
  const isMainAccount = username.toLowerCase() === "admin" || accountTypeValue === "main" || accountTypeValue === "owner";
  const accountType = isMainAccount
    ? "main"
    : (accountTypeValue === "accountant" ? "accountant" : "standard");
  const isAccountant = accountType === "accountant" || accountTypeValue === "accountant";
  const role = isMainAccount
    ? "owner"
    : (accountTypeValue === "staff" ? "staff" : isAccountant ? "accountant" : "admin");

  return {
    actorId: String(row.id),
    username,
    email: normalizedEmail !== "" ? normalizedEmail : `${username}@example.com`,
    accountType,
    role,
    isMainAccount,
    canManageAdminUsers: isMainAccount ? true : (!isAccountant && Number(row.can_manage_admin_users ?? 0) === 1),
    canManageApiKeys: isMainAccount ? true : (!isAccountant && Number(row.can_manage_api_keys ?? 0) === 1),
    active: true
  } as const;
}

function toEmailTemplateRecord(row: {
  id: number;
  name: string;
  template_type: string;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}): EmailTemplate {
  return {
    id: String(row.id),
    name: row.name,
    templateType: row.template_type,
    subject: row.subject,
    bodyHtml: row.body_html ?? "",
    bodyText: row.body_text ?? "",
    active: Number(row.is_active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStringList(value: string | null): string[] {
  if (value == null || value.trim() === "") {
    return [];
  }

  if (value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
    } catch {
      return [];
    }
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function parseIntegerList(value: string | null): number[] {
  return parseStringList(value).map((item) => Number.parseInt(item, 10)).filter((item) => Number.isInteger(item));
}

function parseRecordValue<T extends Record<string, unknown>>(value: string | null): T {
  if (value == null || value.trim() === "") {
    return {} as T;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed) ? parsed as T : {} as T;
  } catch {
    return {} as T;
  }
}

function parseArrayValue<T>(value: string | null): T[] {
  if (value == null || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseLegacyIndexedArrayValue<T>(value: string | null): T[] {
  if (value == null || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }

    if (typeof parsed !== "object" || parsed == null) {
      return [];
    }

    const entries = Object.entries(parsed)
      .map(([key, item]) => ({ index: Number.parseInt(key, 10), item }))
      .filter((entry) => Number.isInteger(entry.index) && entry.index >= 0)
      .sort((left, right) => left.index - right.index);
    if (entries.length === 0) {
      return [];
    }

    const result: T[] = [];
    for (const entry of entries) {
      result[entry.index] = entry.item as T;
    }

    return result;
  } catch {
    return [];
  }
}

type FormSubmissionRow = {
  id: number;
  template_id: number;
  client_id: number;
  booking_id?: number | null;
  pet_id?: number | null;
  template_name?: string | null;
  template_description?: string | null;
  template_fields?: string | null;
  form_type?: string | null;
  template_is_internal?: number | null;
  template_show_in_client_portal?: number | null;
  status?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  pet_name?: string | null;
  service_type?: string | null;
  appointment_datetime?: string | null;
  submitted_by?: number | null;
  submitted_by_name?: string | null;
  reviewed_by?: number | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  notes?: string | null;
  responses?: string | null;
  submitted_at: string | null;
  access_token: string | null;
};

function mapFormSubmissionRow(row: FormSubmissionRow, issuedAt: string): FormSubmission {
  const appointmentDateTime = row.appointment_datetime?.trim() ?? "";
  const serviceType = row.service_type?.trim() ?? "";
  const defaultStatus = row.reviewed_at != null
    ? "reviewed"
    : row.submitted_at == null
      ? "pending"
      : "submitted";

  return {
    id: String(row.id),
    templateId: String(row.template_id),
    clientId: String(row.client_id),
    clientName: row.client_name ?? null,
    bookingId: row.booking_id == null ? null : String(row.booking_id),
    bookingSummary: appointmentDateTime === "" && serviceType === ""
      ? null
      : [serviceType, appointmentDateTime].filter((item) => item !== "").join(" - "),
    petId: row.pet_id == null ? null : String(row.pet_id),
    petName: row.pet_name ?? null,
    templateName: row.template_name ?? null,
    templateDescription: row.template_description ?? null,
    templateFields: parseArrayValue<Record<string, unknown>>(row.template_fields ?? null),
    formType: row.form_type ?? undefined,
    templateIsInternal: row.template_is_internal == null ? undefined : row.template_is_internal !== 0,
    templateShowInClientPortal: row.template_show_in_client_portal == null ? undefined : row.template_show_in_client_portal !== 0,
    status: row.status ?? defaultStatus,
    submittedByAdminUserId: row.submitted_by == null ? null : String(row.submitted_by),
    submittedByName: row.submitted_by_name ?? null,
    reviewedByAdminUserId: row.reviewed_by == null ? null : String(row.reviewed_by),
    reviewedByName: row.reviewed_by_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    notes: row.notes ?? "",
    contactName: row.client_name ?? null,
    contactEmail: row.client_email ?? null,
    contactPhone: row.client_phone ?? null,
    responses: parseLegacyIndexedArrayValue<unknown>(row.responses ?? null),
    submittedAt: row.submitted_at,
    publicAccess: row.access_token == null ? null : {
      token: row.access_token,
      issuedAt,
      expiresAt: null,
      legacySourceId: String(row.id)
    }
  };
}

type FormTemplateRow = {
  id: number;
  name: string;
  description: string | null;
  fields: string | null;
  form_type: string | null;
  required_frequency: string | null;
  appointment_type_id: number | null;
  is_internal: number | null;
  show_in_client_portal: number | null;
  is_active: number | null;
};

function mapFormTemplateRow(row: FormTemplateRow): FormTemplate {
  return {
    id: String(row.id),
    name: row.name,
    active: Number(row.is_active ?? 0) === 1,
    description: row.description ?? "",
    fields: parseArrayValue<Record<string, unknown>>(row.fields),
    formType: row.form_type ?? undefined,
    requiredFrequency: row.required_frequency ?? null,
    appointmentTypeId: row.appointment_type_id == null ? null : String(row.appointment_type_id),
    templateIsInternal: row.is_internal == null ? undefined : row.is_internal !== 0,
    templateShowInClientPortal: row.show_in_client_portal == null ? undefined : row.show_in_client_portal !== 0
  };
}

function toAppointmentTypeRecord(row: {
  id: number;
  name: string;
  description: string | null;
  bullet_points: string | null;
  admin_user_id: number | null;
  duration_minutes: number | null;
  buffer_before_minutes: number | null;
  buffer_after_minutes: number | null;
  use_travel_time_buffer: number | null;
  travel_time_minutes: number | null;
  advance_booking_min_days: number | null;
  advance_booking_max_days: number | null;
  cancellation_notice_hours: number | null;
  requires_forms: number | null;
  form_template_ids: string | null;
  requires_contract: number | null;
  contract_template_id: number | null;
  auto_invoice: number | null;
  invoice_due_days: number | null;
  invoice_due_timing: string | null;
  default_amount: number | null;
  consumes_credits: number | null;
  credit_count: number | null;
  is_group_class: number | null;
  max_participants: number | null;
  is_active: number | null;
  public_available: number | null;
  portal_available: number | null;
  schedule_type: string | null;
  specific_date: string | null;
  specific_dates: string | null;
  available_days: string | null;
  available_start_time: string | null;
  available_end_time: string | null;
  time_slot_interval: number | null;
  is_mini_session: number | null;
  mini_session_location: string | null;
  mini_session_topic: string | null;
  is_field_rental: number | null;
  field_rental_location: string | null;
  group_class_location: string | null;
  per_day_schedule: string | null;
  location_types: string | null;
  confirmation_template_id: number | null;
  booking_request_template_id: number | null;
  invoice_template_id: number | null;
  reminder_template_id: number | null;
  cancellation_template_id: number | null;
  requires_admin_confirmation: number | null;
  uses_resource: number | null;
  resource_name: string | null;
  resource_capacity: number | null;
  resource_allocation: string | null;
  unique_link: string | null;
  created_at: string | null;
  updated_at: string | null;
}): AppointmentType {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description ?? "",
    bulletPoints: parseStringList(row.bullet_points),
    adminUserId: row.admin_user_id == null ? null : String(row.admin_user_id),
    durationMinutes: Number(row.duration_minutes ?? 60),
    bufferBeforeMinutes: Number(row.buffer_before_minutes ?? 0),
    bufferAfterMinutes: Number(row.buffer_after_minutes ?? 0),
    useTravelTimeBuffer: Number(row.use_travel_time_buffer ?? 0) === 1,
    travelTimeMinutes: Number(row.travel_time_minutes ?? 0),
    advanceBookingMinDays: Number(row.advance_booking_min_days ?? 1),
    advanceBookingMaxDays: Number(row.advance_booking_max_days ?? 90),
    cancellationNoticeHours: Number(row.cancellation_notice_hours ?? 0),
    requiresForms: Number(row.requires_forms ?? 0) === 1,
    formTemplateIds: parseStringList(row.form_template_ids),
    requiresContract: Number(row.requires_contract ?? 0) === 1,
    contractTemplateId: row.contract_template_id == null ? null : String(row.contract_template_id),
    autoInvoice: Number(row.auto_invoice ?? 0) === 1,
    invoiceDueDays: Number(row.invoice_due_days ?? 7),
    invoiceDueTiming: row.invoice_due_timing ?? "after",
    defaultAmount: Number(row.default_amount ?? 0),
    consumesCredits: Number(row.consumes_credits ?? 0) === 1,
    creditCount: Number(row.credit_count ?? 1),
    isGroupClass: Number(row.is_group_class ?? 0) === 1,
    maxParticipants: Number(row.max_participants ?? 1),
    publicAvailable: Number(row.public_available ?? 0) === 1,
    portalAvailable: Number(row.portal_available ?? 0) === 1,
    scheduleType: row.schedule_type ?? "recurring",
    specificDate: row.specific_date,
    specificDates: parseArrayValue(row.specific_dates),
    availableDays: parseIntegerList(row.available_days),
    availableStartTime: row.available_start_time ?? "09:00",
    availableEndTime: row.available_end_time ?? "17:00",
    timeSlotInterval: Number(row.time_slot_interval ?? 30),
    perDaySchedule: parseRecordValue(row.per_day_schedule),
    isMiniSession: Number(row.is_mini_session ?? 0) === 1,
    miniSessionLocation: row.mini_session_location ?? "",
    miniSessionTopic: row.mini_session_topic ?? "",
    isFieldRental: Number(row.is_field_rental ?? 0) === 1,
    fieldRentalLocation: row.field_rental_location ?? "",
    groupClassLocation: row.group_class_location ?? "",
    locationTypes: parseStringList(row.location_types),
    confirmationTemplateId: row.confirmation_template_id == null ? null : String(row.confirmation_template_id),
    bookingRequestTemplateId: row.booking_request_template_id == null ? null : String(row.booking_request_template_id),
    invoiceTemplateId: row.invoice_template_id == null ? null : String(row.invoice_template_id),
    reminderTemplateId: row.reminder_template_id == null ? null : String(row.reminder_template_id),
    cancellationTemplateId: row.cancellation_template_id == null ? null : String(row.cancellation_template_id),
    requiresAdminConfirmation: Number(row.requires_admin_confirmation ?? 0) === 1,
    usesResource: Number(row.uses_resource ?? 0) === 1,
    resourceName: row.resource_name ?? "",
    resourceCapacity: Number(row.resource_capacity ?? 1),
    resourceAllocation: row.resource_allocation ?? "per_appointment",
    uniqueLink: row.unique_link ?? String(row.id),
    active: Number(row.is_active ?? 1) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toScheduledTaskRecord(row: {
  id: number;
  task_name: string;
  task_type: string;
  schedule_type: string;
  schedule_value: string | null;
  is_active: number;
  last_run: string | null;
  next_run: string | null;
}): ScheduledTask {
  return {
    id: String(row.id),
    name: row.task_name,
    taskType: row.task_type,
    scheduleType: row.schedule_type,
    scheduleValue: row.schedule_value ?? "",
    active: Number(row.is_active) === 1,
    lastRunAt: row.last_run,
    nextRunAt: row.next_run
  };
}

function toPackageRecord(row: {
  id: number;
  name: string;
  is_active: number;
  price: number;
  description?: string | null;
  bullet_points?: string | null;
  expiration_days?: number | null;
  share_token?: string | null;
  portal_available?: number | null;
  form_template_id?: number | null;
  items?: Package["items"];
}): Package {
  return {
    id: String(row.id),
    name: row.name,
    active: Number(row.is_active) === 1,
    price: Number(row.price),
    description: row.description ?? "",
    bulletPoints: parseStringList(row.bullet_points ?? null),
    expirationDays: row.expiration_days == null ? null : Number(row.expiration_days),
    shareToken: row.share_token ?? null,
    portalAvailable: Number(row.portal_available ?? 0) === 1,
    formTemplateId: row.form_template_id == null ? null : String(row.form_template_id),
    items: row.items ?? []
  };
}

function toPetRecord(row: {
  id: number;
  client_id: number;
  name: string;
  species: string;
  pet_sitting_notes: string | null;
  is_active: number;
}): Pet {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: row.name,
    species: row.species,
    petSittingNotes: row.pet_sitting_notes ?? "",
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
  appointment_type_id: number;
  total_credits: number;
  used_credits: number;
}): Credit {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    packageId: row.package_id == null ? null : String(row.package_id),
    appointmentTypeId: String(row.appointment_type_id),
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
  const passwordVerifier = options.passwordVerifier ?? verifyPasswordWithLegacyBcryptSupport;
  const petUploadsBaseDir = options.petUploadsBaseDir ?? path.resolve(process.cwd(), "..", "backend", "uploads", "pets");
  const petFileContentLoader = options.petFileContentLoader ?? createPetFileContentLoader(petUploadsBaseDir);
  const petFileContentWriter = options.petFileContentWriter ?? createPetFileContentWriter(petUploadsBaseDir);
  const petFileContentDeleter = options.petFileContentDeleter ?? createPetFileContentDeleter(petUploadsBaseDir);
  const stripeClient = options.stripeClient ?? createHttpStripeClient(resolveStripeSecretKey);
  function isMissingColumnError(error: unknown): boolean {
    if (typeof error !== "object" || error == null) {
      return false;
    }

    const maybeMessage = "message" in error ? error.message : undefined;
    const maybeCode = "code" in error ? error.code : undefined;
    return maybeCode === "ER_BAD_FIELD_ERROR"
      || maybeCode === "ER_NO_SUCH_TABLE"
      || (typeof maybeMessage === "string" && (/unknown column/i.test(maybeMessage) || /doesn't exist/i.test(maybeMessage)));
  }

  function getErrorMessage(error: unknown): string {
    return typeof error === "object"
      && error != null
      && "message" in error
      && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  }

  type LegacySettingRow = {
    id: string;
    setting_key: string;
    setting_value: string | null;
    setting_type?: string | null;
    category?: string | null;
    label?: string | null;
    description?: string | null;
    is_secret?: number | null;
    updated_at?: string | null;
  };

  type SettingsSelectSqlFallback = {
    omitCategory?: boolean;
    omitLabel?: boolean;
    omitDescription?: boolean;
    omitSecret?: boolean;
    omitUpdatedAt?: boolean;
    omitType?: boolean;
  };

  function buildSettingsSelectSql(input: {
    whereClause?: string;
    fallback: SettingsSelectSqlFallback;
  }): string {
    const settingTypeSelect = input.fallback.omitType ? "'text' AS setting_type" : "setting_type";
    const categorySelect = input.fallback.omitCategory ? "'general' AS category" : "category";
    const labelSelect = input.fallback.omitLabel ? "setting_key AS label" : "label";
    const descriptionSelect = input.fallback.omitDescription ? "NULL AS description" : "description";
    const secretSelect = input.fallback.omitSecret ? "0 AS is_secret" : "is_secret";
    const updatedAtSelect = input.fallback.omitUpdatedAt ? "NULL AS updated_at" : "updated_at";
    const orderBy = input.fallback.omitCategory || input.fallback.omitLabel
      ? "ORDER BY setting_key ASC"
      : "ORDER BY category ASC, label ASC";

    return [
      `SELECT setting_key AS id, setting_key, setting_value, ${settingTypeSelect}, ${categorySelect}, ${labelSelect}, ${descriptionSelect}, ${secretSelect}, ${updatedAtSelect}`,
      "FROM settings",
      input.whereClause ?? "",
      orderBy
    ].filter((part) => part.trim() !== "").join(" ");
  }

  function getNextSettingsSelectFallback(
    error: unknown,
    current: SettingsSelectSqlFallback
  ): SettingsSelectSqlFallback | null {
    const message = getErrorMessage(error);
    const next = { ...current };

    if (message.includes("setting_type")) {
      next.omitType = true;
    }
    if (message.includes("category")) {
      next.omitCategory = true;
    }
    if (message.includes("label")) {
      next.omitLabel = true;
    }
    if (message.includes("description")) {
      next.omitDescription = true;
    }
    if (message.includes("is_secret")) {
      next.omitSecret = true;
    }
    if (message.includes("updated_at")) {
      next.omitUpdatedAt = true;
    }

    if (JSON.stringify(next) !== JSON.stringify(current)) {
      return next;
    }

    if (!current.omitType) {
      return { ...current, omitType: true };
    }
    if (!current.omitCategory) {
      return { ...current, omitCategory: true };
    }
    if (!current.omitLabel) {
      return { ...current, omitLabel: true };
    }
    if (!current.omitDescription) {
      return { ...current, omitDescription: true };
    }
    if (!current.omitSecret) {
      return { ...current, omitSecret: true };
    }
    if (!current.omitUpdatedAt) {
      return { ...current, omitUpdatedAt: true };
    }

    return null;
  }

  async function loadLegacySettingRows(input: {
    whereClause?: string;
    params?: unknown[];
  }): Promise<LegacySettingRow[]> {
    let fallback: SettingsSelectSqlFallback = {};

    while (true) {
      try {
        const [rows] = await executor.execute<Array<LegacySettingRow>>(
          buildSettingsSelectSql({
            whereClause: input.whereClause,
            fallback
          }),
          input.params ?? []
        );
        return rows;
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }

        const nextFallback = getNextSettingsSelectFallback(error, fallback);
        if (nextFallback == null) {
          throw error;
        }

        fallback = nextFallback;
      }
    }
  }

  type LegacyAdminUserRow = {
    id: number;
    username?: string | null;
    email?: string | null;
    account_type?: string | null;
    can_manage_admin_users?: number | null;
    can_manage_api_keys?: number | null;
    password_hash?: string | null;
  };

  type AdminUserSelectSqlFallback = {
    synthesizeUsername?: boolean;
    omitEmail?: boolean;
    omitAccountType?: boolean;
    omitManageAdminUsers?: boolean;
    omitManageApiKeys?: boolean;
    lookupByEmail?: boolean;
  };

  function buildAdminUserSelectSql(input: {
    whereField?: "id" | "username";
    includePasswordHash?: boolean;
    forSettingsList?: boolean;
    fallback: AdminUserSelectSqlFallback;
  }): string {
    const usernameSelect = input.fallback.synthesizeUsername
      ? (input.fallback.omitEmail
        ? "CONCAT('admin-', id) AS username"
        : "COALESCE(NULLIF(TRIM(email), ''), CONCAT('admin-', id)) AS username")
      : "username";
    const emailSelect = input.fallback.omitEmail ? "NULL AS email" : "email";
    const accountTypeSelect = input.fallback.omitAccountType ? "NULL AS account_type" : "account_type";
    const manageAdminUsersSelect = input.fallback.omitManageAdminUsers ? "NULL AS can_manage_admin_users" : "can_manage_admin_users";
    const manageApiKeysSelect = input.fallback.omitManageApiKeys ? "NULL AS can_manage_api_keys" : "can_manage_api_keys";

    const fields = [
      "id",
      usernameSelect,
      emailSelect,
      accountTypeSelect,
      manageAdminUsersSelect,
      manageApiKeysSelect,
      input.includePasswordHash ? "password_hash" : null
    ].filter((field): field is string => field != null);

    const whereClause = input.whereField === "id"
      ? "WHERE id = ?"
      : input.whereField === "username"
        ? (input.fallback.lookupByEmail && !input.fallback.omitEmail ? "WHERE LOWER(email) = LOWER(?)" : "WHERE LOWER(username) = LOWER(?)")
        : "";

    const orderBy = input.forSettingsList
      ? (input.fallback.synthesizeUsername || input.fallback.omitEmail || input.fallback.omitAccountType
        ? "ORDER BY id ASC"
        : "ORDER BY CASE WHEN username = 'admin' OR account_type IN ('main', 'owner') THEN 0 ELSE 1 END, username ASC, email ASC")
      : "";

    const limitClause = input.whereField == null ? "" : "LIMIT 1";

    return [
      `SELECT ${fields.join(", ")}`,
      "FROM admin_users",
      whereClause,
      orderBy,
      limitClause
    ].filter((part) => part.trim() !== "").join(" ");
  }

  function getNextAdminUserSelectFallback(
    error: unknown,
    current: AdminUserSelectSqlFallback,
    whereField?: "id" | "username"
  ): AdminUserSelectSqlFallback | null {
    const message = getErrorMessage(error);
    const next = { ...current };

    if (message.includes("username")) {
      next.synthesizeUsername = true;
      if (whereField === "username" && !current.omitEmail) {
        next.lookupByEmail = true;
      }
    }
    if (message.includes("email")) {
      next.omitEmail = true;
      next.lookupByEmail = false;
    }
    if (message.includes("account_type")) {
      next.omitAccountType = true;
    }
    if (message.includes("can_manage_admin_users")) {
      next.omitManageAdminUsers = true;
    }
    if (message.includes("can_manage_api_keys")) {
      next.omitManageApiKeys = true;
    }

    if (JSON.stringify(next) !== JSON.stringify(current)) {
      return next;
    }

    if (!current.omitAccountType) {
      return { ...current, omitAccountType: true };
    }
    if (!current.omitManageAdminUsers) {
      return { ...current, omitManageAdminUsers: true };
    }
    if (!current.omitManageApiKeys) {
      return { ...current, omitManageApiKeys: true };
    }
    if (!current.omitEmail) {
      return { ...current, omitEmail: true };
    }
    if (!current.synthesizeUsername) {
      return { ...current, synthesizeUsername: true };
    }

    return null;
  }

  async function loadLegacyAdminUserRows(input: {
    whereField?: "id" | "username";
    params?: unknown[];
    includePasswordHash?: boolean;
    forSettingsList?: boolean;
  }): Promise<LegacyAdminUserRow[]> {
    let fallback: AdminUserSelectSqlFallback = {};

    while (true) {
      try {
        const [rows] = await executor.execute<Array<LegacyAdminUserRow>>(
          buildAdminUserSelectSql({
            whereField: input.whereField,
            includePasswordHash: input.includePasswordHash,
            forSettingsList: input.forSettingsList,
            fallback
          }),
          input.params ?? []
        );
        return rows;
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }

        const nextFallback = getNextAdminUserSelectFallback(error, fallback, input.whereField);
        if (nextFallback == null) {
          throw error;
        }

        fallback = nextFallback;
      }
    }
  }

  type LegacyBookingRow = {
    id: number;
    client_id?: number | null;
    service_type: string;
    appointment_date: string;
    appointment_time: string;
    duration_minutes: number;
    status: string | null;
    ical_token?: string | null;
  };

  type BookingSelectSqlFallback = {
    legacyOrdering?: boolean;
    omitClientId?: boolean;
    tokenlessLegacy?: boolean;
  };

  function buildBookingsSelectSql(input: {
    limit?: number;
    whereClause?: string;
    legacyOrdering?: boolean;
    omitClientId?: boolean;
    tokenlessLegacy?: boolean;
  }): string {
    const limitClause = typeof input.limit === "number" ? `LIMIT ${Math.max(1, Math.trunc(input.limit))}` : "";
    const clientIdSelect = input.omitClientId ? "NULL AS client_id" : "client_id";
    const icalTokenSelect = input.tokenlessLegacy ? "NULL AS ical_token" : "ical_token";
    return [
      `SELECT id, ${clientIdSelect}, service_type, appointment_date, appointment_time, duration_minutes, status, ${icalTokenSelect}`,
      "FROM bookings",
      input.whereClause ?? "",
      input.legacyOrdering ? "ORDER BY appointment_date DESC, appointment_time DESC, id DESC" : "ORDER BY created_at DESC, id DESC",
      limitClause
    ].filter((part) => part.trim() !== "").join(" ");
  }

  function getNextBookingSelectFallback(
    error: unknown,
    current: BookingSelectSqlFallback
  ): BookingSelectSqlFallback | null {
    const message = typeof error === "object"
      && error != null
      && "message" in error
      && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
    const next: BookingSelectSqlFallback = { ...current };

    if (message.includes("created_at")) {
      next.legacyOrdering = true;
    }
    if (message.includes("client_id")) {
      next.omitClientId = true;
    }
    if (message.includes("ical_token")) {
      next.tokenlessLegacy = true;
    }

    if (
      next.legacyOrdering !== current.legacyOrdering
      || next.omitClientId !== current.omitClientId
      || next.tokenlessLegacy !== current.tokenlessLegacy
    ) {
      return next;
    }

    if (!current.legacyOrdering) {
      return { ...current, legacyOrdering: true };
    }
    if (!current.tokenlessLegacy) {
      return { ...current, tokenlessLegacy: true };
    }
    if (!current.omitClientId) {
      return { ...current, omitClientId: true };
    }

    return null;
  }

  async function loadLegacyBookingRows(input: {
    limit?: number;
    whereClause?: string;
    params?: unknown[];
  }): Promise<LegacyBookingRow[]> {
    let fallback: BookingSelectSqlFallback = {};

    while (true) {
      try {
        const [rows] = await executor.execute<Array<LegacyBookingRow>>(
          buildBookingsSelectSql({
            limit: input.limit,
            whereClause: input.whereClause,
            legacyOrdering: fallback.legacyOrdering,
            omitClientId: fallback.omitClientId,
            tokenlessLegacy: fallback.tokenlessLegacy
          }),
          input.params ?? []
        );
        return rows;
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }

        const nextFallback = getNextBookingSelectFallback(error, fallback);
        if (nextFallback == null) {
          throw error;
        }
        fallback = nextFallback;
      }
    }
  }

  function buildInvoicesSelectSql(input: { limit?: number; whereClause?: string; legacy?: boolean; tolerateMissingPayments?: boolean; }): string {
    const limitClause = typeof input.limit === "number" ? `LIMIT ${Math.max(1, Math.trunc(input.limit))}` : "";
    const outstandingSelect = input.legacy
      ? (
          input.tolerateMissingPayments
            ? "COALESCE(i.total_amount, 0) AS outstanding_amount"
            : [
                "GREATEST(",
                "COALESCE(i.total_amount, 0) - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)",
                "+ COALESCE((SELECT SUM(r.amount) FROM invoice_refunds r WHERE r.invoice_id = i.id), 0)",
                ", 0) AS outstanding_amount"
              ].join(" ")
        )
      : "i.outstanding_amount AS outstanding_amount";
    const dueDateSelect = input.legacy ? "i.due_date AS due_at" : "i.due_at AS due_at";
    return [
      `SELECT i.id, i.client_id, i.status, i.total_amount, ${outstandingSelect}, ${dueDateSelect}`,
      "FROM invoices i",
      input.whereClause ?? "",
      "ORDER BY i.id DESC",
      limitClause
    ].filter((part) => part.trim() !== "").join(" ");
  }

  function buildQuotesSelectSql(input: { limit?: number; whereClause?: string; legacy?: boolean; tokenlessLegacy?: boolean; }): string {
    const limitClause = typeof input.limit === "number" ? `LIMIT ${Math.max(1, Math.trunc(input.limit))}` : "";
    return [
      `SELECT q.id, q.client_id, q.status, ${input.legacy ? "q.amount" : "q.total_amount"} AS total_amount, ${input.tokenlessLegacy ? "NULL" : "q.access_token"} AS access_token`,
      "FROM quotes q",
      input.whereClause ?? "",
      "ORDER BY q.id DESC",
      limitClause
    ].filter((part) => part.trim() !== "").join(" ");
  }

  async function loadSettingsByKey(keys: string[]): Promise<Record<string, string>> {
    if (keys.length === 0) {
      return {};
    }

    const placeholders = keys.map(() => "?").join(", ");
    const [rows] = await executor.execute<Array<{
      setting_key: string;
      setting_value: string | null;
    }>>(
      [
        "SELECT setting_key, setting_value",
        "FROM settings",
        `WHERE setting_key IN (${placeholders})`
      ].join(" "),
      keys
    );

    const values = Object.fromEntries(keys.map((key) => [key, ""]));
    for (const row of rows) {
      values[row.setting_key] = row.setting_value ?? "";
    }

    return values;
  }

  async function resolveStripeSecretKey(): Promise<string> {
    const override = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (override !== "") {
      return override;
    }

    const settings = await loadSettingsByKey([
      "stripe_enabled",
      "stripe_mode",
      "stripe_live_secret_key",
      "stripe_test_secret_key"
    ]);
    const stripeEnabled = (settings.stripe_enabled ?? "").trim() === "1";
    const stripeMode = (settings.stripe_mode ?? "test").trim().toLowerCase() === "live" ? "live" : "test";
    const secretKey = stripeMode === "live"
      ? (settings.stripe_live_secret_key ?? "").trim()
      : (settings.stripe_test_secret_key ?? "").trim();

    if (!stripeEnabled || secretKey === "") {
      throw new Error("Stripe checkout is not configured.");
    }

    return secretKey;
  }

  async function resolveStripeWebhookSecret(): Promise<string> {
    const override = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
    if (override !== "") {
      return override;
    }

    const settings = await loadSettingsByKey(["stripe_webhook_secret"]);
    const webhookSecret = (settings.stripe_webhook_secret ?? "").trim();
    if (webhookSecret === "") {
      throw new Error("Stripe webhook secret is not configured.");
    }

    return webhookSecret;
  }

  function verifyStripeWebhookSignature(rawBody: string, signature: string, secret: string): void {
    const parsedSignature = parseStripeSignatureHeader(signature);
    if (parsedSignature == null) {
      throw new Error("Invalid Stripe webhook signature header.");
    }

    const timestampSeconds = Number(parsedSignature.timestamp);
    if (!Number.isFinite(timestampSeconds)) {
      throw new Error("Invalid Stripe webhook signature timestamp.");
    }

    const currentSeconds = Math.floor(Date.parse(now()) / 1000);
    if (Math.abs(currentSeconds - timestampSeconds) > 300) {
      throw new Error("Stripe webhook signature timestamp is outside the allowed tolerance.");
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(`${parsedSignature.timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    if (!parsedSignature.signatures.some((candidate) => secureCompare(expectedSignature, candidate))) {
      throw new Error("Stripe webhook signature verification failed.");
    }
  }

  function toSqlTimestamp(timestamp: string): string {
    return timestamp.slice(0, 19).replace("T", " ");
  }

  function toSqlDate(timestamp: string): string {
    return timestamp.slice(0, 10);
  }

  function buildPackagePurchaseDefaultNote(paymentMethod: "offline" | "credit_card"): string {
    return paymentMethod === "credit_card"
      ? "Self-serve package purchase via Stripe checkout"
      : "Self-serve package purchase via public checkout";
  }

  function buildPackagePurchaseAuditChannel(paymentMethod: "offline" | "credit_card"): string {
    return paymentMethod === "credit_card" ? "Stripe checkout" : "Public checkout";
  }

  function buildPackageInvoiceNotePrefix(clientPackageId: string): string {
    return `Auto-generated for package purchase #${clientPackageId}`;
  }

  function buildPackageInvoiceNote(clientPackageId: string, packageName: string): string {
    const normalizedPackageName = packageName.trim() === "" ? "Package" : packageName.trim();
    return `${buildPackageInvoiceNotePrefix(clientPackageId)} (${normalizedPackageName})`;
  }

  function buildPackageInvoiceDescription(packageItem: Package): string {
    const normalizedName = packageItem.name.trim() === "" ? "Package" : packageItem.name.trim();
    const normalizedDescription = packageItem.description?.trim() ?? "";
    return normalizedDescription === "" ? normalizedName : `${normalizedName} - ${normalizedDescription}`;
  }

  function buildInvoiceNumber(): string {
    const datePart = toSqlDate(now()).replaceAll("-", "");
    return `INV-${datePart}-${randomBytes(4).toString("hex")}`;
  }

  function buildInvoicePayToken(): string {
    return `pay-${randomBytes(8).toString("hex")}`;
  }

  function buildStripeCheckoutPaymentNote(sessionId: string | null | undefined): string {
    const normalizedSessionId = sessionId?.trim() ?? "";
    return normalizedSessionId === ""
      ? "Stripe package checkout"
      : `Stripe Checkout session ${normalizedSessionId}`;
  }

  async function ensurePackagePurchaseInvoice(input: {
    clientId: string;
    clientPackageId: string;
    packageItem: Package;
    paymentMethod: "offline" | "credit_card";
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
  }): Promise<void> {
    const packagePrice = Math.round(Math.max(0, Number(input.packageItem.price ?? 0)) * 100) / 100;
    const purchaseDate = toSqlDate(now());
    const paid = input.paymentMethod === "credit_card" || packagePrice <= 0;
    const invoiceNotePrefix = buildPackageInvoiceNotePrefix(input.clientPackageId);
    const invoiceNote = buildPackageInvoiceNote(input.clientPackageId, input.packageItem.name);

    const [invoiceRows] = await executor.execute<Array<{ id: number }>>(
      [
        "SELECT id",
        "FROM invoices",
        "WHERE client_id = ? AND notes LIKE ?",
        "ORDER BY id DESC",
        "LIMIT 1"
      ].join(" "),
      [input.clientId, `${invoiceNotePrefix}%`]
    );

    let invoiceId = String(invoiceRows[0]?.id ?? "");
    if (invoiceId === "") {
      const [, invoiceResult] = await executor.execute(
        [
          "INSERT INTO invoices (",
          "invoice_number, client_id, issue_date, due_date, subtotal, tax_rate, tax_amount, total_amount, outstanding_amount,",
          "notes, status, pay_token, payment_method, payment_date, stripe_payment_intent_id",
          ") VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          buildInvoiceNumber(),
          input.clientId,
          purchaseDate,
          purchaseDate,
          packagePrice,
          packagePrice,
          paid ? 0 : packagePrice,
          invoiceNote,
          paid ? "paid" : "draft",
          buildInvoicePayToken(),
          paid && packagePrice > 0 ? "credit_card" : null,
          paid && packagePrice > 0 ? purchaseDate : null,
          input.stripePaymentIntentId?.trim() || null
        ]
      );
      invoiceId = String(invoiceResult.insertId ?? 0);
    }

    const [invoiceItemRows] = await executor.execute<Array<{ id: number }>>(
      [
        "SELECT id",
        "FROM invoice_items",
        "WHERE invoice_id = ? AND item_type = 'package' AND reference_id = ?",
        "ORDER BY id DESC",
        "LIMIT 1"
      ].join(" "),
      [invoiceId, input.packageItem.id]
    );

    if (invoiceItemRows[0] == null) {
      await executor.execute(
        [
          "INSERT INTO invoice_items",
          "(invoice_id, item_type, reference_id, description, quantity, rate, amount)",
          "VALUES (?, 'package', ?, ?, 1, ?, ?)"
        ].join(" "),
        [
          invoiceId,
          input.packageItem.id,
          buildPackageInvoiceDescription(input.packageItem),
          packagePrice,
          packagePrice
        ]
      );
    }

    if (paid && packagePrice > 0) {
      const normalizedPaymentIntentId = input.stripePaymentIntentId?.trim() ?? "";
      let paymentExists = false;

      if (normalizedPaymentIntentId !== "") {
        const [paymentRows] = await executor.execute<Array<{ invoice_id: number }>>(
          [
            "SELECT invoice_id",
            "FROM invoice_payments",
            "WHERE stripe_payment_intent_id = ?",
            "LIMIT 1"
          ].join(" "),
          [normalizedPaymentIntentId]
        );
        paymentExists = Number(paymentRows[0]?.invoice_id ?? 0) === Number(invoiceId);
      } else {
        const [paymentRows] = await executor.execute<Array<{ id: number }>>(
          [
            "SELECT id",
            "FROM invoice_payments",
            "WHERE invoice_id = ? AND payment_method = 'credit_card' AND notes = ?",
            "ORDER BY id DESC",
            "LIMIT 1"
          ].join(" "),
          [invoiceId, buildStripeCheckoutPaymentNote(input.stripeCheckoutSessionId)]
        );
        paymentExists = paymentRows[0] != null;
      }

      if (!paymentExists) {
        await executor.execute(
          [
            "INSERT INTO invoice_payments",
            "(invoice_id, amount, payment_date, payment_method, stripe_payment_intent_id, notes)",
            "VALUES (?, ?, ?, 'credit_card', ?, ?)"
          ].join(" "),
          [
            invoiceId,
            packagePrice,
            purchaseDate,
            normalizedPaymentIntentId === "" ? null : normalizedPaymentIntentId,
            buildStripeCheckoutPaymentNote(input.stripeCheckoutSessionId)
          ]
        );
      }

      await executor.execute(
        [
          "UPDATE invoices",
          "SET status = 'paid', outstanding_amount = 0, payment_method = 'credit_card',",
          "payment_date = COALESCE(payment_date, ?),",
          "stripe_payment_intent_id = COALESCE(NULLIF(?, ''), stripe_payment_intent_id),",
          "updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [purchaseDate, normalizedPaymentIntentId, invoiceId]
      );
      return;
    }

    if (paid) {
      await executor.execute(
        "UPDATE invoices SET status = 'paid', outstanding_amount = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [invoiceId]
      );
      return;
    }

    await executor.execute(
      "UPDATE invoices SET outstanding_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [packagePrice, invoiceId]
    );
  }

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
      await executor.execute("START TRANSACTION");
      try {
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
        await applyAppointmentBookingTriggers(booking);
        await executor.execute("COMMIT");
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
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

  const publicPackages: PublicPackagePurchaseDependencies = {
    now,
    async findPublicPackageByToken(token) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
        description: string | null;
        bullet_points: string | null;
        expiration_days: number | null;
        share_token: string | null;
        portal_available: number | null;
        form_template_id: number | null;
      }>>(
        [
          "SELECT id, name, COALESCE(is_active, 1) AS is_active, COALESCE(price, 0) AS price,",
          "description, bullet_points, expiration_days, share_token, portal_available, form_template_id",
          "FROM packages",
          "WHERE share_token = ? AND COALESCE(is_active, 1) = 1",
          "LIMIT 1"
        ].join(" "),
        [token]
      );

      const row = rows[0];
      return row == null ? null : (await mapPackageRows([row]))[0] ?? null;
    },
    async findPublicCheckoutForm(formTemplateId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        description: string | null;
        fields: string | null;
        form_type: string | null;
        required_frequency: string | null;
        appointment_type_id: number | null;
        is_internal: number | null;
        show_in_client_portal: number | null;
        is_active: number | null;
      }>>(
        [
          "SELECT id, name, description, fields, form_type, required_frequency, appointment_type_id,",
          "is_internal, show_in_client_portal, is_active",
          "FROM form_templates",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [formTemplateId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        id: String(row.id),
        name: row.name,
        active: Number(row.is_active ?? 0) === 1,
        description: row.description ?? "",
        fields: parseArrayValue<Record<string, unknown>>(row.fields),
        formType: row.form_type ?? undefined,
        requiredFrequency: row.required_frequency ?? null,
        appointmentTypeId: row.appointment_type_id == null ? null : String(row.appointment_type_id),
        templateIsInternal: row.is_internal == null ? undefined : row.is_internal !== 0,
        templateShowInClientPortal: row.show_in_client_portal == null ? undefined : row.show_in_client_portal !== 0
      };
    },
    async findClientIdByEmail(email) {
      const [rows] = await executor.execute<Array<{ id: number }>>(
        [
          "SELECT id",
          "FROM clients",
          "WHERE LOWER(email) = ? AND COALESCE(is_archived, 0) = 0",
          "ORDER BY updated_at DESC, created_at DESC, id DESC",
          "LIMIT 1"
        ].join(" "),
        [email.trim().toLowerCase()]
      );

      return rows[0] == null ? null : String(rows[0].id);
    },
    async hasSubmittedCheckoutForm(input) {
      const params: unknown[] = [input.clientId, input.templateId];
      const clauses = [
        "SELECT 1",
        "FROM form_submissions fs",
        "LEFT JOIN bookings b ON b.id = fs.booking_id",
        "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
        "WHERE fs.client_id = ? AND fs.template_id = ? AND fs.status = 'submitted'"
      ];

      if (input.appointmentTypeId != null && input.appointmentTypeId.trim() !== "") {
        clauses.push(
          "AND (b.appointment_type_id = ? OR (fs.booking_id IS NULL AND COALESCE(ft.appointment_type_id, 0) = ?))"
        );
        params.push(input.appointmentTypeId, input.appointmentTypeId);
      }

      if (input.submittedAfter != null) {
        clauses.push("AND fs.submitted_at IS NOT NULL AND fs.submitted_at >= ?");
        params.push(input.submittedAfter.slice(0, 19).replace("T", " "));
      }

      clauses.push("LIMIT 1");
      const [rows] = await executor.execute<Array<{ 1: number }>>(clauses.join(" "), params);
      return rows.length > 0;
    },
    async createPublicPackagePaymentSession(input) {
      const session = await stripeClient.createCheckoutSession({
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        customerEmail: input.buyerEmail,
        amountTotal: Math.round(Math.max(0, Number(input.packageItem.price ?? 0)) * 100),
        itemName: input.packageItem.name,
        itemDescription: input.packageItem.description ?? "",
        metadata: {
          public_package_id: input.packageItem.id,
          public_package_token: input.packageItem.shareToken ?? ""
        }
      });

      return {
        sessionId: session.sessionId,
        checkoutUrl: session.checkoutUrl
      };
    },
    async storePendingPublicPackagePurchase(input) {
      await executor.execute(
        [
          "INSERT INTO package_pending_purchases (",
          "package_id, package_token, stripe_checkout_session_id, buyer_name, buyer_email, buyer_phone, notes, form_submission_json, created_at, updated_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
          "ON DUPLICATE KEY UPDATE",
          "package_token = VALUES(package_token),",
          "buyer_name = VALUES(buyer_name),",
          "buyer_email = VALUES(buyer_email),",
          "buyer_phone = VALUES(buyer_phone),",
          "notes = VALUES(notes),",
          "form_submission_json = VALUES(form_submission_json),",
          "updated_at = CURRENT_TIMESTAMP"
        ].join(" "),
        [
          input.packageId,
          input.packageToken,
          input.stripeCheckoutSessionId,
          input.buyerName,
          input.buyerEmail.trim().toLowerCase(),
          input.buyerPhone.trim() === "" ? null : input.buyerPhone.trim(),
          input.notes.trim() === "" ? null : input.notes.trim(),
          JSON.stringify(input.formSubmission ?? null)
        ]
      );
    },
    async findPendingPublicPackagePurchase(packageId, stripeCheckoutSessionId) {
      const [rows] = await executor.execute<Array<{
        package_id: number | string;
        package_token: string;
        stripe_checkout_session_id: string;
        buyer_name: string;
        buyer_email: string;
        buyer_phone: string | null;
        notes: string | null;
        form_submission_json: string | null;
      }>>(
        [
          "SELECT package_id, package_token, stripe_checkout_session_id, buyer_name, buyer_email, buyer_phone, notes, form_submission_json",
          "FROM package_pending_purchases",
          "WHERE package_id = ? AND stripe_checkout_session_id = ?",
          "ORDER BY id DESC",
          "LIMIT 1"
        ].join(" "),
        [packageId, stripeCheckoutSessionId]
      );

      const row = rows[0];
      if (row == null) {
        return null;
      }

      return {
        packageId: String(row.package_id),
        packageToken: row.package_token,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        buyerPhone: row.buyer_phone ?? "",
        notes: row.notes ?? "",
        formSubmission: row.form_submission_json == null || row.form_submission_json.trim() === ""
          ? undefined
          : JSON.parse(row.form_submission_json) as {
            templateId: string;
            responses: Array<string | string[]>;
          }
      };
    },
    async deletePendingPublicPackagePurchase(packageId, stripeCheckoutSessionId) {
      await executor.execute(
        "DELETE FROM package_pending_purchases WHERE package_id = ? AND stripe_checkout_session_id = ?",
        [packageId, stripeCheckoutSessionId]
      );
    },
    async findExistingPublicPackagePurchase(packageId, stripeCheckoutSessionId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
      }>>(
        [
          "SELECT id, client_id",
          "FROM client_packages",
          "WHERE package_id = ? AND stripe_checkout_session_id = ?",
          "ORDER BY id DESC",
          "LIMIT 1"
        ].join(" "),
        [packageId, stripeCheckoutSessionId]
      );

      const row = rows[0];
      return row == null ? null : {
        clientId: String(row.client_id),
        clientPackageId: String(row.id)
      };
    },
    async fetchPublicPackagePaymentSession(stripeCheckoutSessionId) {
      const session = await stripeClient.fetchCheckoutSession(stripeCheckoutSessionId);
      if (session == null) {
        return null;
      }

      return {
        sessionId: session.sessionId,
        paymentStatus: session.paymentStatus,
        amountTotal: session.amountTotal,
        packageId: session.metadata.public_package_id ?? null,
        packageToken: session.metadata.public_package_token ?? null,
        paymentIntentId: session.paymentIntentId
      };
    },
    async finalizePublicPackagePurchase(input) {
      const buyerName = input.buyerName.trim();
      const buyerEmail = input.buyerEmail.trim().toLowerCase();
      const buyerPhone = input.buyerPhone.trim();
      const notes = input.notes.trim();
      const paymentMethod = input.paymentMethod ?? "offline";
      const stripeCheckoutSessionId = input.stripeCheckoutSessionId?.trim() ?? "";
      const stripePaymentIntentId = input.stripePaymentIntentId?.trim() ?? "";

      if (buyerName === "" || buyerEmail === "") {
        throw new Error("Buyer name and email are required.");
      }

      for (const item of input.packageItem.items ?? []) {
        if (item.appointmentTypeId == null || item.appointmentTypeId.trim() === "") {
          throw new Error(`Package ${input.packageItem.id} is missing an appointment type for one or more credit items.`);
        }
      }

      if (stripeCheckoutSessionId !== "") {
        const [existingPurchaseRows] = await executor.execute<Array<{
          id: number;
          client_id: number;
        }>>(
          [
            "SELECT id, client_id",
            "FROM client_packages",
            "WHERE stripe_checkout_session_id = ? AND package_id = ?",
            "ORDER BY id DESC",
            "LIMIT 1"
          ].join(" "),
          [stripeCheckoutSessionId, input.packageItem.id]
        );

        const existingPurchase = existingPurchaseRows[0];
        if (existingPurchase != null) {
          return {
            clientId: String(existingPurchase.client_id),
            clientPackageId: String(existingPurchase.id)
          };
        }
      }

      await executor.execute("START TRANSACTION");
      try {
        const [clientRows] = await executor.execute<Array<{
          id: number;
          name: string | null;
          phone: string | null;
        }>>(
          [
            "SELECT id, name, phone",
            "FROM clients",
            "WHERE LOWER(email) = ? AND COALESCE(is_archived, 0) = 0",
            "ORDER BY updated_at DESC, created_at DESC, id DESC",
            "LIMIT 1"
          ].join(" "),
          [buyerEmail]
        );

        const existingClient = clientRows[0];
        let clientId: string;
        if (existingClient != null) {
          clientId = String(existingClient.id);
          const nextName = (existingClient.name ?? "").trim() === "" ? buyerName : (existingClient.name ?? buyerName);
          const nextPhone = (existingClient.phone ?? "").trim() === "" && buyerPhone !== ""
            ? buyerPhone
            : existingClient.phone;
          await executor.execute(
            "UPDATE clients SET name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [nextName, nextPhone, clientId]
          );
        } else {
          const [, clientResult] = await executor.execute(
            [
              "INSERT INTO clients (name, email, phone, created_at, updated_at)",
              "VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ].join(" "),
            [buyerName, buyerEmail, buyerPhone === "" ? null : buyerPhone]
          );
          clientId = String(clientResult.insertId ?? 0);
        }

        let expiresAt: string | null = null;
        if (input.packageItem.expirationDays != null && input.packageItem.expirationDays > 0) {
          const expirationDate = new Date(now());
          expirationDate.setUTCDate(expirationDate.getUTCDate() + input.packageItem.expirationDays);
          expiresAt = expirationDate.toISOString().slice(0, 19).replace("T", " ");
        }

        const [, purchaseResult] = await executor.execute(
          [
            "INSERT INTO client_packages",
            "(client_id, package_id, package_name, expires_at, is_active, notes, created_by, payment_method, stripe_checkout_session_id)",
            "VALUES (?, ?, ?, ?, 1, ?, NULL, ?, ?)"
          ].join(" "),
          [
            clientId,
            input.packageItem.id,
            input.packageItem.name,
            expiresAt,
            notes === "" ? buildPackagePurchaseDefaultNote(paymentMethod) : notes,
            paymentMethod,
            stripeCheckoutSessionId === "" ? null : stripeCheckoutSessionId
          ]
        );

        const clientPackageId = String(purchaseResult.insertId ?? 0);
        for (const item of input.packageItem.items ?? []) {
          await executor.execute(
            [
              "INSERT INTO client_package_credits",
              "(client_package_id, client_id, appointment_type_id, total_credits, used_credits)",
              "VALUES (?, ?, ?, ?, 0)"
            ].join(" "),
            [clientPackageId, clientId, item.appointmentTypeId, item.quantity]
          );
        }

        const [creditRows] = await executor.execute<Array<{
          id: number;
          appointment_type_id: number;
          total_credits: number;
        }>>(
          [
            "SELECT id, appointment_type_id, total_credits",
            "FROM client_package_credits",
            "WHERE client_package_id = ?",
            "ORDER BY id ASC"
          ].join(" "),
          [clientPackageId]
        );

        for (const creditRow of creditRows) {
          await executor.execute(
            [
              "INSERT INTO package_credit_transactions",
              "(client_package_credit_id, client_id, appointment_type_id, transaction_type, amount, notes, created_by)",
              "VALUES (?, ?, ?, 'purchase', ?, ?, NULL)"
            ].join(" "),
            [
              creditRow.id,
              clientId,
              creditRow.appointment_type_id,
              creditRow.total_credits,
              `Package '${input.packageItem.name}' purchased via ${buildPackagePurchaseAuditChannel(paymentMethod)}`
            ]
          );
        }

        if (input.formSubmission != null) {
          await executor.execute(
            [
              "INSERT INTO form_submissions",
              "(client_id, template_id, responses, status, submitted_at)",
              "VALUES (?, ?, ?, 'submitted', CURRENT_TIMESTAMP)"
            ].join(" "),
            [
              clientId,
              input.formSubmission.templateId,
              JSON.stringify(input.formSubmission.responses)
            ]
          );
          await applyFormSubmissionTriggers({
            clientId,
            templateId: input.formSubmission.templateId
          });
        }

        await ensurePackagePurchaseInvoice({
          clientId,
          clientPackageId,
          packageItem: input.packageItem,
          paymentMethod,
          stripeCheckoutSessionId: stripeCheckoutSessionId === "" ? null : stripeCheckoutSessionId,
          stripePaymentIntentId: stripePaymentIntentId === "" ? null : stripePaymentIntentId
        });

        await executor.execute("COMMIT");
        return {
          clientId,
          clientPackageId
        };
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    }
  };

  const publicContact: PublicContactDependencies = {
    now,
    verifyCaptcha: captchaVerifier,
    async findLatestClientByEmail(email) {
      const [rows] = await executor.execute<Array<{ id: number; notes: string | null }>>(
        [
          "SELECT id, notes",
          "FROM clients",
          "WHERE email = ?",
          "ORDER BY updated_at DESC, created_at DESC, id DESC",
          "LIMIT 1"
        ].join(" "),
        [email]
      );

      const row = rows[0];
      return row == null ? null : {
        clientId: String(row.id),
        notes: row.notes ?? ""
      };
    },
    async updateClientNotes(clientId, notes) {
      await executor.execute(
        [
          "UPDATE clients",
          "SET notes = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [notes, clientId]
      );
    },
    async createClientLead(input) {
      const [, result] = await executor.execute(
        [
          "INSERT INTO clients (name, email, phone, notes, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ].join(" "),
        [input.name, input.email, input.phone, input.notes]
      );

      return {
        clientId: String(result.insertId ?? 0)
      };
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
    async normalizeStripeCallbackPayload({ payload, rawBody, signature }) {
      const eventType = typeof payload.type === "string" ? payload.type.trim() : "";
      const eventObject = typeof payload.object === "string" ? payload.object.trim() : "";
      if (eventType === "" || eventObject !== "event") {
        return null;
      }

      if (rawBody == null || rawBody.trim() === "") {
        throw new Error("Raw Stripe webhook payload is required.");
      }
      if (signature == null || signature.trim() === "") {
        throw new Error("Stripe webhook signature is required.");
      }

      verifyStripeWebhookSignature(rawBody, signature, await resolveStripeWebhookSecret());

      const data = typeof payload.data === "object" && payload.data != null && !Array.isArray(payload.data)
        ? payload.data as Record<string, unknown>
        : {};
      const eventPayload = typeof data.object === "object" && data.object != null && !Array.isArray(data.object)
        ? data.object as Record<string, unknown>
        : {};
      const metadata = typeof eventPayload.metadata === "object" && eventPayload.metadata != null && !Array.isArray(eventPayload.metadata)
        ? eventPayload.metadata as Record<string, unknown>
        : {};
      const invoiceId = typeof metadata.invoice_id === "string" ? metadata.invoice_id.trim() : "";
      const paymentStatus = typeof eventPayload.payment_status === "string" ? eventPayload.payment_status.trim() : "";

      if (
        (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded")
        && invoiceId !== ""
        && paymentStatus === "paid"
      ) {
        return {
          kind: "invoice_update" as const,
          invoiceId,
          paymentStatus: "paid" as const,
          outstandingAmount: 0
        };
      }

      return {
        kind: "ignored" as const,
        reason: `Unhandled Stripe event: ${eventType || "unknown"}`
      };
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
      const rows = await loadLegacyAdminUserRows({
        whereField: "username",
        params: [username],
        includePasswordHash: true
      });

      const user = rows[0];
      if (user == null || user.password_hash == null || user.username == null) {
        return null;
      }

      const accountTypeValue = user.account_type?.trim().toLowerCase() ?? "standard";
      return {
        actorId: String(user.id),
        source: "admin_user",
        username: user.username,
        displayName: user.username,
        passwordHash: user.password_hash,
        role: accountTypeValue === "accountant" ? "accountant" : "admin"
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
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/admin",
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
      const adminRows = await loadLegacyAdminUserRows({
        whereField: "id",
        params: [actorId]
      });

      const adminUser = adminRows[0];
      if (adminUser != null) {
        const username = adminUser.username?.trim() || adminUser.email?.trim() || `admin-${String(adminUser.id)}`;
        const accountTypeValue = adminUser.account_type?.trim().toLowerCase() ?? "standard";
        return {
          actorId: String(adminUser.id),
          source: "admin_user",
          username,
          displayName: username,
          role: accountTypeValue === "accountant" ? "accountant" : "admin",
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

    return rows.map((row) => toInvoiceRecord(row));
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
        "AND status IN ('draft', 'sent', 'viewed', 'expired')",
          "ORDER BY id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

    return rows.map((row) => toQuoteRecord(row));
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
      const rows = await loadLegacyBookingRows({ limit: 5 });
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

  async function persistAppointmentTypeFormLinks(appointmentTypeId: string, formTemplateIds: string[]): Promise<void> {
    await executor.execute(
        "DELETE FROM appointment_type_forms WHERE appointment_type_id = ?",
      [appointmentTypeId]
    );

    for (const formTemplateId of formTemplateIds) {
      await executor.execute(
        "INSERT INTO appointment_type_forms (appointment_type_id, form_template_id) VALUES (?, ?)",
        [appointmentTypeId, formTemplateId]
      );
    }
  }

  const adminConfiguration: AdminConfigurationDependencies = {
    async listAdminAppointmentTypes() {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        description: string | null;
        bullet_points: string | null;
        admin_user_id: number | null;
        duration_minutes: number | null;
        buffer_before_minutes: number | null;
        buffer_after_minutes: number | null;
        use_travel_time_buffer: number | null;
        travel_time_minutes: number | null;
        advance_booking_min_days: number | null;
        advance_booking_max_days: number | null;
        cancellation_notice_hours: number | null;
        requires_forms: number | null;
        form_template_ids: string | null;
        requires_contract: number | null;
        contract_template_id: number | null;
        auto_invoice: number | null;
        invoice_due_days: number | null;
        invoice_due_timing: string | null;
        default_amount: number | null;
        consumes_credits: number | null;
        credit_count: number | null;
        is_group_class: number | null;
        max_participants: number | null;
        is_active: number | null;
        public_available: number | null;
        portal_available: number | null;
        schedule_type: string | null;
        specific_date: string | null;
        specific_dates: string | null;
        available_days: string | null;
        available_start_time: string | null;
        available_end_time: string | null;
        time_slot_interval: number | null;
        is_mini_session: number | null;
        mini_session_location: string | null;
        mini_session_topic: string | null;
        is_field_rental: number | null;
        field_rental_location: string | null;
        group_class_location: string | null;
        per_day_schedule: string | null;
        location_types: string | null;
        confirmation_template_id: number | null;
        booking_request_template_id: number | null;
        invoice_template_id: number | null;
        reminder_template_id: number | null;
        cancellation_template_id: number | null;
        requires_admin_confirmation: number | null;
        uses_resource: number | null;
        resource_name: string | null;
        resource_capacity: number | null;
        resource_allocation: string | null;
        unique_link: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>>(
        [
          "SELECT id, name, description, bullet_points, admin_user_id, duration_minutes, buffer_before_minutes,",
          "buffer_after_minutes, use_travel_time_buffer, travel_time_minutes, advance_booking_min_days,",
          "advance_booking_max_days, cancellation_notice_hours, requires_forms,",
          "COALESCE((SELECT GROUP_CONCAT(form_template_id ORDER BY form_template_id SEPARATOR ',') FROM appointment_type_forms atf WHERE atf.appointment_type_id = appointment_types.id), '') AS form_template_ids,",
          "requires_contract, contract_template_id, auto_invoice, invoice_due_days, invoice_due_timing,",
          "default_amount, consumes_credits, credit_count, is_group_class, max_participants,",
          "is_active, public_available, portal_available, schedule_type, specific_date, specific_dates,",
          "available_days, available_start_time, available_end_time, time_slot_interval, is_mini_session,",
          "mini_session_location, mini_session_topic, is_field_rental, field_rental_location, group_class_location,",
          "per_day_schedule, location_types, confirmation_template_id, booking_request_template_id,",
          "invoice_template_id, reminder_template_id, cancellation_template_id, requires_admin_confirmation,",
          "uses_resource, resource_name, resource_capacity, resource_allocation, unique_link, created_at, updated_at",
          "FROM appointment_types",
          "ORDER BY is_active DESC, name ASC"
        ].join(" ")
      );

      return rows.map((row) => toAppointmentTypeRecord(row));
    },
    async findAdminAppointmentTypeById(appointmentTypeId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        description: string | null;
        bullet_points: string | null;
        admin_user_id: number | null;
        duration_minutes: number | null;
        buffer_before_minutes: number | null;
        buffer_after_minutes: number | null;
        use_travel_time_buffer: number | null;
        travel_time_minutes: number | null;
        advance_booking_min_days: number | null;
        advance_booking_max_days: number | null;
        cancellation_notice_hours: number | null;
        requires_forms: number | null;
        form_template_ids: string | null;
        requires_contract: number | null;
        contract_template_id: number | null;
        auto_invoice: number | null;
        invoice_due_days: number | null;
        invoice_due_timing: string | null;
        default_amount: number | null;
        consumes_credits: number | null;
        credit_count: number | null;
        is_group_class: number | null;
        max_participants: number | null;
        is_active: number | null;
        public_available: number | null;
        portal_available: number | null;
        schedule_type: string | null;
        specific_date: string | null;
        specific_dates: string | null;
        available_days: string | null;
        available_start_time: string | null;
        available_end_time: string | null;
        time_slot_interval: number | null;
        is_mini_session: number | null;
        mini_session_location: string | null;
        mini_session_topic: string | null;
        is_field_rental: number | null;
        field_rental_location: string | null;
        group_class_location: string | null;
        per_day_schedule: string | null;
        location_types: string | null;
        confirmation_template_id: number | null;
        booking_request_template_id: number | null;
        invoice_template_id: number | null;
        reminder_template_id: number | null;
        cancellation_template_id: number | null;
        requires_admin_confirmation: number | null;
        uses_resource: number | null;
        resource_name: string | null;
        resource_capacity: number | null;
        resource_allocation: string | null;
        unique_link: string | null;
        created_at: string | null;
        updated_at: string | null;
      }>>(
        [
          "SELECT id, name, description, bullet_points, admin_user_id, duration_minutes, buffer_before_minutes,",
          "buffer_after_minutes, use_travel_time_buffer, travel_time_minutes, advance_booking_min_days,",
          "advance_booking_max_days, cancellation_notice_hours, requires_forms,",
          "COALESCE((SELECT GROUP_CONCAT(form_template_id ORDER BY form_template_id SEPARATOR ',') FROM appointment_type_forms atf WHERE atf.appointment_type_id = appointment_types.id), '') AS form_template_ids,",
          "requires_contract, contract_template_id, auto_invoice, invoice_due_days, invoice_due_timing,",
          "default_amount, consumes_credits, credit_count, is_group_class, max_participants,",
          "is_active, public_available, portal_available, schedule_type, specific_date, specific_dates,",
          "available_days, available_start_time, available_end_time, time_slot_interval, is_mini_session,",
          "mini_session_location, mini_session_topic, is_field_rental, field_rental_location, group_class_location,",
          "per_day_schedule, location_types, confirmation_template_id, booking_request_template_id,",
          "invoice_template_id, reminder_template_id, cancellation_template_id, requires_admin_confirmation,",
          "uses_resource, resource_name, resource_capacity, resource_allocation, unique_link, created_at, updated_at",
          "FROM appointment_types",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [appointmentTypeId]
      );

      const row = rows[0];
      return row == null ? null : toAppointmentTypeRecord(row);
    },
    async createAdminAppointmentType(_adminUserId, input) {
      const createdAt = now();
      const [, result] = await executor.execute(
        [
          "INSERT INTO appointment_types",
          "(",
          "name, description, bullet_points, admin_user_id, duration_minutes, buffer_before_minutes, buffer_after_minutes,",
          "use_travel_time_buffer, travel_time_minutes, advance_booking_min_days, advance_booking_max_days, cancellation_notice_hours,",
          "requires_forms, requires_contract, contract_template_id, auto_invoice, invoice_due_days, invoice_due_timing, default_amount,",
          "consumes_credits, credit_count, is_group_class, max_participants, is_active, public_available, portal_available, schedule_type,",
          "specific_date, specific_dates, available_days, available_start_time, available_end_time, time_slot_interval, is_mini_session,",
          "mini_session_location, mini_session_topic, is_field_rental, field_rental_location, group_class_location, per_day_schedule,",
          "location_types, confirmation_template_id, booking_request_template_id, invoice_template_id, reminder_template_id,",
          "cancellation_template_id, requires_admin_confirmation, uses_resource, resource_name, resource_capacity, resource_allocation,",
          "unique_link, created_at, updated_at",
          ") VALUES (",
          "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
          ")"
        ].join(" "),
        [
          input.name,
          input.description,
          input.bulletPoints.join("\n"),
          input.adminUserId,
          input.durationMinutes,
          input.bufferBeforeMinutes,
          input.bufferAfterMinutes,
          input.useTravelTimeBuffer ? 1 : 0,
          input.travelTimeMinutes,
          input.advanceBookingMinDays,
          input.advanceBookingMaxDays,
          input.cancellationNoticeHours,
          input.requiresForms ? 1 : 0,
          input.requiresContract ? 1 : 0,
          input.contractTemplateId,
          input.autoInvoice ? 1 : 0,
          input.invoiceDueDays,
          input.invoiceDueTiming,
          input.defaultAmount,
          input.consumesCredits ? 1 : 0,
          input.creditCount,
          input.isGroupClass ? 1 : 0,
          input.maxParticipants,
          input.active ? 1 : 0,
          input.publicAvailable ? 1 : 0,
          input.portalAvailable ? 1 : 0,
          input.scheduleType,
          input.specificDate,
          JSON.stringify(input.specificDates),
          JSON.stringify(input.availableDays),
          input.availableStartTime,
          input.availableEndTime,
          input.timeSlotInterval,
          input.isMiniSession ? 1 : 0,
          input.miniSessionLocation,
          input.miniSessionTopic,
          input.isFieldRental ? 1 : 0,
          input.fieldRentalLocation,
          input.groupClassLocation,
          JSON.stringify(input.perDaySchedule),
          JSON.stringify(input.locationTypes),
          input.confirmationTemplateId,
          input.bookingRequestTemplateId,
          input.invoiceTemplateId,
          input.reminderTemplateId,
          input.cancellationTemplateId,
          input.requiresAdminConfirmation ? 1 : 0,
          input.usesResource ? 1 : 0,
          input.resourceName,
          input.resourceCapacity,
          input.resourceAllocation,
          input.uniqueLink,
          createdAt,
          createdAt
        ]
      );

      const appointmentTypeId = String(result.insertId ?? `appointment-type-${randomUUID()}`);
      await persistAppointmentTypeFormLinks(appointmentTypeId, input.formTemplateIds);

      return {
        id: appointmentTypeId,
        ...input,
        createdAt,
        updatedAt: createdAt
      };
    },
    async updateAdminAppointmentType(appointmentTypeId, _adminUserId, input) {
      const updatedAt = now();
      const [, result] = await executor.execute(
        [
          "UPDATE appointment_types SET",
          "name = ?, description = ?, bullet_points = ?, admin_user_id = ?, duration_minutes = ?, buffer_before_minutes = ?, buffer_after_minutes = ?,",
          "use_travel_time_buffer = ?, travel_time_minutes = ?, advance_booking_min_days = ?, advance_booking_max_days = ?, cancellation_notice_hours = ?,",
          "requires_forms = ?, requires_contract = ?, contract_template_id = ?, auto_invoice = ?, invoice_due_days = ?, invoice_due_timing = ?, default_amount = ?,",
          "consumes_credits = ?, credit_count = ?, is_group_class = ?, max_participants = ?, is_active = ?, public_available = ?, portal_available = ?, schedule_type = ?,",
          "specific_date = ?, specific_dates = ?, available_days = ?, available_start_time = ?, available_end_time = ?, time_slot_interval = ?, is_mini_session = ?,",
          "mini_session_location = ?, mini_session_topic = ?, is_field_rental = ?, field_rental_location = ?, group_class_location = ?, per_day_schedule = ?,",
          "location_types = ?, confirmation_template_id = ?, booking_request_template_id = ?, invoice_template_id = ?, reminder_template_id = ?,",
          "cancellation_template_id = ?, requires_admin_confirmation = ?, uses_resource = ?, resource_name = ?, resource_capacity = ?, resource_allocation = ?,",
          "unique_link = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [
          input.name,
          input.description,
          input.bulletPoints.join("\n"),
          input.adminUserId,
          input.durationMinutes,
          input.bufferBeforeMinutes,
          input.bufferAfterMinutes,
          input.useTravelTimeBuffer ? 1 : 0,
          input.travelTimeMinutes,
          input.advanceBookingMinDays,
          input.advanceBookingMaxDays,
          input.cancellationNoticeHours,
          input.requiresForms ? 1 : 0,
          input.requiresContract ? 1 : 0,
          input.contractTemplateId,
          input.autoInvoice ? 1 : 0,
          input.invoiceDueDays,
          input.invoiceDueTiming,
          input.defaultAmount,
          input.consumesCredits ? 1 : 0,
          input.creditCount,
          input.isGroupClass ? 1 : 0,
          input.maxParticipants,
          input.active ? 1 : 0,
          input.publicAvailable ? 1 : 0,
          input.portalAvailable ? 1 : 0,
          input.scheduleType,
          input.specificDate,
          JSON.stringify(input.specificDates),
          JSON.stringify(input.availableDays),
          input.availableStartTime,
          input.availableEndTime,
          input.timeSlotInterval,
          input.isMiniSession ? 1 : 0,
          input.miniSessionLocation,
          input.miniSessionTopic,
          input.isFieldRental ? 1 : 0,
          input.fieldRentalLocation,
          input.groupClassLocation,
          JSON.stringify(input.perDaySchedule),
          JSON.stringify(input.locationTypes),
          input.confirmationTemplateId,
          input.bookingRequestTemplateId,
          input.invoiceTemplateId,
          input.reminderTemplateId,
          input.cancellationTemplateId,
          input.requiresAdminConfirmation ? 1 : 0,
          input.usesResource ? 1 : 0,
          input.resourceName,
          input.resourceCapacity,
          input.resourceAllocation,
          input.uniqueLink,
          appointmentTypeId
        ]
      );

      if (Number(result.affectedRows ?? 0) < 1) {
        return null;
      }

      await persistAppointmentTypeFormLinks(appointmentTypeId, input.formTemplateIds);

      return {
        id: appointmentTypeId,
        ...input,
        createdAt: null,
        updatedAt
      };
    },
    async deleteAdminAppointmentType(appointmentTypeId) {
      await executor.execute(
        "DELETE FROM appointment_type_forms WHERE appointment_type_id = ?",
        [appointmentTypeId]
      );
      const [, result] = await executor.execute(
        "DELETE FROM appointment_types WHERE id = ?",
        [appointmentTypeId]
      );

      return Number(result.affectedRows ?? 0) > 0;
    },
    async listAdminFormTemplates() {
      const [rows] = await executor.execute<FormTemplateRow[]>(
        [
          "SELECT id, name, description, fields, form_type, required_frequency, appointment_type_id,",
          "is_internal, show_in_client_portal, COALESCE(is_active, 1) AS is_active",
          "FROM form_templates",
          "ORDER BY COALESCE(is_active, 1) DESC, created_at DESC, id DESC"
        ].join(" ")
      );

      return rows.map((row) => mapFormTemplateRow(row));
    },
    async findAdminFormTemplateById(templateId) {
      const [rows] = await executor.execute<FormTemplateRow[]>(
        [
          "SELECT id, name, description, fields, form_type, required_frequency, appointment_type_id,",
          "is_internal, show_in_client_portal, COALESCE(is_active, 1) AS is_active",
          "FROM form_templates",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [templateId]
      );

      const row = rows[0];
      return row == null ? null : mapFormTemplateRow(row);
    },
    async createAdminFormTemplate(_adminUserId, input) {
      const createdAt = now();
      const [, result] = await executor.execute(
        [
          "INSERT INTO form_templates",
          "(name, description, fields, form_type, required_frequency, appointment_type_id, is_internal, show_in_client_portal, is_active, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          input.name,
          input.description,
          JSON.stringify(input.fields ?? []),
          input.formType,
          input.requiredFrequency,
          input.appointmentTypeId,
          input.templateIsInternal == null ? null : (input.templateIsInternal ? 1 : 0),
          input.templateShowInClientPortal == null ? null : (input.templateShowInClientPortal ? 1 : 0),
          input.active ? 1 : 0,
          createdAt,
          createdAt
        ]
      );

      const createdId = String(result.insertId ?? "");
      const created = createdId === "" ? null : await adminConfiguration.findAdminFormTemplateById(createdId);
      if (created == null) {
        throw new Error("Failed to load newly created form template.");
      }

      return created;
    },
    async updateAdminFormTemplate(templateId, _adminUserId, input) {
      const updatedAt = now();
      const [, result] = await executor.execute(
        [
          "UPDATE form_templates",
          "SET name = ?, description = ?, fields = ?, form_type = ?, required_frequency = ?, appointment_type_id = ?,",
          "is_internal = ?, show_in_client_portal = ?, is_active = ?, updated_at = ?",
          "WHERE id = ?"
        ].join(" "),
        [
          input.name,
          input.description,
          JSON.stringify(input.fields ?? []),
          input.formType,
          input.requiredFrequency,
          input.appointmentTypeId,
          input.templateIsInternal == null ? null : (input.templateIsInternal ? 1 : 0),
          input.templateShowInClientPortal == null ? null : (input.templateShowInClientPortal ? 1 : 0),
          input.active ? 1 : 0,
          updatedAt,
          templateId
        ]
      );

      if (Number(result.affectedRows ?? 0) < 1) {
        return null;
      }

      return adminConfiguration.findAdminFormTemplateById(templateId);
    },
    async countAdminFormTemplateSubmissions(templateId) {
      const [rows] = await executor.execute<Array<{ submission_count: number }>>(
        [
          "SELECT COUNT(*) AS submission_count",
          "FROM form_submissions",
          "WHERE template_id = ?"
        ].join(" "),
        [templateId]
      );

      return Number(rows[0]?.submission_count ?? 0);
    },
    async deleteAdminFormTemplate(templateId) {
      await executor.execute("START TRANSACTION");

      try {
        await executor.execute(
        "DELETE FROM appointment_type_forms WHERE form_template_id = ?",
          [templateId]
        );
        await executor.execute(
        "DELETE FROM workflow_triggers WHERE form_template_id = ?",
          [templateId]
        );
        const [, result] = await executor.execute(
        "DELETE FROM form_templates WHERE id = ?",
          [templateId]
        );

        await executor.execute("COMMIT");
        return Number(result.affectedRows ?? 0) > 0;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // Ignore rollback failures and surface the original error.
        }
        throw error;
      }
    },
    async listAdminEmailTemplates() {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        template_type: string;
        subject: string;
        body_html: string | null;
        body_text: string | null;
        is_active: number;
        created_at: string | null;
        updated_at: string | null;
      }>>(
        [
          "SELECT id, name, template_type, subject, body_html, body_text, is_active, created_at, updated_at",
          "FROM email_templates",
          "ORDER BY name ASC"
        ].join(" ")
      );

      return rows.map((row) => toEmailTemplateRecord(row));
    },
    async findAdminEmailTemplateById(templateId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        template_type: string;
        subject: string;
        body_html: string | null;
        body_text: string | null;
        is_active: number;
        created_at: string | null;
        updated_at: string | null;
      }>>(
        [
          "SELECT id, name, template_type, subject, body_html, body_text, is_active, created_at, updated_at",
          "FROM email_templates",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [templateId]
      );

      const row = rows[0];
      return row == null ? null : toEmailTemplateRecord(row);
    },
    async createAdminEmailTemplate(_adminUserId, input) {
      const createdAt = now();
      const [, result] = await executor.execute(
        [
          "INSERT INTO email_templates",
          "(name, template_type, subject, body_html, body_text, variables, is_active, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          input.name,
          input.templateType,
          input.subject,
          input.bodyHtml,
          input.bodyText,
          "",
          input.active ? 1 : 0,
          createdAt,
          createdAt
        ]
      );

      return {
        id: String(result.insertId ?? `email-template-${randomUUID()}`),
        name: input.name,
        templateType: input.templateType,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        active: input.active,
        createdAt,
        updatedAt: createdAt
      };
    },
    async updateAdminEmailTemplate(templateId, _adminUserId, input) {
      const updatedAt = now();
      const [, result] = await executor.execute(
        [
          "UPDATE email_templates SET",
          "name = ?, template_type = ?, subject = ?, body_html = ?, body_text = ?, variables = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [
          input.name,
          input.templateType,
          input.subject,
          input.bodyHtml,
          input.bodyText,
          "",
          input.active ? 1 : 0,
          templateId
        ]
      );

      if (Number(result.affectedRows ?? 0) < 1) {
        return null;
      }

      return {
        id: templateId,
        name: input.name,
        templateType: input.templateType,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        active: input.active,
        createdAt: null,
        updatedAt
      };
    },
    async listAdminScheduledTasks() {
      const [rows] = await executor.execute<Array<{
        id: number;
        task_name: string;
        task_type: string;
        schedule_type: string;
        schedule_value: string | null;
        is_active: number;
        last_run: string | null;
        next_run: string | null;
      }>>(
        [
          "SELECT id, task_name, task_type, schedule_type, schedule_value, is_active, last_run, next_run",
          "FROM scheduled_tasks",
          "ORDER BY is_active DESC, task_name ASC"
        ].join(" ")
      );

      return rows.map((row) => toScheduledTaskRecord(row));
    },
    async findAdminScheduledTaskById(taskId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        task_name: string;
        task_type: string;
        schedule_type: string;
        schedule_value: string | null;
        is_active: number;
        last_run: string | null;
        next_run: string | null;
      }>>(
        [
          "SELECT id, task_name, task_type, schedule_type, schedule_value, is_active, last_run, next_run",
          "FROM scheduled_tasks",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [taskId]
      );

      const row = rows[0];
      return row == null ? null : toScheduledTaskRecord(row);
    },
    async createAdminScheduledTask(_adminUserId, input) {
      const [, result] = await executor.execute(
        [
          "INSERT INTO scheduled_tasks",
          "(task_name, task_type, schedule_type, schedule_value, is_active)",
          "VALUES (?, ?, ?, ?, ?)"
        ].join(" "),
        [
          input.name,
          input.taskType,
          input.scheduleType,
          input.scheduleValue,
          input.active ? 1 : 0
        ]
      );

      return {
        id: String(result.insertId ?? `scheduled-task-${randomUUID()}`),
        name: input.name,
        taskType: input.taskType,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        active: input.active,
        lastRunAt: null,
        nextRunAt: null
      };
    },
    async updateAdminScheduledTask(taskId, _adminUserId, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE scheduled_tasks SET",
          "task_name = ?, task_type = ?, schedule_type = ?, schedule_value = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP",
          "WHERE id = ?"
        ].join(" "),
        [
          input.name,
          input.taskType,
          input.scheduleType,
          input.scheduleValue,
          input.active ? 1 : 0,
          taskId
        ]
      );

      if (Number(result.affectedRows ?? 0) < 1) {
        return null;
      }

      return {
        id: taskId,
        name: input.name,
        taskType: input.taskType,
        scheduleType: input.scheduleType,
        scheduleValue: input.scheduleValue,
        active: input.active,
        lastRunAt: null,
        nextRunAt: null
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
    async deleteAdminBlogPost(postId) {
      const [, result] = await executor.execute(
        "DELETE FROM blog_posts WHERE id = ?",
        [postId]
      );

      return Number(result.affectedRows ?? 0) > 0;
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
    async deleteAdminSitePage(pageId) {
      const [, result] = await executor.execute(
        "DELETE FROM site_pages WHERE id = ?",
        [pageId]
      );

      return Number(result.affectedRows ?? 0) > 0;
    },
    async listAdminSettings() {
      const rows = await loadLegacySettingRows({});
      return rows.map(toSettingRecord);
    },
    async findAdminSettingByKey(key) {
      const rows = await loadLegacySettingRows({
        whereClause: "WHERE setting_key = ?",
        params: [key]
      });
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
    },
    async findAdminSettingsUserByActorId(actorId) {
      const rows = await loadLegacyAdminUserRows({
        whereField: "id",
        params: [actorId]
      });
      const row = rows[0];
      return row == null ? null : toAdminSettingsUserRecord(row);
    },
    async listAdminSettingsUsers() {
      const rows = await loadLegacyAdminUserRows({
        forSettingsList: true
      });
      return rows.map(toAdminSettingsUserRecord);
    },
    async findAdminSettingsUserByUsername(username) {
      const rows = await loadLegacyAdminUserRows({
        whereField: "username",
        params: [username]
      });
      const row = rows[0];
      return row == null ? null : toAdminSettingsUserRecord(row);
    },
    async createAdminSettingsUser(input) {
      const passwordHash = await hash(input.password, 10);
      const [, result] = await executor.execute(
        [
          "INSERT INTO admin_users (username, password_hash, email, account_type, can_manage_admin_users, can_manage_api_keys)",
          "VALUES (?, ?, ?, ?, 0, 0)"
        ].join(" "),
        [input.username, passwordHash, input.email, input.accountType]
      );

      return (await content.findAdminSettingsUserByActorId(String(result.insertId ?? 0))) ?? {
        actorId: String(result.insertId ?? 0),
        username: input.username,
        email: input.email,
        accountType: input.accountType,
        role: input.accountType === "accountant" ? "accountant" : "admin",
        isMainAccount: false,
        canManageAdminUsers: false,
        canManageApiKeys: false,
        active: true
      };
    },
    async updateAdminSettingsUserPermissions(actorId, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE admin_users",
          "SET can_manage_admin_users = ?, can_manage_api_keys = ?",
          "WHERE id = ?"
        ].join(" "),
        [input.canManageAdminUsers ? 1 : 0, input.canManageApiKeys ? 1 : 0, actorId]
      );

      if (Number(result.affectedRows ?? 0) === 0) {
        return null;
      }

      return content.findAdminSettingsUserByActorId(actorId);
    },
    async deleteAdminSettingsUser(actorId) {
      await executor.execute("START TRANSACTION");
      try {
        await executor.execute(
          "UPDATE appointment_types SET admin_user_id = NULL WHERE admin_user_id = ?",
          [actorId]
        );
        await executor.execute(
          "UPDATE bookings SET admin_user_id = NULL WHERE admin_user_id = ?",
          [actorId]
        );
        const [, result] = await executor.execute(
          "DELETE FROM admin_users WHERE id = ?",
          [actorId]
        );
        await executor.execute("COMMIT");
        return Number(result.affectedRows ?? 0) > 0;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
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

  async function loadPackageItemsByPackageIds(packageIds: string[]): Promise<Map<string, NonNullable<Package["items"]>>> {
    if (packageIds.length === 0) {
      return new Map();
    }

    const placeholders = packageIds.map(() => "?").join(", ");
    const [rows] = await executor.execute<Array<{
      package_id: number;
      appointment_type_id: number;
      quantity: number;
      appointment_type_name: string;
    }>>(
      [
        "SELECT pi.package_id, pi.appointment_type_id, pi.quantity, at.name AS appointment_type_name",
        "FROM package_items pi",
        "JOIN appointment_types at ON at.id = pi.appointment_type_id",
        `WHERE pi.package_id IN (${placeholders})`,
        "ORDER BY pi.package_id ASC, at.name ASC"
      ].join(" "),
      packageIds
    );

    const itemsByPackageId = new Map<string, NonNullable<Package["items"]>>();
    for (const row of rows) {
      const packageId = String(row.package_id);
      const items = itemsByPackageId.get(packageId) ?? [];
      items.push({
        appointmentTypeId: String(row.appointment_type_id),
        appointmentTypeName: row.appointment_type_name,
        quantity: Number(row.quantity)
      });
      itemsByPackageId.set(packageId, items);
    }

    return itemsByPackageId;
  }

  async function mapPackageRows<T extends {
    id: number;
    name: string;
    is_active: number;
    price: number;
    description: string | null;
    bullet_points: string | null;
    expiration_days: number | null;
    share_token: string | null;
    portal_available: number | null;
    form_template_id: number | null;
  }>(rows: T[]): Promise<Package[]> {
    const itemsByPackageId = await loadPackageItemsByPackageIds(rows.map((row) => String(row.id)));
    return rows.map((row) => toPackageRecord({
      ...row,
      items: itemsByPackageId.get(String(row.id)) ?? []
    }));
  }

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
        pet_sitting_notes: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, pet_sitting_notes, COALESCE(is_active, 1) AS is_active",
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
        pet_sitting_notes: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, pet_sitting_notes, COALESCE(is_active, 1) AS is_active",
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
    return row == null ? null : toInvoiceRecord(row);
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
    return row == null ? null : toQuoteRecord(row);
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

    return rows.map((row) => toContractRecord(row));
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
    return row == null ? null : toContractRecord(row);
    },
    async listPortalForms(clientId) {
      const [rows] = await executor.execute<FormSubmissionRow[]>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, ft.name AS template_name,",
          "ft.form_type, ft.is_internal AS template_is_internal,",
          "ft.show_in_client_portal AS template_show_in_client_portal,",
          "fs.submitted_at, fs.access_token",
          "FROM form_submissions fs",
          "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
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
        templateName: row.template_name ?? null,
        formType: row.form_type ?? undefined,
        templateIsInternal: row.template_is_internal == null ? undefined : row.template_is_internal !== 0,
        templateShowInClientPortal: row.template_show_in_client_portal == null ? undefined : row.template_show_in_client_portal !== 0,
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
      const [rows] = await executor.execute<FormSubmissionRow[]>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, ft.name AS template_name,",
          "ft.description AS template_description, ft.fields AS template_fields,",
          "ft.form_type, ft.is_internal AS template_is_internal,",
          "ft.show_in_client_portal AS template_show_in_client_portal,",
          "c.name AS client_name, c.email AS client_email, c.phone AS client_phone,",
          "fs.responses, fs.submitted_at, fs.access_token",
          "FROM form_submissions fs",
          "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
          "LEFT JOIN clients c ON c.id = fs.client_id",
          "WHERE fs.client_id = ? AND fs.id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId, formId]
      );

      const row = rows[0];
      return row == null ? null : mapFormSubmissionRow(row, now());
    },
    async listPortalNotifications(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        recipient_id: number;
        entity_type: string;
        entity_id: number | null;
        title: string;
        message: string | null;
        url: string;
        is_read: number;
        created_at: string;
      }>>(
        [
          "SELECT id, recipient_id, entity_type, entity_id, title, message, url, is_read, created_at",
          "FROM notifications",
          "WHERE audience = 'portal' AND recipient_id = ? AND deleted_at IS NULL",
          "ORDER BY created_at DESC, id DESC",
          "LIMIT 50"
        ].join(" "),
        [clientId]
      );

      return rows.map((row) => ({
        id: String(row.id),
        clientId: String(row.recipient_id),
        channel: "portal" as const,
        entityType: row.entity_type,
        entityId: row.entity_id == null ? null : String(row.entity_id),
        subject: row.title,
        message: row.message ?? "",
        url: row.url,
        isRead: row.is_read !== 0,
        createdAt: row.created_at
      }));
    },
    async listPortalPackages(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
        description: string | null;
        bullet_points: string | null;
        expiration_days: number | null;
        share_token: string | null;
        portal_available: number | null;
        form_template_id: number | null;
      }>>(
        [
          "SELECT DISTINCT p.id, p.name, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.price, 0) AS price,",
          "p.description, p.bullet_points, p.expiration_days, p.share_token, p.portal_available, p.form_template_id",
          "FROM packages p",
          "JOIN client_packages cp ON cp.package_id = p.id",
          "JOIN client_package_credits cpc ON cpc.client_package_id = cp.id",
          "WHERE cp.client_id = ? AND COALESCE(cp.is_active, 1) = 1",
          "ORDER BY cp.purchased_at DESC, p.id DESC",
          "LIMIT 20"
        ].join(" "),
        [clientId]
      );

      return mapPackageRows(rows);
    },
    async findPortalPackageById(clientId, packageId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
        description: string | null;
        bullet_points: string | null;
        expiration_days: number | null;
        share_token: string | null;
        portal_available: number | null;
        form_template_id: number | null;
      }>>(
        [
          "SELECT DISTINCT p.id, p.name, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.price, 0) AS price,",
          "p.description, p.bullet_points, p.expiration_days, p.share_token, p.portal_available, p.form_template_id",
          "FROM packages p",
          "JOIN client_packages cp ON cp.package_id = p.id",
          "JOIN client_package_credits cpc ON cpc.client_package_id = cp.id",
          "WHERE cp.client_id = ? AND p.id = ? AND COALESCE(cp.is_active, 1) = 1",
          "LIMIT 1"
        ].join(" "),
        [clientId, packageId]
      );

      const row = rows[0];
      return row == null ? null : (await mapPackageRows([row]))[0] ?? null;
    },
    async listPortalCredits(clientId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        appointment_type_id: number;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.appointment_type_id, cpc.total_credits, cpc.used_credits",
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
        appointment_type_id: number;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.appointment_type_id, cpc.total_credits, cpc.used_credits",
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
          "ORDER BY updated_at DESC"
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
        pet_sitting_notes: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, pet_sitting_notes, COALESCE(is_active, 1) AS is_active",
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
        pet_sitting_notes: string | null;
        is_active: number;
      }>>(
        [
          "SELECT id, client_id, name, species, pet_sitting_notes, COALESCE(is_active, 1) AS is_active",
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
    async listAdminBookings() {
      const rows = await loadLegacyBookingRows({ limit: 50 });
      return rows.map((row) => fromLegacyBookingRow(row));
    },
    async findAdminBookingById(bookingId) {
      const rows = await loadLegacyBookingRows({ whereClause: "WHERE id = ?", limit: 1, params: [bookingId] });
      const row = rows[0];
      return row == null ? null : fromLegacyBookingRow(row);
    },
    async listAdminExpenses() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        client_name: string | null;
        category: string | null;
        description: string | null;
        amount: number;
        expense_date: string | Date | null;
        receipt_file: string | null;
        billable: number | string | boolean | null;
        invoiced: number | string | boolean | null;
        notes: string | null;
        created_at: string | Date | null;
      }>>(
        [
          "SELECT e.id, e.client_id, c.name AS client_name, e.category, e.description, e.amount, e.expense_date, e.receipt_file, e.billable, e.invoiced, e.notes, e.created_at",
          "FROM expenses e",
          "LEFT JOIN clients c ON c.id = e.client_id",
          "ORDER BY e.expense_date DESC, e.id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return rows.map((row) => toExpenseRecord(row));
    },
    async findAdminExpenseById(expenseId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number | null;
        client_name: string | null;
        category: string | null;
        description: string | null;
        amount: number;
        expense_date: string | Date | null;
        receipt_file: string | null;
        billable: number | string | boolean | null;
        invoiced: number | string | boolean | null;
        notes: string | null;
        created_at: string | Date | null;
      }>>(
        [
          "SELECT e.id, e.client_id, c.name AS client_name, e.category, e.description, e.amount, e.expense_date, e.receipt_file, e.billable, e.invoiced, e.notes, e.created_at",
          "FROM expenses e",
          "LEFT JOIN clients c ON c.id = e.client_id",
          "WHERE e.id = ?",
          "LIMIT 1"
        ].join(" "),
        [expenseId]
      );

      const row = rows[0];
      return row == null ? null : toExpenseRecord(row);
    },
    async listAdminInvoices() {
      let rows: Array<{
        id: number;
        client_id: number | null;
        status: string | null;
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>;
      try {
        [rows] = await executor.execute<Array<{
          id: number;
          client_id: number | null;
          status: string | null;
          total_amount: number;
          outstanding_amount: number;
          due_at: string | null;
        }>>(buildInvoicesSelectSql({ limit: 50 }));
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }
        try {
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            outstanding_amount: number;
            due_at: string | null;
          }>>(buildInvoicesSelectSql({ limit: 50, legacy: true }));
        } catch (legacyError) {
          if (!isMissingColumnError(legacyError)) {
            throw legacyError;
          }
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            outstanding_amount: number;
            due_at: string | null;
          }>>(buildInvoicesSelectSql({ limit: 50, legacy: true, tolerateMissingPayments: true }));
        }
      }

      return rows.map((row) => toInvoiceRecord(row));
    },
    async findAdminInvoiceById(invoiceId) {
      let rows: Array<{
        id: number;
        client_id: number | null;
        status: string | null;
        total_amount: number;
        outstanding_amount: number;
        due_at: string | null;
      }>;
      try {
        [rows] = await executor.execute<Array<{
          id: number;
          client_id: number | null;
          status: string | null;
          total_amount: number;
          outstanding_amount: number;
          due_at: string | null;
        }>>(buildInvoicesSelectSql({ whereClause: "WHERE i.id = ?", limit: 1 }), [invoiceId]);
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }
        try {
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            outstanding_amount: number;
            due_at: string | null;
          }>>(buildInvoicesSelectSql({ whereClause: "WHERE i.id = ?", limit: 1, legacy: true }), [invoiceId]);
        } catch (legacyError) {
          if (!isMissingColumnError(legacyError)) {
            throw legacyError;
          }
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            outstanding_amount: number;
            due_at: string | null;
          }>>(buildInvoicesSelectSql({ whereClause: "WHERE i.id = ?", limit: 1, legacy: true, tolerateMissingPayments: true }), [invoiceId]);
        }
      }

    const row = rows[0];
    return row == null ? null : toInvoiceRecord(row);
    },
    async listAdminQuotes() {
      let rows: Array<{
        id: number;
        client_id: number | null;
        status: string | null;
        total_amount: number;
        access_token: string | null;
      }>;
      try {
        [rows] = await executor.execute<Array<{
          id: number;
          client_id: number | null;
          status: string | null;
          total_amount: number;
          access_token: string | null;
        }>>(buildQuotesSelectSql({ limit: 50 }));
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }
        try {
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            access_token: string | null;
          }>>(buildQuotesSelectSql({ limit: 50, legacy: true }));
        } catch (legacyError) {
          if (!isMissingColumnError(legacyError)) {
            throw legacyError;
          }
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            access_token: string | null;
          }>>(buildQuotesSelectSql({ limit: 50, legacy: true, tokenlessLegacy: true }));
        }
      }

      return rows.map((row) => toQuoteRecord(row));
    },
    async findAdminQuoteById(quoteId) {
      let rows: Array<{
        id: number;
        client_id: number | null;
        status: string | null;
        total_amount: number;
        access_token: string | null;
      }>;
      try {
        [rows] = await executor.execute<Array<{
          id: number;
          client_id: number | null;
          status: string | null;
          total_amount: number;
          access_token: string | null;
        }>>(buildQuotesSelectSql({ whereClause: "WHERE q.id = ?", limit: 1 }), [quoteId]);
      } catch (error) {
        if (!isMissingColumnError(error)) {
          throw error;
        }
        try {
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            access_token: string | null;
          }>>(buildQuotesSelectSql({ whereClause: "WHERE q.id = ?", limit: 1, legacy: true }), [quoteId]);
        } catch (legacyError) {
          if (!isMissingColumnError(legacyError)) {
            throw legacyError;
          }
          [rows] = await executor.execute<Array<{
            id: number;
            client_id: number | null;
            status: string | null;
            total_amount: number;
            access_token: string | null;
          }>>(buildQuotesSelectSql({ whereClause: "WHERE q.id = ?", limit: 1, legacy: true, tokenlessLegacy: true }), [quoteId]);
        }
      }

    const row = rows[0];
    return row == null ? null : toQuoteRecord(row);
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

    return rows.map((row) => toContractRecord(row));
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
    return row == null ? null : toContractRecord(row);
    },
    async listAdminFormsByTemplate(templateId) {
      const [rows] = await executor.execute<FormSubmissionRow[]>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, fs.booking_id, fs.pet_id,",
          "ft.name AS template_name, ft.description AS template_description, ft.fields AS template_fields,",
          "ft.form_type, ft.is_internal AS template_is_internal,",
          "ft.show_in_client_portal AS template_show_in_client_portal,",
          "fs.status, fs.notes, fs.submitted_by, fs.reviewed_by, fs.reviewed_at,",
          "c.name AS client_name, c.email AS client_email, c.phone AS client_phone,",
          "p.name AS pet_name,",
          "CONCAT_WS(' ', b.appointment_date, b.appointment_time) AS appointment_datetime,",
          "b.service_type,",
          "au.username AS submitted_by_name, au2.username AS reviewed_by_name,",
          "fs.responses, fs.submitted_at, fs.access_token",
          "FROM form_submissions fs",
          "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
          "LEFT JOIN clients c ON c.id = fs.client_id",
          "LEFT JOIN pets p ON p.id = fs.pet_id",
          "LEFT JOIN bookings b ON b.id = fs.booking_id",
          "LEFT JOIN admin_users au ON au.id = fs.submitted_by",
          "LEFT JOIN admin_users au2 ON au2.id = fs.reviewed_by",
          "WHERE fs.template_id = ?",
          "ORDER BY fs.submitted_at DESC, fs.id DESC"
        ].join(" "),
        [templateId]
      );

      return rows.map((row) => mapFormSubmissionRow(row, now()));
    },
    async listAdminForms() {
      const [rows] = await executor.execute<FormSubmissionRow[]>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, fs.booking_id, fs.pet_id,",
          "ft.name AS template_name, ft.description AS template_description, ft.fields AS template_fields,",
          "ft.form_type, ft.is_internal AS template_is_internal,",
          "ft.show_in_client_portal AS template_show_in_client_portal,",
          "fs.status, fs.notes, fs.submitted_by, fs.reviewed_by, fs.reviewed_at,",
          "c.name AS client_name, c.email AS client_email, c.phone AS client_phone,",
          "p.name AS pet_name,",
          "CONCAT_WS(' ', b.appointment_date, b.appointment_time) AS appointment_datetime,",
          "b.service_type,",
          "au.username AS submitted_by_name, au2.username AS reviewed_by_name,",
          "fs.responses, fs.submitted_at, fs.access_token",
          "FROM form_submissions fs",
          "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
          "LEFT JOIN clients c ON c.id = fs.client_id",
          "LEFT JOIN pets p ON p.id = fs.pet_id",
          "LEFT JOIN bookings b ON b.id = fs.booking_id",
          "LEFT JOIN admin_users au ON au.id = fs.submitted_by",
          "LEFT JOIN admin_users au2 ON au2.id = fs.reviewed_by",
          "ORDER BY fs.submitted_at DESC, fs.id DESC"
        ].join(" ")
      );

      return rows.map((row) => mapFormSubmissionRow(row, now()));
    },
    async findAdminFormById(formId) {
      const [rows] = await executor.execute<FormSubmissionRow[]>(
        [
          "SELECT fs.id, fs.template_id, fs.client_id, fs.booking_id, fs.pet_id,",
          "ft.name AS template_name,",
          "ft.description AS template_description, ft.fields AS template_fields,",
          "ft.form_type, ft.is_internal AS template_is_internal,",
          "ft.show_in_client_portal AS template_show_in_client_portal,",
          "fs.status, fs.notes, fs.submitted_by, fs.reviewed_by, fs.reviewed_at,",
          "c.name AS client_name, c.email AS client_email, c.phone AS client_phone,",
          "p.name AS pet_name,",
          "CONCAT_WS(' ', b.appointment_date, b.appointment_time) AS appointment_datetime,",
          "b.service_type,",
          "au.username AS submitted_by_name, au2.username AS reviewed_by_name,",
          "fs.responses, fs.submitted_at, fs.access_token",
          "FROM form_submissions fs",
          "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
          "LEFT JOIN clients c ON c.id = fs.client_id",
          "LEFT JOIN pets p ON p.id = fs.pet_id",
          "LEFT JOIN bookings b ON b.id = fs.booking_id",
          "LEFT JOIN admin_users au ON au.id = fs.submitted_by",
          "LEFT JOIN admin_users au2 ON au2.id = fs.reviewed_by",
          "WHERE fs.id = ?",
          "LIMIT 1"
        ].join(" "),
        [formId]
      );

      const row = rows[0];
      return row == null ? null : mapFormSubmissionRow(row, now());
    },
    async createAdminFormRequest(input) {
      const template = await adminConfiguration.findAdminFormTemplateById(input.templateId);
      if (template == null || !template.active) {
        return null;
      }

      const client = await this.findAdminClientById(input.clientId);
      if (client == null || client.archived) {
        return null;
      }

      if (input.bookingId != null) {
        const booking = await this.findAdminBookingById(input.bookingId);
        if (booking == null) {
          return null;
        }
      }

      if (input.petId != null) {
        const pet = await this.findAdminPetById(input.petId);
        if (pet == null) {
          return null;
        }
      }

      const [, result] = await executor.execute<unknown[]>(
        [
          "INSERT INTO form_submissions",
          "(client_id, template_id, booking_id, pet_id, responses, status, sent_at, access_token)",
          "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)"
        ].join(" "),
        [
          input.clientId,
          input.templateId,
          input.bookingId ?? null,
          input.petId ?? null,
          "{}",
          input.sentAt ?? null,
          randomBytes(16).toString("hex")
        ]
      );

      const createdId = String(result.insertId ?? "");
      return createdId === "" ? null : this.findAdminFormById(createdId);
    },
    async reviewAdminForm(formId, adminUserId, notes) {
      const normalizedNotes = notes.trim();
      const [, result] = await executor.execute<unknown[]>(
        [
          "UPDATE form_submissions",
          "SET status = 'reviewed', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, notes = ?",
          "WHERE id = ?"
        ].join(" "),
        [adminUserId, normalizedNotes === "" ? null : normalizedNotes, formId]
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return this.findAdminFormById(formId);
    },
    async unreviewAdminForm(formId) {
      const [, result] = await executor.execute<unknown[]>(
        [
          "UPDATE form_submissions",
          "SET status = 'submitted', reviewed_by = NULL, reviewed_at = NULL",
          "WHERE id = ?"
        ].join(" "),
        [formId]
      );

      if (result.affectedRows === 0) {
        return null;
      }

      return this.findAdminFormById(formId);
    },
    async listAdminPackages() {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
        description: string | null;
        bullet_points: string | null;
        expiration_days: number | null;
        share_token: string | null;
        portal_available: number | null;
        form_template_id: number | null;
      }>>(
        [
          "SELECT id, name, COALESCE(is_active, 1) AS is_active, COALESCE(price, 0) AS price,",
          "description, bullet_points, expiration_days, share_token, portal_available, form_template_id",
          "FROM packages",
          "ORDER BY updated_at DESC, id DESC",
          "LIMIT 50"
        ].join(" ")
      );

      return mapPackageRows(rows);
    },
    async findAdminPackageById(packageId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        is_active: number;
        price: number;
        description: string | null;
        bullet_points: string | null;
        expiration_days: number | null;
        share_token: string | null;
        portal_available: number | null;
        form_template_id: number | null;
      }>>(
        [
          "SELECT id, name, COALESCE(is_active, 1) AS is_active, COALESCE(price, 0) AS price,",
          "description, bullet_points, expiration_days, share_token, portal_available, form_template_id",
          "FROM packages",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [packageId]
      );

      const row = rows[0];
      return row == null ? null : (await mapPackageRows([row]))[0] ?? null;
    },
    async listAdminCredits() {
      const [rows] = await executor.execute<Array<{
        id: number;
        client_id: number;
        package_id: number | null;
        appointment_type_id: number;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.appointment_type_id, cpc.total_credits, cpc.used_credits",
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
        appointment_type_id: number;
        total_credits: number;
        used_credits: number;
      }>>(
        [
          "SELECT cpc.id, cpc.client_id, cp.package_id, cpc.appointment_type_id, cpc.total_credits, cpc.used_credits",
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
          "SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP",
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
          "SET status = 'signed', signed_date = CURRENT_TIMESTAMP",
          "WHERE client_id = ? AND id = ? AND status = 'sent'"
        ].join(" "),
        [clientId, contractId]
      );

      return await portalResources.findPortalContractById(clientId, contractId);
    },
    async submitPortalForm(clientId, formId) {
      await executor.execute("START TRANSACTION");
      try {
        const [, result] = await executor.execute(
          [
            "UPDATE form_submissions",
            "SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP",
            "WHERE client_id = ? AND id = ? AND submitted_at IS NULL"
          ].join(" "),
          [clientId, formId]
        );

        if (Number(result.affectedRows ?? 0) > 0) {
          const [submissionRows] = await executor.execute<Array<{ template_id: string | number | null }>>(
            [
              "SELECT template_id",
              "FROM form_submissions",
              "WHERE client_id = ? AND id = ?",
              "LIMIT 1"
            ].join(" "),
            [clientId, formId]
          );
          const templateId = submissionRows[0]?.template_id;
          if (templateId != null && String(templateId).trim() !== "") {
            await applyFormSubmissionTriggers({
              clientId,
              templateId: String(templateId)
            });
          }
        }

        await executor.execute("COMMIT");
        return await portalResources.findPortalFormById(clientId, formId);
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async createInvoicePaymentSession(clientId, invoiceId, input) {
      const invoice = await portalResources.findPortalInvoiceById(clientId, invoiceId);
      if (invoice == null) {
        return null;
      }

      if (invoice.outstandingAmount <= 0 || invoice.status === "paid" || invoice.status === "void") {
        return {
          invoice,
          paymentSession: {
            provider: "stripe" as const,
            checkoutUrl: input.cancelUrl,
            expiresAt: null
          }
        };
      }

      const [clientRows] = await executor.execute<Array<{ email: string | null }>>(
        [
          "SELECT email",
          "FROM clients",
          "WHERE id = ?",
          "LIMIT 1"
        ].join(" "),
        [clientId]
      );
      const session = await stripeClient.createCheckoutSession({
        successUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        customerEmail: clientRows[0]?.email ?? null,
        amountTotal: Math.round(Math.max(0, invoice.outstandingAmount) * 100),
        itemName: `Invoice ${invoice.id}`,
        itemDescription: `Brook's Dog Training Academy invoice ${invoice.id}`,
        metadata: {
          invoice_id: invoice.id,
          client_id: clientId
        }
      });

      return {
        invoice,
        paymentSession: {
          provider: "stripe" as const,
          checkoutUrl: session.checkoutUrl,
          expiresAt: session.expiresAt
        }
      };
    }
  };

  function parseWorkflowDelayToMinutes(delayValue: string | null | undefined): number {
    if (delayValue == null || delayValue.trim() === "") {
      return 0;
    }

    const normalizedDelayValue = delayValue.trim();
    const matched = /^(\d+)\s*(minute|hour|day|week)s?$/i.exec(normalizedDelayValue);
    if (matched != null) {
      const amount = Number.parseInt(matched[1] ?? "0", 10);
      const unit = (matched[2] ?? "").toLowerCase();

      switch (unit) {
        case "minute":
          return amount;
        case "hour":
          return amount * 60;
        case "day":
          return amount * 60 * 24;
        case "week":
          return amount * 60 * 24 * 7;
        default:
          return 0;
      }
    }

    if (/^\d+$/.test(normalizedDelayValue)) {
      return Number.parseInt(normalizedDelayValue, 10);
    }

    return 0;
  }

  async function getWorkflowProcessorIntervalMinutes(): Promise<number> {
    const [rows] = await executor.execute<Array<{
      schedule_type: string;
      schedule_value: string | null;
    }>>(
      [
        "SELECT schedule_type, schedule_value",
        "FROM scheduled_tasks",
        "WHERE COALESCE(is_active, 1) = 1",
        "AND task_type IN ('workflow_processor', 'workflow')"
      ].join(" ")
    );

    if (rows.length === 0) {
      return 60;
    }

    const intervals = rows.map((row) => {
      switch (row.schedule_type) {
        case "interval":
          return Math.max(1, Number.parseInt(row.schedule_value ?? "60", 10) || 60);
        case "hourly":
          return 60;
        case "daily":
          return 60 * 24;
        case "weekly":
          return 60 * 24 * 7;
        case "monthly":
          return 60 * 24 * 30;
        case "custom": {
          const value = (row.schedule_value ?? "").trim();
          const minuteMatch = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(value);
          if (minuteMatch != null) {
            return Math.max(1, Number.parseInt(minuteMatch[1] ?? "60", 10));
          }
          const hourMatch = /^\d+\s+\*\/(\d+)\s+\*\s+\*\s+\*$/.exec(value);
          if (hourMatch != null) {
            return Math.max(1, Number.parseInt(hourMatch[1] ?? "1", 10)) * 60;
          }
          return 60;
        }
        default:
          return 60;
      }
    });

    return Math.min(...intervals);
  }

  type WorkflowStepRow = {
    workflow_step_id: string;
    workflow_id: string;
    step_order: number;
    step_name: string;
    email_subject: string;
    email_body_html: string;
    email_body_text: string | null;
    delay_type: WorkflowStep["delayType"];
    delay_value: string | null;
    scheduled_date: string | null;
    attach_contract_id: string | null;
    attach_form_id: string | null;
    attach_quote_id: string | null;
    attach_invoice_id: string | null;
    include_appointment_link: number;
    appointment_type_id: string | null;
    created_at: string | null;
    updated_at: string | null;
  };

  type WorkflowTriggerRow = {
    workflow_trigger_id: string;
    workflow_id: string;
    trigger_type: WorkflowAutoEnrollmentTrigger["triggerType"];
    appointment_type_id: string | null;
    form_template_id: string | null;
    active: number;
    created_at: string | null;
    appointment_type_name?: string | null;
    form_template_name?: string | null;
  };

  function toWorkflowStepItem(row: WorkflowStepRow): WorkflowStep {
    return {
      id: row.workflow_step_id,
      workflowId: row.workflow_id,
      stepOrder: Number(row.step_order),
      stepName: row.step_name,
      emailSubject: row.email_subject,
      emailBodyHtml: row.email_body_html,
      emailBodyText: row.email_body_text,
      delayType: row.delay_type,
      delayValue: row.delay_value,
      scheduledDate: row.scheduled_date,
      attachContractId: row.attach_contract_id,
      attachFormId: row.attach_form_id,
      attachQuoteId: row.attach_quote_id,
      attachInvoiceId: row.attach_invoice_id,
      includeAppointmentLink: Number(row.include_appointment_link) === 1,
      appointmentTypeId: row.appointment_type_id,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }

  function toWorkflowTriggerItem(row: WorkflowTriggerRow) {
    return {
      id: row.workflow_trigger_id,
      workflowId: row.workflow_id,
      triggerType: row.trigger_type,
      appointmentTypeId: row.appointment_type_id,
      formTemplateId: row.form_template_id,
      active: Number(row.active) === 1,
      createdAt: row.created_at ?? undefined,
      appointmentTypeName: row.appointment_type_name ?? null,
      formTemplateName: row.form_template_name ?? null
    };
  }

  async function listWorkflowStepsForWorkflow(workflowId: string): Promise<WorkflowStep[]> {
    const [rows] = await executor.execute<Array<WorkflowStepRow>>(
      [
        "SELECT workflow_step_id, workflow_id, step_order, step_name, email_subject, email_body_html, email_body_text,",
        "delay_type, delay_value, scheduled_date, attach_contract_id, attach_form_id, attach_quote_id, attach_invoice_id,",
        "include_appointment_link, appointment_type_id, created_at, updated_at",
        "FROM workflow_steps",
        "WHERE workflow_id = ?",
        "ORDER BY step_order ASC"
      ].join(" "),
      [workflowId]
    );

    return rows.map((row) => toWorkflowStepItem(row));
  }

  async function findWorkflowStepById(workflowId: string, stepId: string): Promise<WorkflowStep | null> {
    const [rows] = await executor.execute<Array<WorkflowStepRow>>(
      [
        "SELECT workflow_step_id, workflow_id, step_order, step_name, email_subject, email_body_html, email_body_text,",
        "delay_type, delay_value, scheduled_date, attach_contract_id, attach_form_id, attach_quote_id, attach_invoice_id,",
        "include_appointment_link, appointment_type_id, created_at, updated_at",
        "FROM workflow_steps",
        "WHERE workflow_id = ? AND workflow_step_id = ?",
        "LIMIT 1"
      ].join(" "),
      [workflowId, stepId]
    );

    const row = rows[0];
    return row == null ? null : toWorkflowStepItem(row);
  }

  async function listWorkflowTriggersForWorkflow(workflowId: string) {
    const [rows] = await executor.execute<Array<WorkflowTriggerRow>>(
      [
        "SELECT wt.workflow_trigger_id, wt.workflow_id, wt.trigger_type, wt.appointment_type_id, wt.form_template_id, wt.active, wt.created_at,",
        "at.name AS appointment_type_name, ft.name AS form_template_name",
        "FROM workflow_triggers wt",
        "LEFT JOIN appointment_types at ON at.id = wt.appointment_type_id",
        "LEFT JOIN form_templates ft ON ft.id = wt.form_template_id",
        "WHERE wt.workflow_id = ?",
        "ORDER BY wt.created_at ASC, wt.workflow_trigger_id ASC"
      ].join(" "),
      [workflowId]
    );

    return rows.map((row) => toWorkflowTriggerItem(row));
  }

  function calculateWorkflowStepScheduledFor(
    step: WorkflowStep,
    enrolledAt: string,
    previousScheduledFor: string | null
  ): string {
    switch (step.delayType) {
      case "immediate":
        return enrolledAt;
      case "after_enrollment":
        return new Date(Date.parse(enrolledAt) + parseWorkflowDelayToMinutes(step.delayValue ?? null) * 60_000).toISOString();
      case "after_previous": {
        const baseTimestamp = previousScheduledFor ?? enrolledAt;
        return new Date(Date.parse(baseTimestamp) + parseWorkflowDelayToMinutes(step.delayValue ?? null) * 60_000).toISOString();
      }
      case "specific_date":
        return step.scheduledDate ?? enrolledAt;
      default:
        return enrolledAt;
    }
  }

  async function refreshWorkflowEnrollmentProgress(enrollmentId: string): Promise<void> {
    const [enrollmentRows] = await executor.execute<Array<{
      status: WorkflowEnrollment["status"] | null;
      completed_at: string | null;
    }>>(
      [
        "SELECT status, completed_at",
        "FROM workflow_enrollments",
        "WHERE workflow_enrollment_id = ?",
        "LIMIT 1"
      ].join(" "),
      [enrollmentId]
    );
    const enrollment = enrollmentRows[0];
    if (enrollment == null) {
      return;
    }

    const [pendingRows] = await executor.execute<Array<{ scheduled_for: string }>>(
      [
        "SELECT scheduled_for",
        "FROM workflow_step_executions",
        "WHERE enrollment_id = ? AND status = 'pending' AND executed_at IS NULL",
        "ORDER BY scheduled_for ASC"
      ].join(" "),
      [enrollmentId]
    );

    const nextPending = pendingRows[0]?.scheduled_for ?? null;
    if (nextPending != null) {
      await executor.execute(
        "UPDATE workflow_enrollments SET next_run_at = ? WHERE workflow_enrollment_id = ?",
        [nextPending, enrollmentId]
      );
      return;
    }

    if ((enrollment.status ?? "active") === "active") {
      await executor.execute(
        "UPDATE workflow_enrollments SET next_run_at = NULL, completed_at = COALESCE(completed_at, ?), status = 'completed' WHERE workflow_enrollment_id = ?",
        [now(), enrollmentId]
      );
      return;
    }

    await executor.execute(
      "UPDATE workflow_enrollments SET next_run_at = NULL WHERE workflow_enrollment_id = ?",
      [enrollmentId]
    );
  }

  async function scheduleWorkflowStepExecutions(enrollment: {
    id: string;
    workflowId: string;
    enrolledAt: string;
  }): Promise<void> {
    const steps = await listWorkflowStepsForWorkflow(enrollment.workflowId);
    let previousScheduledFor: string | null = null;
    let nextRunAt = enrollment.enrolledAt;

    for (const step of steps) {
      const scheduledFor = calculateWorkflowStepScheduledFor(step, enrollment.enrolledAt, previousScheduledFor);
      await executor.execute(
        [
          "INSERT INTO workflow_step_executions",
          "(workflow_step_execution_id, enrollment_id, step_id, scheduled_for, executed_at, status, error_message, created_at)",
          "VALUES (?, ?, ?, ?, NULL, 'pending', NULL, ?)"
        ].join(" "),
        [`workflow-step-execution-${randomUUID()}`, enrollment.id, step.id, scheduledFor, now()]
      );

      if (previousScheduledFor == null) {
        nextRunAt = scheduledFor;
      }
      previousScheduledFor = scheduledFor;
    }

    await executor.execute(
      "UPDATE workflow_enrollments SET next_run_at = ? WHERE workflow_enrollment_id = ?",
      [nextRunAt, enrollment.id]
    );
  }

  async function enrollWorkflowClientsInternal(
    workflowId: string,
    clientIds: string[],
    adminUserId: string | null
  ): Promise<void> {
    for (const clientId of clientIds) {
      const [existingRows] = await executor.execute<Array<{ workflow_enrollment_id: string }>>(
        [
          "SELECT workflow_enrollment_id FROM workflow_enrollments",
          "WHERE workflow_id = ? AND client_id = ?",
          "AND COALESCE(status, 'active') = 'active'",
          "AND completed_at IS NULL",
          "LIMIT 1"
        ].join(" "),
        [workflowId, clientId]
      );
      if (existingRows[0] != null) {
        continue;
      }

      const enrolledAt = now();
      const enrollmentId = `workflow-enrollment-${randomUUID()}`;
      await executor.execute(
        [
          "INSERT INTO workflow_enrollments",
          "(workflow_enrollment_id, workflow_id, client_id, enrolled_at, next_run_at, completed_at, status, enrolled_by, cancelled_at, created_at)",
          "VALUES (?, ?, ?, ?, ?, NULL, 'active', ?, NULL, CURRENT_TIMESTAMP)"
        ].join(" "),
        [enrollmentId, workflowId, clientId, enrolledAt, enrolledAt, adminUserId]
      );
      await scheduleWorkflowStepExecutions({
        id: enrollmentId,
        workflowId,
        enrolledAt
      });
    }
  }

  async function applyAppointmentBookingTriggers(booking: Booking): Promise<void> {
    if (booking.clientId.trim() === "" || booking.serviceId.trim() === "") {
      return;
    }

    const [rows] = await executor.execute<Array<{ workflow_id: string }>>(
      [
        "SELECT DISTINCT wt.workflow_id",
        "FROM workflow_triggers wt",
        "INNER JOIN workflows w ON w.workflow_id = wt.workflow_id",
        "WHERE wt.trigger_type = 'appointment_booking'",
        "AND wt.active = 1",
        "AND w.active = 1",
        "AND wt.appointment_type_id = ?"
      ].join(" "),
      [booking.serviceId]
    );

    for (const row of rows) {
      await enrollWorkflowClientsInternal(row.workflow_id, [booking.clientId], null);
    }
  }

  async function applyFormSubmissionTriggers(submission: Pick<FormSubmission, "clientId" | "templateId">): Promise<void> {
    if (submission.clientId.trim() === "" || submission.templateId.trim() === "") {
      return;
    }

    const [rows] = await executor.execute<Array<{ workflow_id: string }>>(
      [
        "SELECT DISTINCT wt.workflow_id",
        "FROM workflow_triggers wt",
        "INNER JOIN workflows w ON w.workflow_id = wt.workflow_id",
        "WHERE wt.trigger_type = 'form_submission'",
        "AND wt.active = 1",
        "AND w.active = 1",
        "AND wt.form_template_id = ?"
      ].join(" "),
      [submission.templateId]
    );

    for (const row of rows) {
      await enrollWorkflowClientsInternal(row.workflow_id, [submission.clientId], null);
    }
  }

  const workflows: WorkflowManagementDependencies = {
    async listAdminWorkflows() {
      const [rows] = await executor.execute<Array<{
        workflow_id: string;
        workflow_name: string;
        workflow_description: string | null;
        workflow_trigger: Workflow["trigger"];
        active: number;
        created_at: string | null;
        enrollment_count: number;
        active_enrollment_count: number;
        trigger_count: number;
      }>>(
        [
          "SELECT w.workflow_id, w.workflow_name, w.workflow_description, w.workflow_trigger, w.active, w.created_at,",
          "COUNT(DISTINCT we.workflow_enrollment_id) AS enrollment_count,",
          "COUNT(DISTINCT CASE WHEN COALESCE(we.status, 'active') = 'active' AND we.completed_at IS NULL THEN we.workflow_enrollment_id END) AS active_enrollment_count,",
          "COUNT(DISTINCT wt.workflow_trigger_id) AS trigger_count",
          "FROM workflows w",
          "LEFT JOIN workflow_enrollments we ON we.workflow_id = w.workflow_id",
          "LEFT JOIN workflow_triggers wt ON wt.workflow_id = w.workflow_id",
          "GROUP BY w.workflow_id, w.workflow_name, w.workflow_description, w.workflow_trigger, w.active, w.created_at",
          "ORDER BY w.workflow_name ASC"
        ].join(" ")
      );

      return rows.map((row) => ({
        id: row.workflow_id,
        name: row.workflow_name,
        description: row.workflow_description ?? "",
        trigger: row.workflow_trigger,
        active: Number(row.active) === 1,
        createdAt: row.created_at ?? now(),
        enrollmentCount: Number(row.enrollment_count ?? 0),
        activeEnrollmentCount: Number(row.active_enrollment_count ?? 0),
        triggerCount: Number(row.trigger_count ?? 0)
      }));
    },
    async findAdminWorkflowById(workflowId) {
      const [rows] = await executor.execute<Array<{
        workflow_id: string;
        workflow_name: string;
        workflow_description: string | null;
        workflow_trigger: Workflow["trigger"];
        active: number;
        created_at: string | null;
      }>>(
        [
          "SELECT workflow_id, workflow_name, workflow_description, workflow_trigger, active, created_at",
          "FROM workflows",
          "WHERE workflow_id = ?",
          "LIMIT 1"
        ].join(" "),
        [workflowId]
      );

      const row = rows[0];
      return row == null ? null : {
        id: row.workflow_id,
        name: row.workflow_name,
        description: row.workflow_description ?? "",
        trigger: row.workflow_trigger,
        active: Number(row.active) === 1,
        createdAt: row.created_at ?? now()
      };
    },
    async createAdminWorkflow(_adminUserId, input) {
      const workflowId = `workflow-${randomUUID()}`;
      await executor.execute(
        [
          "INSERT INTO workflows (workflow_id, workflow_name, workflow_description, workflow_trigger, active, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [workflowId, input.name, input.description, input.trigger, input.active ? 1 : 0, now()]
      );

      const workflow = await workflows.findAdminWorkflowById(workflowId);
      if (workflow == null) {
        throw new Error("Failed to load newly created workflow.");
      }

      return workflow;
    },
    async updateAdminWorkflow(workflowId, _adminUserId, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE workflows",
          "SET workflow_name = ?, workflow_description = ?, workflow_trigger = ?, active = ?",
          "WHERE workflow_id = ?"
        ].join(" "),
        [input.name, input.description, input.trigger, input.active ? 1 : 0, workflowId]
      );

      if (Number(result.affectedRows ?? 0) === 0) {
        return null;
      }

      return workflows.findAdminWorkflowById(workflowId);
    },
    async deleteAdminWorkflow(workflowId) {
      await executor.execute("START TRANSACTION");
      try {
        await executor.execute(
          "DELETE FROM workflow_triggers WHERE workflow_id = ?",
          [workflowId]
        );
        await executor.execute(
          "DELETE FROM workflow_step_executions WHERE enrollment_id IN (SELECT workflow_enrollment_id FROM workflow_enrollments WHERE workflow_id = ?)",
          [workflowId]
        );
        await executor.execute(
          "DELETE FROM workflow_step_executions WHERE step_id IN (SELECT workflow_step_id FROM workflow_steps WHERE workflow_id = ?)",
          [workflowId]
        );
        await executor.execute(
          "DELETE FROM workflow_steps WHERE workflow_id = ?",
          [workflowId]
        );
        await executor.execute(
          "DELETE FROM workflow_enrollments WHERE workflow_id = ?",
          [workflowId]
        );
        const [, result] = await executor.execute(
          "DELETE FROM workflows WHERE workflow_id = ?",
          [workflowId]
        );
        await executor.execute("COMMIT");
        return Number(result.affectedRows ?? 0) > 0;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async listAdminWorkflowTriggers(workflowId) {
      return await listWorkflowTriggersForWorkflow(workflowId);
    },
    async listWorkflowTriggerOptions() {
      const [appointmentTypeRows] = await executor.execute<Array<{ id: number | string; name: string }>>(
        [
          "SELECT id, name",
          "FROM appointment_types",
          "WHERE COALESCE(active, 1) = 1",
          "ORDER BY name ASC"
        ].join(" ")
      );
      const [formTemplateRows] = await executor.execute<Array<{ id: number | string; name: string }>>(
        [
          "SELECT id, name",
          "FROM form_templates",
          "WHERE COALESCE(is_active, 1) = 1",
          "ORDER BY name ASC"
        ].join(" ")
      );

      return {
        appointmentTypes: appointmentTypeRows.map((row) => ({
          id: String(row.id),
          label: row.name
        })),
        formTemplates: formTemplateRows.map((row) => ({
          id: String(row.id),
          label: row.name
        }))
      };
    },
    async createAdminWorkflowTrigger(workflowId, _adminUserId, input) {
      const workflowTriggerId = `workflow-trigger-${randomUUID()}`;
      const createdAt = now();
      await executor.execute(
        [
          "INSERT INTO workflow_triggers",
          "(workflow_trigger_id, workflow_id, trigger_type, appointment_type_id, form_template_id, active, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          workflowTriggerId,
          workflowId,
          input.triggerType,
          input.appointmentTypeId,
          input.formTemplateId,
          input.active ? 1 : 0,
          createdAt
        ]
      );

      const triggers = await listWorkflowTriggersForWorkflow(workflowId);
      const createdTrigger = triggers.find((trigger) => trigger.id === workflowTriggerId) ?? null;
      if (createdTrigger == null) {
        throw new Error("Failed to load newly created workflow trigger.");
      }

      return createdTrigger;
    },
    async deleteAdminWorkflowTrigger(workflowId, triggerId) {
      const [, result] = await executor.execute(
        "DELETE FROM workflow_triggers WHERE workflow_id = ? AND workflow_trigger_id = ?",
        [workflowId, triggerId]
      );

      return Number(result.affectedRows ?? 0) > 0;
    },
    async listAdminWorkflowEnrollments(workflowId) {
      const [rows] = await executor.execute<Array<{
        workflow_enrollment_id: string;
        workflow_id: string;
        client_id: string;
        enrolled_at: string;
        next_run_at: string | null;
        completed_at: string | null;
        status: "active" | "completed" | "cancelled" | null;
        enrolled_by: string | null;
        cancelled_at: string | null;
        client_name: string;
        client_email: string;
        enrolled_by_name: string | null;
      }>>(
        [
          "SELECT we.workflow_enrollment_id, we.workflow_id, we.client_id, we.enrolled_at, we.next_run_at, we.completed_at,",
          "we.status, we.enrolled_by, we.cancelled_at,",
          "c.name AS client_name, c.email AS client_email, au.username AS enrolled_by_name",
          "FROM workflow_enrollments we",
          "INNER JOIN clients c ON c.id = we.client_id",
          "LEFT JOIN admin_users au ON au.id = we.enrolled_by",
          "WHERE we.workflow_id = ?",
          "ORDER BY we.enrolled_at DESC"
        ].join(" "),
        [workflowId]
      );

      return rows.map((row) => ({
        id: row.workflow_enrollment_id,
        workflowId: row.workflow_id,
        clientId: row.client_id,
        enrolledAt: row.enrolled_at,
        nextRunAt: row.next_run_at ?? row.enrolled_at,
        completedAt: row.completed_at,
        status: row.status ?? (row.completed_at == null ? "active" : "completed"),
        enrolledByAdminUserId: row.enrolled_by,
        cancelledAt: row.cancelled_at,
        clientName: row.client_name,
        clientEmail: row.client_email,
        enrolledByName: row.enrolled_by_name
      }));
    },
    async listWorkflowEnrollableClients(workflowId) {
      const [rows] = await executor.execute<Array<{
        id: number;
        name: string;
        email: string;
        already_enrolled: number;
      }>>(
        [
          "SELECT c.id, c.name, c.email,",
          "CASE WHEN EXISTS(",
          "  SELECT 1 FROM workflow_enrollments we",
          "  WHERE we.workflow_id = ?",
          "    AND we.client_id = c.id",
          "    AND COALESCE(we.status, 'active') = 'active'",
          "    AND we.completed_at IS NULL",
          ") THEN 1 ELSE 0 END AS already_enrolled",
          "FROM clients c",
          "WHERE COALESCE(c.is_archived, 0) = 0",
          "ORDER BY c.name ASC"
        ].join(" "),
        [workflowId]
      );

      return rows.map((row) => ({
        clientId: String(row.id),
        name: row.name,
        email: row.email,
        alreadyEnrolled: Number(row.already_enrolled) === 1
      }));
    },
    async enrollWorkflowClients(workflowId, clientIds, adminUserId) {
      await executor.execute("START TRANSACTION");
      try {
        await enrollWorkflowClientsInternal(workflowId, clientIds, adminUserId);
        await executor.execute("COMMIT");
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async cancelWorkflowEnrollment(workflowId, enrollmentId) {
      const cancelledAt = now();
      await executor.execute("START TRANSACTION");
      try {
        const [, result] = await executor.execute(
          [
            "UPDATE workflow_enrollments",
            "SET status = 'cancelled', completed_at = COALESCE(completed_at, ?), cancelled_at = ?, next_run_at = NULL",
            "WHERE workflow_id = ? AND workflow_enrollment_id = ?",
            "AND COALESCE(status, 'active') = 'active'"
          ].join(" "),
          [cancelledAt, cancelledAt, workflowId, enrollmentId]
        );

        if (Number(result.affectedRows ?? 0) === 0) {
          await executor.execute("COMMIT");
          return false;
        }

        await executor.execute(
          [
            "UPDATE workflow_step_executions",
            "SET status = 'cancelled'",
            "WHERE enrollment_id = ? AND status = 'pending' AND executed_at IS NULL"
          ].join(" "),
          [enrollmentId]
        );

        await executor.execute("COMMIT");
        return true;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async listAdminWorkflowSteps(workflowId) {
      return await listWorkflowStepsForWorkflow(workflowId);
    },
    async findAdminWorkflowStepById(workflowId, stepId) {
      return await findWorkflowStepById(workflowId, stepId);
    },
    async createAdminWorkflowStep(workflowId, _adminUserId, input) {
      const [orderRows] = await executor.execute<Array<{ max_order: number | null }>>(
        [
          "SELECT MAX(step_order) AS max_order",
          "FROM workflow_steps",
          "WHERE workflow_id = ?"
        ].join(" "),
        [workflowId]
      );
      const stepOrder = Number(orderRows[0]?.max_order ?? 0) + 1;
      const workflowStepId = `workflow-step-${randomUUID()}`;
      const createdAt = now();

      await executor.execute(
        [
          "INSERT INTO workflow_steps",
          "(workflow_step_id, workflow_id, step_order, step_name, email_subject, email_body_html, email_body_text,",
          "delay_type, delay_value, scheduled_date, attach_contract_id, attach_form_id, attach_quote_id, attach_invoice_id,",
          "include_appointment_link, appointment_type_id, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          workflowStepId,
          workflowId,
          stepOrder,
          input.stepName,
          input.emailSubject,
          input.emailBodyHtml,
          input.emailBodyText,
          input.delayType,
          input.delayValue,
          input.scheduledDate,
          input.attachContractId,
          input.attachFormId,
          input.attachQuoteId,
          input.attachInvoiceId,
          input.includeAppointmentLink ? 1 : 0,
          input.appointmentTypeId,
          createdAt,
          createdAt
        ]
      );

      const step = await findWorkflowStepById(workflowId, workflowStepId);
      if (step == null) {
        throw new Error("Failed to load newly created workflow step.");
      }

      return step;
    },
    async updateAdminWorkflowStep(workflowId, stepId, _adminUserId, input) {
      const [, result] = await executor.execute(
        [
          "UPDATE workflow_steps",
          "SET step_name = ?, email_subject = ?, email_body_html = ?, email_body_text = ?,",
          "delay_type = ?, delay_value = ?, scheduled_date = ?,",
          "attach_contract_id = ?, attach_form_id = ?, attach_quote_id = ?, attach_invoice_id = ?,",
          "include_appointment_link = ?, appointment_type_id = ?, updated_at = ?",
          "WHERE workflow_id = ? AND workflow_step_id = ?"
        ].join(" "),
        [
          input.stepName,
          input.emailSubject,
          input.emailBodyHtml,
          input.emailBodyText,
          input.delayType,
          input.delayValue,
          input.scheduledDate,
          input.attachContractId,
          input.attachFormId,
          input.attachQuoteId,
          input.attachInvoiceId,
          input.includeAppointmentLink ? 1 : 0,
          input.appointmentTypeId,
          now(),
          workflowId,
          stepId
        ]
      );

      if (Number(result.affectedRows ?? 0) === 0) {
        return null;
      }

      return await findWorkflowStepById(workflowId, stepId);
    },
    async deleteAdminWorkflowStep(workflowId, stepId) {
      await executor.execute("START TRANSACTION");
      try {
        const [enrollmentRows] = await executor.execute<Array<{ enrollment_id: string }>>(
          [
            "SELECT DISTINCT enrollment_id",
            "FROM workflow_step_executions",
            "WHERE step_id = ?"
          ].join(" "),
          [stepId]
        );

        await executor.execute(
        "DELETE FROM workflow_step_executions WHERE step_id = ?",
          [stepId]
        );
        const [, result] = await executor.execute(
        "DELETE FROM workflow_steps WHERE workflow_id = ? AND workflow_step_id = ?",
          [workflowId, stepId]
        );

        if (Number(result.affectedRows ?? 0) === 0) {
          await executor.execute("COMMIT");
          return false;
        }

        for (const row of enrollmentRows) {
          await refreshWorkflowEnrollmentProgress(row.enrollment_id);
        }

        await executor.execute("COMMIT");
        return true;
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }
    },
    async listWorkflowStepEditorOptions() {
      const [contractRows] = await executor.execute<Array<{ id: number; name: string }>>(
        "SELECT id, name FROM contract_templates WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC"
      );
      const [formRows] = await executor.execute<Array<{ id: number; name: string }>>(
        "SELECT id, name FROM form_templates WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC"
      );
      const [appointmentTypeRows] = await executor.execute<Array<{ id: number; name: string }>>(
        "SELECT id, name FROM appointment_types WHERE COALESCE(is_active, 1) = 1 ORDER BY name ASC"
      );
      const [quoteRows] = await executor.execute<Array<{
        id: number;
        quote_number: string;
        title: string;
        client_name: string | null;
      }>>(
        [
          "SELECT q.id, q.quote_number, q.title, c.name AS client_name",
          "FROM quotes q",
          "LEFT JOIN clients c ON c.id = q.client_id",
          "ORDER BY q.created_at DESC",
          "LIMIT 100"
        ].join(" ")
      );
      const [invoiceRows] = await executor.execute<Array<{
        id: number;
        invoice_number: string;
        client_name: string | null;
        total_amount: number;
      }>>(
        [
          "SELECT i.id, i.invoice_number, c.name AS client_name, i.total_amount",
          "FROM invoices i",
          "LEFT JOIN clients c ON c.id = i.client_id",
          "ORDER BY i.issue_date DESC",
          "LIMIT 100"
        ].join(" ")
      );
      const [emailTemplateRows] = await executor.execute<Array<{
        id: number;
        name: string;
        subject: string;
        body_html: string;
        body_text: string | null;
      }>>(
        [
          "SELECT id, name, subject, body_html, body_text",
          "FROM email_templates",
          "WHERE COALESCE(is_active, 1) = 1",
          "ORDER BY name ASC"
        ].join(" ")
      );

      return {
        contractTemplates: contractRows.map((row) => ({
          id: String(row.id),
          label: row.name
        })),
        formTemplates: formRows.map((row) => ({
          id: String(row.id),
          label: row.name
        })),
        appointmentTypes: appointmentTypeRows.map((row) => ({
          id: String(row.id),
          label: row.name
        })),
        quotes: quoteRows.map((row) => ({
          id: String(row.id),
          label: `${row.quote_number} - ${row.title}${row.client_name == null || row.client_name === "" ? "" : ` (${row.client_name})`}`
        })),
        invoices: invoiceRows.map((row) => ({
          id: String(row.id),
          label: `${row.invoice_number}${row.client_name == null || row.client_name === "" ? "" : ` (${row.client_name})`}`
        })),
        emailTemplates: emailTemplateRows.map((row) => ({
          id: String(row.id),
          label: row.name,
          subject: row.subject,
          bodyHtml: row.body_html,
          bodyText: row.body_text ?? ""
        })),
        processorIntervalMinutes: await getWorkflowProcessorIntervalMinutes()
      };
    }
  };

  async function loadPublicQuoteItems(quoteId: string) {
    const [rows] = await executor.execute<Array<{
      description: string | null;
      quantity: number | null;
      unit_price: number | null;
      amount: number | null;
      item_type: string | null;
      reference_id: number | null;
    }>>(
      [
        "SELECT description, quantity, unit_price, amount, item_type, reference_id",
        "FROM quote_items",
        "WHERE quote_id = ?",
        "ORDER BY id ASC"
      ].join(" "),
      [quoteId]
    );

    return rows.map((row) => ({
      description: row.description?.trim() === "" ? "Line Item" : (row.description ?? "Line Item"),
      quantity: Number(row.quantity ?? 0),
      unitPrice: Number(row.unit_price ?? 0),
      amount: Number(row.amount ?? 0),
      itemType: row.item_type ?? undefined,
      referenceId: row.reference_id == null ? null : String(row.reference_id)
    }));
  }

  async function loadPublicQuoteByWhere(whereClause: string, params: unknown[]): Promise<Quote | null> {
    const [rows] = await executor.execute<Array<{
      id: number;
      client_id: number;
      status: Quote["status"];
      total_amount: number;
      access_token: string | null;
      quote_number: string | null;
      title: string | null;
      description: string | null;
      expiration_date: string | null;
      accepted_at: string | null;
      declined_at: string | null;
    }>>(
      [
        "SELECT id, client_id, status, total_amount, access_token, quote_number, title, description, expiration_date, accepted_at, declined_at",
        "FROM quotes",
        `WHERE ${whereClause}`,
        "LIMIT 1"
      ].join(" "),
      params
    );

    const row = rows[0];
    if (row == null) {
      return null;
    }

  return toQuoteRecord({
    ...row,
    items: await loadPublicQuoteItems(String(row.id))
  });
  }

  async function loadPublicContractByWhere(whereClause: string, params: unknown[]): Promise<Contract | null> {
    const [rows] = await executor.execute<Array<{
      id: number;
      client_id: number;
      status: Contract["status"];
      access_token: string | null;
      contract_number: string | null;
      title: string | null;
      description: string | null;
      contract_text: string | null;
      effective_date: string | null;
      signed_date: string | null;
      signature_typed_name: string | null;
      signature_font: string | null;
    }>>(
      [
        "SELECT id, client_id, status, access_token, contract_number, title, description, contract_text, effective_date, signed_date, signature_typed_name, signature_font",
        "FROM contracts",
        `WHERE ${whereClause}`,
        "LIMIT 1"
      ].join(" "),
      params
    );

  const row = rows[0];
  return row == null ? null : toContractRecord(row);
  }

  async function loadPublicFormSubmissionByWhere(whereClause: string, params: unknown[]): Promise<FormSubmission | null> {
    const [rows] = await executor.execute<FormSubmissionRow[]>(
      [
        "SELECT fs.id, fs.template_id, fs.client_id, ft.name AS template_name,",
        "ft.description AS template_description, ft.fields AS template_fields,",
        "ft.form_type, ft.is_internal AS template_is_internal,",
        "ft.show_in_client_portal AS template_show_in_client_portal,",
        "c.name AS client_name, c.email AS client_email, c.phone AS client_phone,",
        "fs.responses, fs.submitted_at, fs.access_token",
        "FROM form_submissions fs",
        "LEFT JOIN form_templates ft ON ft.id = fs.template_id",
        "LEFT JOIN clients c ON c.id = fs.client_id",
        `WHERE ${whereClause}`,
        "LIMIT 1"
      ].join(" "),
      params
    );

    const row = rows[0];
    return row == null ? null : mapFormSubmissionRow(row, now());
  }

  const publicDocuments: PublicDocumentAccessDependencies = {
    now,
    findPublicQuoteById: async (quoteId) => loadPublicQuoteByWhere("id = ?", [quoteId]),
    findPublicQuoteByToken: async (token) => loadPublicQuoteByWhere("access_token = ?", [token]),
    async respondPublicQuote(quoteId, action) {
      await executor.execute(
        [
          "UPDATE quotes",
          action === "accept"
            ? "SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP"
            : "SET status = 'declined', declined_at = CURRENT_TIMESTAMP",
          "WHERE id = ? AND status IN ('draft', 'sent')"
        ].join(" "),
        [quoteId]
      );

      return await loadPublicQuoteByWhere("id = ?", [quoteId]);
    },
    findPublicContractById: async (contractId) => loadPublicContractByWhere("id = ?", [contractId]),
    findPublicContractByToken: async (token) => loadPublicContractByWhere("access_token = ?", [token]),
    async signPublicContract(input) {
      await executor.execute("START TRANSACTION");
      try {
        await executor.execute(
          [
            "UPDATE contracts",
            "SET status = 'signed', signature_typed_name = ?, signature_font = ?, signed_date = CURRENT_TIMESTAMP, ip_address = ?",
            "WHERE id = ? AND status = 'sent'"
          ].join(" "),
          [input.typedName, input.signatureFont, input.ipAddress, input.contractId]
        );
        await executor.execute(
          [
            "INSERT INTO contract_signature_log",
            "(contract_id, event_type, details, ip_address, user_agent, created_at)",
            "VALUES (?, 'signed', ?, ?, ?, CURRENT_TIMESTAMP)"
          ].join(" "),
          [
            input.contractId,
            `Contract signed electronically by "${input.typedName}" using style ${input.signatureFont}.`,
            input.ipAddress,
            input.userAgent
          ]
        );
        await executor.execute("COMMIT");
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }

      return await loadPublicContractByWhere("id = ?", [input.contractId]);
    },
    findPublicFormSubmissionById: async (submissionId) => loadPublicFormSubmissionByWhere("fs.id = ?", [submissionId]),
    findPublicFormSubmissionByToken: async (token) => loadPublicFormSubmissionByWhere("fs.access_token = ?", [token]),
    async submitPublicForm(input) {
      await executor.execute("START TRANSACTION");
      try {
        await executor.execute(
          [
            "UPDATE form_submissions",
            "SET responses = ?, status = 'submitted', submitted_at = CURRENT_TIMESTAMP",
            "WHERE id = ? AND status = 'pending'"
          ].join(" "),
          [JSON.stringify(input.responses), input.submissionId]
        );
        await executor.execute(
          [
            "UPDATE clients",
            "SET name = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP",
            "WHERE id = (SELECT client_id FROM form_submissions WHERE id = ? LIMIT 1)"
          ].join(" "),
          [input.contactName, input.contactEmail, input.contactPhone === "" ? null : input.contactPhone, input.submissionId]
        );
        const [submissionRows] = await executor.execute<Array<{ client_id: number | null; template_id: string | number | null }>>(
          [
            "SELECT client_id, template_id",
            "FROM form_submissions",
            "WHERE id = ?",
            "LIMIT 1"
          ].join(" "),
          [input.submissionId]
        );
        const clientId = submissionRows[0]?.client_id;
        const templateId = submissionRows[0]?.template_id;
        if (clientId != null && templateId != null) {
          await applyFormSubmissionTriggers({
            clientId: String(clientId),
            templateId: String(templateId)
          });
        }
        await executor.execute("COMMIT");
      } catch (error) {
        try {
          await executor.execute("ROLLBACK");
        } catch {
          // best effort rollback
        }
        throw error;
      }

      return await loadPublicFormSubmissionByWhere("fs.id = ?", [input.submissionId]);
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
    },
    async findPublicBookingIcalByToken(token) {
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
          "WHERE ical_token = ?",
          "LIMIT 1"
        ].join(" "),
        [token]
      );

      const row = rows[0];
      return row == null ? null : fromLegacyBookingRow(row);
    },
    verifyCaptcha: captchaVerifier
  };

  return {
    publicBooking,
    publicContact,
    publicPackages,
    integrationCallbacks,
    portalLogin,
    adminLogin,
    portalActorProfile,
    adminActorProfile,
    clientProfiles,
    portalSummary,
    adminDashboard,
    adminOperations,
    adminConfiguration,
    content,
    achievements,
    portalResources,
    adminResources,
    petFiles,
    contacts,
    adminCalendarSync,
    portalCommerce,
    publicDocuments,
    workflows
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
  "settings",
  "workflow_triggers",
  "workflow_step_executions",
  "workflow_steps",
  "workflows"
]);

const supportedMigrationTokenFields: Record<string, Set<string>> = {
  bookings: new Set(["ical_token"]),
  contracts: new Set(["access_token"]),
  form_submissions: new Set(["access_token"]),
  quotes: new Set(["access_token"])
};

const supportedLaunchPreflightTables = new Set([
  "app_sessions",
  "calendar_sync_links",
  "email_outbox",
  "inbound_emails",
  "integration_callbacks",
  "job_queue",
  "package_pending_purchases",
  "settings",
  "unmatched_emails",
  "workflow_enrollments",
  "workflow_triggers",
  "workflow_step_executions",
  "workflow_steps",
  "workflows"
]);

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

function assertSupportedLaunchPreflightTable(table: string): void {
  if (!supportedLaunchPreflightTables.has(table)) {
    throw new Error(`Unsupported launch preflight table: ${table}`);
  }
}

export function createMySqlMigrationAuditDependencies(
  executor: SqlExecutor,
  options: { now?: () => string } = {}
): LaunchPreflightDependencies {
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
    },
    async tableExists(table) {
      assertSupportedLaunchPreflightTable(table);
      const [rows] = await executor.execute<Array<{ tableName: string }>>(
        "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
        [table]
      );
      return rows.length > 0;
    }
  };
}

type MySqlBootstrapIndexStatement = {
  table: string;
  indexName: string;
  statement: string;
};

type MySqlBootstrapColumnStatement = {
  table: string;
  columnName: string;
  statement: string;
};

function escapeMySqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const mySqlBootstrapSettingsSeedStatements = [...managedSettingsCatalog.values()].flatMap((definition) => {
  const quotedKey = escapeMySqlString(definition.key);
  const quotedValue = escapeMySqlString(definition.bootstrapValue);
  const quotedType = escapeMySqlString(definition.type);
  const quotedCategory = escapeMySqlString(definition.category);
  const quotedLabel = escapeMySqlString(definition.label);
  const quotedDescription = escapeMySqlString(definition.description);
  const secretValue = definition.secret ? "1" : "0";

  return [
    [
      "INSERT INTO settings (setting_key, setting_value, setting_type, category, label, description, is_secret, updated_at)",
      `SELECT ${quotedKey}, ${quotedValue}, ${quotedType}, ${quotedCategory}, ${quotedLabel}, ${quotedDescription}, ${secretValue}, CURRENT_TIMESTAMP`,
      `WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key = ${quotedKey})`
    ].join(" "),
    [
      "UPDATE settings",
      `SET setting_type = ${quotedType},`,
      `category = ${quotedCategory},`,
      `label = ${quotedLabel},`,
      `description = ${quotedDescription},`,
      `is_secret = ${secretValue},`,
      "updated_at = CURRENT_TIMESTAMP",
      `WHERE setting_key = ${quotedKey}`,
      "AND (",
      `COALESCE(setting_type, '') <> ${quotedType}`,
      `OR COALESCE(category, '') <> ${quotedCategory}`,
      `OR COALESCE(label, '') <> ${quotedLabel}`,
      `OR COALESCE(description, '') <> ${quotedDescription}`,
      `OR is_secret <> ${secretValue}`,
      ")"
    ].join(" ")
  ];
});

const mySqlBootstrapTableStatements = [
  [
    "CREATE TABLE IF NOT EXISTS settings (",
    "setting_key VARCHAR(191) PRIMARY KEY,",
    "setting_value TEXT NULL,",
    "setting_type VARCHAR(64) NOT NULL DEFAULT 'text',",
    "category VARCHAR(64) NOT NULL DEFAULT 'general',",
    "label VARCHAR(255) NOT NULL DEFAULT '',",
    "description TEXT NULL,",
    "is_secret TINYINT(1) NOT NULL DEFAULT 0,",
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS app_sessions (",
    "session_id VARCHAR(191) PRIMARY KEY,",
    "session_data LONGTEXT NOT NULL,",
    "expires_at TIMESTAMP NOT NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
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
    "CREATE TABLE IF NOT EXISTS package_pending_purchases (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "package_id VARCHAR(128) NOT NULL,",
    "package_token VARCHAR(255) NOT NULL,",
    "stripe_checkout_session_id VARCHAR(255) NOT NULL,",
    "buyer_name VARCHAR(255) NOT NULL,",
    "buyer_email VARCHAR(255) NOT NULL,",
    "buyer_phone VARCHAR(64) NULL,",
    "notes TEXT NULL,",
    "form_submission_json JSON NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,",
    "UNIQUE KEY uniq_package_pending_purchases_package_session (package_id, stripe_checkout_session_id)",
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
    "CREATE TABLE IF NOT EXISTS google_oauth_tokens (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "admin_user_id BIGINT NOT NULL,",
    "access_token TEXT NOT NULL,",
    "refresh_token TEXT NULL,",
    "token_type VARCHAR(32) NOT NULL DEFAULT 'Bearer',",
    "expires_at TIMESTAMP NULL,",
    "calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',",
    "google_email VARCHAR(255) NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS workflows (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "workflow_id VARCHAR(128) NOT NULL UNIQUE,",
    "workflow_name VARCHAR(255) NOT NULL,",
    "workflow_description TEXT NULL,",
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
    "next_run_at TIMESTAMP NULL,",
    "completed_at TIMESTAMP NULL,",
    "status VARCHAR(32) NOT NULL DEFAULT 'active',",
    "enrolled_by VARCHAR(128) NULL,",
    "cancelled_at TIMESTAMP NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS workflow_triggers (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "workflow_trigger_id VARCHAR(128) NOT NULL UNIQUE,",
    "workflow_id VARCHAR(128) NOT NULL,",
    "trigger_type VARCHAR(64) NOT NULL,",
    "appointment_type_id VARCHAR(128) NULL,",
    "form_template_id VARCHAR(128) NULL,",
    "active TINYINT(1) NOT NULL DEFAULT 1,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS workflow_steps (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "workflow_step_id VARCHAR(128) NOT NULL UNIQUE,",
    "workflow_id VARCHAR(128) NOT NULL,",
    "step_order INT NOT NULL,",
    "step_name VARCHAR(255) NOT NULL,",
    "email_subject VARCHAR(255) NOT NULL,",
    "email_body_html MEDIUMTEXT NOT NULL,",
    "email_body_text MEDIUMTEXT NULL,",
    "delay_type VARCHAR(64) NOT NULL,",
    "delay_value VARCHAR(255) NULL,",
    "scheduled_date TIMESTAMP NULL,",
    "attach_contract_id VARCHAR(128) NULL,",
    "attach_form_id VARCHAR(128) NULL,",
    "attach_quote_id VARCHAR(128) NULL,",
    "attach_invoice_id VARCHAR(128) NULL,",
    "include_appointment_link TINYINT(1) NOT NULL DEFAULT 0,",
    "appointment_type_id VARCHAR(128) NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS workflow_step_executions (",
    "id BIGINT PRIMARY KEY AUTO_INCREMENT,",
    "workflow_step_execution_id VARCHAR(128) NOT NULL UNIQUE,",
    "enrollment_id VARCHAR(128) NOT NULL,",
    "step_id VARCHAR(128) NOT NULL,",
    "scheduled_for TIMESTAMP NOT NULL,",
    "executed_at TIMESTAMP NULL,",
    "status VARCHAR(32) NOT NULL DEFAULT 'pending',",
    "error_message TEXT NULL,",
    "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    ")"
  ].join(" ")
];

const mySqlBootstrapColumnStatements: MySqlBootstrapColumnStatement[] = [
  {
    table: "settings",
    columnName: "category",
    statement: "ALTER TABLE settings ADD COLUMN category VARCHAR(64) NOT NULL DEFAULT 'general' AFTER setting_type"
  },
  {
    table: "settings",
    columnName: "label",
    statement: "ALTER TABLE settings ADD COLUMN label VARCHAR(255) NOT NULL DEFAULT '' AFTER category"
  },
  {
    table: "settings",
    columnName: "description",
    statement: "ALTER TABLE settings ADD COLUMN description TEXT NULL AFTER label"
  },
  {
    table: "settings",
    columnName: "is_secret",
    statement: "ALTER TABLE settings ADD COLUMN is_secret TINYINT(1) NOT NULL DEFAULT 0 AFTER description"
  },
  {
    table: "settings",
    columnName: "updated_at",
    statement: "ALTER TABLE settings ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER is_secret"
  },
  {
    table: "workflows",
    columnName: "workflow_description",
    statement: "ALTER TABLE workflows ADD COLUMN workflow_description TEXT NULL AFTER workflow_name"
  },
  {
    table: "workflow_enrollments",
    columnName: "status",
    statement: "ALTER TABLE workflow_enrollments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER completed_at"
  },
  {
    table: "workflow_enrollments",
    columnName: "enrolled_by",
    statement: "ALTER TABLE workflow_enrollments ADD COLUMN enrolled_by VARCHAR(128) NULL AFTER status"
  },
  {
    table: "workflow_enrollments",
    columnName: "cancelled_at",
    statement: "ALTER TABLE workflow_enrollments ADD COLUMN cancelled_at TIMESTAMP NULL AFTER enrolled_by"
  }
];

const mySqlBootstrapIndexStatements: MySqlBootstrapIndexStatement[] = [
  {
    table: "inbound_emails",
    indexName: "idx_inbound_emails_provider_received_at",
    statement: "CREATE INDEX idx_inbound_emails_provider_received_at ON inbound_emails(provider, received_at)"
  },
  {
    table: "inbound_emails",
    indexName: "idx_inbound_emails_provider_message_id",
    statement: "CREATE INDEX idx_inbound_emails_provider_message_id ON inbound_emails(provider(16), message_id(170))"
  },
  {
    table: "inbound_emails",
    indexName: "idx_inbound_emails_message_id",
    statement: "CREATE INDEX idx_inbound_emails_message_id ON inbound_emails(message_id(170))"
  },
  {
    table: "unmatched_emails",
    indexName: "idx_unmatched_emails_reason_detected_at",
    statement: "CREATE INDEX idx_unmatched_emails_reason_detected_at ON unmatched_emails(reason, detected_at)"
  },
  {
    table: "integration_callbacks",
    indexName: "idx_integration_callbacks_provider_received_at",
    statement: "CREATE INDEX idx_integration_callbacks_provider_received_at ON integration_callbacks(provider, received_at)"
  },
  {
    table: "calendar_sync_links",
    indexName: "idx_calendar_sync_links_provider_synced_at",
    statement: "CREATE INDEX idx_calendar_sync_links_provider_synced_at ON calendar_sync_links(provider, synced_at)"
  },
  {
    table: "google_oauth_tokens",
    indexName: "idx_google_oauth_tokens_admin_user_id",
    statement: "CREATE INDEX idx_google_oauth_tokens_admin_user_id ON google_oauth_tokens(admin_user_id)"
  },
  {
    table: "workflows",
    indexName: "idx_workflows_active_trigger",
    statement: "CREATE INDEX idx_workflows_active_trigger ON workflows(active, workflow_trigger)"
  },
  {
    table: "workflow_enrollments",
    indexName: "idx_workflow_enrollments_run_at",
    statement: "CREATE INDEX idx_workflow_enrollments_run_at ON workflow_enrollments(completed_at, next_run_at)"
  },
  {
    table: "workflow_triggers",
    indexName: "idx_workflow_triggers_workflow",
    statement: "CREATE INDEX idx_workflow_triggers_workflow ON workflow_triggers(workflow_id, created_at)"
  },
  {
    table: "workflow_triggers",
    indexName: "idx_workflow_triggers_match",
    statement: "CREATE INDEX idx_workflow_triggers_match ON workflow_triggers(trigger_type, active, appointment_type_id, form_template_id)"
  },
  {
    table: "workflow_steps",
    indexName: "idx_workflow_steps_workflow_order",
    statement: "CREATE INDEX idx_workflow_steps_workflow_order ON workflow_steps(workflow_id, step_order)"
  },
  {
    table: "workflow_step_executions",
    indexName: "idx_workflow_step_executions_due",
    statement: "CREATE INDEX idx_workflow_step_executions_due ON workflow_step_executions(status, executed_at, scheduled_for)"
  },
  {
    table: "workflow_step_executions",
    indexName: "idx_workflow_step_executions_enrollment",
    statement: "CREATE INDEX idx_workflow_step_executions_enrollment ON workflow_step_executions(enrollment_id, status, scheduled_for)"
  },
  {
    table: "job_queue",
    indexName: "idx_job_queue_status_run_at",
    statement: "CREATE INDEX idx_job_queue_status_run_at ON job_queue(status, run_at)"
  },
  {
    table: "email_outbox",
    indexName: "idx_email_outbox_status_created_at",
    statement: "CREATE INDEX idx_email_outbox_status_created_at ON email_outbox(status, created_at)"
  }
];

export function getMySqlBootstrapStatements(): string[] {
  return [
    ...mySqlBootstrapTableStatements,
    ...mySqlBootstrapColumnStatements.map((statement) => statement.statement),
    ...mySqlBootstrapSettingsSeedStatements,
    ...mySqlBootstrapIndexStatements.map((statement) => statement.statement)
  ];
}

async function mySqlBootstrapColumnExists(
  executor: SqlExecutor,
  table: string,
  columnName: string
): Promise<boolean> {
  const [rows] = await executor.execute<Array<{ columnName: string }>>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [table, columnName]
  );
  return rows.length > 0;
}

async function mySqlBootstrapIndexExists(
  executor: SqlExecutor,
  table: string,
  indexName: string
): Promise<boolean> {
  const [rows] = await executor.execute<Array<{ indexName: string }>>(
    "SELECT index_name AS indexName FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
    [table, indexName]
  );
  return rows.length > 0;
}

export async function applyMySqlBootstrapStatement(executor: SqlExecutor, statement: string): Promise<boolean> {
  const columnStatement = mySqlBootstrapColumnStatements.find((candidate) => candidate.statement === statement);
  if (columnStatement != null) {
    if (await mySqlBootstrapColumnExists(executor, columnStatement.table, columnStatement.columnName)) {
      return false;
    }
  }

  const indexStatement = mySqlBootstrapIndexStatements.find((candidate) => candidate.statement === statement);
  if (indexStatement != null) {
    if (await mySqlBootstrapIndexExists(executor, indexStatement.table, indexStatement.indexName)) {
      return false;
    }
  }

  await executor.execute(statement);
  return true;
}

export async function applyMySqlBootstrap(executor: SqlExecutor): Promise<Array<{ statement: string; executed: boolean }>> {
  const audits: Array<{ statement: string; executed: boolean }> = [];

  for (const statement of getMySqlBootstrapStatements()) {
    audits.push({
      statement,
      executed: await applyMySqlBootstrapStatement(executor, statement)
    });
  }

  return audits;
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
