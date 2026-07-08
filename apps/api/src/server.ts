import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import { buildApiRuntime } from "./index.js";
import type { ApiDependencies } from "@bdta/application";
import { adminRoleSchema } from "@bdta/domain";
import { authSessionSchema } from "@bdta/contracts";

type SessionStore = {
  save(sessionId: string, sessionData: string): Promise<void>;
  load(sessionId: string): Promise<string | null>;
  delete(sessionId: string): Promise<void>;
} | null;

type ServerErrorContext = {
  requestId: string;
  method: string;
  path: string;
};

type RequestCompletionContext = ServerErrorContext & {
  statusCode: number;
  durationMs: number;
};

type HttpApiServerOptions = {
  dependencies: ApiDependencies;
  sessionStore: SessionStore;
  requestIdFactory?: () => string;
  onError?: (error: unknown, context: ServerErrorContext) => void | Promise<void>;
  onRequestComplete?: (context: RequestCompletionContext) => void | Promise<void>;
  healthCheck?: () => Promise<{
    status: "ok" | "degraded";
    checks: Record<string, "ok" | "error">;
  }>;
};

const storedSessionSchema = z.object({
  session: authSessionSchema.extend({
    role: adminRoleSchema.nullable().optional(),
    roleRefreshedAt: z.string().datetime().optional()
  })
});

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = (await readRawBody(request)).toString("utf8").trim();
  if (raw === "") {
    return {};
  }

  return JSON.parse(raw);
}

async function readJsonTextBody(request: IncomingMessage): Promise<{
  raw: string;
  parsed: unknown;
}> {
  const raw = (await readRawBody(request)).toString("utf8").trim();
  if (raw === "") {
    return {
      raw,
      parsed: {}
    };
  }

  return {
    raw,
    parsed: JSON.parse(raw)
  };
}

async function readFormDataBody(request: IncomingMessage): Promise<FormData> {
  const body = await readRawBody(request);
  const parsedRequest = new Request("http://localhost/upload", {
    method: request.method ?? "POST",
    headers: request.headers as HeadersInit,
    body: new Uint8Array(body)
  });
  return parsedRequest.formData();
}

async function readPetFileUploadInput(request: IncomingMessage): Promise<{
  originalName: string;
  description: string;
  content: Uint8Array;
}> {
  const formData = await readFormDataBody(request);
  const file = formData.get("file");
  const description = typeof formData.get("description") === "string"
    ? String(formData.get("description") ?? "")
    : "";

  if (!(file instanceof File)) {
    return {
      originalName: "",
      description,
      content: new Uint8Array()
    };
  }

  return {
    originalName: file.name,
    description,
    content: new Uint8Array(await file.arrayBuffer())
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function writeJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString(),
    ...headers
  });
  response.end(payload);
}

function writeText(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "text/calendar; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...headers
  });
  response.end(body);
}

function writeHtml(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...headers
  });
  response.end(body);
}

function writeBinary(
  response: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string> = {}
): void {
  response.writeHead(status, {
    "content-length": body.byteLength.toString(),
    ...headers
  });
  response.end(body);
}

