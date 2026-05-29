import { once } from "node:events";

import { createHttpWebServer } from "../apps/web/src/server.js";
import { createInMemoryPlatformState } from "@bdta/infrastructure";

describe("web server", () => {
  it("renders homepage, site pages, and blog routes from content state", async () => {
    const state = createInMemoryPlatformState({
      blogPosts: [
        {
          id: "blog-1",
          title: "Loose Leash Training Tips",
          slug: "loose-leash-training-tips",
          content: "<p>Walks start before the leash clips on.</p>",
          excerpt: "Walks start before the leash clips on.",
          coverPhoto: "/images/blog/loose-leash.jpg",
          author: "Brook",
          published: true,
          publishDate: "2026-05-28T15:00:00.000Z",
          createdAt: "2026-05-20T10:00:00.000Z",
          updatedAt: "2026-05-28T15:00:00.000Z"
        }
      ],
      sitePages: [
        {
          id: "page-home",
          slug: "home",
          title: "Brook's Dog Training Academy",
          htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
          cssContent: "body { color: #1f2933; }",
          metaDescription: "Private lessons and board-and-train programs.",
          metaKeywords: "dog training, obedience",
          ogTitle: "BDTA Home",
          ogDescription: "Dog training for real family life.",
          ogImage: "/images/og/home.jpg",
          isHomepage: true,
          published: true,
          sortOrder: 1,
          updatedByAdminUserId: "admin-1",
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-28T12:00:00.000Z"
        },
        {
          id: "page-services",
          slug: "services",
          title: "Services",
          htmlContent: "<section><h1>Programs</h1><p>Private lessons and board-and-train.</p></section>",
          cssContent: "",
          metaDescription: "Training services",
          metaKeywords: "",
          ogTitle: null,
          ogDescription: null,
          ogImage: null,
          isHomepage: false,
          published: true,
          sortOrder: 2,
          updatedByAdminUserId: "admin-1",
          createdAt: "2026-05-02T10:00:00.000Z",
          updatedAt: "2026-05-28T12:00:00.000Z"
        }
      ]
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const home = await fetch(`${baseUrl}/`);
      const services = await fetch(`${baseUrl}/services`);
      const blogIndex = await fetch(`${baseUrl}/blog`);
      const blogPost = await fetch(`${baseUrl}/blog/loose-leash-training-tips`);

      expect(home.status).toBe(200);
      expect(services.status).toBe(200);
      expect(blogIndex.status).toBe(200);
      expect(blogPost.status).toBe(200);

      expect(await home.text()).toContain("Train the dog in front of you.");
      expect(await services.text()).toContain("Private lessons and board-and-train.");
      expect(await blogIndex.text()).toContain("Loose Leash Training Tips");
      expect(await blogPost.text()).toContain("Walks start before the leash clips on.");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports portal login and renders session-backed portal pages", async () => {
    const state = createInMemoryPlatformState({
      bookings: [
        {
          id: "booking-1",
          clientId: "client-portal-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: null
        }
      ],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }
      ],
      contracts: [
        {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          publicAccess: null
        }
      ],
      formSubmissions: [
        {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          submittedAt: null,
          publicAccess: null
        }
      ],
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: null
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "portal@example.com",
          displayName: "Portal User",
          passwordHash: "portal-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => password === "portal-password" && hash === "portal-hash"
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const loginPage = await fetch(`${baseUrl}/portal/login`);
      expect(loginPage.status).toBe(200);
      expect(await loginPage.text()).toContain("Portal Login");

      const login = await fetch(`${baseUrl}/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          email: "portal@example.com",
          password: "portal-password"
        })
      });

      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/portal");
      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const portalHome = await fetch(`${baseUrl}/portal`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const appointments = await fetch(`${baseUrl}/portal/appointments`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const invoices = await fetch(`${baseUrl}/portal/invoices`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const quotes = await fetch(`${baseUrl}/portal/quotes`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const contracts = await fetch(`${baseUrl}/portal/contracts`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const forms = await fetch(`${baseUrl}/portal/forms`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(portalHome.status).toBe(200);
      expect(appointments.status).toBe(200);
      expect(invoices.status).toBe(200);
      expect(quotes.status).toBe(200);
      expect(contracts.status).toBe(200);
      expect(forms.status).toBe(200);

      const portalHomeHtml = await portalHome.text();
      const appointmentsHtml = await appointments.text();
      const invoicesHtml = await invoices.text();
      const quotesHtml = await quotes.text();
      const contractsHtml = await contracts.text();
      const formsHtml = await forms.text();

      expect(portalHomeHtml).toContain("Portal User");
      expect(portalHomeHtml).toContain("svc-private-lesson");
      expect(appointmentsHtml).toContain("booking-1");
      expect(invoicesHtml).toContain("invoice-1");
      expect(invoicesHtml).toContain("125");
      expect(quotesHtml).toContain("quote-1");
      expect(contractsHtml).toContain("contract-1");
      expect(formsHtml).toContain("form-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders the public booking page and accepts portal commerce actions", async () => {
    const state = createInMemoryPlatformState({
      contracts: [
        {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          publicAccess: null
        }
      ],
      formSubmissions: [
        {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          submittedAt: null,
          publicAccess: null
        }
      ],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "portal@example.com",
          displayName: "Portal User",
          passwordHash: "portal-hash",
          archived: false
        }
      ],
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: null
        }
      ],
      passwordVerifier: async (password, hash) => password === "portal-password" && hash === "portal-hash"
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const bookingPage = await fetch(`${baseUrl}/book`);
      expect(bookingPage.status).toBe(200);
      expect(await bookingPage.text()).toContain("Book Training");

      const bookingSubmit = await fetch(`${baseUrl}/book`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          serviceId: "svc-private-lesson",
          clientEmail: "new-client@example.com",
          requestedStart: "2026-06-10T16:00:00.000Z",
          requestedEnd: "2026-06-10T17:00:00.000Z",
          turnstileToken: "turnstile-ok"
        })
      });

      expect(bookingSubmit.status).toBe(302);
      expect(bookingSubmit.headers.get("location")).toContain("/book/confirmation?bookingId=");
      expect(state.bookings).toHaveLength(1);

      const portalLogin = await fetch(`${baseUrl}/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          email: "portal@example.com",
          password: "portal-password"
        })
      });

      const cookie = portalLogin.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const quoteAccept = await fetch(`${baseUrl}/portal/quotes/quote-1/accept`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });
      const contractSign = await fetch(`${baseUrl}/portal/contracts/contract-1/sign`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });
      const formSubmit = await fetch(`${baseUrl}/portal/forms/form-1/submit`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });
      const invoicePay = await fetch(`${baseUrl}/portal/invoices/invoice-1/pay`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });

      expect(quoteAccept.status).toBe(302);
      expect(contractSign.status).toBe(302);
      expect(formSubmit.status).toBe(302);
      expect(invoicePay.status).toBe(302);
      expect(state.quotes[0]?.status).toBe("accepted");
      expect(state.contracts[0]?.status).toBe("signed");
      expect(state.formSubmissions[0]?.submittedAt).toBe("2026-05-27T18:00:00.000Z");
      expect(invoicePay.headers.get("location")).toContain("invoice=invoice-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });
});
