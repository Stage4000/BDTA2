import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import {
  createApiHandlers,
  getPublicBlogPostDetail,
  getPublicSitePage,
  listPublicBlogPosts,
  type ApiDependencies,
  type ContentManagementDependencies
} from "@bdta/application";
import { authSessionSchema } from "@bdta/contracts";
import { createInMemoryApiDependencies, createInMemorySessionStore, type InMemoryPlatformState } from "@bdta/infrastructure";

type SessionStore = {
  save(sessionId: string, sessionData: string): Promise<void>;
  load(sessionId: string): Promise<string | null>;
  delete(sessionId: string): Promise<void>;
} | null;

type HttpWebServerOptions =
  | { dependencies: ApiDependencies; sessionStore?: SessionStore; state?: never; content?: never }
  | { state: InMemoryPlatformState; dependencies?: never; content?: never; sessionStore?: never }
  | { content: ContentManagementDependencies; dependencies?: never; state?: never; sessionStore?: never };

type ResolvedWebDependencies = {
  content: ContentManagementDependencies;
  api: ApiDependencies | null;
  sessionStore: SessionStore;
};

const storedSessionSchema = z.object({
  session: authSessionSchema.extend({
    role: z.string().nullable().optional(),
    roleRefreshedAt: z.string().datetime().optional()
  })
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveDependencies(options: HttpWebServerOptions): ResolvedWebDependencies {
  if ("dependencies" in options && options.dependencies != null) {
    return {
      content: options.dependencies.content,
      api: options.dependencies,
      sessionStore: options.sessionStore ?? null
    };
  }

  if ("content" in options && options.content != null) {
    return {
      content: options.content,
      api: null,
      sessionStore: null
    };
  }

  const api = createInMemoryApiDependencies(options.state);
  return {
    content: api.content,
    api,
    sessionStore: createInMemorySessionStore(options.state)
  };
}

function renderLayout(input: {
  title: string;
  description?: string;
  css?: string;
  body: string;
}): string {
  const description = input.description == null || input.description.trim() === ""
    ? "Brook's Dog Training Academy"
    : input.description;

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    "<style>",
    "body { margin: 0; font-family: Georgia, serif; color: #1f2933; background: linear-gradient(180deg, #f7f3ec 0%, #ffffff 100%); }",
    "header { padding: 24px 32px; border-bottom: 1px solid rgba(31, 41, 51, 0.08); background: rgba(255,255,255,0.85); position: sticky; top: 0; backdrop-filter: blur(8px); }",
    "header nav { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }",
    "header a { color: #6b2c5d; text-decoration: none; font-weight: 600; }",
    "main { max-width: 980px; margin: 0 auto; padding: 40px 24px 72px; }",
    "article { background: white; border: 1px solid rgba(31, 41, 51, 0.08); border-radius: 24px; padding: 32px; box-shadow: 0 16px 40px rgba(31, 41, 51, 0.06); }",
    ".blog-list, .portal-list { display: grid; gap: 20px; }",
    ".blog-card, .portal-card { background: white; border: 1px solid rgba(31, 41, 51, 0.08); border-radius: 20px; padding: 24px; box-shadow: 0 12px 30px rgba(31, 41, 51, 0.05); }",
    ".eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: #6b7280; }",
    ".meta { color: #6b7280; font-size: 14px; }",
    "h1, h2 { margin-top: 0; }",
    "label { display: block; font-weight: 600; }",
    "input { display: block; width: 100%; padding: 12px; margin-top: 6px; box-sizing: border-box; }",
    "button { padding: 12px 16px; background: #6b2c5d; color: #fff; border: none; border-radius: 999px; cursor: pointer; }",
    `${input.css ?? ""}`,
    "</style>",
    "</head>",
    "<body>",
    "<header><nav><a href=\"/\">Home</a><a href=\"/services\">Services</a><a href=\"/blog\">Blog</a><a href=\"/book\">Book</a><a href=\"/portal\">Portal</a></nav></header>",
    `<main>${input.body}</main>`,
    "</body>",
    "</html>"
  ].join("");
}

function writeHtml(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...headers
  });
  response.end(body);
}