async function persistSessionIfPresent(
  sessionStore: SessionStore,
  body: unknown
): Promise<Record<string, string>> {
  if (sessionStore == null || typeof body !== "object" || body == null || !("session" in body)) {
    return {};
  }

  const sessionId = randomUUID();
  await sessionStore.save(sessionId, JSON.stringify(body));

  return {
    "set-cookie": `bdta_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
  };
}

function readSessionIdFromCookie(request: IncomingMessage): string | null {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader == null || cookieHeader.trim() === "") {
    return null;
  }

  for (const fragment of cookieHeader.split(";")) {
    const [name, ...valueParts] = fragment.trim().split("=");
    if (name === "bdta_session") {
      const value = valueParts.join("=").trim();
      return value === "" ? null : value;
    }
  }

  return null;
}

async function loadPersistedSession(sessionStore: SessionStore, request: IncomingMessage): Promise<unknown | null> {
  const sessionId = readSessionIdFromCookie(request);
  if (sessionStore == null || sessionId == null) {
    return null;
  }

  const raw = await sessionStore.load(sessionId);
  if (raw == null) {
    return null;
  }

  const parsed = JSON.parse(raw);
  return storedSessionSchema.parse(parsed).session;
}

export function createHttpApiServer(options: HttpApiServerOptions): Server {
  const runtime = buildApiRuntime(options.dependencies);

  return createServer(async (request, response) => {
    const requestId = options.requestIdFactory?.() ?? randomUUID();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const startedAt = Date.now();
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => {
      void Promise.resolve(options.onRequestComplete?.({
        requestId,
        method,
        path: url.pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt
      })).catch(() => undefined);
    });

    try {
      if (method === "GET" && url.pathname === "/health") {
        if (options.healthCheck == null) {
          writeJson(response, 200, { status: "ok" });
          return;
        }

        const report = await options.healthCheck();
        writeJson(response, report.status === "ok" ? 200 : 503, report);
        return;
      }

      if (method === "POST" && url.pathname === "/api/public/bookings") {
        const result = await runtime.handlers.handlePublicBooking(await readJsonBody(request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && (url.pathname === "/api/public/contact" || url.pathname === "/backend/public/api_contact.php")) {
        const result = await runtime.handlers.handlePublicContact(await readJsonBody(request));
        if ("error" in result.body) {
          writeJson(response, result.status, {
            success: false,
            error: result.body.error.message
          });
          return;
        }

        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/public/blog") {
        const result = await runtime.handlers.handlePublicBlogPosts();
        writeJson(response, result.status, result.body);
        return;
      }

      const publicBlogPostMatch = method === "GET" ? /^\/api\/public\/blog\/([^/]+)$/.exec(url.pathname) : null;
      if (publicBlogPostMatch != null) {
        const result = await runtime.handlers.handlePublicBlogPostDetail(decodeURIComponent(publicBlogPostMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/public/site") {
        const result = await runtime.handlers.handlePublicSitePage(url.searchParams.get("slug"));
        writeJson(response, result.status, result.body);
        return;
      }

      const callbackMatch = method === "POST" ? /^\/api\/callbacks\/([^/]+)$/.exec(url.pathname) : null;
      if (callbackMatch != null) {
        const callbackBody = await readJsonTextBody(request);
        const receivedAt = isRecord(callbackBody.parsed) && typeof callbackBody.parsed.receivedAt === "string"
          ? callbackBody.parsed.receivedAt
          : undefined;
        const payload = isRecord(callbackBody.parsed) && isRecord(callbackBody.parsed.payload)
          ? callbackBody.parsed.payload
          : isRecord(callbackBody.parsed)
            ? Object.fromEntries(Object.entries(callbackBody.parsed).filter(([key]) => key !== "receivedAt"))
            : {};

        const result = await runtime.handlers.handleIntegrationCallback({
          provider: decodeURIComponent(callbackMatch[1] ?? ""),
          receivedAt,
          payload,
          rawBody: callbackBody.raw,
          signature: request.headers["stripe-signature"] == null
            ? undefined
            : Array.isArray(request.headers["stripe-signature"])
              ? (request.headers["stripe-signature"][0] ?? undefined)
              : request.headers["stripe-signature"]
        });
        writeJson(response, result.status, result.body);
        return;
      }

      const publicQuoteMatch = method === "GET" ? /^\/api\/public\/quotes\/([^/]+)$/.exec(url.pathname) : null;
      if (publicQuoteMatch != null) {
        const result = await runtime.handlers.handlePublicQuoteDetail({
          quoteId: decodeURIComponent(publicQuoteMatch[1] ?? ""),
          token: url.searchParams.get("token"),
          session: await loadPersistedSession(options.sessionStore, request)
        });
        writeJson(response, result.status, result.body);
        return;
      }

      const publicContractMatch = method === "GET" ? /^\/api\/public\/contracts\/([^/]+)$/.exec(url.pathname) : null;
      if (publicContractMatch != null) {
        const result = await runtime.handlers.handlePublicContractDetail({
          contractId: decodeURIComponent(publicContractMatch[1] ?? ""),
          token: url.searchParams.get("token"),
          session: await loadPersistedSession(options.sessionStore, request)
        });
        writeJson(response, result.status, result.body);
        return;
      }

      const publicFormMatch = method === "GET" ? /^\/api\/public\/forms\/([^/]+)$/.exec(url.pathname) : null;
      if (publicFormMatch != null) {
        const result = await runtime.handlers.handlePublicFormSubmissionDetail({
          submissionId: decodeURIComponent(publicFormMatch[1] ?? ""),
          token: url.searchParams.get("token"),
          session: await loadPersistedSession(options.sessionStore, request)
        });
        writeJson(response, result.status, result.body);
        return;
      }

      const publicBookingIcalMatch = method === "GET" ? /^\/api\/public\/bookings\/([^/]+)\/ical$/.exec(url.pathname) : null;
      if (publicBookingIcalMatch != null) {
        const result = await runtime.handlers.handlePublicBookingIcalDetail({
          bookingId: decodeURIComponent(publicBookingIcalMatch[1] ?? ""),
          token: url.searchParams.get("token"),
          session: await loadPersistedSession(options.sessionStore, request)
        });
        if (typeof result.body === "string") {
          writeText(response, result.status, result.body, {
            "content-disposition": `attachment; filename="booking-${encodeURIComponent(publicBookingIcalMatch[1] ?? "event")}.ics"`
          });
        } else {
          writeJson(response, result.status, result.body);
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/portal/login") {
        const result = await runtime.handlers.handlePortalLogin(await readJsonBody(request));
        const headers = await persistSessionIfPresent(options.sessionStore, result.body);
        writeJson(response, result.status, result.body, headers);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/login") {
        const result = await runtime.handlers.handleAdminLogin(await readJsonBody(request));
        const headers = await persistSessionIfPresent(options.sessionStore, result.body);
        writeJson(response, result.status, result.body, headers);
        return;
      }

      if (method === "GET" && url.pathname === "/api/session") {
        const session = await loadPersistedSession(options.sessionStore, request);
        if (session == null) {
          writeJson(response, 200, { authenticated: false });
          return;
        }

        writeJson(response, 200, {
          authenticated: true,
          session
        });
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/me") {
        const result = await runtime.handlers.handlePortalActorProfile(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/profile") {
        const result = await runtime.handlers.handlePortalProfile(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/portal/profile") {
        const result = await runtime.handlers.handlePortalProfileUpdate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/summary") {
        const result = await runtime.handlers.handlePortalSummary(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/achievements") {
        const result = await runtime.handlers.handlePortalAchievements(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalAchievementCertificateMatch = method === "GET" ? /^\/api\/portal\/achievements\/([^/]+)\/certificate$/.exec(url.pathname) : null;
      if (portalAchievementCertificateMatch != null) {
        const achievementId = decodeURIComponent(portalAchievementCertificateMatch[1] ?? "");
        const download = url.searchParams.get("download") === "1";
        const result = await runtime.handlers.handlePortalAchievementCertificate(
          await loadPersistedSession(options.sessionStore, request),
          achievementId,
          download
        );
        if (typeof result.body === "string") {
          writeHtml(response, result.status, result.body, {
            "content-disposition": `${download ? "attachment" : "inline"}; filename="achievement-${encodeURIComponent(achievementId)}.html"`
          });
        } else {
          writeJson(response, result.status, result.body);
        }
        return;
      }

      const portalAchievementMatch = method === "GET" ? /^\/api\/portal\/achievements\/([^/]+)$/.exec(url.pathname) : null;
      if (portalAchievementMatch != null) {
        const result = await runtime.handlers.handlePortalAchievementDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalAchievementMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/bookings") {
        const result = await runtime.handlers.handlePortalBookings(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/pets") {
        const result = await runtime.handlers.handlePortalPets(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalPetMatch = method === "GET" ? /^\/api\/portal\/pets\/([^/]+)$/.exec(url.pathname) : null;
      if (portalPetMatch != null) {
        const result = await runtime.handlers.handlePortalPetDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalPetMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalPetFilesMatch = method === "GET" ? /^\/api\/portal\/pets\/([^/]+)\/files$/.exec(url.pathname) : null;
      if (portalPetFilesMatch != null) {
        const result = await runtime.handlers.handlePortalPetFiles(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalPetFilesMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalPetFileUploadMatch = method === "POST" ? /^\/api\/portal\/pets\/([^/]+)\/files$/.exec(url.pathname) : null;
      if (portalPetFileUploadMatch != null) {
        const result = await runtime.handlers.handlePortalPetFileUpload(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalPetFileUploadMatch[1] ?? ""),
          await readPetFileUploadInput(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalPetFileDetailMatch = method === "GET" ? /^\/api\/portal\/pets\/([^/]+)\/files\/([^/]+)$/.exec(url.pathname) : null;
      if (portalPetFileDetailMatch != null) {
        const result = await runtime.handlers.handlePortalPetFileDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalPetFileDetailMatch[1] ?? ""),
          decodeURIComponent(portalPetFileDetailMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalPetFileContentMatch = method === "GET" ? /^\/api\/portal\/pets\/([^/]+)\/files\/([^/]+)\/content$/.exec(url.pathname) : null;
      if (portalPetFileContentMatch != null) {
        const result = await runtime.handlers.handlePortalPetFileContent(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalPetFileContentMatch[1] ?? ""),
          decodeURIComponent(portalPetFileContentMatch[2] ?? ""),
          url.searchParams.get("download") === "1"
        );
        if ("error" in result.body) {
          writeJson(response, result.status, result.body);
          return;
        }

        writeBinary(
          response,
          result.status,
          Buffer.from(result.body.contentBase64, "base64"),
          {
            "content-type": result.body.item.mimeType,
            "content-disposition": `${result.body.disposition}; filename="${result.body.fileName}"`,
            "cache-control": "private, max-age=0, no-cache, must-revalidate",
            pragma: "no-cache"
          }
        );
        return;
      }

      const portalPetFileDeleteMatch = method === "POST" ? /^\/api\/portal\/pets\/([^/]+)\/files\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (portalPetFileDeleteMatch != null) {
        const result = await runtime.handlers.handlePortalPetFileDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalPetFileDeleteMatch[1] ?? ""),
          decodeURIComponent(portalPetFileDeleteMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalBookingMatch = method === "GET" ? /^\/api\/portal\/bookings\/([^/]+)$/.exec(url.pathname) : null;
      if (portalBookingMatch != null) {
        const result = await runtime.handlers.handlePortalBookingDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalBookingMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/contacts") {
        const result = await runtime.handlers.handlePortalContacts(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/portal/contacts") {
        const result = await runtime.handlers.handlePortalContactCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalContactDeleteMatch = method === "POST" ? /^\/api\/portal\/contacts\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (portalContactDeleteMatch != null) {
        const result = await runtime.handlers.handlePortalContactDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalContactDeleteMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalContactUpdateMatch = method === "POST" ? /^\/api\/portal\/contacts\/([^/]+)$/.exec(url.pathname) : null;
      if (portalContactUpdateMatch != null) {
        const result = await runtime.handlers.handlePortalContactUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalContactUpdateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const portalContactMatch = method === "GET" ? /^\/api\/portal\/contacts\/([^/]+)$/.exec(url.pathname) : null;
      if (portalContactMatch != null) {
        const result = await runtime.handlers.handlePortalContactDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalContactMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/invoices") {
        const result = await runtime.handlers.handlePortalInvoices(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalInvoiceMatch = method === "GET" ? /^\/api\/portal\/invoices\/([^/]+)$/.exec(url.pathname) : null;
      if (portalInvoiceMatch != null) {
        const result = await runtime.handlers.handlePortalInvoiceDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalInvoiceMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/quotes") {
        const result = await runtime.handlers.handlePortalQuotes(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalQuoteMatch = method === "GET" ? /^\/api\/portal\/quotes\/([^/]+)$/.exec(url.pathname) : null;
      if (portalQuoteMatch != null) {
        const result = await runtime.handlers.handlePortalQuoteDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalQuoteMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/contracts") {
        const result = await runtime.handlers.handlePortalContracts(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalContractMatch = method === "GET" ? /^\/api\/portal\/contracts\/([^/]+)$/.exec(url.pathname) : null;
      if (portalContractMatch != null) {
        const result = await runtime.handlers.handlePortalContractDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalContractMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

        if (method === "GET" && url.pathname === "/api/portal/forms") {
          const result = await runtime.handlers.handlePortalForms(await loadPersistedSession(options.sessionStore, request));
          writeJson(response, result.status, result.body);
          return;
        }

        if (method === "GET" && url.pathname === "/api/portal/notifications") {
          const result = await runtime.handlers.handlePortalNotifications(await loadPersistedSession(options.sessionStore, request));
          writeJson(response, result.status, result.body);
          return;
        }

        if (method === "GET" && url.pathname === "/api/portal/packages") {
          const result = await runtime.handlers.handlePortalPackages(await loadPersistedSession(options.sessionStore, request));
          writeJson(response, result.status, result.body);
          return;
        }

      const portalPackageMatch = method === "GET" ? /^\/api\/portal\/packages\/([^/]+)$/.exec(url.pathname) : null;
      if (portalPackageMatch != null) {
        const result = await runtime.handlers.handlePortalPackageDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalPackageMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/portal/credits") {
        const result = await runtime.handlers.handlePortalCredits(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalCreditMatch = method === "GET" ? /^\/api\/portal\/credits\/([^/]+)$/.exec(url.pathname) : null;
      if (portalCreditMatch != null) {
        const result = await runtime.handlers.handlePortalCreditDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalCreditMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalFormMatch = method === "GET" ? /^\/api\/portal\/forms\/([^/]+)$/.exec(url.pathname) : null;
      if (portalFormMatch != null) {
        const result = await runtime.handlers.handlePortalFormDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalFormMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalQuoteAcceptMatch = method === "POST" ? /^\/api\/portal\/quotes\/([^/]+)\/accept$/.exec(url.pathname) : null;
      if (portalQuoteAcceptMatch != null) {
        const result = await runtime.handlers.handlePortalQuoteAccept(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalQuoteAcceptMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalContractSignMatch = method === "POST" ? /^\/api\/portal\/contracts\/([^/]+)\/sign$/.exec(url.pathname) : null;
      if (portalContractSignMatch != null) {
        const result = await runtime.handlers.handlePortalContractSign(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalContractSignMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalFormSubmitMatch = method === "POST" ? /^\/api\/portal\/forms\/([^/]+)\/submit$/.exec(url.pathname) : null;
      if (portalFormSubmitMatch != null) {
        const result = await runtime.handlers.handlePortalFormSubmit(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(portalFormSubmitMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const portalInvoicePaymentMatch = method === "POST" ? /^\/api\/portal\/invoices\/([^/]+)\/payment-session$/.exec(url.pathname) : null;
      if (portalInvoicePaymentMatch != null) {
        const result = await runtime.handlers.handlePortalInvoicePaymentSession(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(portalInvoicePaymentMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/me") {
        const result = await runtime.handlers.handleAdminActorProfile(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/access") {
        const result = await runtime.handlers.handleAdminRouteAccess({
          session: await loadPersistedSession(options.sessionStore, request),
          path: url.searchParams.get("path")
        });
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/dashboard") {
        const result = await runtime.handlers.handleAdminDashboard(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/blog-posts") {
        const result = await runtime.handlers.handleAdminBlogPosts(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/blog-posts") {
        const result = await runtime.handlers.handleAdminBlogPostCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBlogPostDeleteMatch = method === "POST" ? /^\/api\/admin\/blog-posts\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminBlogPostDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminBlogPostDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminBlogPostDeleteMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBlogPostUpdateMatch = method === "POST" ? /^\/api\/admin\/blog-posts\/([^/]+)$/.exec(url.pathname) : null;
      if (adminBlogPostUpdateMatch != null) {
        const result = await runtime.handlers.handleAdminBlogPostUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminBlogPostUpdateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBlogPostMatch = method === "GET" ? /^\/api\/admin\/blog-posts\/([^/]+)$/.exec(url.pathname) : null;
      if (adminBlogPostMatch != null) {
        const result = await runtime.handlers.handleAdminBlogPostDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminBlogPostMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/site-pages") {
        const result = await runtime.handlers.handleAdminSitePages(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/site-pages") {
        const result = await runtime.handlers.handleAdminSitePageCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminSitePageUpdateMatch = method === "POST" ? /^\/api\/admin\/site-pages\/([^/]+)$/.exec(url.pathname) : null;
      if (adminSitePageUpdateMatch != null) {
        const result = await runtime.handlers.handleAdminSitePageUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminSitePageUpdateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminSitePageMatch = method === "GET" ? /^\/api\/admin\/site-pages\/([^/]+)$/.exec(url.pathname) : null;
      if (adminSitePageMatch != null) {
        const result = await runtime.handlers.handleAdminSitePageDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminSitePageMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/settings") {
        const result = await runtime.handlers.handleAdminSettings(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminSettingUpdateMatch = method === "POST" ? /^\/api\/admin\/settings\/([^/]+)$/.exec(url.pathname) : null;
      if (adminSettingUpdateMatch != null) {
        const result = await runtime.handlers.handleAdminSettingUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminSettingUpdateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminSettingMatch = method === "GET" ? /^\/api\/admin\/settings\/([^/]+)$/.exec(url.pathname) : null;
      if (adminSettingMatch != null) {
        const result = await runtime.handlers.handleAdminSettingDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminSettingMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/appointment-types") {
        const result = await runtime.handlers.handleAdminAppointmentTypes(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/appointment-types") {
        const result = await runtime.handlers.handleAdminAppointmentTypeCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminAppointmentTypeDeleteMatch = method === "POST" ? /^\/api\/admin\/appointment-types\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminAppointmentTypeDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminAppointmentTypeDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminAppointmentTypeDeleteMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminAppointmentTypeMatch = /^\/api\/admin\/appointment-types\/([^/]+)$/.exec(url.pathname);
      if (adminAppointmentTypeMatch != null) {
        const appointmentTypeId = decodeURIComponent(adminAppointmentTypeMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminAppointmentTypeDetail(
            await loadPersistedSession(options.sessionStore, request),
            appointmentTypeId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminAppointmentTypeUpdate(
            await loadPersistedSession(options.sessionStore, request),
            appointmentTypeId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/admin/form-templates") {
        const result = await runtime.handlers.handleAdminFormTemplates(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/form-templates") {
        const result = await runtime.handlers.handleAdminFormTemplateCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminFormTemplateDeleteMatch = method === "POST" ? /^\/api\/admin\/form-templates\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminFormTemplateDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminFormTemplateDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminFormTemplateDeleteMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminFormTemplateMatch = /^\/api\/admin\/form-templates\/([^/]+)$/.exec(url.pathname);
      if (adminFormTemplateMatch != null) {
        const templateId = decodeURIComponent(adminFormTemplateMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminFormTemplateDetail(
            await loadPersistedSession(options.sessionStore, request),
            templateId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminFormTemplateUpdate(
            await loadPersistedSession(options.sessionStore, request),
            templateId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/admin/email-templates") {
        const result = await runtime.handlers.handleAdminEmailTemplates(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/email-templates") {
        const result = await runtime.handlers.handleAdminEmailTemplateCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminEmailTemplateMatch = /^\/api\/admin\/email-templates\/([^/]+)$/.exec(url.pathname);
      if (adminEmailTemplateMatch != null) {
        const templateId = decodeURIComponent(adminEmailTemplateMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminEmailTemplateDetail(
            await loadPersistedSession(options.sessionStore, request),
            templateId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminEmailTemplateUpdate(
            await loadPersistedSession(options.sessionStore, request),
            templateId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/admin/scheduled-tasks") {
        const result = await runtime.handlers.handleAdminScheduledTasks(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/scheduled-tasks") {
        const result = await runtime.handlers.handleAdminScheduledTaskCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminScheduledTaskMatch = /^\/api\/admin\/scheduled-tasks\/([^/]+)$/.exec(url.pathname);
      if (adminScheduledTaskMatch != null) {
        const taskId = decodeURIComponent(adminScheduledTaskMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminScheduledTaskDetail(
            await loadPersistedSession(options.sessionStore, request),
            taskId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminScheduledTaskUpdate(
            await loadPersistedSession(options.sessionStore, request),
            taskId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      if (method === "GET" && url.pathname === "/api/admin/achievement-types") {
        const result = await runtime.handlers.handleAdminAchievementTypes(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminAchievementTypeMatch = method === "GET" ? /^\/api\/admin\/achievement-types\/([^/]+)$/.exec(url.pathname) : null;
      if (adminAchievementTypeMatch != null) {
        const result = await runtime.handlers.handleAdminAchievementTypeDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminAchievementTypeMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/operations/jobs") {
        const result = await runtime.handlers.handleAdminJobLogs(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminOperationJobMatch = method === "GET" ? /^\/api\/admin\/operations\/jobs\/([^/]+)$/.exec(url.pathname) : null;
      if (adminOperationJobMatch != null) {
        const result = await runtime.handlers.handleAdminJobLogDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminOperationJobMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/operations/callbacks") {
        const result = await runtime.handlers.handleAdminIntegrationCallbackLogs(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminOperationCallbackMatch = method === "GET" ? /^\/api\/admin\/operations\/callbacks\/([^/]+)$/.exec(url.pathname) : null;
      if (adminOperationCallbackMatch != null) {
        const result = await runtime.handlers.handleAdminIntegrationCallbackLogDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminOperationCallbackMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/clients") {
        const result = await runtime.handlers.handleAdminClients(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/clients") {
        const result = await runtime.handlers.handleAdminClientCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientProfileMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/profile$/.exec(url.pathname) : null;
      if (adminClientProfileMatch != null) {
        const result = await runtime.handlers.handleAdminClientProfile(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientProfileMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientProfileUpdateMatch = method === "POST" ? /^\/api\/admin\/clients\/([^/]+)\/profile$/.exec(url.pathname) : null;
      if (adminClientProfileUpdateMatch != null) {
        const result = await runtime.handlers.handleAdminClientUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientProfileUpdateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientContactDeleteMatch = method === "POST" ? /^\/api\/admin\/clients\/([^/]+)\/contacts\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminClientContactDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminClientContactDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientContactDeleteMatch[1] ?? ""),
          decodeURIComponent(adminClientContactDeleteMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientContactUpdateMatch = method === "POST" ? /^\/api\/admin\/clients\/([^/]+)\/contacts\/([^/]+)$/.exec(url.pathname) : null;
      if (adminClientContactUpdateMatch != null) {
        const result = await runtime.handlers.handleAdminClientContactUpdate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientContactUpdateMatch[1] ?? ""),
          decodeURIComponent(adminClientContactUpdateMatch[2] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientContactMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/contacts\/([^/]+)$/.exec(url.pathname) : null;
      if (adminClientContactMatch != null) {
        const result = await runtime.handlers.handleAdminClientContactDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientContactMatch[1] ?? ""),
          decodeURIComponent(adminClientContactMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientContactsCreateMatch = method === "POST" ? /^\/api\/admin\/clients\/([^/]+)\/contacts$/.exec(url.pathname) : null;
      if (adminClientContactsCreateMatch != null) {
        const result = await runtime.handlers.handleAdminClientContactCreate(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientContactsCreateMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientContactsMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/contacts$/.exec(url.pathname) : null;
      if (adminClientContactsMatch != null) {
        const result = await runtime.handlers.handleAdminClientContacts(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientContactsMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientAchievementCertificateMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/achievements\/([^/]+)\/certificate$/.exec(url.pathname) : null;
      if (adminClientAchievementCertificateMatch != null) {
        const clientId = decodeURIComponent(adminClientAchievementCertificateMatch[1] ?? "");
        const achievementId = decodeURIComponent(adminClientAchievementCertificateMatch[2] ?? "");
        const download = url.searchParams.get("download") === "1";
        const result = await runtime.handlers.handleAdminClientAchievementCertificate(
          await loadPersistedSession(options.sessionStore, request),
          clientId,
          achievementId,
          download
        );
        if (typeof result.body === "string") {
          writeHtml(response, result.status, result.body, {
            "content-disposition": `${download ? "attachment" : "inline"}; filename="achievement-${encodeURIComponent(achievementId)}.html"`
          });
        } else {
          writeJson(response, result.status, result.body);
        }
        return;
      }

      const adminClientAchievementMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/achievements\/([^/]+)$/.exec(url.pathname) : null;
      if (adminClientAchievementMatch != null) {
        const result = await runtime.handlers.handleAdminClientAchievementDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientAchievementMatch[1] ?? ""),
          decodeURIComponent(adminClientAchievementMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientAchievementsMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)\/achievements$/.exec(url.pathname) : null;
      if (adminClientAchievementsMatch != null) {
        const result = await runtime.handlers.handleAdminClientAchievements(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminClientAchievementsMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/pets") {
        const result = await runtime.handlers.handleAdminPets(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPetMatch = method === "GET" ? /^\/api\/admin\/pets\/([^/]+)$/.exec(url.pathname) : null;
      if (adminPetMatch != null) {
        const result = await runtime.handlers.handleAdminPetDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminPetMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPetFilesMatch = method === "GET" ? /^\/api\/admin\/pets\/([^/]+)\/files$/.exec(url.pathname) : null;
      if (adminPetFilesMatch != null) {
        const result = await runtime.handlers.handleAdminPetFiles(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminPetFilesMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPetFileUploadMatch = method === "POST" ? /^\/api\/admin\/pets\/([^/]+)\/files$/.exec(url.pathname) : null;
      if (adminPetFileUploadMatch != null) {
        const result = await runtime.handlers.handleAdminPetFileUpload(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminPetFileUploadMatch[1] ?? ""),
          await readPetFileUploadInput(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPetFileDetailMatch = method === "GET" ? /^\/api\/admin\/pets\/([^/]+)\/files\/([^/]+)$/.exec(url.pathname) : null;
      if (adminPetFileDetailMatch != null) {
        const result = await runtime.handlers.handleAdminPetFileDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminPetFileDetailMatch[1] ?? ""),
          decodeURIComponent(adminPetFileDetailMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPetFileContentMatch = method === "GET" ? /^\/api\/admin\/pets\/([^/]+)\/files\/([^/]+)\/content$/.exec(url.pathname) : null;
      if (adminPetFileContentMatch != null) {
        const result = await runtime.handlers.handleAdminPetFileContent(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminPetFileContentMatch[1] ?? ""),
          decodeURIComponent(adminPetFileContentMatch[2] ?? ""),
          url.searchParams.get("download") === "1"
        );
        if ("error" in result.body) {
          writeJson(response, result.status, result.body);
          return;
        }

        writeBinary(
          response,
          result.status,
          Buffer.from(result.body.contentBase64, "base64"),
          {
            "content-type": result.body.item.mimeType,
            "content-disposition": `${result.body.disposition}; filename="${result.body.fileName}"`,
            "cache-control": "private, max-age=0, no-cache, must-revalidate",
            pragma: "no-cache"
          }
        );
        return;
      }

      const adminPetFileDeleteMatch = method === "POST" ? /^\/api\/admin\/pets\/([^/]+)\/files\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminPetFileDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminPetFileDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminPetFileDeleteMatch[1] ?? ""),
          decodeURIComponent(adminPetFileDeleteMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminClientMatch = method === "GET" ? /^\/api\/admin\/clients\/([^/]+)$/.exec(url.pathname) : null;
      if (adminClientMatch != null) {
        const result = await runtime.handlers.handleAdminClientDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminClientMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/bookings") {
        const result = await runtime.handlers.handleAdminBookings(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBookingMatch = method === "GET" ? /^\/api\/admin\/bookings\/([^/]+)$/.exec(url.pathname) : null;
      if (adminBookingMatch != null) {
        const result = await runtime.handlers.handleAdminBookingDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminBookingMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBookingCalendarSyncDetailMatch = method === "GET" ? /^\/api\/admin\/bookings\/([^/]+)\/calendar-sync$/.exec(url.pathname) : null;
      if (adminBookingCalendarSyncDetailMatch != null) {
        const result = await runtime.handlers.handleAdminBookingCalendarSyncDetail(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminBookingCalendarSyncDetailMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminBookingCalendarSyncMatch = method === "POST" ? /^\/api\/admin\/bookings\/([^/]+)\/calendar-sync$/.exec(url.pathname) : null;
      if (adminBookingCalendarSyncMatch != null) {
        const result = await runtime.handlers.handleAdminBookingCalendarSync(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminBookingCalendarSyncMatch[1] ?? ""),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/invoices") {
        const result = await runtime.handlers.handleAdminInvoices(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminInvoiceMatch = method === "GET" ? /^\/api\/admin\/invoices\/([^/]+)$/.exec(url.pathname) : null;
      if (adminInvoiceMatch != null) {
        const result = await runtime.handlers.handleAdminInvoiceDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminInvoiceMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/quotes") {
        const result = await runtime.handlers.handleAdminQuotes(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminQuoteMatch = method === "GET" ? /^\/api\/admin\/quotes\/([^/]+)$/.exec(url.pathname) : null;
      if (adminQuoteMatch != null) {
        const result = await runtime.handlers.handleAdminQuoteDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminQuoteMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/contracts") {
        const result = await runtime.handlers.handleAdminContracts(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminContractMatch = method === "GET" ? /^\/api\/admin\/contracts\/([^/]+)$/.exec(url.pathname) : null;
      if (adminContractMatch != null) {
        const result = await runtime.handlers.handleAdminContractDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminContractMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/forms") {
        const result = await runtime.handlers.handleAdminForms(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/packages") {
        const result = await runtime.handlers.handleAdminPackages(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminPackageMatch = method === "GET" ? /^\/api\/admin\/packages\/([^/]+)$/.exec(url.pathname) : null;
      if (adminPackageMatch != null) {
        const result = await runtime.handlers.handleAdminPackageDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminPackageMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/credits") {
        const result = await runtime.handlers.handleAdminCredits(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminCreditMatch = method === "GET" ? /^\/api\/admin\/credits\/([^/]+)$/.exec(url.pathname) : null;
      if (adminCreditMatch != null) {
        const result = await runtime.handlers.handleAdminCreditDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminCreditMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      const adminFormMatch = method === "GET" ? /^\/api\/admin\/forms\/([^/]+)$/.exec(url.pathname) : null;
      if (adminFormMatch != null) {
        const result = await runtime.handlers.handleAdminFormDetail(await loadPersistedSession(options.sessionStore, request), decodeURIComponent(adminFormMatch[1] ?? ""));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "GET" && url.pathname === "/api/admin/workflows") {
        const result = await runtime.handlers.handleAdminWorkflows(await loadPersistedSession(options.sessionStore, request));
        writeJson(response, result.status, result.body);
        return;
      }

      if (method === "POST" && url.pathname === "/api/admin/workflows") {
        const result = await runtime.handlers.handleAdminWorkflowCreate(
          await loadPersistedSession(options.sessionStore, request),
          await readJsonBody(request)
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowTriggerDeleteMatch = method === "POST" ? /^\/api\/admin\/workflows\/([^/]+)\/triggers\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminWorkflowTriggerDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowTriggerDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowTriggerDeleteMatch[1] ?? ""),
          decodeURIComponent(adminWorkflowTriggerDeleteMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowTriggersMatch = /^\/api\/admin\/workflows\/([^/]+)\/triggers$/.exec(url.pathname);
      if (adminWorkflowTriggersMatch != null) {
        const workflowId = decodeURIComponent(adminWorkflowTriggersMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminWorkflowTriggers(
            await loadPersistedSession(options.sessionStore, request),
            workflowId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminWorkflowTriggerCreate(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      const adminWorkflowEnrollmentCancelMatch = method === "POST" ? /^\/api\/admin\/workflows\/([^/]+)\/enrollments\/([^/]+)\/cancel$/.exec(url.pathname) : null;
      if (adminWorkflowEnrollmentCancelMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowEnrollmentCancel(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowEnrollmentCancelMatch[1] ?? ""),
          decodeURIComponent(adminWorkflowEnrollmentCancelMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowEnrollmentsMatch = method === "GET" ? /^\/api\/admin\/workflows\/([^/]+)\/enrollments$/.exec(url.pathname) : null;
      if (adminWorkflowEnrollmentsMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowEnrollments(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowEnrollmentsMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowEnrollMatch = /^\/api\/admin\/workflows\/([^/]+)\/enroll$/.exec(url.pathname);
      if (adminWorkflowEnrollMatch != null) {
        const workflowId = decodeURIComponent(adminWorkflowEnrollMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminWorkflowEnrollableClients(
            await loadPersistedSession(options.sessionStore, request),
            workflowId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminWorkflowEnroll(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      const adminWorkflowStepDeleteMatch = method === "POST" ? /^\/api\/admin\/workflows\/([^/]+)\/steps\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminWorkflowStepDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowStepDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowStepDeleteMatch[1] ?? ""),
          decodeURIComponent(adminWorkflowStepDeleteMatch[2] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowStepNewMatch = method === "GET" ? /^\/api\/admin\/workflows\/([^/]+)\/steps\/new$/.exec(url.pathname) : null;
      if (adminWorkflowStepNewMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowStepEditor(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowStepNewMatch[1] ?? ""),
          null
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowStepDetailMatch = /^\/api\/admin\/workflows\/([^/]+)\/steps\/([^/]+)$/.exec(url.pathname);
      if (adminWorkflowStepDetailMatch != null) {
        const workflowId = decodeURIComponent(adminWorkflowStepDetailMatch[1] ?? "");
        const stepId = decodeURIComponent(adminWorkflowStepDetailMatch[2] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminWorkflowStepEditor(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            stepId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminWorkflowStepUpdate(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            stepId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      const adminWorkflowStepsMatch = /^\/api\/admin\/workflows\/([^/]+)\/steps$/.exec(url.pathname);
      if (adminWorkflowStepsMatch != null) {
        const workflowId = decodeURIComponent(adminWorkflowStepsMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminWorkflowSteps(
            await loadPersistedSession(options.sessionStore, request),
            workflowId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminWorkflowStepCreate(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      const adminWorkflowDeleteMatch = method === "POST" ? /^\/api\/admin\/workflows\/([^/]+)\/delete$/.exec(url.pathname) : null;
      if (adminWorkflowDeleteMatch != null) {
        const result = await runtime.handlers.handleAdminWorkflowDelete(
          await loadPersistedSession(options.sessionStore, request),
          decodeURIComponent(adminWorkflowDeleteMatch[1] ?? "")
        );
        writeJson(response, result.status, result.body);
        return;
      }

      const adminWorkflowDetailMatch = /^\/api\/admin\/workflows\/([^/]+)$/.exec(url.pathname);
      if (adminWorkflowDetailMatch != null) {
        const workflowId = decodeURIComponent(adminWorkflowDetailMatch[1] ?? "");
        if (method === "GET") {
          const result = await runtime.handlers.handleAdminWorkflowDetail(
            await loadPersistedSession(options.sessionStore, request),
            workflowId
          );
          writeJson(response, result.status, result.body);
          return;
        }
        if (method === "POST") {
          const result = await runtime.handlers.handleAdminWorkflowUpdate(
            await loadPersistedSession(options.sessionStore, request),
            workflowId,
            await readJsonBody(request)
          );
          writeJson(response, result.status, result.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/api/logout") {
        const sessionId = readSessionIdFromCookie(request);
        if (options.sessionStore != null && sessionId != null) {
          await options.sessionStore.delete(sessionId);
        }

        writeJson(response, 200, { loggedOut: true }, {
          "set-cookie": "bdta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        });
        return;
      }

      writeJson(response, 404, {
        error: {
          code: "not_found",
          message: "Route not found."
        }
      });
    } catch (error) {
      await options.onError?.(error, {
        requestId,
        method,
        path: url.pathname
      });

      if (!response.headersSent) {
        writeJson(response, 500, {
          error: {
            code: "internal_error",
            message: "Unexpected server failure."
          }
        });
        return;
      }

      if (!response.writableEnded) {
        response.end();
      }
    }
  });
}
