import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHttpWebServer } from "../apps/web/src/server.js";
import { createManagedSettingsCatalog } from "../apps/release/src/settings-catalog.js";
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
          coverPhoto: "/backend/uploads/blog/loose-leash.jpg",
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
      const health = await fetch(`${baseUrl}/health`);
      const home = await fetch(`${baseUrl}/`);
      const services = await fetch(`${baseUrl}/services`);
      const blogIndex = await fetch(`${baseUrl}/blog`);
      const blogPost = await fetch(`${baseUrl}/blog/loose-leash-training-tips`);

      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");
      expect(home.status).toBe(200);
      expect(services.status).toBe(200);
      expect(blogIndex.status).toBe(200);
      expect(blogPost.status).toBe(200);

      const homeHtml = await home.text();
      const servicesHtml = await services.text();
      const blogIndexHtml = await blogIndex.text();
      const blogPostHtml = await blogPost.text();

      expect(homeHtml).toContain("Train the dog in front of you.");
      expect(servicesHtml).toContain("Private lessons and board-and-train.");
      expect(blogIndexHtml).toContain("Loose Leash Training Tips");
      expect(blogPostHtml).toContain("Walks start before the leash clips on.");
      expect(homeHtml).toContain("hero-section");
      expect(homeHtml).toContain("navbar");
      expect(homeHtml).toContain("Poppins");
      expect(homeHtml).toContain("Montserrat");
      expect(homeHtml).not.toContain("BDTA Client Portal");
      expect(homeHtml).not.toContain("BDTA Client CRM");
      expect(homeHtml).toContain("marketing-hero");
      expect(homeHtml).toContain("hero-media-frame");
      expect(homeHtml).toContain("/assets/images/hero-dog-real.jpg");
      expect(homeHtml).toContain("about-panel");
      expect(homeHtml).toContain("process-grid");
      expect(homeHtml).toContain("testimonial-grid");
      expect(homeHtml).toContain("contact-panel");
      expect(servicesHtml).toContain("program-grid");
      expect(servicesHtml).toContain("service-overview-grid");
      expect(servicesHtml).toContain("Private Coaching");
      expect(blogIndexHtml).toContain("featured-story");
      expect(blogIndexHtml).toContain("featured-story__content");
      expect(blogIndexHtml).toContain('/backend/uploads/blog/loose-leash.jpg');
      expect(blogPostHtml).toContain("article-shell");
      expect(blogPostHtml).toContain('/backend/uploads/blog/loose-leash.jpg');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