function redirect(response: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  response.writeHead(302, {
    location,
    ...headers
  });
  response.end();
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

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams((await readRawBody(request)).toString("utf8"));
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

  return storedSessionSchema.parse(JSON.parse(raw)).session;
}

async function persistSession(sessionStore: SessionStore, body: unknown): Promise<Record<string, string>> {
  if (sessionStore == null || typeof body !== "object" || body == null || !("session" in body)) {
    return {};
  }

  const sessionId = randomUUID();
  await sessionStore.save(sessionId, JSON.stringify(body));

  return {
    "set-cookie": `bdta_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`
  };
}

function toLocalLocation(value: string): string {
  if (value.startsWith("/")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const local = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return local === "" ? "/" : local;
  } catch {
    return "/";
  }
}

function getRequestOrigin(request: IncomingMessage): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? (forwardedProto[0] ?? "http")
    : (forwardedProto ?? "http");
  const host = request.headers.host ?? "localhost";
  return `${protocol}://${host}`;
}

export function createHttpWebServer(options: HttpWebServerOptions): Server {
  const resolved = resolveDependencies(options);
  const handlers = resolved.api == null ? null : createApiHandlers(resolved.api);

  return createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");

    try {
      if (method === "GET" && url.pathname === "/portal/login") {
        writeHtml(response, 200, renderLayout({
          title: "Portal Login",
          body: [
            "<article>",
            '<p class="eyebrow">Client Portal</p>',
            "<h1>Portal Login</h1>",
            '<form method="post" action="/portal/login" style="display:grid;gap:16px;max-width:420px;">',
            '<label>Email<input type="email" name="email" required></label>',
            '<label>Password<input type="password" name="password" required></label>',
            '<button type="submit">Sign In</button>',
            "</form>",
            "</article>"
          ].join("")
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/portal/login" && handlers != null) {
        const form = await readFormBody(request);
        const result = await handlers.handlePortalLogin({
          email: form.get("email"),
          password: form.get("password"),
          returnTo: null
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Portal Login",
            body: `<article><h1>Portal Login</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, toLocalLocation(result.body.redirectTo), await persistSession(resolved.sessionStore, result.body));
        return;
      }

      if (method === "GET" && url.pathname === "/book") {
        writeHtml(response, 200, renderLayout({
          title: "Book Training",
          body: [
            "<article>",
            '<p class="eyebrow">Schedule Training</p>',
            "<h1>Book Training</h1>",
            "<p>Send a booking request for your next training session.</p>",
            '<form method="post" action="/book" style="display:grid;gap:16px;max-width:560px;">',
            '<label>Service ID<input type="text" name="serviceId" value="svc-private-lesson" required></label>',
            '<label>Email<input type="email" name="clientEmail" required></label>',
            '<label>Requested Start<input type="datetime-local" name="requestedStart" required></label>',
            '<label>Requested End<input type="datetime-local" name="requestedEnd" required></label>',
            '<label>Turnstile Token<input type="text" name="turnstileToken" value="turnstile-ok" required></label>',
            '<button type="submit">Request Booking</button>',
            "</form>",
            "</article>"
          ].join("")
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/book" && handlers != null) {
        const form = await readFormBody(request);
        const result = await handlers.handlePublicBooking({
          serviceId: form.get("serviceId"),
          clientEmail: form.get("clientEmail"),
          petIds: form.getAll("petId").filter((value) => value.trim() !== ""),
          requestedStart: form.get("requestedStart"),
          requestedEnd: form.get("requestedEnd"),
          turnstileToken: form.get("turnstileToken")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Book Training",
            body: [
              "<article>",
              "<h1>Book Training</h1>",
              `<p>${escapeHtml(result.body.error.message)}</p>`,
              '<p><a href="/book">Return to booking form</a></p>',
              "</article>"
            ].join("")
          }));
          return;
        }

        redirect(response, `/book/confirmation?bookingId=${encodeURIComponent(result.body.bookingId)}`);
        return;
      }

      if (method === "GET" && url.pathname === "/book/confirmation") {
        const bookingId = url.searchParams.get("bookingId") ?? "pending";
        writeHtml(response, 200, renderLayout({
          title: "Booking Confirmation",
          body: [
            "<article>",
            '<p class="eyebrow">Booking Received</p>',
            "<h1>Thanks for your request</h1>",
            `<p>Your booking request has been recorded as <strong>${escapeHtml(bookingId)}</strong>.</p>`,
            '<p><a href="/portal/login">Go to portal</a></p>',
            "</article>"
          ].join("")
        }));
        return;
      }

      if (method === "GET" && url.pathname === "/portal/logout") {
        const sessionId = readSessionIdFromCookie(request);
        if (resolved.sessionStore != null && sessionId != null) {
          await resolved.sessionStore.delete(sessionId);
        }

        redirect(response, "/portal/login", {
          "set-cookie": "bdta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        });
        return;
      }

      const quoteAcceptMatch = /^\/portal\/quotes\/([^/]+)\/accept$/.exec(url.pathname);
      if (method === "POST" && handlers != null && quoteAcceptMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, "/portal/login");
          return;
        }

        const result = await handlers.handlePortalQuoteAccept(session, decodeURIComponent(quoteAcceptMatch[1] ?? ""));
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Quote Action",
            body: `<article><h1>Quote Action</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/quotes");
        return;
      }

      const contractSignMatch = /^\/portal\/contracts\/([^/]+)\/sign$/.exec(url.pathname);
      if (method === "POST" && handlers != null && contractSignMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, "/portal/login");
          return;
        }

        const result = await handlers.handlePortalContractSign(session, decodeURIComponent(contractSignMatch[1] ?? ""));
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Contract Action",
            body: `<article><h1>Contract Action</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/contracts");
        return;
      }

      const formSubmitMatch = /^\/portal\/forms\/([^/]+)\/submit$/.exec(url.pathname);
      if (method === "POST" && handlers != null && formSubmitMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, "/portal/login");
          return;
        }

        const result = await handlers.handlePortalFormSubmit(session, decodeURIComponent(formSubmitMatch[1] ?? ""));
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Form Action",
            body: `<article><h1>Form Action</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/forms");
        return;
      }

      const invoicePayMatch = /^\/portal\/invoices\/([^/]+)\/pay$/.exec(url.pathname);
      if (method === "POST" && handlers != null && invoicePayMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, "/portal/login");
          return;
        }

        const origin = getRequestOrigin(request);
        const result = await handlers.handlePortalInvoicePaymentSession(
          session,
          decodeURIComponent(invoicePayMatch[1] ?? ""),
          {
            returnUrl: `${origin}/portal/invoices`,
            cancelUrl: `${origin}/portal/invoices`
          }
        );

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Invoice Payment",
            body: `<article><h1>Invoice Payment</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, result.body.paymentSession.checkoutUrl);
        return;
      }

      if (
        handlers != null
        && (
          url.pathname === "/portal"
          || url.pathname === "/portal/appointments"
          || url.pathname === "/portal/invoices"
          || url.pathname === "/portal/quotes"
          || url.pathname === "/portal/contracts"
          || url.pathname === "/portal/forms"
        )
      ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, "/portal/login");
          return;
        }

        const actor = await handlers.handlePortalActorProfile(session);
        if ("error" in actor.body) {
          redirect(response, "/portal/login");
          return;
        }

        if (url.pathname === "/portal") {
          const summary = await handlers.handlePortalSummary(session);
          if ("error" in summary.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal",
            body: [
              "<article>",
              '<p class="eyebrow">Client Portal</p>',
              `<h1>${escapeHtml(actor.body.actor.displayName)}</h1>`,
              '<p><a href="/portal/appointments">Appointments</a> | <a href="/portal/invoices">Invoices</a> | <a href="/portal/quotes">Quotes</a> | <a href="/portal/contracts">Contracts</a> | <a href="/portal/forms">Forms</a> | <a href="/portal/logout">Logout</a></p>',
              "<h2>Upcoming Bookings</h2>",
              summary.body.upcomingBookings.length === 0
                ? "<p>No upcoming bookings.</p>"
                : `<div class="portal-list">${summary.body.upcomingBookings.map((booking) => `<section class="portal-card"><strong>${escapeHtml(booking.id)}</strong><div>${escapeHtml(booking.serviceId)}</div><div class="meta">${escapeHtml(booking.startsAt)}</div></section>`).join("")}</div>`,
              "<h2>Open Invoices</h2>",
              summary.body.openInvoices.length === 0
                ? "<p>No open invoices.</p>"
                : `<div class="portal-list">${summary.body.openInvoices.map((invoice) => `<section class="portal-card"><strong>${escapeHtml(invoice.id)}</strong><div>Outstanding ${invoice.outstandingAmount}</div><div class="meta">${escapeHtml(invoice.status)}</div></section>`).join("")}</div>`,
              "<h2>Active Quotes</h2>",
              summary.body.activeQuotes.length === 0
                ? "<p>No active quotes.</p>"
                : `<div class="portal-list">${summary.body.activeQuotes.map((quote) => `<section class="portal-card"><strong>${escapeHtml(quote.id)}</strong><div>Total ${quote.totalAmount}</div><div class="meta">${escapeHtml(quote.status)}</div></section>`).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/appointments") {
          const bookings = await handlers.handlePortalBookings(session);
          if ("error" in bookings.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Appointments",
            body: [
              "<article>",
              '<p class="eyebrow">Appointments</p>',
              "<h1>Your Appointments</h1>",
              '<p><a href="/portal">Back to portal</a></p>',
              bookings.body.items.length === 0
                ? "<p>No appointments.</p>"
                : `<div class="portal-list">${bookings.body.items.map((booking) => `<section class="portal-card"><strong>${escapeHtml(booking.id)}</strong><div>${escapeHtml(booking.serviceId)}</div><div class="meta">${escapeHtml(booking.startsAt)}</div></section>`).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/invoices") {
          const invoices = await handlers.handlePortalInvoices(session);
          if ("error" in invoices.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Invoices",
            body: [
              "<article>",
              '<p class="eyebrow">Invoices</p>',
              "<h1>Your Invoices</h1>",
              '<p><a href="/portal">Back to portal</a></p>',
              invoices.body.items.length === 0
                ? "<p>No invoices.</p>"
                : `<div class="portal-list">${invoices.body.items.map((invoice) => [
                    '<section class="portal-card">',
                    `<strong>${escapeHtml(invoice.id)}</strong>`,
                    `<div>Outstanding ${invoice.outstandingAmount}</div>`,
                    `<div class="meta">${escapeHtml(invoice.status)}</div>`,
                    invoice.outstandingAmount > 0 && invoice.status !== "paid" && invoice.status !== "void"
                      ? `<form method="post" action="/portal/invoices/${encodeURIComponent(invoice.id)}/pay"><button type="submit">Pay Invoice</button></form>`
                      : "<p>Paid</p>",
                    "</section>"
                  ].join("")).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/quotes") {
          const quotes = await handlers.handlePortalQuotes(session);
          if ("error" in quotes.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Quotes",
            body: [
              "<article>",
              '<p class="eyebrow">Quotes</p>',
              "<h1>Your Quotes</h1>",
              '<p><a href="/portal">Back to portal</a></p>',
              quotes.body.items.length === 0
                ? "<p>No quotes.</p>"
                : `<div class="portal-list">${quotes.body.items.map((quote) => [
                    '<section class="portal-card">',
                    `<strong>${escapeHtml(quote.id)}</strong>`,
                    `<div>Total ${quote.totalAmount}</div>`,
                    `<div class="meta">${escapeHtml(quote.status)}</div>`,
                    quote.status === "accepted"
                      ? "<p>Accepted</p>"
                      : `<form method="post" action="/portal/quotes/${encodeURIComponent(quote.id)}/accept"><button type="submit">Accept Quote</button></form>`,
                    "</section>"
                  ].join("")).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/contracts") {
          const contracts = await handlers.handlePortalContracts(session);
          if ("error" in contracts.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Contracts",
            body: [
              "<article>",
              '<p class="eyebrow">Contracts</p>',
              "<h1>Your Contracts</h1>",
              '<p><a href="/portal">Back to portal</a></p>',
              contracts.body.items.length === 0
                ? "<p>No contracts.</p>"
                : `<div class="portal-list">${contracts.body.items.map((contract) => [
                    '<section class="portal-card">',
                    `<strong>${escapeHtml(contract.id)}</strong>`,
                    `<div class="meta">${escapeHtml(contract.status)}</div>`,
                    contract.status === "signed"
                      ? "<p>Signed</p>"
                      : `<form method="post" action="/portal/contracts/${encodeURIComponent(contract.id)}/sign"><button type="submit">Sign Contract</button></form>`,
                    "</section>"
                  ].join("")).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/forms") {
          const forms = await handlers.handlePortalForms(session);
          if ("error" in forms.body) {
            redirect(response, "/portal/login");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Forms",
            body: [
              "<article>",
              '<p class="eyebrow">Forms</p>',
              "<h1>Your Forms</h1>",
              '<p><a href="/portal">Back to portal</a></p>',
              forms.body.items.length === 0
                ? "<p>No forms.</p>"
                : `<div class="portal-list">${forms.body.items.map((form) => [
                    '<section class="portal-card">',
                    `<strong>${escapeHtml(form.id)}</strong>`,
                    `<div class="meta">${form.submittedAt == null ? "Pending" : `Submitted ${escapeHtml(form.submittedAt)}`}</div>`,
                    form.submittedAt == null
                      ? `<form method="post" action="/portal/forms/${encodeURIComponent(form.id)}/submit"><button type="submit">Submit Form</button></form>`
                      : "<p>Submitted</p>",
                    "</section>"
                  ].join("")).join("")}</div>`,
              "</article>"
            ].join("")
          }));
          return;
        }
      }

      if (method !== "GET") {
        writeHtml(response, 405, renderLayout({
          title: "Method Not Allowed",
          body: "<article><h1>Method Not Allowed</h1></article>"
        }));
        return;
      }

      if (url.pathname === "/") {
        const page = await getPublicSitePage(null, resolved.content);
        writeHtml(response, 200, renderLayout({
          title: page.item.title,
          description: page.item.metaDescription,
          css: page.item.cssContent,
          body: `<article>${page.item.htmlContent}</article>`
        }));
        return;
      }

      if (url.pathname === "/blog") {
        const posts = await listPublicBlogPosts(resolved.content);
        const body = [
          "<section>",
          '<p class="eyebrow">BDTA Journal</p>',
          "<h1>Latest Training Notes</h1>",
          '<div class="blog-list">',
          ...posts.items.map((post) => [
            '<article class="blog-card">',
            `<p class="meta">${escapeHtml(post.author)}${post.publishDate ? ` | ${escapeHtml(post.publishDate.slice(0, 10))}` : ""}</p>`,
            `<h2><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>`,
            `<p>${escapeHtml(post.excerpt)}</p>`,
            "</article>"
          ].join("")),
          "</div>",
          "</section>"
        ].join("");

        writeHtml(response, 200, renderLayout({
          title: "Blog",
          body
        }));
        return;
      }

      const blogMatch = /^\/blog\/([^/]+)$/.exec(url.pathname);
      if (blogMatch != null) {
        const post = await getPublicBlogPostDetail(decodeURIComponent(blogMatch[1] ?? ""), resolved.content);
        writeHtml(response, 200, renderLayout({
          title: post.item.title,
          description: post.item.excerpt,
          body: [
            "<article>",
            '<p class="eyebrow">BDTA Journal</p>',
            `<h1>${escapeHtml(post.item.title)}</h1>`,
            `<p class="meta">${escapeHtml(post.item.author)}${post.item.publishDate ? ` | ${escapeHtml(post.item.publishDate.slice(0, 10))}` : ""}</p>`,
            post.item.content,
            "</article>"
          ].join("")
        }));
        return;
      }

      const slug = url.pathname.replace(/^\/+/, "");
      if (slug !== "") {
        const page = await getPublicSitePage(slug, resolved.content);
        writeHtml(response, 200, renderLayout({
          title: page.item.title,
          description: page.item.metaDescription,
          css: page.item.cssContent,
          body: `<article>${page.item.htmlContent}</article>`
        }));
        return;
      }

      writeHtml(response, 404, renderLayout({
        title: "Not Found",
        body: "<article><h1>Not Found</h1></article>"
      }));
    } catch {
      writeHtml(response, 404, renderLayout({
        title: "Not Found",
        body: "<article><h1>Not Found</h1></article>"
      }));
    }
  });
}