it("renders public content when migrated blog and page metadata uses blank strings", async () => {
  const state = createInMemoryPlatformState({
    blogPosts: [
      {
        id: "blog-legacy-1",
        title: "Legacy Training Notes",
        slug: "legacy-training-notes",
        content: "<p>Legacy migration content still needs to render.</p>",
        excerpt: "Legacy migration content still needs to render.",
        coverPhoto: null,
        author: "",
        published: true,
        publishDate: "2026-06-01T12:00:00.000Z",
        createdAt: "2026-06-01T12:00:00.000Z",
        updatedAt: "2026-06-01T12:00:00.000Z"
      }
    ],
    sitePages: [
      {
        id: "page-home-legacy",
        slug: "home",
        title: "Brook's Dog Training Academy",
        htmlContent: "<section><h1>Legacy homepage content</h1></section>",
        cssContent: "",
        metaDescription: "Legacy homepage description.",
        metaKeywords: "legacy, home",
        ogTitle: "",
        ogDescription: "",
        ogImage: "",
        isHomepage: true,
        published: true,
        sortOrder: 1,
        updatedByAdminUserId: null,
        createdAt: "2026-06-01T12:00:00.000Z",
        updatedAt: "2026-06-01T12:00:00.000Z"
      },
      {
        id: "page-directory-legacy",
        slug: "directory",
        title: "Directory",
        htmlContent: "<section><h1>Directory</h1><p>Legacy directory copy.</p></section>",
        cssContent: "",
        metaDescription: "Legacy directory description.",
        metaKeywords: "legacy, directory",
        ogTitle: "",
        ogDescription: "",
        ogImage: "",
        isHomepage: false,
        published: true,
        sortOrder: 2,
        updatedByAdminUserId: null,
        createdAt: "2026-06-01T12:00:00.000Z",
        updatedAt: "2026-06-01T12:00:00.000Z"
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
    const [home, directory, blogIndex, blogPost] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/directory`),
      fetch(`${baseUrl}/blog`),
      fetch(`${baseUrl}/blog/legacy-training-notes`)
    ]);

    expect(home.status).toBe(200);
    expect(directory.status).toBe(200);
    expect(blogIndex.status).toBe(200);
    expect(blogPost.status).toBe(200);

    expect(await home.text()).toContain("Legacy homepage content");
    expect(await directory.text()).toContain("Legacy directory copy.");
    expect(await blogIndex.text()).toContain("Legacy Training Notes");
    expect(await blogPost.text()).toContain("Legacy migration content still needs to render.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
});

it("renders newsletter and Tawk settings on eligible public pages and suppresses them when legacy rules require it", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          passwordHash: "admin-hash",
          role: "owner",
          active: true
        }
      ],
      blogPosts: [
        {
          id: "blog-1",
          title: "Loose Leash Training Tips",
          slug: "loose-leash-training-tips",
          content: "<p>Walks start before the leash clips on.</p>",
          excerpt: "Walks start before the leash clips on.",
          coverPhoto: "/backend/uploads/blog/loose-leash.jpg",
          author: "Brook",
          published: true,
          publishDate: "2026-05-28T15:00:00.000Z",
          createdAt: "2026-05-20T10:00:00.000Z",
          updatedAt: "2026-05-28T15:00:00.000Z"
        }
      ],
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          active: true,
          price: 0,
          expirationDays: 120,
          shareToken: "starter-package-token",
          items: [
            {
              appointmentTypeId: "appointment-type-private",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            }
          ]
        }
      ] as never,
      settings: createManagedSettingsCatalog("2026-05-28T12:00:00.000Z").map((setting) => {
        if (setting.key === "newsletter_embed_html") {
          return {
            ...setting,
            value: '<div class="newsletter-embed">Subscribe</div>'
          };
        }

        if (setting.key === "tawk_to_enabled") {
          return {
            ...setting,
            value: "1"
          };
        }

        if (setting.key === "tawk_to_property_id") {
          return {
            ...setting,
            value: "0123456789abcdef01234567"
          };
        }

        if (setting.key === "tawk_to_widget_id") {
          return {
            ...setting,
            value: ""
          };
        }

        return setting;
      }),
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
      ],
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tawkEmbedUrl = "https://embed.tawk.to/0123456789abcdef01234567/default";

    try {
      const home = await fetch(`${baseUrl}/`);
      const blogIndex = await fetch(`${baseUrl}/blog`);
      const packageDetail = await fetch(`${baseUrl}/client/package_detail.php?token=starter-package-token`);
      const book = await fetch(`${baseUrl}/book`);

      expect(home.status).toBe(200);
      expect(blogIndex.status).toBe(200);
      expect(packageDetail.status).toBe(200);
      expect(book.status).toBe(200);

      const homeHtml = await home.text();
      const blogIndexHtml = await blogIndex.text();
      const packageDetailHtml = await packageDetail.text();
      const bookHtml = await book.text();

      expect(homeHtml).toContain('<section class="bdta-newsletter-embed-section"');
      expect(homeHtml).toContain("bdta-newsletter-embed-card");
      expect(homeHtml).toContain('<div class="newsletter-embed">Subscribe</div>');
      expect(homeHtml).toContain(tawkEmbedUrl);
      expect(blogIndexHtml).toContain('<section class="bdta-newsletter-embed-section"');
      expect(blogIndexHtml).toContain(tawkEmbedUrl);
      expect(packageDetailHtml).toContain(tawkEmbedUrl);
      expect(packageDetailHtml).not.toContain('<section class="bdta-newsletter-embed-section"');
      expect(bookHtml).toContain(tawkEmbedUrl);
      expect(bookHtml).not.toContain('<section class="bdta-newsletter-embed-section"');

      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");
      expect(adminLogin.status).toBe(302);

      const adminViewedPackage = await fetch(`${baseUrl}/client/package_detail.php?token=starter-package-token`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      expect(adminViewedPackage.status).toBe(200);
      expect(await adminViewedPackage.text()).not.toContain(tawkEmbedUrl);

      const newsletterSetting = state.settings.find((setting) => setting.key === "newsletter_embed_html");
      const tawkPropertySetting = state.settings.find((setting) => setting.key === "tawk_to_property_id");
      const tawkWidgetSetting = state.settings.find((setting) => setting.key === "tawk_to_widget_id");
      if (newsletterSetting == null || tawkPropertySetting == null || tawkWidgetSetting == null) {
        throw new Error("Expected public settings to exist.");
      }

      newsletterSetting.value = "";
      tawkPropertySetting.value = "invalid/property";
      tawkWidgetSetting.value = "../../bad-widget";

      const services = await fetch(`${baseUrl}/services`);
      const packageWithoutWidget = await fetch(`${baseUrl}/client/package_detail.php?token=starter-package-token`);
      expect(services.status).toBe(200);
      expect(packageWithoutWidget.status).toBe(200);
      expect(await services.text()).not.toContain('<section class="bdta-newsletter-embed-section"');
      expect(await packageWithoutWidget.text()).not.toContain(tawkEmbedUrl);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders public notice, social links, imported-page runtime, and legacy public aliases", async () => {
    const state = createInMemoryPlatformState({
      blogPosts: [
        {
          id: "blog-1",
          title: "Loose Leash Training Tips",
          slug: "loose-leash-training-tips",
          content: "<p>Walks start before the leash clips on.</p>",
          excerpt: "Walks start before the leash clips on.",
          coverPhoto: "/backend/uploads/blog/loose-leash.jpg",
          author: "Brook",
          published: true,
          publishDate: "2026-05-28T15:00:00.000Z",
          createdAt: "2026-05-20T10:00:00.000Z",
          updatedAt: "2026-05-28T15:00:00.000Z"
        }
      ],
      settings: createManagedSettingsCatalog("2026-05-28T12:00:00.000Z").map((setting) => {
        if (setting.key === "public_notice_enabled") {
          return {
            ...setting,
            value: "1"
          };
        }

        if (setting.key === "public_notice_text") {
          return {
            ...setting,
            value: "Scheduled maintenance Thursday.\n<script>alert(1)</script>"
          };
        }

        if (setting.key === "facebook_url") {
          return {
            ...setting,
            value: "https://facebook.example/bdta"
          };
        }

        if (setting.key === "bluesky_url") {
          return {
            ...setting,
            value: "https://bsky.app/profile/bdta.example"
          };
        }

        if (setting.key === "linktree_url") {
          return {
            ...setting,
            value: "javascript:alert(1)"
          };
        }

        if (setting.key === "custom_social_link_1_label") {
          return {
            ...setting,
            value: "Podcast"
          };
        }

        if (setting.key === "custom_social_link_1_url") {
          return {
            ...setting,
            value: "https://example.com/podcast"
          };
        }

        if (setting.key === "custom_social_link_2_url") {
          return {
            ...setting,
            value: "https://www.books.example/store"
          };
        }

        return setting;
      }),
      sitePages: [
        {
          id: "page-home",
          slug: "home",
          title: "Brook's Dog Training Academy",
          htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
          cssContent: "",
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
          id: "page-manual",
          slug: "manual",
          title: "Manual Page",
          htmlContent: [
            '<div id="wb_root" class="root wb-layout-vertical">',
            '<ul class="navbar-nav ms-auto">',
            '<li class="nav-item"><a class="nav-link" href="../index.html#contact">Contact</a></li>',
            '<li class="nav-item"><a class="nav-link" href="/blog/index.php">Blog</a></li>',
            "</ul>",
            "<!-- BDTA_SOCIAL_LINKS:contact -->",
            "old contact markup",
            "<!-- /BDTA_SOCIAL_LINKS:contact -->",
            '<div class="wb-layout-element"><h1>Imported Manual Page</h1><p>Legacy imported content.</p></div>',
            "</div>"
          ].join(""),
          cssContent: "",
          metaDescription: "Imported manual page.",
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
      const homeAlias = await fetch(`${baseUrl}/index.php`);
      const manual = await fetch(`${baseUrl}/manual`);
      const manualAlias = await fetch(`${baseUrl}/page.php?slug=manual`);
      const blogAlias = await fetch(`${baseUrl}/blog/index.php`);
      const blogPostAlias = await fetch(`${baseUrl}/blog/post.php?slug=loose-leash-training-tips`);

      expect(homeAlias.status).toBe(200);
      expect(manual.status).toBe(200);
      expect(manualAlias.status).toBe(200);
      expect(blogAlias.status).toBe(200);
      expect(blogPostAlias.status).toBe(200);

      const homeAliasHtml = await homeAlias.text();
      const manualHtml = await manual.text();
      const manualAliasHtml = await manualAlias.text();
      const blogAliasHtml = await blogAlias.text();
      const blogPostAliasHtml = await blogPostAlias.text();

      expect(homeAliasHtml).toContain("Train the dog in front of you.");
      expect(manualHtml).toContain('data-public-notice');
      expect(manualHtml).toContain("Scheduled maintenance Thursday.<br>&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(manualHtml).toContain("data-public-notice-dismiss");
      expect(manualHtml).toContain("requestAnimationFrame");
      expect(manualHtml).toContain('data-theme-toggle');
      expect(manualHtml).toContain("public-theme-toggle");
      expect(manualHtml).toContain("/assets/js/theme-init.js");
      expect(manualHtml).toContain("/assets/js/theme-toggle.js");
      expect(manualHtml).toContain('href="/#contact"');
      expect(manualHtml).toContain('href="/directory">Directory</a>');
      expect(manualHtml).not.toContain("old contact markup");
      expect(manualHtml).toContain("Follow Us");
      expect(manualHtml).toContain("https://facebook.example/bdta");
      expect(manualHtml).toContain("https://example.com/podcast");
      expect(manualHtml).toContain("books.example");
      expect(manualHtml).toContain("bdta-social-icon-bluesky");
      expect(manualHtml).not.toContain("javascript:alert(1)");
      expect(manualHtml).toContain('class="bdta-imported-page"');
      expect(manualHtml).toContain("body > #wb_root");
      expect(manualAliasHtml).toContain("Imported Manual Page");
      expect(blogAliasHtml).toContain("Loose Leash Training Tips");
      expect(blogPostAliasHtml).toContain("Walks start before the leash clips on.");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders saved page-builder HTML for customized marketing pages", async () => {
    const state = createInMemoryPlatformState({
      sitePages: [
        {
          id: "page-home",
          slug: "home",
          title: "Brook's Dog Training Academy",
          htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
          cssContent: "",
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
          htmlContent: [
            '<section class="bdta-services-module py-5">',
            '<div class="container">',
            '<div class="custom-builder-marker">Live editor content</div>',
            '<div class="bdta-services-grid row g-4"></div>',
            '<div class="bdta-services-empty text-center py-5 d-none">No services.</div>',
            "</div>",
            "</section>"
          ].join(""),
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

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/services`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain("custom-builder-marker");
      expect(html).toContain("Live editor content");
      expect(html).toContain("bdta-services-module");
      expect(html).toContain('/assets/js/public/modules.js');
      expect(html).not.toContain("Behavior Tune-Ups");
      expect(html).not.toContain("Service Menu");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("serves favicon requests without a 404", async () => {
    const server = createHttpWebServer({
      state: createInMemoryPlatformState()
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/favicon.ico`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/svg+xml");
      expect((await response.text()).trim().startsWith("<svg")).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("serves legacy public assets for the web runtime", async () => {
    const server = createHttpWebServer({
      content: {
        now: () => "2026-06-01T12:00:00.000Z",
        listPublicBlogPosts: async () => [],
        findPublicBlogPostBySlug: async () => null,
        findPublicSitePageBySlug: async () => null,
        listAdminBlogPosts: async () => [],
        findAdminBlogPostById: async () => null,
        createAdminBlogPost: async () => {
          throw new Error("not used");
        },
        updateAdminBlogPost: async () => null,
        deleteAdminBlogPost: async () => false,
        listAdminSitePages: async () => [],
        findAdminSitePageById: async () => null,
        createAdminSitePage: async () => {
          throw new Error("not used");
        },
        updateAdminSitePage: async () => null,
        deleteAdminSitePage: async () => false,
        listAdminSettings: async () => [],
        findAdminSettingByKey: async () => null,
        updateAdminSetting: async () => null,
        findAdminSettingsUserByActorId: async () => null,
        listAdminSettingsUsers: async () => [],
        findAdminSettingsUserByUsername: async () => null,
        createAdminSettingsUser: async () => {
          throw new Error("not used");
        },
        updateAdminSettingsUserPermissions: async () => null,
        deleteAdminSettingsUser: async () => false
      }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/assets/images/hero-dog-real.jpg`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1024);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("handles the legacy public contact endpoint with legacy-compatible JSON responses", async () => {
    const state = createInMemoryPlatformState({
      portalUsers: [],
      captchaVerifier: async (token) => token === "turnstile-ok"
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
      const success = await fetch(`${baseUrl}/backend/public/api_contact.php`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Contact New",
          email: "Contact-New@Example.com",
          phone: "555-1100",
          service: "pet-sitting",
          message: "Need help with training basics.",
          turnstile_token: "turnstile-ok"
        })
      });

      expect(success.status).toBe(200);
      expect(await success.json()).toEqual({ success: true });
      expect(state.portalUsers).toHaveLength(1);
      expect(state.portalUsers[0]).toMatchObject({
        email: "contact-new@example.com",
        displayName: "Contact New",
        phone: "555-1100"
      });
      expect(state.portalUsers[0]?.notes).toContain("Message: Need help with training basics.");

      const failure = await fetch(`${baseUrl}/backend/public/api_contact.php`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Contact Fail",
          email: "contact-fail@example.com",
          phone: "555-1199",
          service: "",
          message: "Need help with training basics.",
          turnstile_token: "turnstile-fail"
        })
      });

      expect(failure.status).toBe(400);
      expect(await failure.json()).toEqual({
        success: false,
        error: "Please confirm you are not a robot and try again."
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("returns 500 with a request id for unexpected public-page failures and preserves 404s for missing pages", async () => {
    const reportedErrors: Array<{
      error: unknown;
      requestId: string;
      method: string;
      path: string;
    }> = [];

    const crashingServer = createHttpWebServer({
      requestIdFactory: () => "web-request-1",
      onError: async (error, context) => {
        reportedErrors.push({
          error,
          requestId: context.requestId,
          method: context.method,
          path: context.path
        });
      },
      content: {
        now: () => "2026-06-01T12:00:00.000Z",
        listPublicBlogPosts: async () => [],
        findPublicBlogPostBySlug: async () => null,
        findPublicSitePageBySlug: async () => {
          throw new Error("database unavailable");
        },
        listAdminBlogPosts: async () => [],
        findAdminBlogPostById: async () => null,
        createAdminBlogPost: async () => {
          throw new Error("not used");
        },
        updateAdminBlogPost: async () => null,
        deleteAdminBlogPost: async () => false,
        listAdminSitePages: async () => [],
        findAdminSitePageById: async () => null,
        createAdminSitePage: async () => {
          throw new Error("not used");
        },
        updateAdminSitePage: async () => null,
        deleteAdminSitePage: async () => false,
        listAdminSettings: async () => [],
        findAdminSettingByKey: async () => null,
        updateAdminSetting: async () => null,
        findAdminSettingsUserByActorId: async () => null,
        listAdminSettingsUsers: async () => [],
        findAdminSettingsUserByUsername: async () => null,
        createAdminSettingsUser: async () => {
          throw new Error("not used");
        },
        updateAdminSettingsUserPermissions: async () => null,
        deleteAdminSettingsUser: async () => false
      }
    });

    crashingServer.listen(0, "127.0.0.1");
    await once(crashingServer, "listening");
    const crashingAddress = crashingServer.address();
    if (crashingAddress == null || typeof crashingAddress === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${crashingAddress.port}/`);
      expect(response.status).toBe(500);
      expect(response.headers.get("x-request-id")).toBe("web-request-1");
      const html = await response.text();
      expect(html).toContain("database unavailable");
      expect(html).toContain("Request ID");
      expect(html).toContain("web-request-1");
      expect(html).toContain("Route");
      expect(html).toContain('<pre class="debug-error-pre">');
      expect(reportedErrors).toHaveLength(1);
      expect(reportedErrors[0]?.requestId).toBe("web-request-1");
      expect(reportedErrors[0]?.method).toBe("GET");
      expect(reportedErrors[0]?.path).toBe("/");
      expect(reportedErrors[0]?.error).toBeInstanceOf(Error);
    } finally {
      await new Promise<void>((resolve, reject) => {
        crashingServer.close((error?: Error) => error ? reject(error) : resolve());
      });
    }

    const missingStateServer = createHttpWebServer({
      content: {
        now: () => "2026-06-01T12:00:00.000Z",
        listPublicBlogPosts: async () => [],
        findPublicBlogPostBySlug: async () => null,
        findPublicSitePageBySlug: async () => null,
        listAdminBlogPosts: async () => [],
        findAdminBlogPostById: async () => null,
        createAdminBlogPost: async () => {
          throw new Error("not used");
        },
        updateAdminBlogPost: async () => null,
        deleteAdminBlogPost: async () => false,
        listAdminSitePages: async () => [],
        findAdminSitePageById: async () => null,
        createAdminSitePage: async () => {
          throw new Error("not used");
        },
        updateAdminSitePage: async () => null,
        deleteAdminSitePage: async () => false,
        listAdminSettings: async () => [],
        findAdminSettingByKey: async () => null,
        updateAdminSetting: async () => null,
        findAdminSettingsUserByActorId: async () => null,
        listAdminSettingsUsers: async () => [],
        findAdminSettingsUserByUsername: async () => null,
        createAdminSettingsUser: async () => {
          throw new Error("not used");
        },
        updateAdminSettingsUserPermissions: async () => null,
        deleteAdminSettingsUser: async () => false
      }
    });

    missingStateServer.listen(0, "127.0.0.1");
    await once(missingStateServer, "listening");
    const missingAddress = missingStateServer.address();
    if (missingAddress == null || typeof missingAddress === "string") {
      throw new Error("Expected TCP server address.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${missingAddress.port}/missing-page`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Not Found");
    } finally {
      await new Promise<void>((resolve, reject) => {
        missingStateServer.close((error?: Error) => error ? reject(error) : resolve());
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
          id: "form-review-1",
          templateId: "template-follow-up",
          clientId: "client-portal-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          submittedAt: "2026-05-30T10:00:00.000Z",
          publicAccess: null
        },
        {
          id: "form-pending-1",
          templateId: "template-onboarding",
          clientId: "client-portal-1",
          templateName: "Onboarding Form",
          formType: "client_form",
          templateIsInternal: false,
          submittedAt: null,
          publicAccess: null
        },
        {
          id: "form-hidden-1",
          templateId: "template-hidden",
          clientId: "client-portal-1",
          templateName: "Internal Staff Note",
          formType: "client_form",
          submittedAt: "2026-05-29T10:00:00.000Z",
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
      const loginPageHtml = await loginPage.text();
      expect(loginPageHtml).toContain("Portal Login");
      expect(loginPageHtml).toContain("Dog Training Academy");
      expect(loginPageHtml).not.toContain("Client self-service without clutter.");

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
      const reviewForm = await fetch(`${baseUrl}/portal/forms/form-review-1`, {
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
      expect(reviewForm.status).toBe(200);

      const portalHomeHtml = await portalHome.text();
      const appointmentsHtml = await appointments.text();
      const invoicesHtml = await invoices.text();
      const quotesHtml = await quotes.text();
      const contractsHtml = await contracts.text();
      const formsHtml = await forms.text();
      const reviewFormHtml = await reviewForm.text();

      expect(portalHomeHtml).toContain("Portal User");
      expect(portalHomeHtml).toContain("svc-private-lesson");
      expect(portalHomeHtml).toContain("Dog Training Academy");
      expect(portalHomeHtml).toContain("sidebar");
      expect(portalHomeHtml).toContain("app-main-content");
      expect(portalHomeHtml).toContain('data-app-layout');
      expect(portalHomeHtml).toContain('data-app-sidebar');
      expect(portalHomeHtml).toContain('class="app-shell-toggle"');
      expect(portalHomeHtml).toContain("data-app-shell-toggle");
      expect(portalHomeHtml).toContain("summary-grid");
      expect(portalHomeHtml).toContain("summary-card");
      expect(portalHomeHtml).toContain("quick-links-grid");
      expect(portalHomeHtml).toContain("data-app-desktop-shell-toggle");
      expect(portalHomeHtml).toContain("Hide Menu");
      expect(appointmentsHtml).toContain("booking-1");
      expect(invoicesHtml).toContain("invoice-1");
      expect(invoicesHtml).toContain("125");
      expect(quotesHtml).toContain("quote-1");
      expect(contractsHtml).toContain("contract-1");
      expect(formsHtml).toContain("form-review-1");
      expect(formsHtml).toContain("form-pending-1");
      expect(formsHtml).not.toContain("form-hidden-1");
      expect(formsHtml).toContain(">Review<");
      expect(formsHtml).toContain("Submit Form");
      expect(reviewFormHtml).toContain("Follow-up Note");
      expect(reviewFormHtml).toContain("Client Review");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("links portal commerce lists to invoice, quote, and contract detail pages", async () => {
    const state = createInMemoryPlatformState({
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
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: null
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

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const invoices = await fetch(`${baseUrl}/portal/invoices`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const invoiceDetail = await fetch(`${baseUrl}/portal/invoices/invoice-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const quotes = await fetch(`${baseUrl}/portal/quotes`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const quoteDetail = await fetch(`${baseUrl}/portal/quotes/quote-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const contracts = await fetch(`${baseUrl}/portal/contracts`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const contractDetail = await fetch(`${baseUrl}/portal/contracts/contract-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(invoices.status).toBe(200);
      expect(invoiceDetail.status).toBe(200);
      expect(quotes.status).toBe(200);
      expect(quoteDetail.status).toBe(200);
      expect(contracts.status).toBe(200);
      expect(contractDetail.status).toBe(200);

      const invoicesHtml = await invoices.text();
      const invoiceDetailHtml = await invoiceDetail.text();
      const quotesHtml = await quotes.text();
      const quoteDetailHtml = await quoteDetail.text();
      const contractsHtml = await contracts.text();
      const contractDetailHtml = await contractDetail.text();

      expect(invoicesHtml).toContain('href="/portal/invoices/invoice-1"');
      expect(invoiceDetailHtml).toContain("Invoice Details");
      expect(invoiceDetailHtml).toContain("Pay Invoice");
      expect(invoiceDetailHtml).toContain("$125.00");
      expect(quotesHtml).toContain('href="/portal/quotes/quote-1"');
      expect(quoteDetailHtml).toContain("Quote Details");
      expect(quoteDetailHtml).toContain("Accept Quote");
      expect(quoteDetailHtml).toContain("$450.00");
      expect(contractsHtml).toContain('href="/portal/contracts/contract-1"');
      expect(contractDetailHtml).toContain("Contract Details");
      expect(contractDetailHtml).toContain("Sign Contract");
      expect(contractDetailHtml).toContain("contract-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("links portal appointments to booking detail pages", async () => {
    const state = createInMemoryPlatformState({
      bookings: [
        {
          id: "booking-1",
          clientId: "client-portal-1",
          petIds: [],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "booking-ical-token",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-1"
          }
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

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const appointments = await fetch(`${baseUrl}/portal/appointments`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const bookingDetail = await fetch(`${baseUrl}/portal/bookings/booking-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(appointments.status).toBe(200);
      expect(bookingDetail.status).toBe(200);

      const appointmentsHtml = await appointments.text();
      const bookingDetailHtml = await bookingDetail.text();

      expect(appointmentsHtml).toContain('href="/portal/bookings/booking-1"');
      expect(bookingDetailHtml).toContain("Appointment Details");
      expect(bookingDetailHtml).toContain("svc-private-lesson");
      expect(bookingDetailHtml).toContain("booking-1");
      expect(bookingDetailHtml).toContain("booking-ical-token");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("links portal pets, packages, and credits to their detail pages", async () => {
    const state = createInMemoryPlatformState({
      pets: [
        {
          id: "pet-1",
          clientId: "client-portal-1",
          name: "Roux",
          species: "dog",
          petSittingNotes: "Needs medication with dinner.",
          archived: false
        }
      ],
      packages: [
        {
          id: "package-1",
          name: "Starter Package",
          active: true,
          price: 325
        }
      ],
      credits: [
        {
          id: "credit-1",
          clientId: "client-portal-1",
          packageId: "package-1",
          appointmentTypeId: "appointment-type-1",
          remainingUnits: 4
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

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const pets = await fetch(`${baseUrl}/portal/pets`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const petDetail = await fetch(`${baseUrl}/portal/pets/pet-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const packages = await fetch(`${baseUrl}/portal/packages`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const packageDetail = await fetch(`${baseUrl}/portal/packages/package-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const credits = await fetch(`${baseUrl}/portal/credits`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const creditDetail = await fetch(`${baseUrl}/portal/credits/credit-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(pets.status).toBe(200);
      expect(petDetail.status).toBe(200);
      expect(packages.status).toBe(200);
      expect(packageDetail.status).toBe(200);
      expect(credits.status).toBe(200);
      expect(creditDetail.status).toBe(200);

      const petsHtml = await pets.text();
      const petDetailHtml = await petDetail.text();
      const packagesHtml = await packages.text();
      const packageDetailHtml = await packageDetail.text();
      const creditsHtml = await credits.text();
      const creditDetailHtml = await creditDetail.text();

      expect(petsHtml).toContain('href="/portal/pets/pet-1"');
      expect(petDetailHtml).toContain("Pet Details");
      expect(petDetailHtml).toContain("Roux");
      expect(petDetailHtml).toContain("Needs medication with dinner.");
      expect(petDetailHtml).toContain('/portal/pets/pet-1/files');
      expect(packagesHtml).toContain('href="/portal/packages/package-1"');
      expect(packageDetailHtml).toContain("Package Details");
      expect(packageDetailHtml).toContain("Starter Package");
      expect(packageDetailHtml).toContain("$325.00");
      expect(creditsHtml).toContain('href="/portal/credits/credit-1"');
      expect(creditDetailHtml).toContain("Credit Details");
      expect(creditDetailHtml).toContain("4");
      expect(creditDetailHtml).toContain("package-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders portal notifications for follow-up review items", async () => {
    const state = createInMemoryPlatformState({
      formSubmissions: [
        {
          id: "form-review-1",
          templateId: "template-follow-up",
          clientId: "client-portal-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          submittedAt: "2026-05-30T10:00:00.000Z",
          publicAccess: {
            token: "form-review-token",
            issuedAt: "2026-05-30T10:00:00.000Z",
            expiresAt: null,
            legacySourceId: "legacy-form-review-1"
          }
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
    }) as ReturnType<typeof createInMemoryPlatformState> & {
      notifications?: Array<{
        id: string;
        clientId: string;
        channel: "portal" | "email";
        entityType: string;
        entityId: string | null;
        subject: string;
        message: string;
        url: string;
        isRead: boolean;
        createdAt: string;
      }>;
    };

    state.notifications = [
      {
        id: "notification-1",
        clientId: "client-portal-1",
        channel: "portal",
        entityType: "follow_up_note",
        entityId: "form-review-1",
        subject: "New follow-up note available",
        message: "Your Follow-up Note is ready to review in the client portal.",
        url: "/portal/forms/form-review-1",
        isRead: false,
        createdAt: "2026-05-30T10:05:00.000Z"
      }
    ];

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
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

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const notifications = await fetch(`${baseUrl}/portal/notifications`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(notifications.status).toBe(200);
      const html = await notifications.text();
      expect(html).toContain("New follow-up note available");
      expect(html).toContain("client portal");
      expect(html).toContain("/portal/forms/form-review-1");
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
      const bookingPageHtml = await bookingPage.text();
      expect(bookingPageHtml).toContain("Book Training");
      expect(bookingPageHtml).toContain("booking-shell");
      expect(bookingPageHtml).toContain("booking-benefits");

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

  it("serves the legacy public services feed and appointment-type booking aliases", async () => {
    const state = createInMemoryPlatformState({
      appointmentTypes: [
        {
          id: "appointment-type-1",
          name: "Private Coaching",
          description: "One-on-one coaching session.",
          bulletPoints: ["Behavior assessment", "Homework plan"],
          durationMinutes: 90,
          defaultAmount: 225,
          uniqueLink: "private-coaching-link",
          publicAvailable: true,
          portalAvailable: true,
          isGroupClass: false,
          isMiniSession: false,
          isFieldRental: false,
          fieldRentalLocation: "",
          active: true
        },
        {
          id: "appointment-type-2",
          name: "Group Workshop",
          description: "Group-only class.",
          bulletPoints: ["Not in services feed"],
          durationMinutes: 60,
          defaultAmount: 50,
          uniqueLink: "group-workshop-link",
          publicAvailable: true,
          portalAvailable: true,
          isGroupClass: true,
          isMiniSession: false,
          isFieldRental: false,
          fieldRentalLocation: "",
          active: true
        }
      ] as never,
      captchaVerifier: async (token) => token === "turnstile-ok"
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
      const servicesApi = await fetch(`${baseUrl}/backend/public/api_services.php`);
      expect(servicesApi.status).toBe(200);
      const servicesPayload = await servicesApi.json() as {
        services: Array<{
          name: string;
          bullet_points: string[];
          booking_url: string;
          duration_minutes: number;
        }>;
      };
      expect(servicesPayload.services).toHaveLength(1);
      expect(servicesPayload.services[0]?.name).toBe("Private Coaching");
      expect(servicesPayload.services[0]?.bullet_points).toEqual(["Behavior assessment", "Homework plan"]);
      expect(servicesPayload.services[0]?.duration_minutes).toBe(90);
      expect(servicesPayload.services[0]?.booking_url).toContain("/backend/public/book.php?link=private-coaching-link");

      const bookingByLink = await fetch(`${baseUrl}/backend/public/book.php?link=private-coaching-link`);
      const bookingByType = await fetch(`${baseUrl}/backend/public/book.php?type=appointment-type-1`);
      const invalidBooking = await fetch(`${baseUrl}/backend/public/book.php?link=missing-link`);

      expect(bookingByLink.status).toBe(200);
      expect(bookingByType.status).toBe(200);
      expect(invalidBooking.status).toBe(200);

      const bookingByLinkHtml = await bookingByLink.text();
      const bookingByTypeHtml = await bookingByType.text();
      const invalidBookingHtml = await invalidBooking.text();

      expect(bookingByLinkHtml).toContain("Private Coaching");
      expect(bookingByLinkHtml).toContain("One-on-one coaching session.");
      expect(bookingByLinkHtml).toContain("Behavior assessment");
      expect(bookingByLinkHtml).toContain('value="appointment-type-1"');
      expect(bookingByTypeHtml).toContain("Private Coaching");
      expect(invalidBookingHtml).toContain("Invalid Booking Link");

      const legacyBookingSubmit = await fetch(`${baseUrl}/backend/public/book.php?link=private-coaching-link`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          serviceId: "appointment-type-1",
          clientEmail: "new-client@example.com",
          requestedStart: "2026-06-10T16:00:00.000Z",
          requestedEnd: "2026-06-10T17:30:00.000Z",
          turnstileToken: "turnstile-ok"
        })
      });

      expect(legacyBookingSubmit.status).toBe(302);
      expect(legacyBookingSubmit.headers.get("location")).toContain("/book/confirmation?bookingId=");
      expect(state.bookings).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("serves the legacy public events feed for group classes and mini sessions", async () => {
    const state = createInMemoryPlatformState({
      appointmentTypes: [
        {
          id: "appointment-type-group",
          name: "Reactive Dog Workshop",
          description: "Small-group coaching for real-world reactivity.",
          bulletPoints: ["Structured drills", "Coach feedback"],
          durationMinutes: 60,
          defaultAmount: 95,
          isGroupClass: true,
          maxParticipants: 1,
          groupClassLocation: "Training Barn",
          scheduleType: "specific_date",
          specificDate: "2026-06-10",
          specificDates: [],
          availableStartTime: "09:00",
          availableEndTime: "10:00",
          timeSlotInterval: 60,
          uniqueLink: "reactive-workshop-link",
          active: true
        },
        {
          id: "appointment-type-mini",
          name: "Loose Leash Mini Session",
          description: "Drop-in leash handling help.",
          bulletPoints: ["Leash mechanics", "Handler timing"],
          durationMinutes: 30,
          defaultAmount: 45,
          isMiniSession: true,
          miniSessionLocation: "Community Park",
          miniSessionTopic: "Loose leash walking",
          scheduleType: "specific_date",
          specificDates: [
            {
              date: "2026-06-11",
              timeslots: [
                { type: "range", start: "12:00", end: "14:00" }
              ]
            }
          ],
          availableStartTime: "12:00",
          availableEndTime: "14:00",
          timeSlotInterval: 30,
          uniqueLink: "loose-leash-mini-link",
          active: true
        }
      ] as never,
      bookings: [
        {
          id: "booking-existing-1",
          clientId: "client-existing-1",
          petIds: [],
          serviceId: "appointment-type-group",
          startsAt: "2026-06-10T09:00:00.000Z",
          endsAt: "2026-06-10T10:00:00.000Z",
          status: "confirmed",
          icalAccess: null
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
      const eventsApi = await fetch(`${baseUrl}/backend/public/api_events.php`);
      expect(eventsApi.status).toBe(200);
      const eventsPayload = await eventsApi.json() as {
        events: Array<{
          id: string;
          name: string;
          type: "group_class" | "mini_session";
          date: string;
          start_time: string;
          end_time: string;
          duration_minutes: number;
          fully_booked: boolean;
          location: string;
          topic?: string;
          booking_url: string | null;
        }>;
      };

      expect(eventsPayload.events).toHaveLength(2);
      expect(eventsPayload.events[0]).toMatchObject({
        id: "appointment-type-group",
        name: "Reactive Dog Workshop",
        type: "group_class",
        date: "2026-06-10",
        start_time: "09:00",
        end_time: "10:00",
        duration_minutes: 60,
        fully_booked: true,
        location: "Training Barn"
      });
      expect(eventsPayload.events[0]?.booking_url).toContain("/backend/public/book.php?link=reactive-workshop-link");

      expect(eventsPayload.events[1]).toMatchObject({
        id: "appointment-type-mini",
        name: "Loose Leash Mini Session",
        type: "mini_session",
        date: "2026-06-11",
        start_time: "12:00",
        end_time: "14:00",
        duration_minutes: 30,
        fully_booked: false,
        location: "Community Park",
        topic: "Loose leash walking"
      });
      expect(eventsPayload.events[1]?.booking_url).toContain("/backend/public/book.php?link=loose-leash-mini-link");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("serves the legacy public packages feed with shareable purchase links", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          bulletPoints: ["Four sessions", "Homework notes"],
          active: true,
          price: 325,
          expirationDays: 120,
          shareToken: "starter-package-token",
          items: [
            {
              appointmentTypeId: "appointment-type-1",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            }
          ]
        },
        {
          id: "package-hidden-1",
          name: "Internal Only Package",
          active: true,
          price: 900,
          shareToken: null,
          items: []
        }
      ] as never
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
      const packagesApi = await fetch(`${baseUrl}/backend/public/api_packages.php`);
      expect(packagesApi.status).toBe(200);
      const packagesPayload = await packagesApi.json() as {
        packages: Array<{
          id: string;
          name: string;
          description: string;
          bullet_points: string[];
          price: number;
          expiration_days: number | null;
          purchase_url: string;
          items: Array<{
            apt_type_name: string;
            quantity: number;
          }>;
        }>;
      };

      expect(packagesPayload.packages).toHaveLength(1);
      expect(packagesPayload.packages[0]).toMatchObject({
        id: "package-public-1",
        name: "Starter Package",
        description: "Four private sessions with follow-up support.",
        bullet_points: ["Four sessions", "Homework notes"],
        price: 325,
        expiration_days: 120,
        items: [
          {
            apt_type_name: "Private Lesson",
            quantity: 4
          }
        ]
      });
      expect(packagesPayload.packages[0]?.purchase_url).toContain("/client/package_detail.php?token=starter-package-token");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders the legacy public package detail page and preserves portal return login flow", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          bulletPoints: ["Four sessions", "Homework notes"],
          active: true,
          price: 325,
          expirationDays: 120,
          shareToken: "starter-package-token",
          items: [
            {
              appointmentTypeId: "appointment-type-1",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            }
          ]
        }
      ] as never,
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
    const packagePath = "/client/package_detail.php?token=starter-package-token";

    try {
      const packageDetail = await fetch(`${baseUrl}${packagePath}`);
      const missingPackage = await fetch(`${baseUrl}/client/package_detail.php?token=missing-token`);

      expect(packageDetail.status).toBe(200);
      expect(missingPackage.status).toBe(404);

      const packageDetailHtml = await packageDetail.text();
      const missingPackageHtml = await missingPackage.text();

      expect(packageDetailHtml).toContain("Starter Package");
      expect(packageDetailHtml).toContain("Four private sessions with follow-up support.");
      expect(packageDetailHtml).toContain("$325.00");
      expect(packageDetailHtml).toContain("120 days");
      expect(packageDetailHtml).toContain("Private Lesson");
      expect(packageDetailHtml).toContain("Four sessions");
      expect(packageDetailHtml).toContain("/portal/login?return_to=%2Fclient%2Fpackage_detail.php%3Ftoken%3Dstarter-package-token");
      expect(missingPackageHtml).toContain("Package not found");

      const portalLoginPage = await fetch(`${baseUrl}/portal/login?return_to=${encodeURIComponent(packagePath)}`);
      expect(portalLoginPage.status).toBe(200);
      expect(await portalLoginPage.text()).toContain(`/portal/login?return_to=${encodeURIComponent(packagePath)}`);

      const portalLogin = await fetch(`${baseUrl}/portal/login?return_to=${encodeURIComponent(packagePath)}`, {
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

      expect(portalLogin.status).toBe(302);
      expect(portalLogin.headers.get("location")).toBe(packagePath);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders legacy public quote, contract, form, and booking calendar routes from tokenized links", async () => {
    const state = createInMemoryPlatformState({
      bookings: [
        {
          id: "booking-ical-1",
          clientId: "client-portal-1",
          petIds: [],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: {
            token: "ical-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-ical-1"
          }
        }
      ],
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          quoteNumber: "Q-1001",
          title: "Starter Training Package",
          description: "Four private sessions with a custom homework plan.",
          totalAmount: 450,
          items: [
            {
              description: "Private Coaching Session",
              quantity: 4,
              unitPrice: 112.5,
              amount: 450
            }
          ],
          publicAccess: {
            token: "quote-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }
      ],
      contracts: [
        {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          contractNumber: "C-2001",
          title: "Training Services Agreement",
          description: "Agreement for recurring private coaching services.",
          contractText: "<p>Contract body copy for the client.</p>",
          publicAccess: {
            token: "contract-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }
      ],
      formSubmissions: [
        {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          clientReviewSubmission: false,
          submittedAt: null,
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        }
      ],
      formTemplates: [
        {
          id: "template-1",
          name: "Client Intake",
          description: "Complete the onboarding form.",
          active: true,
          formType: "client_form",
          templateIsInternal: false,
          templateShowInClientPortal: true,
          fields: [
            {
              label: "Dog Name",
              type: "text",
              required: true
            },
            {
              label: "Training Goals",
              type: "textarea",
              required: false
            }
          ]
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
      const quote = await fetch(`${baseUrl}/backend/public/quote.php?token=quote-access-token-123456&portal_return=${encodeURIComponent("/portal/quotes.php")}`);
      const contract = await fetch(`${baseUrl}/backend/public/contract.php?token=contract-access-token-123456&portal_return=${encodeURIComponent("/portal/agreements.php")}`);
      const form = await fetch(`${baseUrl}/backend/public/form.php?token=form-access-token-123456&portal_return=${encodeURIComponent("/portal/agreements.php")}`);
      const bookingIcal = await fetch(`${baseUrl}/backend/public/download_ical.php?token=ical-access-token-123456`);
      const invalidQuote = await fetch(`${baseUrl}/backend/public/quote.php?token=missing-token-123456`);

      expect(quote.status).toBe(200);
      expect(contract.status).toBe(200);
      expect(form.status).toBe(200);
      expect(bookingIcal.status).toBe(200);
      expect(invalidQuote.status).toBe(404);

      const quoteHtml = await quote.text();
      const contractHtml = await contract.text();
      const formHtml = await form.text();

      expect(quoteHtml).toContain("Starter Training Package");
      expect(quoteHtml).toContain("Q-1001");
      expect(quoteHtml).toContain("Private Coaching Session");
      expect(quoteHtml).toContain("$450.00");
      expect(quoteHtml).toContain('href="/portal/quotes"');
      expect(quoteHtml).toContain('name="action" value="accept"');
      expect(quoteHtml).toContain('name="action" value="decline"');

      expect(contractHtml).toContain("Training Services Agreement");
      expect(contractHtml).toContain("C-2001");
      expect(contractHtml).toContain("Contract body copy for the client.");
      expect(contractHtml).toContain('name="typedName"');
      expect(contractHtml).toContain('name="signatureFont"');

      expect(formHtml).toContain("Client Intake");
      expect(formHtml).toContain("form-1");
      expect(formHtml).toContain('name="contact_name"');
      expect(formHtml).toContain("Dog Name");
      expect(formHtml).toContain('name="field[0]"');

      expect(bookingIcal.headers.get("content-type")).toContain("text/calendar");
      expect(bookingIcal.headers.get("content-disposition")).toContain('attachment; filename="booking-event.ics"');
      expect(await bookingIcal.text()).toContain("BEGIN:VCALENDAR");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("accepts public quotes, signs public contracts, and submits public forms from tokenized legacy routes", async () => {
    const state = createInMemoryPlatformState({
      quotes: [
        {
          id: "quote-1",
          clientId: "client-portal-1",
          status: "sent",
          quoteNumber: "Q-1001",
          title: "Starter Training Package",
          totalAmount: 450,
          publicAccess: {
            token: "quote-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "quote-1"
          }
        }
      ],
      contracts: [
        {
          id: "contract-1",
          clientId: "client-portal-1",
          status: "sent",
          contractNumber: "C-2001",
          title: "Training Services Agreement",
          contractText: "<p>Contract body copy for the client.</p>",
          publicAccess: {
            token: "contract-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "contract-1"
          }
        }
      ],
      formSubmissions: [
        {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-portal-1",
          templateName: "Client Intake",
          formType: "client_form",
          templateIsInternal: false,
          submittedAt: null,
          publicAccess: {
            token: "form-access-token-123456",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "form-1"
          }
        }
      ],
      formTemplates: [
        {
          id: "template-1",
          name: "Client Intake",
          description: "Complete the onboarding form.",
          active: true,
          formType: "client_form",
          templateIsInternal: false,
          templateShowInClientPortal: true,
          fields: [
            {
              label: "Dog Name",
              type: "text",
              required: true
            }
          ]
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
      const acceptedQuote = await fetch(`${baseUrl}/backend/public/quote.php?token=quote-access-token-123456`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          action: "accept",
          turnstileToken: "turnstile-ok"
        })
      });
      const signedContract = await fetch(`${baseUrl}/backend/public/contract.php?token=contract-access-token-123456`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          typedName: "Casey Client",
          signatureFont: "font-dancing",
          client_confirmation: "1",
          turnstileToken: "turnstile-ok"
        })
      });
      const submittedForm = await fetch(`${baseUrl}/backend/public/form.php?token=form-access-token-123456`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          contact_name: "Casey Client",
          contact_email: "casey@example.com",
          contact_phone: "555-0110",
          turnstileToken: "turnstile-ok",
          "field[0]": "Rocket"
        })
      });

      expect(acceptedQuote.status).toBe(303);
      expect(acceptedQuote.headers.get("location")).toContain("result=accepted");
      expect(signedContract.status).toBe(303);
      expect(signedContract.headers.get("location")).toContain("result=signed");
      expect(submittedForm.status).toBe(303);
      expect(submittedForm.headers.get("location")).toContain("result=submitted");

      expect(state.quotes[0]?.status).toBe("accepted");
      expect(state.contracts[0]?.status).toBe("signed");
      expect(state.contracts[0]?.signatureTypedName).toBe("Casey Client");
      expect(state.contracts[0]?.signatureFont).toBe("font-dancing");
      expect(state.formSubmissions[0]?.submittedAt).toBe("2026-05-27T18:00:00.000Z");
      expect(state.formSubmissions[0]?.responses).toEqual(["Rocket"]);
      expect(state.formSubmissions[0]?.contactEmail).toBe("casey@example.com");

      const acceptedQuotePage = await fetch(`${baseUrl}${acceptedQuote.headers.get("location") ?? ""}`);
      const signedContractPage = await fetch(`${baseUrl}${signedContract.headers.get("location") ?? ""}`);
      const submittedFormPage = await fetch(`${baseUrl}${submittedForm.headers.get("location") ?? ""}`);
      const acceptedQuoteHtml = await acceptedQuotePage.text();
      const signedContractHtml = await signedContractPage.text();
      const submittedFormHtml = await submittedFormPage.text();

      expect(acceptedQuoteHtml).toContain("Quote accepted. We will contact you shortly.");
      expect(signedContractHtml).toContain("Contract signed successfully. Thank you.");
      expect(signedContractHtml).toContain("Casey Client");
      expect(submittedFormHtml).toContain("Thank you! Your form has been submitted successfully.");
      expect(submittedFormHtml).toContain("Rocket");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("completes a legacy public package purchase and issues per-appointment-type credits", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          active: true,
          price: 0,
          expirationDays: 120,
          shareToken: "starter-package-token",
          items: [
            {
              appointmentTypeId: "appointment-type-private",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            },
            {
              appointmentTypeId: "appointment-type-field",
              appointmentTypeName: "Field Rental",
              quantity: 2
            }
          ]
        }
      ] as never
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const packagePath = "/client/package_detail.php?token=starter-package-token";

    try {
      const purchase = await fetch(`${baseUrl}${packagePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          buyer_name: "Package Buyer",
          buyer_email: "buyer@example.com",
          buyer_phone: "555-0111",
          notes: "Please keep sessions on weekday evenings."
        })
      });

      expect(purchase.status).toBe(303);
      expect(purchase.headers.get("location")).toBe(`${packagePath}&purchase=success`);
      expect(state.portalUsers).toHaveLength(1);
      expect(state.portalUsers[0]).toMatchObject({
        email: "buyer@example.com",
        displayName: "Package Buyer"
      });
      expect(state.credits).toHaveLength(2);
      expect(state.credits).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientId: state.portalUsers[0]?.clientId,
          packageId: "package-public-1",
          appointmentTypeId: "appointment-type-private",
          remainingUnits: 4
        }),
        expect.objectContaining({
          clientId: state.portalUsers[0]?.clientId,
          packageId: "package-public-1",
          appointmentTypeId: "appointment-type-field",
          remainingUnits: 2
        })
      ]));

      const successPage = await fetch(`${baseUrl}${packagePath}&purchase=success`);
      expect(successPage.status).toBe(200);
      expect(await successPage.text()).toContain("Package purchase complete");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("redirects paid public package purchases into secure checkout and finalizes them after callback verification", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          active: true,
          price: 325,
          expirationDays: 120,
          shareToken: "starter-package-token",
          items: [
            {
              appointmentTypeId: "appointment-type-private",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            },
            {
              appointmentTypeId: "appointment-type-field",
              appointmentTypeName: "Field Rental",
              quantity: 2
            }
          ]
        }
      ] as never
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const packagePath = "/client/package_detail.php?token=starter-package-token";

    try {
      const purchase = await fetch(`${baseUrl}${packagePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          buyer_name: "Package Buyer",
          buyer_email: "buyer@example.com",
          buyer_phone: "555-0111",
          notes: "Please keep sessions on weekday evenings."
        })
      });

      expect(purchase.status).toBe(303);
      expect(purchase.headers.get("location")).toContain("https://checkout.example.test/public-packages/pkg-checkout-session-1");
      expect(state.portalUsers).toHaveLength(0);
      expect(state.credits).toHaveLength(0);
      expect(state.pendingPublicPackagePurchases).toHaveLength(1);
      expect(state.publicPackagePaymentSessions).toHaveLength(1);

      state.publicPackagePaymentSessions[0] = {
        ...state.publicPackagePaymentSessions[0],
        paymentStatus: "paid",
        paymentIntentId: "pi_public_package_1"
      };

      const completed = await fetch(`${baseUrl}${packagePath}&session_id=pkg-checkout-session-1`, {
        redirect: "manual"
      });

      expect(completed.status).toBe(303);
      expect(completed.headers.get("location")).toBe(`${packagePath}&purchase=success`);
      expect(state.portalUsers).toHaveLength(1);
      expect(state.portalUsers[0]).toMatchObject({
        email: "buyer@example.com",
        displayName: "Package Buyer"
      });
      expect(state.pendingPublicPackagePurchases).toHaveLength(0);
      expect(state.publicPackagePurchases).toHaveLength(1);
      expect(state.credits).toHaveLength(2);
      expect(state.credits).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientId: state.portalUsers[0]?.clientId,
          packageId: "package-public-1",
          appointmentTypeId: "appointment-type-private",
          remainingUnits: 4
        }),
        expect.objectContaining({
          clientId: state.portalUsers[0]?.clientId,
          packageId: "package-public-1",
          appointmentTypeId: "appointment-type-field",
          remainingUnits: 2
        })
      ]));

      const repeatedCallback = await fetch(`${baseUrl}${packagePath}&session_id=pkg-checkout-session-1`, {
        redirect: "manual"
      });
      expect(repeatedCallback.status).toBe(303);
      expect(repeatedCallback.headers.get("location")).toBe(`${packagePath}&purchase=success`);
      expect(state.publicPackagePurchases).toHaveLength(1);
      expect(state.credits).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders attached package checkout forms, validates required fields, and stores form submissions", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          active: true,
          price: 0,
          expirationDays: 120,
          shareToken: "starter-package-token",
          formTemplateId: "form-template-1",
          items: [
            {
              appointmentTypeId: "appointment-type-private",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            }
          ]
        }
      ] as never,
      formTemplates: [
        {
          id: "form-template-1",
          name: "Package Intake Form",
          active: true,
          formType: "booking_form",
          templateIsInternal: false,
          templateShowInClientPortal: true,
          fields: [
            {
              label: "Dog Name",
              type: "text",
              required: true
            },
            {
              label: "Goals",
              type: "textarea",
              required: false
            }
          ]
        }
      ] as never
    });

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const packagePath = "/client/package_detail.php?token=starter-package-token";

    try {
      const detail = await fetch(`${baseUrl}${packagePath}`);
      expect(detail.status).toBe(200);
      const detailHtml = await detail.text();
      expect(detailHtml).toContain("Package Intake Form");
      expect(detailHtml).toContain("Dog Name");
      expect(detailHtml).toContain("package_form[form-template-1][0]");

      const missingFormField = await fetch(`${baseUrl}${packagePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          buyer_name: "Package Buyer",
          buyer_email: "buyer@example.com",
          buyer_phone: "555-0111",
          notes: "Please keep sessions on weekday evenings."
        })
      });

      expect(missingFormField.status).toBe(400);
      expect(await missingFormField.text()).toContain("Dog Name is required.");

      const purchase = await fetch(`${baseUrl}${packagePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          buyer_name: "Package Buyer",
          buyer_email: "buyer@example.com",
          buyer_phone: "555-0111",
          notes: "Please keep sessions on weekday evenings.",
          "package_form[form-template-1][0]": "Rocket",
          "package_form[form-template-1][1]": "Build confidence around other dogs"
        })
      });

      expect(purchase.status).toBe(303);
      expect(state.formSubmissions).toHaveLength(1);
      expect(state.formSubmissions[0]).toMatchObject({
        templateId: "form-template-1",
        clientId: state.portalUsers[0]?.clientId
      });
      expect(state.formSubmissions[0]?.submittedAt).not.toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("skips re-submission of current package forms for existing clients on the same appointment type", async () => {
    const state = createInMemoryPlatformState({
      packages: [
        {
          id: "package-public-1",
          name: "Starter Package",
          description: "Four private sessions with follow-up support.",
          active: true,
          price: 0,
          expirationDays: 120,
          shareToken: "starter-package-token",
          formTemplateId: "form-template-1",
          items: [
            {
              appointmentTypeId: "appointment-type-private",
              appointmentTypeName: "Private Lesson",
              quantity: 4
            }
          ]
        }
      ] as never,
      formTemplates: [
        {
          id: "form-template-1",
          name: "Package Intake Form",
          active: true,
          formType: "booking_form",
          templateIsInternal: false,
          templateShowInClientPortal: true,
          requiredFrequency: "per_appointment",
          appointmentTypeId: "appointment-type-private",
          fields: [
            {
              label: "Dog Name",
              type: "text",
              required: true
            }
          ]
        }
      ] as never,
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "buyer@example.com",
          displayName: "Existing Buyer",
          passwordHash: "",
          archived: false
        }
      ],
      formSubmissions: [
        {
          id: "form-submission-1",
          templateId: "form-template-1",
          clientId: "client-portal-1",
          templateName: "Package Intake Form",
          formType: "booking_form",
          submittedAt: "2026-05-20T15:00:00.000Z",
          publicAccess: null
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
    const packagePath = "/client/package_detail.php?token=starter-package-token";

    try {
      const purchase = await fetch(`${baseUrl}${packagePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          buyer_name: "Existing Buyer",
          buyer_email: "buyer@example.com",
          buyer_phone: "555-0111",
          notes: "Use the existing intake details."
        })
      });

      expect(purchase.status).toBe(303);
      expect(state.formSubmissions).toHaveLength(1);
      expect(state.credits).toHaveLength(1);
      expect(state.credits[0]).toMatchObject({
        clientId: "client-portal-1",
        appointmentTypeId: "appointment-type-private",
        remainingUnits: 4
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports admin login and renders session-backed admin crm pages", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          passwordHash: "admin-hash",
          role: "owner",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "client@example.com",
          displayName: "Casey Client",
          passwordHash: "portal-hash",
          archived: false
        }
      ],
      bookings: [
        {
          id: "booking-1",
          clientId: "client-portal-1",
          petIds: [],
          serviceId: "svc-private-lesson",
          startsAt: "2026-05-30T16:00:00.000Z",
          endsAt: "2026-05-30T17:00:00.000Z",
          status: "pending",
          icalAccess: null
        }
      ],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "overdue",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-05-29T00:00:00.000Z"
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
      passwordVerifier: async (password, hash) =>
        (password === "admin-password" && hash === "admin-hash")
        || (password === "portal-password" && hash === "portal-hash")
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
      const loginPage = await fetch(`${baseUrl}/admin/login`);
      expect(loginPage.status).toBe(200);
      const adminLoginPageHtml = await loginPage.text();
      expect(adminLoginPageHtml).toContain("Admin Login");
      expect(adminLoginPageHtml).toContain("Dog Training Academy");
      expect(adminLoginPageHtml).not.toContain("Admin CRM");

      const login = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });

      expect(login.status).toBe(302);
      expect(login.headers.get("location")).toBe("/admin");
      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const dashboard = await fetch(`${baseUrl}/admin`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const clients = await fetch(`${baseUrl}/admin/clients`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const bookings = await fetch(`${baseUrl}/admin/bookings`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const invoices = await fetch(`${baseUrl}/admin/invoices`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const quotes = await fetch(`${baseUrl}/admin/quotes`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const contracts = await fetch(`${baseUrl}/admin/contracts`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const forms = await fetch(`${baseUrl}/admin/forms`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(dashboard.status).toBe(200);
      expect(clients.status).toBe(200);
      expect(bookings.status).toBe(200);
      expect(invoices.status).toBe(200);
      expect(quotes.status).toBe(200);
      expect(contracts.status).toBe(200);
      expect(forms.status).toBe(200);

      const dashboardHtml = await dashboard.text();
      const clientsHtml = await clients.text();
      const bookingsHtml = await bookings.text();
      const invoicesHtml = await invoices.text();
      const quotesHtml = await quotes.text();
      const contractsHtml = await contracts.text();
      const formsHtml = await forms.text();

      expect(dashboardHtml).toContain("Brook Admin");
      expect(dashboardHtml).toContain("pendingBookings");
      expect(dashboardHtml).toContain("booking-1");
      expect(dashboardHtml).toContain("Dog Training Academy");
      expect(dashboardHtml).toContain("sidebar");
      expect(dashboardHtml).toContain("app-main-content");
      expect(dashboardHtml).toContain("summary-grid");
      expect(dashboardHtml).toContain("data-table");
      expect(dashboardHtml).not.toContain('class="inline-link-list"');
      expect(clientsHtml).toContain("client-portal-1");
      expect(clientsHtml).toContain("Casey");
      expect(clientsHtml).toContain("<h2>Client Directory</h2>");
      expect(clientsHtml).toContain("<table");
      expect(bookingsHtml).toContain("booking-1");
      expect(bookingsHtml).toContain("<h2>Booking Ledger</h2>");
      expect(bookingsHtml).toContain('<div class="data-table">');
      expect(bookingsHtml).toContain("data-enhanced-table");
      expect(bookingsHtml).toContain("data-enhanced-table-search");
      expect(bookingsHtml).toContain("data-enhanced-table-page-count");
      expect(invoicesHtml).toContain("invoice-1");
      expect(invoicesHtml).toContain("<h2>Invoice Ledger</h2>");
      expect(invoicesHtml).toContain('<div class="data-table">');
      expect(quotesHtml).toContain("quote-1");
      expect(quotesHtml).toContain("<h2>Quote Pipeline</h2>");
      expect(quotesHtml).toContain('<div class="data-table">');
      expect(contractsHtml).toContain("contract-1");
      expect(contractsHtml).toContain("<h2>Contract Status</h2>");
      expect(contractsHtml).toContain('<div class="data-table">');
      expect(formsHtml).toContain("form-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders portal account pages and admin client resource pages", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          passwordHash: "admin-hash",
          role: "owner",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "client@example.com",
          displayName: "Casey Client",
          passwordHash: "portal-hash",
          phone: "555-0100",
          address: "123 Harbor Way",
          notes: "Reactive at the door.",
          isAdmin: false,
          archived: false
        }
      ],
      contacts: [
        {
          id: "contact-1",
          clientId: "client-portal-1",
          name: "Primary Contact",
          email: "contact@example.com",
          phone: "555-0100",
          isPrimary: true
        }
      ],
      pets: [
        {
          id: "pet-1",
          clientId: "client-portal-1",
          name: "Buddy",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      packages: [
        {
          id: "package-1",
          name: "Starter Package",
          active: true,
          price: 325
        }
      ],
      credits: [
        {
          id: "credit-1",
          clientId: "client-portal-1",
          packageId: "package-1",
          appointmentTypeId: "appointment-type-1",
          remainingUnits: 4
        }
      ],
      achievementTypes: [
        {
          id: "achievement-type-1",
          title: "Canine Good Citizen",
          description: "Awarded after program completion.",
          scopeType: "general",
          awardMode: "badge_certificate",
          badgeIconPath: "/assets/badges/cgc.svg",
          certificateTemplatePath: "/assets/certificates/cgc.html",
          certificateBodyHtml: "<p>Certificate Body</p>",
          active: true
        }
      ],
      clientAchievements: [
        {
          id: "achievement-1",
          clientId: "client-portal-1",
          achievementTypeId: "achievement-type-1",
          title: "Canine Good Citizen",
          description: "Awarded after program completion.",
          scopeType: "general",
          awardMode: "badge_certificate",
          badgeIconPath: "/assets/badges/cgc.svg",
          certificateTemplatePath: "/assets/certificates/cgc.html",
          certificateBodyHtml: "<p>Certificate Body</p>",
          status: "awarded",
          awardedOn: "2026-05-20",
          dogName: "Buddy",
          programName: "Obedience 101",
          notes: "Strong recall and leash work.",
          awardedByAdminUserId: "admin-1",
          updatedByAdminUserId: "admin-1",
          revokedByAdminUserId: null,
          revokedAt: null,
          createdAt: "2026-05-20T18:00:00.000Z",
          updatedAt: "2026-05-20T18:00:00.000Z"
        }
      ],
      passwordVerifier: async (password, hash) =>
        (password === "admin-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "portal-hash")
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
      const portalLogin = await fetch(`${baseUrl}/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          email: "client@example.com",
          password: "client-password"
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");

      const portalProfile = await fetch(`${baseUrl}/portal/profile`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalAppointments = await fetch(`${baseUrl}/portal/appointments`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalContacts = await fetch(`${baseUrl}/portal/contacts`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalContactDetail = await fetch(`${baseUrl}/portal/contacts/contact-1`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalPets = await fetch(`${baseUrl}/portal/pets`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalPackages = await fetch(`${baseUrl}/portal/packages`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalCredits = await fetch(`${baseUrl}/portal/credits`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalAchievements = await fetch(`${baseUrl}/portal/achievements`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalAchievementDetail = await fetch(`${baseUrl}/portal/achievements/achievement-1`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const portalAchievementCertificate = await fetch(`${baseUrl}/portal/achievements/achievement-1/certificate`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });

      expect(portalProfile.status).toBe(200);
      expect(portalAppointments.status).toBe(200);
      expect(portalContacts.status).toBe(200);
      expect(portalContactDetail.status).toBe(200);
      expect(portalPets.status).toBe(200);
      expect(portalPackages.status).toBe(200);
      expect(portalCredits.status).toBe(200);
      expect(portalAchievements.status).toBe(200);
      expect(portalAchievementDetail.status).toBe(200);
      expect(portalAchievementCertificate.status).toBe(200);

      const portalProfileHtml = await portalProfile.text();
      const portalAppointmentsHtml = await portalAppointments.text();
      const portalContactsHtml = await portalContacts.text();
      const portalContactDetailHtml = await portalContactDetail.text();
      const portalPetsHtml = await portalPets.text();
      const portalPackagesHtml = await portalPackages.text();
      const portalCreditsHtml = await portalCredits.text();
      const portalAchievementsHtml = await portalAchievements.text();
      const portalAchievementDetailHtml = await portalAchievementDetail.text();

      expect(portalProfileHtml).toContain("123 Harbor Way");
      expect(portalProfileHtml).toContain("Manage the primary contact information");
      expect(portalProfileHtml).toContain('<form class="form-grid" method="post" action="/portal/profile">');
      expect(portalProfileHtml).not.toContain('class="inline-link-list"');
      expect(portalAppointmentsHtml).toContain("<h2>Appointment Schedule</h2>");
      expect(portalAppointmentsHtml).toContain("No appointments.");
      expect(portalContactsHtml).toContain("contact-1");
      expect(portalContactsHtml).toContain("<h2>Contact Directory</h2>");
      expect(portalContactsHtml).toContain('<div class="data-table">');
      expect(portalContactDetailHtml).toContain("Primary Contact");
      expect(portalContactDetailHtml).toContain("<h2>Edit Contact</h2>");
      expect(portalContactDetailHtml).toContain('<form class="form-grid" method="post" action="/portal/contacts/contact-1">');
      expect(portalPetsHtml).toContain("Buddy");
      expect(portalPetsHtml).toContain("<h2>Pet Directory</h2>");
      expect(portalPetsHtml).toContain('<div class="data-table">');
      expect(portalPetsHtml).toContain("data-enhanced-table-prev");
      expect(portalPetsHtml).toContain('data-label="Pet ID"');
      expect(portalPetsHtml).toContain("Use the side gate and towel paws before re-entry.");
      expect(portalPackagesHtml).toContain("Starter Package");
      expect(portalPackagesHtml).toContain("<h2>Package Summary</h2>");
      expect(portalCreditsHtml).toContain("credit-1");
      expect(portalCreditsHtml).toContain("<h2>Credit Balances</h2>");
      expect(portalAchievementsHtml).toContain("Canine Good Citizen");
      expect(portalAchievementsHtml).toContain("<h2>Achievement Library</h2>");
      expect(portalAchievementDetailHtml).toContain("Obedience 101");
      expect(portalAchievementDetailHtml).toContain("<h2>Award Summary</h2>");
      expect(await portalAchievementCertificate.text()).toContain("Canine Good Citizen");

      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const adminClientProfile = await fetch(`${baseUrl}/admin/clients/client-portal-1/profile`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientContacts = await fetch(`${baseUrl}/admin/clients/client-portal-1/contacts`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientContactDetail = await fetch(`${baseUrl}/admin/clients/client-portal-1/contacts/contact-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminPets = await fetch(`${baseUrl}/admin/pets`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminPackages = await fetch(`${baseUrl}/admin/packages`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminCredits = await fetch(`${baseUrl}/admin/credits`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminAchievementTypes = await fetch(`${baseUrl}/admin/achievement-types`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminAchievementTypeDetail = await fetch(`${baseUrl}/admin/achievement-types/achievement-type-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientAchievements = await fetch(`${baseUrl}/admin/clients/client-portal-1/achievements`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientAchievementDetail = await fetch(`${baseUrl}/admin/clients/client-portal-1/achievements/achievement-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminClientAchievementCertificate = await fetch(`${baseUrl}/admin/clients/client-portal-1/achievements/achievement-1/certificate`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(adminClientProfile.status).toBe(200);
      expect(adminClientContacts.status).toBe(200);
      expect(adminClientContactDetail.status).toBe(200);
      expect(adminPets.status).toBe(200);
      expect(adminPackages.status).toBe(200);
      expect(adminCredits.status).toBe(200);
      expect(adminAchievementTypes.status).toBe(200);
      expect(adminAchievementTypeDetail.status).toBe(200);
      expect(adminClientAchievements.status).toBe(200);
      expect(adminClientAchievementDetail.status).toBe(200);
      expect(adminClientAchievementCertificate.status).toBe(200);

      const adminClientProfileHtml = await adminClientProfile.text();
      const adminClientContactsHtml = await adminClientContacts.text();
      const adminClientContactDetailHtml = await adminClientContactDetail.text();
      const adminPetsHtml = await adminPets.text();
      const adminPackagesHtml = await adminPackages.text();
      const adminCreditsHtml = await adminCredits.text();
      const adminAchievementTypesHtml = await adminAchievementTypes.text();
      const adminAchievementTypeDetailHtml = await adminAchievementTypeDetail.text();

      expect(adminClientProfileHtml).toContain("Reactive at the door.");
      expect(adminClientProfileHtml).toContain("<h2>Edit Client</h2>");
      expect(adminClientProfileHtml).toContain('<form class="form-grid" method="post" action="/admin/clients/client-portal-1/profile">');
      expect(adminClientProfileHtml).toContain('/client/form_requests_create.php?form_type=client_form&client_id=client-portal-1');
      expect(adminClientProfileHtml).toContain('/client/form_requests_create.php?form_type=survey_form&client_id=client-portal-1');
      expect(adminClientContactsHtml).toContain("Primary Contact");
      expect(adminClientContactsHtml).toContain("<h2>Contact Directory</h2>");
      expect(adminClientContactDetailHtml).toContain("Primary Contact");
      expect(adminClientContactDetailHtml).toContain("<h2>Edit Contact</h2>");
      expect(adminPetsHtml).toContain("Buddy");
      expect(adminPetsHtml).toContain("<h2>Pet Directory</h2>");
      expect(adminPetsHtml).toContain("Use the side gate and towel paws before re-entry.");
      expect(adminPackagesHtml).toContain("Starter Package");
      expect(adminPackagesHtml).toContain("<h2>Package Catalog</h2>");
      expect(adminCreditsHtml).toContain("credit-1");
      expect(adminCreditsHtml).toContain("<h2>Credit Balances</h2>");
      expect(adminAchievementTypesHtml).toContain("achievement-type-1");
      expect(adminAchievementTypesHtml).toContain("<h2>Achievement Catalog</h2>");
      expect(adminAchievementTypeDetailHtml).toContain("Canine Good Citizen");
      expect(adminAchievementTypeDetailHtml).toContain("<h2>Type Definition</h2>");
      expect(await adminClientAchievements.text()).toContain("Obedience 101");
      expect(await adminClientAchievementDetail.text()).toContain("Obedience 101");
      expect(await adminClientAchievementCertificate.text()).toContain("Canine Good Citizen");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("links admin resource lists to booking, invoice, quote, contract, pet, package, credit, and form detail pages", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          passwordHash: "admin-hash",
          role: "owner",
          active: true
        }
      ],
      bookings: [
        {
          id: "booking-1",
          clientId: "client-portal-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-05-30T16:00:00.000Z",
          endsAt: "2026-05-30T17:00:00.000Z",
          status: "pending",
          icalAccess: {
            token: "booking-ical-token",
            issuedAt: "2026-05-27T18:00:00.000Z",
            expiresAt: null,
            legacySourceId: "booking-1"
          }
        }
      ],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-portal-1",
          status: "overdue",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-05-29T00:00:00.000Z"
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
          templateId: "template-follow-up",
          clientId: "client-portal-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          submittedAt: "2026-05-30T10:00:00.000Z",
          publicAccess: null
        }
      ],
      pets: [
        {
          id: "pet-1",
          clientId: "client-portal-1",
          name: "Buddy",
          species: "dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      packages: [
        {
          id: "package-1",
          name: "Starter Package",
          active: true,
          price: 325
        }
      ],
      credits: [
        {
          id: "credit-1",
          clientId: "client-portal-1",
          packageId: "package-1",
          appointmentTypeId: "appointment-type-1",
          remainingUnits: 4
        }
      ],
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
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
      const login = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });

      const cookie = login.headers.get("set-cookie");
      expect(cookie).toContain("bdta_session=");

      const bookings = await fetch(`${baseUrl}/admin/bookings`, { headers: { cookie: cookie ?? "" } });
      const bookingDetail = await fetch(`${baseUrl}/admin/bookings/booking-1`, { headers: { cookie: cookie ?? "" } });
      const invoices = await fetch(`${baseUrl}/admin/invoices`, { headers: { cookie: cookie ?? "" } });
      const invoiceDetail = await fetch(`${baseUrl}/admin/invoices/invoice-1`, { headers: { cookie: cookie ?? "" } });
      const quotes = await fetch(`${baseUrl}/admin/quotes`, { headers: { cookie: cookie ?? "" } });
      const quoteDetail = await fetch(`${baseUrl}/admin/quotes/quote-1`, { headers: { cookie: cookie ?? "" } });
      const contracts = await fetch(`${baseUrl}/admin/contracts`, { headers: { cookie: cookie ?? "" } });
      const contractDetail = await fetch(`${baseUrl}/admin/contracts/contract-1`, { headers: { cookie: cookie ?? "" } });
      const pets = await fetch(`${baseUrl}/admin/pets`, { headers: { cookie: cookie ?? "" } });
      const petDetail = await fetch(`${baseUrl}/admin/pets/pet-1`, { headers: { cookie: cookie ?? "" } });
      const packages = await fetch(`${baseUrl}/admin/packages`, { headers: { cookie: cookie ?? "" } });
      const packageDetail = await fetch(`${baseUrl}/admin/packages/package-1`, { headers: { cookie: cookie ?? "" } });
      const credits = await fetch(`${baseUrl}/admin/credits`, { headers: { cookie: cookie ?? "" } });
      const creditDetail = await fetch(`${baseUrl}/admin/credits/credit-1`, { headers: { cookie: cookie ?? "" } });
      const forms = await fetch(`${baseUrl}/admin/forms`, { headers: { cookie: cookie ?? "" } });
      const formDetail = await fetch(`${baseUrl}/admin/forms/form-1`, { headers: { cookie: cookie ?? "" } });

      expect(bookings.status).toBe(200);
      expect(bookingDetail.status).toBe(200);
      expect(invoices.status).toBe(200);
      expect(invoiceDetail.status).toBe(200);
      expect(quotes.status).toBe(200);
      expect(quoteDetail.status).toBe(200);
      expect(contracts.status).toBe(200);
      expect(contractDetail.status).toBe(200);
      expect(pets.status).toBe(200);
      expect(petDetail.status).toBe(200);
      expect(packages.status).toBe(200);
      expect(packageDetail.status).toBe(200);
      expect(credits.status).toBe(200);
      expect(creditDetail.status).toBe(200);
      expect(forms.status).toBe(200);
      expect(formDetail.status).toBe(200);

      const bookingsHtml = await bookings.text();
      const bookingDetailHtml = await bookingDetail.text();
      const invoicesHtml = await invoices.text();
      const invoiceDetailHtml = await invoiceDetail.text();
      const quotesHtml = await quotes.text();
      const quoteDetailHtml = await quoteDetail.text();
      const contractsHtml = await contracts.text();
      const contractDetailHtml = await contractDetail.text();
      const petsHtml = await pets.text();
      const petDetailHtml = await petDetail.text();
      const packagesHtml = await packages.text();
      const packageDetailHtml = await packageDetail.text();
      const creditsHtml = await credits.text();
      const creditDetailHtml = await creditDetail.text();
      const formsHtml = await forms.text();
      const formDetailHtml = await formDetail.text();

      expect(bookingsHtml).toContain('href="/admin/bookings/booking-1"');
      expect(bookingDetailHtml).toContain("Booking Details");
      expect(bookingDetailHtml).toContain("svc-private-lesson");
      expect(bookingDetailHtml).toContain('/client/form_requests_create.php?form_type=follow_up_note&booking_id=booking-1');
      expect(invoicesHtml).toContain('href="/admin/invoices/invoice-1"');
      expect(invoiceDetailHtml).toContain("Invoice Details");
      expect(invoiceDetailHtml).toContain("$125.00");
      expect(quotesHtml).toContain('href="/admin/quotes/quote-1"');
      expect(quoteDetailHtml).toContain("Quote Details");
      expect(quoteDetailHtml).toContain("$450.00");
      expect(contractsHtml).toContain('href="/admin/contracts/contract-1"');
      expect(contractDetailHtml).toContain("Contract Details");
      expect(contractDetailHtml).toContain("contract-1");
      expect(petsHtml).toContain('href="/admin/pets/pet-1"');
      expect(petDetailHtml).toContain("Pet Details");
      expect(petDetailHtml).toContain("Buddy");
      expect(petDetailHtml).toContain('/client/form_requests_create.php?form_type=pet_form&pet_id=pet-1');
      expect(packagesHtml).toContain('href="/admin/packages/package-1"');
      expect(packageDetailHtml).toContain("Package Details");
      expect(packageDetailHtml).toContain("Starter Package");
      expect(creditsHtml).toContain('href="/admin/credits/credit-1"');
      expect(creditDetailHtml).toContain("Credit Details");
      expect(creditDetailHtml).toContain("4");
      expect(formsHtml).toContain('href="/admin/forms/form-1"');
      expect(formDetailHtml).toContain("Review Status");
      expect(formDetailHtml).toContain("Follow-up Note");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports legacy form submission review routes and survey results parity", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-1",
          email: "casey@example.com",
          displayName: "Casey Client",
          passwordHash: "portal-hash",
          archived: false
        }
      ],
      formTemplates: [
        {
          id: "survey-template-1",
          name: "Program Feedback Survey",
          active: true,
          description: "Post-program survey used for client feedback.",
          fields: [
            {
              label: "How prepared did you feel after your first session?",
              type: "radio",
              options: ["Very prepared", "Somewhat prepared", "Not prepared"]
            },
            {
              label: "Additional feedback",
              type: "textarea"
            }
          ],
          formType: "survey_form",
          templateIsInternal: false,
          templateShowInClientPortal: true
        },
        {
          id: "followup-template-1",
          name: "Follow-up Note",
          active: true,
          description: "Admin follow-up note.",
          fields: [
            {
              label: "Summary",
              type: "textarea",
              required: true
            }
          ],
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true
        }
      ],
      formSubmissions: [
        {
          id: "form-survey-1",
          templateId: "survey-template-1",
          clientId: "client-1",
          templateName: "Program Feedback Survey",
          formType: "survey_form",
          templateIsInternal: false,
          templateShowInClientPortal: true,
          status: "submitted",
          submittedAt: "2026-05-30T10:00:00.000Z",
          responses: ["Very prepared", "Loved the prep emails."],
          publicAccess: null
        },
        {
          id: "form-note-1",
          templateId: "followup-template-1",
          clientId: "client-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          status: "submitted",
          submittedAt: "2026-05-31T10:00:00.000Z",
          responses: ["Client is making steady leash progress."],
          publicAccess: null
        }
      ],
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
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
      const login = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const cookie = login.headers.get("set-cookie");

      const legacyList = await fetch(`${baseUrl}/client/form_submissions_list.php?status=submitted`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const legacyDetail = await fetch(`${baseUrl}/client/form_submissions_view.php?id=form-survey-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const legacySurveyResults = await fetch(`${baseUrl}/client/form_survey_results.php?template_id=survey-template-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      const modernSurveyResults = await fetch(`${baseUrl}/admin/form-templates/survey-template-1/survey-results`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(legacyList.status).toBe(200);
      expect(legacyDetail.status).toBe(200);
      expect(legacySurveyResults.status).toBe(200);
      expect(modernSurveyResults.status).toBe(200);

      const legacyListHtml = await legacyList.text();
      const legacyDetailHtml = await legacyDetail.text();
      const legacySurveyResultsHtml = await legacySurveyResults.text();
      const modernSurveyResultsHtml = await modernSurveyResults.text();

      expect(legacyListHtml).toContain("Form Submissions");
      expect(legacyListHtml).toContain("Casey Client");
      expect(legacyListHtml).toContain("/client/form_survey_results.php?template_id=survey-template-1");
      expect(legacyDetailHtml).toContain("Survey Results");
      expect(legacySurveyResultsHtml).toContain("Program Feedback Survey");
      expect(legacySurveyResultsHtml).toContain("Very prepared");
      expect(legacySurveyResultsHtml).toContain("Loved the prep emails.");
      expect(modernSurveyResultsHtml).toContain("Visualized Questions");
      expect(modernSurveyResultsHtml).toContain("responses | 100%");

      const review = await fetch(`${baseUrl}/client/form_submissions_view.php?id=form-note-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          action: "review",
          notes: "Checked and approved."
        })
      });

      expect(review.status).toBe(302);
      expect(state.formSubmissions.find((item) => item.id === "form-note-1")?.status).toBe("reviewed");
      expect(state.formSubmissions.find((item) => item.id === "form-note-1")?.reviewedByAdminUserId).toBe("admin-1");
      expect(state.formSubmissions.find((item) => item.id === "form-note-1")?.notes).toBe("Checked and approved.");

      const reviewedDetail = await fetch(`${baseUrl}/admin/forms/form-note-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });
      expect(reviewedDetail.status).toBe(200);
      expect(await reviewedDetail.text()).toContain("Remove Review");

      const unreview = await fetch(`${baseUrl}/admin/forms/form-note-1/unreview`, {
        method: "POST",
        headers: {
          cookie: cookie ?? ""
        },
        redirect: "manual"
      });

      expect(unreview.status).toBe(302);
      expect(state.formSubmissions.find((item) => item.id === "form-note-1")?.status).toBe("submitted");
      expect(state.formSubmissions.find((item) => item.id === "form-note-1")?.reviewedAt).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports legacy form request generation, queued delivery, and booking-link open actions", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-1",
          email: "casey@example.com",
          displayName: "Casey Client",
          passwordHash: "portal-hash",
          phone: "555-0100",
          archived: false
        }
      ],
      appointmentTypes: [
        {
          id: "appointment-type-1",
          name: "Private Coaching",
          description: "Private coaching session.",
          bulletPoints: [],
          adminUserId: "admin-1",
          durationMinutes: 90,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          useTravelTimeBuffer: false,
          travelTimeMinutes: 0,
          advanceBookingMinDays: 1,
          advanceBookingMaxDays: 30,
          cancellationNoticeHours: 24,
          requiresForms: false,
          formTemplateIds: [],
          requiresContract: false,
          contractTemplateId: null,
          autoInvoice: false,
          invoiceDueDays: 0,
          invoiceDueTiming: "after",
          defaultAmount: 225,
          consumesCredits: false,
          creditCount: 1,
          isGroupClass: false,
          maxParticipants: 1,
          publicAvailable: true,
          portalAvailable: true,
          scheduleType: "recurring",
          specificDate: null,
          specificDates: [],
          availableDays: [1, 2, 3, 4, 5],
          availableStartTime: "09:00",
          availableEndTime: "17:00",
          timeSlotInterval: 30,
          perDaySchedule: {},
          isMiniSession: false,
          miniSessionLocation: "",
          miniSessionTopic: "",
          isFieldRental: false,
          fieldRentalLocation: "",
          groupClassLocation: "",
          locationTypes: ["client_address"],
          confirmationTemplateId: null,
          bookingRequestTemplateId: null,
          invoiceTemplateId: null,
          reminderTemplateId: null,
          cancellationTemplateId: null,
          requiresAdminConfirmation: false,
          usesResource: false,
          resourceName: "",
          resourceCapacity: 1,
          resourceAllocation: "per_appointment",
          uniqueLink: "private-coaching-link",
          active: true
        }
      ] as never,
      bookings: [
        {
          id: "booking-1",
          clientId: "client-1",
          petIds: ["pet-1"],
          serviceId: "appointment-type-1",
          startsAt: "2026-05-30T18:00:00.000Z",
          endsAt: "2026-05-30T19:30:00.000Z",
          status: "confirmed",
          icalAccess: null
        }
      ] as never,
      pets: [
        {
          id: "pet-1",
          clientId: "client-1",
          name: "Buddy",
          species: "Dog",
          petSittingNotes: "",
          archived: false
        }
      ] as never,
      formTemplates: [
        {
          id: "survey-template-1",
          name: "Program Feedback Survey",
          active: true,
          description: "Post-program survey used for client feedback.",
          fields: [{ label: "How did training go?", type: "textarea" }],
          formType: "survey_form",
          templateIsInternal: false,
          templateShowInClientPortal: true
        },
        {
          id: "followup-template-1",
          name: "Follow-up Note",
          active: true,
          description: "Admin follow-up note.",
          fields: [{ label: "Summary", type: "textarea" }],
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true
        }
      ] as never,
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
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
      const login = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const cookie = login.headers.get("set-cookie");

      const requestPage = await fetch(`${baseUrl}/client/form_requests_create.php?form_type=survey_form&client_id=client-1`, {
        headers: {
          cookie: cookie ?? ""
        }
      });

      expect(requestPage.status).toBe(200);
      const requestPageHtml = await requestPage.text();
      expect(requestPageHtml).toContain("Survey Form Request");
      expect(requestPageHtml).toContain("Program Feedback Survey");
      expect(requestPageHtml).toContain("Generate and Queue Email");

      const generate = await fetch(`${baseUrl}/client/form_requests_create.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookie ?? ""
        },
        body: new URLSearchParams({
          form_type: "survey_form",
          client_id: "client-1",
          template_id: "survey-template-1",
          request_action: "generate"
        })
      });

      expect(generate.status).toBe(200);
      const generateHtml = await generate.text();
      expect(generateHtml).toContain("Link generated successfully.");
      expect(generateHtml).toContain("/backend/public/form.php?token=form-request-1-token");
      expect(state.formSubmissions).toHaveLength(1);
      expect(state.formSubmissions[0]?.status).toBe("pending");
      expect(state.formSubmissions[0]?.submittedAt).toBeNull();
      expect(state.formSubmissions[0]?.templateId).toBe("survey-template-1");

      const send = await fetch(`${baseUrl}/client/form_requests_create.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookie ?? ""
        },
        body: new URLSearchParams({
          form_type: "survey_form",
          client_id: "client-1",
          template_id: "survey-template-1",
          request_action: "send"
        })
      });

      expect(send.status).toBe(200);
      expect(await send.text()).toContain("Link queued for casey@example.com.");
      expect(state.formSubmissions).toHaveLength(2);
      expect(state.queuedEmails).toHaveLength(1);
      expect(state.queuedEmails[0]?.subject).toBe("Please complete your Program Feedback Survey");
      expect(state.queuedEmails[0]?.html).toContain("/backend/public/form.php?token=form-request-2-token");

      const openBookingRequest = await fetch(`${baseUrl}/client/form_requests_create.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          form_type: "booking_form",
          appointment_type_id: "appointment-type-1",
          client_id: "client-1",
          request_action: "open"
        })
      });

      expect(openBookingRequest.status).toBe(302);
      expect(openBookingRequest.headers.get("location")).toBe(`${baseUrl}/backend/public/book.php?link=private-coaching-link`);

      const blockedInternalSend = await fetch(`${baseUrl}/client/form_requests_create.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookie ?? ""
        },
        body: new URLSearchParams({
          form_type: "follow_up_note",
          client_id: "client-1",
          booking_id: "booking-1",
          template_id: "followup-template-1",
          request_action: "send"
        })
      });

      expect(blockedInternalSend.status).toBe(200);
      expect(await blockedInternalSend.text()).toContain("This form type cannot be emailed because it is for admin use only.");
      expect(state.formSubmissions).toHaveLength(2);
      expect(state.queuedEmails).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders admin content, settings, and operations pages and supports content mutations", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
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
          cssContent: "",
          metaDescription: "Homepage",
          metaKeywords: "dogs",
          ogTitle: null,
          ogDescription: null,
          ogImage: null,
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
          htmlContent: "<section><h1>Programs</h1></section>",
          cssContent: "",
          metaDescription: "Programs",
          metaKeywords: "private lessons",
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
      ],
      settings: [
        ...createManagedSettingsCatalog("2026-05-28T12:00:00.000Z")
      ],
      queuedJobs: [
        {
          jobId: "job-queued-1",
          kind: "workflow_processor",
          scheduledFor: "2026-05-27T17:30:00.000Z",
          payload: {
            limit: 10
          }
        }
      ],
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
    });
    state.integrationCallbacks.push({
      callbackId: "callback-1",
      provider: "stripe",
      receivedAt: "2026-05-29T09:30:00.000Z",
      queuedJobId: "job-queued-1",
      payload: {
        invoiceId: "invoice-1",
        paymentStatus: "paid"
      }
    });

    const envRoot = await mkdtemp(path.join(os.tmpdir(), "bdta-web-settings-"));
    const envFilePath = path.join(envRoot, ".env.production");
    const envTemplatePath = path.join(envRoot, ".env.production.example");
    await writeFile(envTemplatePath, [
      "DB_HOST=localhost",
      "DB_PORT=3306",
      "DB_NAME=bdta",
      "DB_USER=bdta_user",
      "DB_PASSWORD=template-password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"), "utf8");
    await writeFile(envFilePath, [
      "DB_HOST=db.internal",
      "DB_PORT=3307",
      "DB_NAME=bdta_runtime",
      "DB_USER=runtime_user",
      "DB_PASSWORD=runtime_password",
      "SESSION_LIFETIME_SECONDS=1209600"
    ].join("\n"), "utf8");

    const server = createHttpWebServer({
      state,
      runtimeEnvironmentFilePath: envFilePath,
      runtimeEnvironmentTemplateFilePath: envTemplatePath,
      runtimeEnvironmentProcessEnv: {
        DB_HOST: "db.plesk.internal",
        PORT: "4100"
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const blogPosts = await fetch(`${baseUrl}/admin/blog-posts`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const blogPostDetail = await fetch(`${baseUrl}/admin/blog-posts/blog-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyBlogPosts = await fetch(`${baseUrl}/client/blog_list.php`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyBlogPostDetail = await fetch(`${baseUrl}/client/blog_edit.php?id=blog-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyBlogCreatePage = await fetch(`${baseUrl}/client/blog_edit.php`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const sitePages = await fetch(`${baseUrl}/admin/site-pages`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacySitePages = await fetch(`${baseUrl}/client/site_pages_list.php`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const sitePageDetail = await fetch(`${baseUrl}/admin/site-pages/page-services`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const sitePageEditor = await fetch(`${baseUrl}/admin/site-pages/page-services/editor`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacySitePageEditor = await fetch(`${baseUrl}/client/site_editor.php?id=page-services`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const settings = await fetch(`${baseUrl}/admin/settings`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const databaseSettings = await fetch(`${baseUrl}/admin/settings?category=database`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const communicationsSettings = await fetch(`${baseUrl}/admin/settings?category=communications`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const adminSettingsUsersPage = await fetch(`${baseUrl}/admin/settings?category=admins`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacySettings = await fetch(`${baseUrl}/client/settings.php`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const settingDetail = await fetch(`${baseUrl}/admin/settings/turnstile_site_key`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const smtpPasswordDetail = await fetch(`${baseUrl}/admin/settings/smtp_password`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const googleCalendarEnabledDetail = await fetch(`${baseUrl}/admin/settings/google_calendar_enabled`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const newsletterEmbedDetail = await fetch(`${baseUrl}/admin/settings/newsletter_embed_html`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const jobLogs = await fetch(`${baseUrl}/admin/operations/jobs`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const jobLogDetail = await fetch(`${baseUrl}/admin/operations/jobs/job-queued-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const callbackLogs = await fetch(`${baseUrl}/admin/operations/callbacks`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const callbackLogDetail = await fetch(`${baseUrl}/admin/operations/callbacks/callback-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(blogPosts.status).toBe(200);
      expect(blogPostDetail.status).toBe(200);
      expect(legacyBlogPosts.status).toBe(200);
      expect(legacyBlogPostDetail.status).toBe(200);
      expect(legacyBlogCreatePage.status).toBe(200);
      expect(sitePages.status).toBe(200);
      expect(legacySitePages.status).toBe(200);
      expect(sitePageDetail.status).toBe(200);
      expect(sitePageEditor.status).toBe(200);
      expect(legacySitePageEditor.status).toBe(200);
      expect(settings.status).toBe(200);
      expect(databaseSettings.status).toBe(200);
      expect(communicationsSettings.status).toBe(200);
      expect(adminSettingsUsersPage.status).toBe(200);
      expect(legacySettings.status).toBe(200);
      expect(settingDetail.status).toBe(200);
      expect(smtpPasswordDetail.status).toBe(200);
      expect(googleCalendarEnabledDetail.status).toBe(200);
      expect(newsletterEmbedDetail.status).toBe(200);
      expect(jobLogs.status).toBe(200);
      expect(jobLogDetail.status).toBe(200);
      expect(callbackLogs.status).toBe(200);
      expect(callbackLogDetail.status).toBe(200);

      const blogPostsHtml = await blogPosts.text();
      const blogPostDetailHtml = await blogPostDetail.text();
      const legacyBlogPostsHtml = await legacyBlogPosts.text();
      const legacyBlogPostDetailHtml = await legacyBlogPostDetail.text();
      const legacyBlogCreatePageHtml = await legacyBlogCreatePage.text();
      const sitePagesHtml = await sitePages.text();
      const legacySitePagesHtml = await legacySitePages.text();
      const sitePageDetailHtml = await sitePageDetail.text();
      const sitePageEditorHtml = await sitePageEditor.text();
      const legacySitePageEditorHtml = await legacySitePageEditor.text();
      const settingsHtml = await settings.text();
      const databaseSettingsHtml = await databaseSettings.text();
      const communicationsSettingsHtml = await communicationsSettings.text();
      const adminSettingsUsersHtml = await adminSettingsUsersPage.text();
      const legacySettingsHtml = await legacySettings.text();
      const settingDetailHtml = await settingDetail.text();
      const smtpPasswordDetailHtml = await smtpPasswordDetail.text();
      const googleCalendarEnabledDetailHtml = await googleCalendarEnabledDetail.text();
      const newsletterEmbedDetailHtml = await newsletterEmbedDetail.text();
      const jobLogsHtml = await jobLogs.text();
      const jobLogDetailHtml = await jobLogDetail.text();
      const callbackLogsHtml = await callbackLogs.text();
      const callbackLogDetailHtml = await callbackLogDetail.text();

      expect(blogPostsHtml).toContain("Loose Leash Training Tips");
      expect(blogPostsHtml).toContain("<h2>Published Content</h2>");
      expect(blogPostsHtml).toContain("/admin/blog-posts/blog-1/delete");
      expect(blogPostDetailHtml).toContain("Walks start before the leash clips on.");
      expect(blogPostDetailHtml).toContain("<h2>Edit Blog Post</h2>");
      expect(blogPostDetailHtml).toContain("/admin/blog-posts/blog-1/delete");
      expect(legacyBlogPostsHtml).toContain("Blog Posts");
      expect(legacyBlogPostsHtml).toContain("/client/blog_edit.php?id=blog-1");
      expect(legacyBlogPostsHtml).toContain('/client/blog_delete.php');
      expect(legacyBlogPostDetailHtml).toContain('action="/client/blog_edit.php?id=blog-1"');
      expect(legacyBlogCreatePageHtml).toContain('action="/client/blog_edit.php"');
      expect(sitePagesHtml).toContain("Services");
      expect(sitePagesHtml).toContain("<h2>Site Page Directory</h2>");
      expect(sitePagesHtml).toContain("Edit in Visual Editor");
      expect(legacySitePagesHtml).toContain("Site Pages");
      expect(legacySitePagesHtml).toContain("/client/site_editor.php?id=page-services");
      expect(sitePageDetailHtml).toContain("private lessons");
      expect(sitePageDetailHtml).toContain("<h2>Edit Site Page</h2>");
      expect(sitePageDetailHtml).toContain("/admin/site-pages/page-services/editor");
      expect(sitePageEditorHtml).toContain("Visual Site Editor");
      expect(legacySitePageEditorHtml).toContain("Visual Site Editor");
      expect(sitePageEditorHtml).toContain('id="gjs"');
      expect(sitePageEditorHtml).toContain("Edit HTML / CSS");
      expect(sitePageEditorHtml).toContain("Page Settings");
      expect(sitePageEditorHtml).toContain("Undo");
      expect(sitePageEditorHtml).toContain("Redo");
      expect(sitePageEditorHtml).toContain("Desktop");
      expect(sitePageEditorHtml).toContain("Tablet");
      expect(sitePageEditorHtml).toContain("Mobile");
      expect(sitePageEditorHtml).toContain("const finalPath = new URL(response.url || window.location.href, window.location.origin).pathname;");
      expect(sitePageEditorHtml).toContain("Your session expired. Sign in again.");
      expect(sitePageEditorHtml).toContain("Save changes");
      expect(sitePageEditorHtml).toContain("Save and publish");
      expect(sitePageEditorHtml).toContain("site_pages_editor");
      expect(sitePageEditorHtml).toContain("bdta-hero");
      expect(sitePageEditorHtml).toContain("bdta-services");
      expect(sitePageEditorHtml).toContain("bdta-packages");
      expect(sitePageEditorHtml).toContain("bdta-events");
      expect(sitePageEditorHtml).toContain("editor-settings-button");
      expect(sitePageEditorHtml).toContain("editor-seo-modal");
      expect(sitePageEditorHtml).toContain("metaDescription");
      expect(sitePageEditorHtml).toContain("ogImage");
      expect(sitePageEditorHtml).toContain('/assets/vendor/editor/grapesjs/grapes.min.js');
      expect(sitePageEditorHtml).toContain('/assets/vendor/editor/grapesjs/css/grapes.min.css');
      expect(sitePageEditorHtml).toContain('/assets/vendor/editor/bootstrap/css/bootstrap.min.css');
      expect(sitePageEditorHtml).toContain('/assets/vendor/editor/fontawesome/css/all.min.css');
      expect(sitePageEditorHtml).not.toContain("https://unpkg.com/grapesjs");
      expect(sitePageEditorHtml).not.toContain("https://cdn.jsdelivr.net/npm/bootstrap");
      expect(sitePageEditorHtml).not.toContain("https://cdnjs.cloudflare.com/ajax/libs/font-awesome");
      expect(settingsHtml).toContain("Turnstile Site Key");
      expect(settingsHtml).toContain("Base URL");
      expect(settingsHtml).toContain("Stripe Live Secret Key");
      expect(settingsHtml).toContain("SMTP Host");
      expect(settingsHtml).toContain("SMTP Port");
      expect(settingsHtml).toContain("Newsletter Embed HTML");
      expect(settingsHtml).toContain("Google OAuth Client Secret");
      expect(settingsHtml).toContain("Google Calendar Sync Enabled");
      expect(settingsHtml).toContain("Launch-Critical Settings");
      expect(settingsHtml).toContain("Configuration Areas");
      expect(settingsHtml).toContain("API-Key Access");
      expect(settingsHtml).toContain("?category=database");
      expect(settingsHtml).toContain("settings-summary-grid");
      expect(settingsHtml).toContain("Validation and Live Launch Status");
      expect(settingsHtml).toContain("Release Validation");
      expect(settingsHtml).toContain("Integration Readiness");
      expect(settingsHtml).toContain("settings-console-search");
      expect(settingsHtml).toContain("settings-category-section");
      expect(settingsHtml).toContain("Site");
      expect(settingsHtml).toContain("Payments");
      expect(settingsHtml).toContain("Communications");
      expect(settingsHtml).toContain("Advanced");
      expect(settingsHtml).toContain("Launch Critical");
      expect(databaseSettingsHtml).toContain("Runtime Environment");
      expect(databaseSettingsHtml).toContain(".env.production");
      expect(databaseSettingsHtml).toContain("MySQL Host");
      expect(databaseSettingsHtml).toContain('value="db.plesk.internal"');
      expect(databaseSettingsHtml).toContain("Plesk App Env");
      expect(communicationsSettingsHtml).toContain("SMTP Password");
      expect(communicationsSettingsHtml).toContain("IMAP Folder");
      expect(communicationsSettingsHtml).toContain("Mailjet API Secret");
      expect(adminSettingsUsersHtml).toContain("Admin User Management");
      expect(adminSettingsUsersHtml).toContain("Add Admin User");
      expect(adminSettingsUsersHtml).toContain("Access Matrix");
      expect(legacySettingsHtml).toContain("Launch-Critical Settings");
      expect(settingDetailHtml).toContain("site-key-1");
      expect(settingDetailHtml).toContain("Settings Detail");
      expect(settingDetailHtml).toContain("Where this is used");
      expect(settingDetailHtml).toContain("Current Value");
      expect(settingDetailHtml).toContain("Launch Critical");
      expect(settingDetailHtml).toContain('<input type="text" name="value" value="site-key-1"');
      expect(smtpPasswordDetailHtml).toContain('input type="password" name="value"');
      expect(googleCalendarEnabledDetailHtml).toContain('input type="hidden" name="value" value="0"');
      expect(googleCalendarEnabledDetailHtml).toContain('input type="checkbox" name="value" value="1"');
      expect(newsletterEmbedDetailHtml).toContain('<textarea name="value"');
      expect(newsletterEmbedDetailHtml).toContain("Only paste official provider embed code");
      expect(jobLogsHtml).toContain("job-queued-1");
      expect(jobLogsHtml).toContain("<h2>Job Activity</h2>");
      expect(jobLogDetailHtml).toContain("workflow_processor");
      expect(jobLogDetailHtml).toContain('<pre>');
      expect(callbackLogsHtml).toContain("callback-1");
      expect(callbackLogsHtml).toContain("<h2>Callback Activity</h2>");
      expect(callbackLogDetailHtml).toContain("invoice-1");
      expect(callbackLogDetailHtml).toContain('<pre>');

      const createBlogPost = await fetch(`${baseUrl}/admin/blog-posts`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          title: "Reactive Dog Journal",
          slug: "reactive-dog-journal",
          content: "<p>Pattern work for calmer walks.</p>",
          excerpt: "Pattern work for calmer walks.",
          coverPhoto: "",
          author: "Brook",
          published: "on",
          publishDate: "2026-05-30T10:00:00.000Z"
        })
      });
      expect(createBlogPost.status).toBe(302);
      const createdBlogPost = state.blogPosts.find((post) => post.slug === "reactive-dog-journal");
      expect(createdBlogPost).toBeDefined();

      const deleteBlogPost = await fetch(`${baseUrl}/admin/blog-posts/${encodeURIComponent(createdBlogPost?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(deleteBlogPost.status).toBe(302);
      expect(state.blogPosts.some((post) => post.id === createdBlogPost?.id)).toBe(false);

      const createLegacyBlogPost = await fetch(`${baseUrl}/client/blog_edit.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          title: "Legacy Reactive Dog Journal",
          slug: "legacy-reactive-dog-journal",
          content: "<p>Legacy route journal entry.</p>",
          excerpt: "Legacy route journal entry.",
          coverPhoto: "",
          author: "Brook",
          published: "on",
          publishDate: "2026-06-01T10:00:00.000Z"
        })
      });
      expect(createLegacyBlogPost.status).toBe(302);
      expect(createLegacyBlogPost.headers.get("location")).toBe("/client/blog_list.php");
      const legacyCreatedBlogPost = state.blogPosts.find((post) => post.slug === "legacy-reactive-dog-journal");
      expect(legacyCreatedBlogPost).toBeDefined();

      const deleteLegacyBlogPost = await fetch(`${baseUrl}/client/blog_delete.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          id: String(legacyCreatedBlogPost?.id ?? "")
        })
      });
      expect(deleteLegacyBlogPost.status).toBe(302);
      expect(deleteLegacyBlogPost.headers.get("location")).toBe("/client/blog_list.php");
      expect(state.blogPosts.some((post) => post.id === legacyCreatedBlogPost?.id)).toBe(false);

      const updateSitePage = await fetch(`${baseUrl}/admin/site-pages/page-services`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          slug: "services",
          title: "Training Services",
          htmlContent: "<section><h1>Programs</h1><p>Private coaching.</p></section>",
          cssContent: "",
          metaDescription: "Programs",
          metaKeywords: "private lessons",
          ogTitle: "",
          ogDescription: "",
          ogImage: "",
          isHomepage: "",
          published: "on",
          sortOrder: "2"
        })
      });
      expect(updateSitePage.status).toBe(302);
      expect(state.sitePages.find((page) => page.id === "page-services")?.title).toBe("Training Services");

      const createLegacySitePage = await fetch(`${baseUrl}/client/site_pages_list.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          slug: "legacy-faq",
          title: "Legacy FAQ",
          htmlContent: "<section><h1>Legacy FAQ</h1></section>",
          cssContent: "",
          metaDescription: "Legacy faq",
          metaKeywords: "faq",
          ogTitle: "",
          ogDescription: "",
          ogImage: "",
          isHomepage: "",
          published: "on",
          sortOrder: "4"
        })
      });
      expect(createLegacySitePage.status).toBe(302);
      expect(createLegacySitePage.headers.get("location")).toContain("/client/site_editor.php?id=");
      expect(state.sitePages.some((page) => page.slug === "legacy-faq")).toBe(true);

      const updateSetting = await fetch(`${baseUrl}/admin/settings/turnstile_site_key`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          value: "site-key-2"
        })
      });
      expect(updateSetting.status).toBe(302);
      expect(state.settings.find((setting) => setting.key === "turnstile_site_key")?.value).toBe("site-key-2");

      const updateGoogleCalendarEnabled = await fetch(`${baseUrl}/admin/settings/google_calendar_enabled`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams([
          ["value", "0"],
          ["value", "1"]
        ])
      });
      expect(updateGoogleCalendarEnabled.status).toBe(302);
      expect(state.settings.find((setting) => setting.key === "google_calendar_enabled")?.value).toBe("1");

      const updateNewsletterEmbed = await fetch(`${baseUrl}/admin/settings/newsletter_embed_html`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          value: "<section><form><input type=\"email\" name=\"email\"></form></section>"
        })
      });
      expect(updateNewsletterEmbed.status).toBe(302);
      expect(state.settings.find((setting) => setting.key === "newsletter_embed_html")?.value).toContain("<form>");

      const updateRuntimeEnvironment = await fetch(`${baseUrl}/admin/settings/runtime-environment`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          DB_HOST: "db.updated.internal",
          DB_PORT: "3306",
          DB_NAME: "bdta_updated",
          DB_USER: "updated_user",
          DB_PASSWORD: "updated_password",
          DATABASE_URL: "",
          SESSION_LIFETIME_SECONDS: "604800",
          HOST: "0.0.0.0",
          PORT: "3000",
          JOB_POLL_INTERVAL_MS: "45000",
          JOB_BATCH_SIZE: "30",
          EMAIL_BATCH_SIZE: "40"
        })
      });
      expect(updateRuntimeEnvironment.status).toBe(302);
      expect(updateRuntimeEnvironment.headers.get("location")).toContain("notice=runtime-environment-saved");
      const runtimeEnvFile = await readFile(envFilePath, "utf8");
      expect(runtimeEnvFile).toContain("DB_HOST=db.updated.internal");
      expect(runtimeEnvFile).toContain("DB_NAME=bdta_updated");
      expect(runtimeEnvFile).toContain("DB_PASSWORD=updated_password");
      expect(runtimeEnvFile).toContain("SESSION_LIFETIME_SECONDS=604800");
      expect(runtimeEnvFile).toContain("JOB_POLL_INTERVAL_MS=45000");

      const createAdminUser = await fetch(`${baseUrl}/admin/settings/admin-users`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "assistant.admin",
          email: "assistant.admin@example.com",
          password: "temporary-password",
          accountType: "standard"
        })
      });
      expect(createAdminUser.status).toBe(302);
      expect(createAdminUser.headers.get("location")).toContain("notice=admin-user-created");
      const createdAdminUser = state.adminUsers.find((user) => user.username === "assistant.admin");
      expect(createdAdminUser).toBeDefined();

      const updateAdminPermissions = await fetch(`${baseUrl}/admin/settings/admin-users/${encodeURIComponent(createdAdminUser?.actorId ?? "")}/permissions`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          canManageAdminUsers: "on",
          canManageApiKeys: "on"
        })
      });
      expect(updateAdminPermissions.status).toBe(302);
      expect(state.adminUsers.find((user) => user.actorId === createdAdminUser?.actorId)).toMatchObject({
        canManageAdminUsers: true,
        canManageApiKeys: true
      });

      state.appointmentTypes.push({
        id: "appointment-type-delete-check",
        name: "Delete Check",
        adminUserId: createdAdminUser?.actorId
      } as never);
      state.bookings.push({
        id: "booking-delete-check",
        clientId: "client-1",
        appointmentTypeId: "appointment-type-delete-check",
        status: "pending",
        startAt: "2026-06-02T16:00:00.000Z",
        endAt: "2026-06-02T17:00:00.000Z",
        notes: "",
        adminUserId: createdAdminUser?.actorId ?? null,
        quoteId: null,
        invoiceId: null,
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
        clientAccess: null,
        icalAccess: null
      } as never);

      const deleteAdminUser = await fetch(`${baseUrl}/admin/settings/admin-users/${encodeURIComponent(createdAdminUser?.actorId ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(deleteAdminUser.status).toBe(302);
      expect(state.adminUsers.some((user) => user.actorId === createdAdminUser?.actorId)).toBe(false);
      expect(state.appointmentTypes.find((item) => item.id === "appointment-type-delete-check")?.adminUserId).toBeNull();
      expect(state.bookings.find((item) => item.id === "booking-delete-check")?.adminUserId).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("renders admin appointment type, form template, email template, and scheduled task management pages with legacy aliases", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      appointmentTypes: [{
        id: "appointment-type-1",
        name: "Private Coaching",
        description: "One-on-one coaching session.",
        bulletPoints: ["Behavior assessment", "Homework plan"],
        adminUserId: "admin-1",
        durationMinutes: 90,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        useTravelTimeBuffer: true,
        travelTimeMinutes: 20,
        advanceBookingMinDays: 2,
        advanceBookingMaxDays: 45,
        cancellationNoticeHours: 24,
        requiresForms: true,
        formTemplateIds: ["form-template-1"],
        requiresContract: true,
        contractTemplateId: "contract-template-1",
        autoInvoice: true,
        invoiceDueDays: 7,
        invoiceDueTiming: "after",
        defaultAmount: 225,
        consumesCredits: true,
        creditCount: 2,
        isGroupClass: false,
        maxParticipants: 1,
        publicAvailable: true,
        portalAvailable: true,
        scheduleType: "recurring",
        specificDate: null,
        specificDates: [],
        availableDays: [1, 2, 3, 4, 5],
        availableStartTime: "09:00",
        availableEndTime: "17:00",
        timeSlotInterval: 30,
        perDaySchedule: {},
        isMiniSession: false,
        miniSessionLocation: "",
        miniSessionTopic: "",
        isFieldRental: false,
        fieldRentalLocation: "",
        groupClassLocation: "",
        locationTypes: ["client_address"],
        confirmationTemplateId: "email-template-1",
        bookingRequestTemplateId: null,
        invoiceTemplateId: null,
        reminderTemplateId: null,
        cancellationTemplateId: null,
        requiresAdminConfirmation: true,
        usesResource: true,
        resourceName: "Trainer Vehicle",
        resourceCapacity: 1,
        resourceAllocation: "per_appointment",
        uniqueLink: "private-coaching-link",
        active: true
      }] as never,
      formTemplates: [{
        id: "form-template-1",
        name: "Boarding Intake",
        active: true,
        description: "Collect intake details before boarding.",
        fields: [{ label: "Pet Name", type: "text", required: true }],
        formType: "client_form",
        requiredFrequency: "once",
        appointmentTypeId: "appointment-type-1",
        templateIsInternal: false,
        templateShowInClientPortal: true
      }] as never,
      emailTemplates: [{
        id: "email-template-1",
        name: "Booking Confirmation",
        templateType: "booking_confirmation",
        subject: "Your booking is confirmed",
        bodyHtml: "<p>Confirmed.</p>",
        bodyText: "Confirmed.",
        active: true
      }] as never,
      scheduledTasks: [{
        id: "scheduled-task-1",
        name: "Workflow Processor",
        taskType: "workflow_processor",
        active: true,
        scheduleType: "interval",
        scheduleValue: "60",
        lastRunAt: "2026-05-27T17:00:00.000Z",
        nextRunAt: "2026-05-27T18:00:00.000Z"
      }] as never,
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
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
      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const appointmentTypes = await fetch(`${baseUrl}/admin/appointment-types`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const appointmentTypeDetail = await fetch(`${baseUrl}/admin/appointment-types/appointment-type-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyAppointmentTypes = await fetch(`${baseUrl}/client/appointment_types_list.php`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyAppointmentTypeDetail = await fetch(`${baseUrl}/client/appointment_types_edit.php?id=appointment-type-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const formTemplates = await fetch(`${baseUrl}/admin/form-templates`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const formTemplateDetail = await fetch(`${baseUrl}/admin/form-templates/form-template-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyFormTemplates = await fetch(`${baseUrl}/client/form_templates_list.php`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyFormTemplateCreate = await fetch(`${baseUrl}/client/form_templates_edit.php`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyFormTemplateDetail = await fetch(`${baseUrl}/client/form_templates_edit.php?id=form-template-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const emailTemplates = await fetch(`${baseUrl}/admin/email-templates`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const emailTemplateDetail = await fetch(`${baseUrl}/admin/email-templates/email-template-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyEmailTemplates = await fetch(`${baseUrl}/client/email_templates_list.php`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyEmailTemplateDetail = await fetch(`${baseUrl}/client/email_templates_edit.php?id=email-template-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const scheduledTasks = await fetch(`${baseUrl}/admin/scheduled-tasks`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const scheduledTaskDetail = await fetch(`${baseUrl}/admin/scheduled-tasks/scheduled-task-1`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyScheduledTasks = await fetch(`${baseUrl}/client/scheduled_tasks_list.php`, {
        headers: { cookie: adminCookie ?? "" }
      });
      const legacyScheduledTaskDetail = await fetch(`${baseUrl}/client/scheduled_tasks_edit.php?id=scheduled-task-1`, {
        headers: { cookie: adminCookie ?? "" }
      });

      expect(appointmentTypes.status).toBe(200);
      expect(appointmentTypeDetail.status).toBe(200);
      expect(legacyAppointmentTypes.status).toBe(200);
      expect(legacyAppointmentTypeDetail.status).toBe(200);
      expect(formTemplates.status).toBe(200);
      expect(formTemplateDetail.status).toBe(200);
      expect(legacyFormTemplates.status).toBe(200);
      expect(legacyFormTemplateCreate.status).toBe(200);
      expect(legacyFormTemplateDetail.status).toBe(200);
      expect(emailTemplates.status).toBe(200);
      expect(emailTemplateDetail.status).toBe(200);
      expect(legacyEmailTemplates.status).toBe(200);
      expect(legacyEmailTemplateDetail.status).toBe(200);
      expect(scheduledTasks.status).toBe(200);
      expect(scheduledTaskDetail.status).toBe(200);
      expect(legacyScheduledTasks.status).toBe(200);
      expect(legacyScheduledTaskDetail.status).toBe(200);

      const appointmentTypesHtml = await appointmentTypes.text();
      const appointmentTypeDetailHtml = await appointmentTypeDetail.text();
      const legacyAppointmentTypesHtml = await legacyAppointmentTypes.text();
      const legacyAppointmentTypeDetailHtml = await legacyAppointmentTypeDetail.text();
      const formTemplatesHtml = await formTemplates.text();
      const formTemplateDetailHtml = await formTemplateDetail.text();
      const legacyFormTemplatesHtml = await legacyFormTemplates.text();
      const legacyFormTemplateCreateHtml = await legacyFormTemplateCreate.text();
      const legacyFormTemplateDetailHtml = await legacyFormTemplateDetail.text();
      const emailTemplatesHtml = await emailTemplates.text();
      const emailTemplateDetailHtml = await emailTemplateDetail.text();
      const legacyEmailTemplatesHtml = await legacyEmailTemplates.text();
      const legacyEmailTemplateDetailHtml = await legacyEmailTemplateDetail.text();
      const scheduledTasksHtml = await scheduledTasks.text();
      const scheduledTaskDetailHtml = await scheduledTaskDetail.text();
      const legacyScheduledTasksHtml = await legacyScheduledTasks.text();
      const legacyScheduledTaskDetailHtml = await legacyScheduledTaskDetail.text();

      expect(appointmentTypesHtml).toContain("Appointment Types");
      expect(appointmentTypesHtml).toContain("/admin/appointment-types/appointment-type-1/delete");
      expect(appointmentTypesHtml).toContain("/admin/appointment-types/appointment-type-1/duplicate");
      expect(appointmentTypeDetailHtml).toContain("Private Coaching");
      expect(appointmentTypeDetailHtml).toContain("/admin/appointment-types/appointment-type-1/delete");
      expect(appointmentTypeDetailHtml).toContain('/client/form_requests_create.php?form_type=booking_form&appointment_type_id=appointment-type-1');
      expect(legacyAppointmentTypesHtml).toContain("Appointment Types");
      expect(legacyAppointmentTypesHtml).toContain("/client/appointment_types_duplicate.php");
      expect(legacyAppointmentTypeDetailHtml).toContain("Unique Link");
      expect(formTemplatesHtml).toContain("Form Templates");
      expect(formTemplatesHtml).toContain("/admin/form-templates/form-template-1/delete");
      expect(formTemplatesHtml).toContain("/admin/form-templates/form-template-1/duplicate");
      expect(formTemplateDetailHtml).toContain("Boarding Intake");
      expect(formTemplateDetailHtml).toContain("Fields JSON");
      expect(legacyFormTemplatesHtml).toContain("Form Templates");
      expect(legacyFormTemplatesHtml).toContain("/client/form_templates_duplicate.php");
      expect(legacyFormTemplateCreateHtml).toContain("Create Form Template");
      expect(legacyFormTemplateDetailHtml).toContain("Required Frequency");
      expect(emailTemplatesHtml).toContain("Email Templates");
      expect(emailTemplatesHtml).toContain("/admin/email-templates/email-template-1/duplicate");
      expect(emailTemplateDetailHtml).toContain("Booking Confirmation");
      expect(legacyEmailTemplatesHtml).toContain("Email Templates");
      expect(legacyEmailTemplatesHtml).toContain("/client/email_templates_duplicate.php");
      expect(legacyEmailTemplateDetailHtml).toContain("Template Type");
      expect(scheduledTasksHtml).toContain("Scheduled Tasks");
      expect(scheduledTaskDetailHtml).toContain("Workflow Processor");
      expect(legacyScheduledTasksHtml).toContain("Scheduled Tasks");
      expect(legacyScheduledTaskDetailHtml).toContain("Schedule Type");

      const createAppointmentType = await fetch(`${baseUrl}/admin/appointment-types`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Mini Session Saturday",
          description: "Short-format mini session.",
          bulletPoints: "Outdoor setup\nPhoto-ready training",
          adminUserId: "admin-1",
          durationMinutes: "45",
          bufferBeforeMinutes: "10",
          bufferAfterMinutes: "10",
          advanceBookingMinDays: "1",
          advanceBookingMaxDays: "14",
          cancellationNoticeHours: "12",
          invoiceDueDays: "3",
          invoiceDueTiming: "before",
          defaultAmount: "95",
          creditCount: "1",
          scheduleType: "specific_date",
          specificDate: "2026-06-21",
          availableStartTime: "10:00",
          availableEndTime: "14:00",
          timeSlotInterval: "30",
          miniSessionLocation: "Downtown Park",
          miniSessionTopic: "Recall refresh",
          resourceCapacity: "1",
          resourceAllocation: "per_appointment",
          uniqueLink: "mini-session-june-21",
          portalAvailable: "on",
          autoInvoice: "on",
          requiresAdminConfirmation: "on",
          isMiniSession: "on",
          active: "on"
        })
      });
      const updateAppointmentType = await fetch(`${baseUrl}/admin/appointment-types/appointment-type-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Private Coaching Updated",
          description: "Updated coaching session.",
          bulletPoints: "Updated assessment",
          adminUserId: "admin-1",
          durationMinutes: "60",
          bufferBeforeMinutes: "5",
          bufferAfterMinutes: "5",
          advanceBookingMinDays: "1",
          advanceBookingMaxDays: "30",
          cancellationNoticeHours: "12",
          invoiceDueDays: "7",
          invoiceDueTiming: "after",
          defaultAmount: "175",
          creditCount: "1",
          scheduleType: "recurring",
          availableStartTime: "08:00",
          availableEndTime: "12:00",
          timeSlotInterval: "30",
          resourceCapacity: "1",
          resourceAllocation: "per_appointment",
          uniqueLink: "private-coaching-updated",
          publicAvailable: "on",
          portalAvailable: "on",
          active: "on"
        })
      });
      const createEmailTemplate = await fetch(`${baseUrl}/admin/email-templates`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Reminder Template",
          templateType: "booking_reminder",
          subject: "Reminder",
          bodyHtml: "<p>Reminder</p>",
          bodyText: "Reminder",
          active: "on"
        })
      });
      const createFormTemplate = await fetch(`${baseUrl}/client/form_templates_edit.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Follow-Up Survey",
          description: "Collect post-program feedback.",
          formType: "survey_form",
          requiredFrequency: "yearly",
          fields: JSON.stringify([{ label: "How did training go?", type: "textarea", required: true }]),
          templateShowInClientPortal: "on",
          active: "on"
        })
      });
      const updateFormTemplate = await fetch(`${baseUrl}/admin/form-templates/form-template-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Boarding Intake Updated",
          description: "Updated boarding intake workflow.",
          formType: "client_form",
          requiredFrequency: "once_per_pet",
          appointmentTypeId: "appointment-type-1",
          fields: JSON.stringify([
            { label: "Pet Name", type: "text", required: true },
            { label: "Medication Notes", type: "textarea" }
          ]),
          templateIsInternal: "on",
          active: "on"
        })
      });
      const updateScheduledTask = await fetch(`${baseUrl}/admin/scheduled-tasks/scheduled-task-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Workflow Processor Revised",
          taskType: "workflow_processor",
          scheduleType: "interval",
          scheduleValue: "30",
          active: "on"
        })
      });

      expect(createAppointmentType.status).toBe(302);
      expect(updateAppointmentType.status).toBe(302);
      expect(createFormTemplate.status).toBe(302);
      expect(updateFormTemplate.status).toBe(302);
      expect(createEmailTemplate.status).toBe(302);
      expect(updateScheduledTask.status).toBe(302);
      const createdAppointmentType = state.appointmentTypes.find((item) => item.uniqueLink === "mini-session-june-21");
      const createdFormTemplate = state.formTemplates.find((item) => item.name === "Follow-Up Survey");
      expect(createdAppointmentType).toBeDefined();
      expect(createdFormTemplate).toBeDefined();

      const duplicateAppointmentType = await fetch(`${baseUrl}/admin/appointment-types/appointment-type-1/duplicate`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      const deleteAppointmentType = await fetch(`${baseUrl}/admin/appointment-types/${encodeURIComponent(createdAppointmentType?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      expect(duplicateAppointmentType.status).toBe(302);
      expect(state.appointmentTypes.filter((item) => item.name.includes("Private Coaching")).length).toBeGreaterThan(1);
      expect(deleteAppointmentType.status).toBe(302);
      expect(state.appointmentTypes.some((item) => item.id === createdAppointmentType?.id)).toBe(false);
      const duplicateLegacyFormTemplate = await fetch(`${baseUrl}/client/form_templates_duplicate.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          id: "form-template-1"
        })
      });
      const deleteFormTemplate = await fetch(`${baseUrl}/admin/form-templates/${encodeURIComponent(createdFormTemplate?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(duplicateLegacyFormTemplate.status).toBe(302);
      expect(duplicateLegacyFormTemplate.headers.get("location")).toBe("/client/form_templates_list.php");
      expect(state.formTemplates.filter((item) => item.name.includes("Boarding Intake")).length).toBeGreaterThan(1);
      expect(deleteFormTemplate.status).toBe(302);
      expect(state.formTemplates.some((item) => item.id === createdFormTemplate?.id)).toBe(false);

      const duplicateLegacyEmailTemplate = await fetch(`${baseUrl}/client/email_templates_duplicate.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          id: "email-template-1"
        })
      });

      expect(duplicateLegacyEmailTemplate.status).toBe(302);
      expect(duplicateLegacyEmailTemplate.headers.get("location")).toBe("/client/email_templates_list.php");
      expect(state.emailTemplates.filter((template) => template.name.includes("Booking Confirmation")).length).toBeGreaterThan(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports admin site page lifecycle actions from the directory", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      sitePages: [
        {
          id: "page-home",
          slug: "home",
          title: "Brook's Dog Training Academy",
          htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
          cssContent: "",
          metaDescription: "Homepage",
          metaKeywords: "dogs",
          ogTitle: null,
          ogDescription: null,
          ogImage: null,
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
          htmlContent: "<section><h1>Programs</h1></section>",
          cssContent: "",
          metaDescription: "Programs",
          metaKeywords: "private lessons",
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
      ],
      passwordVerifier: async (password, hash) => password === "admin-password" && hash === "admin-hash"
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
      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const sitePages = await fetch(`${baseUrl}/admin/site-pages`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(sitePages.status).toBe(200);
      const sitePagesHtml = await sitePages.text();
      expect(sitePagesHtml).toContain('/admin/site-pages/page-services/toggle-publish');
      expect(sitePagesHtml).toContain('/admin/site-pages/page-services/delete');
      expect(sitePagesHtml).not.toContain('/admin/site-pages/page-home/delete');

      const createPage = await fetch(`${baseUrl}/admin/site-pages`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          slug: "behavior-consults",
          title: "Behavior Consults",
          htmlContent: "<section><h1>Behavior Consults</h1></section>",
          cssContent: "",
          metaDescription: "Behavior consults",
          metaKeywords: "reactivity",
          ogTitle: "",
          ogDescription: "",
          ogImage: "",
          sortOrder: "3"
        })
      });

      const createdPage = state.sitePages.find((page) => page.slug === "behavior-consults");
      expect(createPage.status).toBe(302);
      expect(createdPage).toBeDefined();
      expect(createPage.headers.get("location")).toBe(`/admin/site-pages/${encodeURIComponent(createdPage?.id ?? "")}/editor`);

      const togglePublish = await fetch(`${baseUrl}/admin/site-pages/page-services/toggle-publish`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      expect(togglePublish.status).toBe(302);
      expect(state.sitePages.find((page) => page.id === "page-services")?.published).toBe(false);

      const deleteCreatedPage = await fetch(`${baseUrl}/admin/site-pages/${encodeURIComponent(createdPage?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      expect(deleteCreatedPage.status).toBe(302);
      expect(state.sitePages.some((page) => page.id === createdPage?.id)).toBe(false);

      const homepageDelete = await fetch(`${baseUrl}/admin/site-pages/page-home/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      expect(homepageDelete.status).toBe(302);
      expect(state.sitePages.some((page) => page.id === "page-home")).toBe(true);
      expect(state.sitePages).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports portal and admin profile and contact mutation flows", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-portal-1",
          email: "client@example.com",
          displayName: "Casey Client",
          passwordHash: "portal-hash",
          archived: false,
          phone: "555-0100",
          address: "123 Harbor Way",
          notes: "Initial note",
          isAdmin: false
        }
      ],
      contacts: [
        {
          id: "contact-1",
          clientId: "client-portal-1",
          name: "Primary Contact",
          email: "contact@example.com",
          phone: "555-0200",
          isPrimary: true
        }
      ],
      passwordVerifier: async (password, hash) =>
        (password === "admin-password" && hash === "admin-hash")
        || (password === "portal-password" && hash === "portal-hash")
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
      const portalLogin = await fetch(`${baseUrl}/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          email: "client@example.com",
          password: "portal-password"
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");

      const portalProfileUpdate = await fetch(`${baseUrl}/portal/profile`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: portalCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Casey Updated",
          email: "casey.updated@example.com",
          phone: "555-1111",
          address: "456 New Harbor Way",
          currentPassword: "",
          newPassword: "",
          confirmPassword: ""
        })
      });
      expect(portalProfileUpdate.status).toBe(302);
      expect(state.portalUsers[0]?.displayName).toBe("Casey Updated");
      expect(state.portalUsers[0]?.email).toBe("casey.updated@example.com");
      expect(state.portalUsers[0]?.address).toBe("456 New Harbor Way");

      const portalContactCreate = await fetch(`${baseUrl}/portal/contacts`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: portalCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Emergency Contact",
          email: "emergency@example.com",
          phone: "555-0300",
          isPrimary: "on"
        })
      });
      expect(portalContactCreate.status).toBe(302);
      const createdPortalContact = state.contacts.find((contact) => contact.name === "Emergency Contact");
      expect(createdPortalContact).toBeDefined();
      expect(createdPortalContact?.isPrimary).toBe(true);
      expect(state.contacts.find((contact) => contact.id === "contact-1")?.isPrimary).toBe(false);

      const portalContactUpdate = await fetch(`${baseUrl}/portal/contacts/contact-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: portalCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Updated Primary Contact",
          email: "contact.updated@example.com",
          phone: "555-0400",
          isPrimary: "on"
        })
      });
      expect(portalContactUpdate.status).toBe(302);
      expect(state.contacts.find((contact) => contact.id === "contact-1")?.name).toBe("Updated Primary Contact");
      expect(state.contacts.find((contact) => contact.id === "contact-1")?.isPrimary).toBe(true);
      expect(createdPortalContact == null ? null : state.contacts.find((contact) => contact.id === createdPortalContact.id)?.isPrimary).toBe(false);

      const portalContactDelete = await fetch(`${baseUrl}/portal/contacts/${encodeURIComponent(createdPortalContact?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        },
        redirect: "manual"
      });
      expect(portalContactDelete.status).toBe(302);
      expect(state.contacts.some((contact) => contact.name === "Emergency Contact")).toBe(false);

      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const adminClientCreate = await fetch(`${baseUrl}/admin/clients`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "New Client",
          email: "new-client@example.com",
          phone: "555-0500",
          address: "789 Cedar Ave",
          notes: "Created from admin web.",
          isAdmin: "on"
        })
      });
      expect(adminClientCreate.status).toBe(302);
      expect(state.portalUsers.some((user) => user.email === "new-client@example.com" && user.isAdmin === true)).toBe(true);

      const adminProfileUpdate = await fetch(`${baseUrl}/admin/clients/client-portal-1/profile`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Casey Admin Updated",
          email: "casey.admin@example.com",
          phone: "555-0600",
          address: "890 Updated Address",
          notes: "Updated by admin.",
          isAdmin: "on"
        })
      });
      expect(adminProfileUpdate.status).toBe(302);
      expect(state.portalUsers.find((user) => user.clientId === "client-portal-1")?.displayName).toBe("Casey Admin Updated");
      expect(state.portalUsers.find((user) => user.clientId === "client-portal-1")?.notes).toBe("Updated by admin.");
      expect(state.portalUsers.find((user) => user.clientId === "client-portal-1")?.isAdmin).toBe(true);

      const adminContactCreate = await fetch(`${baseUrl}/admin/clients/client-portal-1/contacts`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Admin Added Contact",
          email: "admin-added@example.com",
          phone: "555-0700",
          isPrimary: ""
        })
      });
      expect(adminContactCreate.status).toBe(302);
      const createdAdminContact = state.contacts.find((contact) => contact.name === "Admin Added Contact");
      expect(createdAdminContact).toBeDefined();

      const adminContactUpdate = await fetch(`${baseUrl}/admin/clients/client-portal-1/contacts/${encodeURIComponent(createdAdminContact?.id ?? "")}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Admin Edited Contact",
          email: "admin-edited@example.com",
          phone: "555-0800",
          isPrimary: "on"
        })
      });
      expect(adminContactUpdate.status).toBe(302);
      expect(state.contacts.find((contact) => contact.id === createdAdminContact?.id)?.name).toBe("Admin Edited Contact");
      expect(state.contacts.find((contact) => contact.id === createdAdminContact?.id)?.isPrimary).toBe(true);

      const adminContactDelete = await fetch(`${baseUrl}/admin/clients/client-portal-1/contacts/${encodeURIComponent(createdAdminContact?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(adminContactDelete.status).toBe(302);
      expect(state.contacts.some((contact) => contact.id === createdAdminContact?.id)).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports portal and admin pet file web workflows", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "accountant",
          displayName: "Accountant User",
          passwordHash: "admin-hash",
          role: "accountant",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-admin-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      pets: [
        {
          id: "pet-admin-1",
          clientId: "client-admin-1",
          name: "Scout",
          species: "Dog",
          petSittingNotes: "Use the side gate and towel paws before re-entry.",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "correct-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
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
      const portalLogin = await fetch(`${baseUrl}/portal/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          email: "owner@example.com",
          password: "client-password"
        })
      });
      const portalCookie = portalLogin.headers.get("set-cookie");

      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "accountant",
          password: "correct-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const portalUploadForm = new FormData();
      portalUploadForm.set("description", "Vaccination record");
      portalUploadForm.set("file", new File([
        Buffer.from("%PDF-1.4\nportal-upload-pdf-body", "utf8")
      ], "Vaccination Record.pdf", { type: "application/pdf" }));

      const portalUpload = await fetch(`${baseUrl}/portal/pets/pet-admin-1/files`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        },
        redirect: "manual",
        body: portalUploadForm
      });
      expect(portalUpload.status).toBe(302);

      const adminUploadForm = new FormData();
      adminUploadForm.set("description", "Front profile");
      adminUploadForm.set("file", new File([
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
      ], "Scout Headshot.jpg", { type: "image/jpeg" }));

      const adminUpload = await fetch(`${baseUrl}/admin/pets/pet-admin-1/files`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: adminUploadForm
      });
      expect(adminUpload.status).toBe(302);

      const portalPdf = state.petFiles.find((file) => file.originalName === "Vaccination_Record.pdf");
      const adminJpg = state.petFiles.find((file) => file.originalName === "Scout_Headshot.jpg");
      expect(portalPdf).toBeDefined();
      expect(adminJpg).toBeDefined();

      const portalFiles = await fetch(`${baseUrl}/portal/pets/pet-admin-1/files`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminFiles = await fetch(`${baseUrl}/admin/pets/pet-admin-1/files`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalFiles.status).toBe(200);
      expect(adminFiles.status).toBe(200);
      expect(await portalFiles.text()).toContain("Vaccination_Record.pdf");
      expect(await adminFiles.text()).toContain("Scout_Headshot.jpg");

      const portalContent = await fetch(`${baseUrl}/portal/pets/pet-admin-1/files/${encodeURIComponent(portalPdf?.id ?? "")}/content`, {
        headers: {
          cookie: portalCookie ?? ""
        }
      });
      const adminContent = await fetch(`${baseUrl}/admin/pets/pet-admin-1/files/${encodeURIComponent(adminJpg?.id ?? "")}/content?download=1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(portalContent.status).toBe(200);
      expect(adminContent.status).toBe(200);
      expect(portalContent.headers.get("content-disposition")).toContain("inline");
      expect(adminContent.headers.get("content-disposition")).toContain("attachment");
      expect(await portalContent.text()).toContain("portal-upload-pdf-body");
      expect((await adminContent.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const portalDelete = await fetch(`${baseUrl}/portal/pets/pet-admin-1/files/${encodeURIComponent(portalPdf?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: portalCookie ?? ""
        },
        redirect: "manual"
      });
      const adminDelete = await fetch(`${baseUrl}/admin/pets/pet-admin-1/files/${encodeURIComponent(adminJpg?.id ?? "")}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });

      expect(portalDelete.status).toBe(302);
      expect(adminDelete.status).toBe(302);
      expect(state.petFiles).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });

  it("supports admin workflow management pages and actions", async () => {
    const state = createInMemoryPlatformState({
      adminUsers: [
        {
          actorId: "admin-1",
          username: "brook",
          displayName: "Brook Admin",
          role: "owner",
          passwordHash: "admin-hash",
          active: true
        }
      ],
      portalUsers: [
        {
          clientId: "client-1",
          email: "owner@example.com",
          displayName: "Owner Client",
          passwordHash: "client-hash",
          archived: false
        },
        {
          clientId: "client-2",
          email: "second@example.com",
          displayName: "Second Client",
          passwordHash: "client-hash",
          archived: false
        },
        {
          clientId: "client-3",
          email: "third@example.com",
          displayName: "Third Client",
          passwordHash: "client-hash",
          archived: false
        }
      ],
      passwordVerifier: async (password, hash) => (
        (password === "admin-password" && hash === "admin-hash")
        || (password === "client-password" && hash === "client-hash")
      )
    });
    const workflowState = state as typeof state & {
      workflows: Array<Record<string, unknown>>;
      workflowTriggers: Array<Record<string, unknown>>;
      workflowEnrollments: Array<Record<string, unknown>>;
      workflowSteps: Array<Record<string, unknown>>;
      workflowStepExecutions: Array<Record<string, unknown>>;
      formTemplates: Array<Record<string, unknown>>;
      emailTemplates: Array<Record<string, unknown>>;
      appointmentTypes: Array<Record<string, unknown>>;
      scheduledTasks: Array<Record<string, unknown>>;
    };
    workflowState.workflows = [
      {
        id: "workflow-1",
        name: "Welcome Series",
        description: "New client onboarding workflow.",
        trigger: "manual",
        active: true,
        createdAt: "2026-05-27T18:00:00.000Z"
      }
    ];
    workflowState.workflowTriggers = [
      {
        id: "workflow-trigger-1",
        workflowId: "workflow-1",
        triggerType: "appointment_booking",
        appointmentTypeId: "appointment-type-1",
        formTemplateId: null,
        active: true,
        createdAt: "2026-05-27T18:00:00.000Z"
      }
    ];
    workflowState.workflowEnrollments = [
      {
        id: "workflow-enrollment-1",
        workflowId: "workflow-1",
        clientId: "client-1",
        status: "active",
        enrolledAt: "2026-05-27T18:00:00.000Z",
        nextRunAt: "2026-05-27T18:00:00.000Z",
        completedAt: null,
        enrolledByAdminUserId: "admin-1"
      }
    ];
    workflowState.workflowSteps = [
      {
        id: "workflow-step-1",
        workflowId: "workflow-1",
        stepOrder: 1,
        stepName: "Welcome Email",
        emailSubject: "Welcome {client_name}",
        emailBodyHtml: "<p>Hello {client_name}</p>",
        emailBodyText: "Hello {client_name}",
        delayType: "after_enrollment",
        delayValue: "2 hours",
        scheduledDate: null,
        attachContractId: null,
        attachFormId: null,
        attachQuoteId: null,
        attachInvoiceId: null,
        includeAppointmentLink: false,
        appointmentTypeId: null,
        createdAt: "2026-05-27T18:00:00.000Z",
        updatedAt: "2026-05-27T18:00:00.000Z"
      }
    ];
    workflowState.workflowStepExecutions = [];
    workflowState.formTemplates = [
      {
        id: "form-template-1",
        name: "Client Intake",
        active: true,
        description: "",
        fields: [],
        formType: "booking_form",
        requiredFrequency: null,
        appointmentTypeId: null,
        templateIsInternal: false,
        templateShowInClientPortal: true
      }
    ];
    workflowState.emailTemplates = [
      {
        id: "email-template-1",
        name: "Workflow Welcome Template",
        subject: "Template Subject",
        bodyHtml: "<p>Template Html</p>",
        bodyText: "Template Text",
        active: true
      }
    ];
    workflowState.appointmentTypes = [
      {
        id: "appointment-type-1",
        name: "Consultation",
        active: true
      }
    ];
    workflowState.scheduledTasks = [
      {
        id: "scheduled-task-1",
        taskType: "workflow_processor",
        active: true,
        scheduleType: "hourly",
        scheduleValue: ""
      }
    ];

    const server = createHttpWebServer({ state });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address == null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const adminLogin = await fetch(`${baseUrl}/admin/login`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        redirect: "manual",
        body: new URLSearchParams({
          username: "brook",
          password: "admin-password"
        })
      });
      const adminCookie = adminLogin.headers.get("set-cookie");

      const workflows = await fetch(`${baseUrl}/admin/workflows`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowDetail = await fetch(`${baseUrl}/admin/workflows/workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowEnrollments = await fetch(`${baseUrl}/admin/workflows/workflow-1/enrollments`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowEnroll = await fetch(`${baseUrl}/admin/workflows/workflow-1/enroll`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowSteps = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowStepCreate = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps/new`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const workflowStepDetail = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps/workflow-step-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflows = await fetch(`${baseUrl}/client/workflows_list.php`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowDetail = await fetch(`${baseUrl}/client/workflows_edit.php?id=workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowEnrollments = await fetch(`${baseUrl}/client/workflows_enrollments.php?workflow_id=workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowEnroll = await fetch(`${baseUrl}/client/workflows_enroll.php?workflow_id=workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowSteps = await fetch(`${baseUrl}/client/workflows_steps.php?workflow_id=workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowStepCreate = await fetch(`${baseUrl}/client/workflows_steps_edit.php?workflow_id=workflow-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });
      const legacyWorkflowStepDetail = await fetch(`${baseUrl}/client/workflows_steps_edit.php?workflow_id=workflow-1&step_id=workflow-step-1`, {
        headers: {
          cookie: adminCookie ?? ""
        }
      });

      expect(workflows.status).toBe(200);
      expect(workflowDetail.status).toBe(200);
      expect(workflowEnrollments.status).toBe(200);
      expect(workflowEnroll.status).toBe(200);
      expect(workflowSteps.status).toBe(200);
      expect(workflowStepCreate.status).toBe(200);
      expect(workflowStepDetail.status).toBe(200);
      expect(legacyWorkflows.status).toBe(200);
      expect(legacyWorkflowDetail.status).toBe(200);
      expect(legacyWorkflowEnrollments.status).toBe(200);
      expect(legacyWorkflowEnroll.status).toBe(200);
      expect(legacyWorkflowSteps.status).toBe(200);
      expect(legacyWorkflowStepCreate.status).toBe(200);
      expect(legacyWorkflowStepDetail.status).toBe(200);

      const workflowsHtml = await workflows.text();
      const workflowDetailHtml = await workflowDetail.text();
      const workflowEnrollmentsHtml = await workflowEnrollments.text();
      const workflowEnrollHtml = await workflowEnroll.text();
      const workflowStepsHtml = await workflowSteps.text();
      const workflowStepCreateHtml = await workflowStepCreate.text();
      const workflowStepDetailHtml = await workflowStepDetail.text();
      const legacyWorkflowsHtml = await legacyWorkflows.text();
      const legacyWorkflowDetailHtml = await legacyWorkflowDetail.text();
      const legacyWorkflowEnrollmentsHtml = await legacyWorkflowEnrollments.text();
      const legacyWorkflowEnrollHtml = await legacyWorkflowEnroll.text();
      const legacyWorkflowStepsHtml = await legacyWorkflowSteps.text();
      const legacyWorkflowStepCreateHtml = await legacyWorkflowStepCreate.text();
      const legacyWorkflowStepDetailHtml = await legacyWorkflowStepDetail.text();

      expect(workflowsHtml).toContain("Automated Workflows");
      expect(workflowDetailHtml).toContain("Edit Workflow");
      expect(workflowEnrollmentsHtml).toContain("Active Enrollments");
      expect(workflowEnrollHtml).toContain("Enroll Clients");
      expect(workflowStepsHtml).toContain("Workflow Steps");
      expect(workflowStepCreateHtml).toContain("Add Workflow Step");
      expect(workflowStepDetailHtml).toContain("Edit Workflow Step");
      expect(workflowDetailHtml).toContain("Auto-Enrollment Triggers");
      expect(workflowDetailHtml).toContain('/admin/workflows/workflow-1/triggers');
      expect(workflowDetailHtml).toContain("Consultation");
      expect(legacyWorkflowsHtml).toContain('/client/workflows_edit.php?id=workflow-1');
      expect(legacyWorkflowsHtml).toContain('/client/workflows_steps.php?workflow_id=workflow-1');
      expect(legacyWorkflowsHtml).toContain('/client/workflows_enrollments.php?workflow_id=workflow-1');
      expect(legacyWorkflowDetailHtml).toContain('action="/client/workflows_edit.php?id=workflow-1"');
      expect(legacyWorkflowDetailHtml).toContain('action="/client/workflows_delete.php"');
      expect(legacyWorkflowDetailHtml).toContain('name="add_trigger" value="1"');
      expect(legacyWorkflowDetailHtml).toContain('name="delete_trigger_id" value="workflow-trigger-1"');
      expect(legacyWorkflowEnrollmentsHtml).toContain('/client/workflows_enroll.php?workflow_id=workflow-1');
      expect(legacyWorkflowEnrollmentsHtml).toContain('/client/workflows_enrollments.php?workflow_id=workflow-1&cancel=1&enrollment_id=workflow-enrollment-1');
      expect(legacyWorkflowEnrollHtml).toContain('action="/client/workflows_enroll.php?workflow_id=workflow-1"');
      expect(legacyWorkflowStepsHtml).toContain('/client/workflows_steps_edit.php?workflow_id=workflow-1');
      expect(legacyWorkflowStepsHtml).toContain('action="/client/workflows_steps.php?workflow_id=workflow-1"');
      expect(legacyWorkflowStepCreateHtml).toContain('id="workflow-step-email-template"');
      expect(legacyWorkflowStepCreateHtml).toContain('id="workflow-step-load-template"');
      expect(legacyWorkflowStepCreateHtml).toContain('data-subject="Template Subject"');
      expect(legacyWorkflowStepDetailHtml).toContain('href="/client/workflows_steps.php?workflow_id=workflow-1"');
      expect(legacyWorkflowStepDetailHtml).toContain('name="delete_step_id" value="workflow-step-1"');

      const createWorkflow = await fetch(`${baseUrl}/admin/workflows`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Invoice Follow-up",
          description: "Overdue invoice reminder workflow.",
          trigger: "invoice_overdue",
          active: "on"
        })
      });
      expect(createWorkflow.status).toBe(302);

      const createdWorkflow = workflowState.workflows.find((workflow) => workflow.id !== "workflow-1");
      expect(createdWorkflow).toBeDefined();

      const updateWorkflow = await fetch(`${baseUrl}/admin/workflows/workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Welcome Series Revised",
          description: "Updated onboarding flow.",
          trigger: "scheduled",
          active: ""
        })
      });
      expect(updateWorkflow.status).toBe(302);
      expect(workflowState.workflows.find((workflow) => workflow.id === "workflow-1")?.name).toBe("Welcome Series Revised");

      const createWorkflowTrigger = await fetch(`${baseUrl}/client/workflows_edit.php?id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          add_trigger: "1",
          triggerType: "form_submission",
          appointmentTypeId: "",
          formTemplateId: "form-template-1",
          active: "on"
        })
      });
      expect(createWorkflowTrigger.status).toBe(302);
      expect(createWorkflowTrigger.headers.get("location")).toBe("/client/workflows_edit.php?id=workflow-1#triggers");
      const createdWorkflowTrigger = workflowState.workflowTriggers.find((trigger) => trigger.id !== "workflow-trigger-1");
      expect(createdWorkflowTrigger).toBeDefined();

      const createLegacyWorkflow = await fetch(`${baseUrl}/client/workflows_edit.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Legacy Intake Follow-up",
          description: "Legacy workflow route coverage.",
          trigger: "manual",
          active: "on"
        })
      });
      expect(createLegacyWorkflow.status).toBe(302);
      expect(createLegacyWorkflow.headers.get("location")).toContain("/client/workflows_steps.php?workflow_id=");
      const legacyCreatedWorkflow = workflowState.workflows.find((workflow) => workflow.id !== "workflow-1" && workflow.id !== createdWorkflow?.id);
      expect(legacyCreatedWorkflow).toBeDefined();

      const updateLegacyWorkflow = await fetch(`${baseUrl}/client/workflows_edit.php?id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          name: "Legacy Welcome Series Revised",
          description: "Legacy editor update flow.",
          trigger: "scheduled",
          active: "on"
        })
      });
      expect(updateLegacyWorkflow.status).toBe(302);
      expect(updateLegacyWorkflow.headers.get("location")).toBe("/client/workflows_steps.php?workflow_id=workflow-1");
      expect(workflowState.workflows.find((workflow) => workflow.id === "workflow-1")?.name).toBe("Legacy Welcome Series Revised");

      const createWorkflowStep = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          stepName: "Preparation Reminder",
          emailSubject: "Prep for {workflow_name}",
          emailBodyHtml: "<p>Bring your leash.</p>",
          emailBodyText: "Bring your leash.",
          delayType: "after_previous",
          delayValue: "1 day",
          scheduledDate: "",
          attachContractId: "",
          attachFormId: "",
          attachQuoteId: "",
          attachInvoiceId: "",
          includeAppointmentLink: "on",
          appointmentTypeId: "appointment-type-1"
        })
      });
      expect(createWorkflowStep.status).toBe(302);
      const createdWorkflowStep = workflowState.workflowSteps.find((step) => step.id !== "workflow-step-1");
      expect(createdWorkflowStep).toBeDefined();

      const updateWorkflowStep = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps/workflow-step-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          stepName: "Welcome Email Revised",
          emailSubject: "Updated welcome for {client_name}",
          emailBodyHtml: "<p>Updated body</p>",
          emailBodyText: "Updated body",
          delayType: "after_enrollment",
          delayValue: "3 hours",
          scheduledDate: "",
          attachContractId: "",
          attachFormId: "",
          attachQuoteId: "",
          attachInvoiceId: "",
          includeAppointmentLink: "",
          appointmentTypeId: ""
        })
      });
      expect(updateWorkflowStep.status).toBe(302);
      expect(workflowState.workflowSteps.find((step) => step.id === "workflow-step-1")?.stepName).toBe("Welcome Email Revised");

      const createLegacyWorkflowStep = await fetch(`${baseUrl}/client/workflows_steps_edit.php?workflow_id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          stepName: "Legacy Reminder",
          emailSubject: "Legacy prep for {workflow_name}",
          emailBodyHtml: "<p>Legacy reminder body.</p>",
          emailBodyText: "Legacy reminder body.",
          delayType: "after_previous",
          delayValue: "1 day",
          scheduledDate: "",
          attachContractId: "",
          attachFormId: "",
          attachQuoteId: "",
          attachInvoiceId: "",
          includeAppointmentLink: "on",
          appointmentTypeId: "appointment-type-1"
        })
      });
      expect(createLegacyWorkflowStep.status).toBe(302);
      expect(createLegacyWorkflowStep.headers.get("location")).toBe("/client/workflows_steps.php?workflow_id=workflow-1");
      const legacyCreatedWorkflowStep = workflowState.workflowSteps.find((step) => (
        step.id !== "workflow-step-1"
        && step.id !== createdWorkflowStep?.id
      ));
      expect(legacyCreatedWorkflowStep).toBeDefined();

      const updateLegacyWorkflowStep = await fetch(`${baseUrl}/client/workflows_steps_edit.php?workflow_id=workflow-1&step_id=workflow-step-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          stepName: "Legacy Welcome Email Revised",
          emailSubject: "Legacy updated welcome for {client_name}",
          emailBodyHtml: "<p>Legacy updated body</p>",
          emailBodyText: "Legacy updated body",
          delayType: "after_enrollment",
          delayValue: "4 hours",
          scheduledDate: "",
          attachContractId: "",
          attachFormId: "",
          attachQuoteId: "",
          attachInvoiceId: "",
          includeAppointmentLink: "",
          appointmentTypeId: ""
        })
      });
      expect(updateLegacyWorkflowStep.status).toBe(302);
      expect(updateLegacyWorkflowStep.headers.get("location")).toBe("/client/workflows_steps.php?workflow_id=workflow-1");
      expect(workflowState.workflowSteps.find((step) => step.id === "workflow-step-1")?.stepName).toBe("Legacy Welcome Email Revised");

      const enrollClient = await fetch(`${baseUrl}/admin/workflows/workflow-1/enroll`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams([
          ["clientIds", "client-2"]
        ])
      });
      expect(enrollClient.status).toBe(302);
      expect(workflowState.workflowEnrollments.some((enrollment) => enrollment.clientId === "client-2")).toBe(true);
      expect(workflowState.workflowStepExecutions.some((execution) => execution.enrollmentId != null)).toBe(true);

      const legacyEnrollClient = await fetch(`${baseUrl}/client/workflows_enroll.php?workflow_id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams([
          ["clientIds", "client-3"]
        ])
      });
      expect(legacyEnrollClient.status).toBe(302);
      expect(legacyEnrollClient.headers.get("location")).toBe("/client/workflows_enrollments.php?workflow_id=workflow-1");
      expect(workflowState.workflowEnrollments.some((enrollment) => enrollment.clientId === "client-3")).toBe(true);

      const cancelEnrollment = await fetch(`${baseUrl}/admin/workflows/workflow-1/enrollments/workflow-enrollment-1/cancel`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(cancelEnrollment.status).toBe(302);
      expect(workflowState.workflowEnrollments.find((enrollment) => enrollment.id === "workflow-enrollment-1")?.status).toBe("cancelled");

      const legacyEnrollmentId = String(workflowState.workflowEnrollments.find((enrollment) => enrollment.clientId === "client-3")?.id ?? "");
      const cancelLegacyEnrollment = await fetch(`${baseUrl}/client/workflows_enrollments.php?workflow_id=workflow-1&cancel=1&enrollment_id=${encodeURIComponent(legacyEnrollmentId)}`, {
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(cancelLegacyEnrollment.status).toBe(302);
      expect(cancelLegacyEnrollment.headers.get("location")).toBe("/client/workflows_enrollments.php?workflow_id=workflow-1");
      expect(workflowState.workflowEnrollments.find((enrollment) => enrollment.id === legacyEnrollmentId)?.status).toBe("cancelled");

      const deleteWorkflowStep = await fetch(`${baseUrl}/admin/workflows/workflow-1/steps/${encodeURIComponent(String(createdWorkflowStep?.id ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(deleteWorkflowStep.status).toBe(302);
      expect(workflowState.workflowSteps.some((step) => step.id === createdWorkflowStep?.id)).toBe(false);

      const deleteLegacyWorkflowStep = await fetch(`${baseUrl}/client/workflows_steps.php?workflow_id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          delete_step_id: String(legacyCreatedWorkflowStep?.id ?? "")
        })
      });
      expect(deleteLegacyWorkflowStep.status).toBe(302);
      expect(deleteLegacyWorkflowStep.headers.get("location")).toBe("/client/workflows_steps.php?workflow_id=workflow-1");
      expect(workflowState.workflowSteps.some((step) => step.id === legacyCreatedWorkflowStep?.id)).toBe(false);

      const deleteWorkflowTrigger = await fetch(`${baseUrl}/client/workflows_edit.php?id=workflow-1`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          delete_trigger_id: String(createdWorkflowTrigger?.id ?? "")
        })
      });
      expect(deleteWorkflowTrigger.status).toBe(302);
      expect(deleteWorkflowTrigger.headers.get("location")).toBe("/client/workflows_edit.php?id=workflow-1#triggers");
      expect(workflowState.workflowTriggers.some((trigger) => trigger.id === createdWorkflowTrigger?.id)).toBe(false);

      const deleteWorkflow = await fetch(`${baseUrl}/admin/workflows/${encodeURIComponent(String(createdWorkflow?.id ?? ""))}/delete`, {
        method: "POST",
        headers: {
          cookie: adminCookie ?? ""
        },
        redirect: "manual"
      });
      expect(deleteWorkflow.status).toBe(302);
      expect(workflowState.workflows.some((workflow) => workflow.id === createdWorkflow?.id)).toBe(false);

      const deleteLegacyWorkflow = await fetch(`${baseUrl}/client/workflows_delete.php`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: adminCookie ?? ""
        },
        redirect: "manual",
        body: new URLSearchParams({
          id: String(legacyCreatedWorkflow?.id ?? "")
        })
      });
      expect(deleteLegacyWorkflow.status).toBe(302);
      expect(deleteLegacyWorkflow.headers.get("location")).toBe("/client/workflows_list.php");
      expect(workflowState.workflows.some((workflow) => workflow.id === legacyCreatedWorkflow?.id)).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
  });
});


