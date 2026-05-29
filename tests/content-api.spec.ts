import { createApiHandlers } from "@bdta/application";
import { createInMemoryApiDependencies, createInMemoryPlatformState } from "@bdta/infrastructure";

describe("content api handlers", () => {
  it("returns published public blog posts and public site pages", async () => {
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
        },
        {
          id: "blog-2",
          title: "Draft Post",
          slug: "draft-post",
          content: "<p>Draft</p>",
          excerpt: "Draft",
          coverPhoto: null,
          author: "Brook",
          published: false,
          publishDate: null,
          createdAt: "2026-05-21T10:00:00.000Z",
          updatedAt: "2026-05-21T10:00:00.000Z"
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
          htmlContent: "<section><h1>Programs</h1></section>",
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

    const handlers = createApiHandlers(createInMemoryApiDependencies(state));

    const blogPosts = await handlers.handlePublicBlogPosts();
    const blogPost = await handlers.handlePublicBlogPostDetail("loose-leash-training-tips");
    const homepage = await handlers.handlePublicSitePage(null);
    const servicesPage = await handlers.handlePublicSitePage("services");

    expect(blogPosts.status).toBe(200);
    expect(blogPost.status).toBe(200);
    expect(homepage.status).toBe(200);
    expect(servicesPage.status).toBe(200);
    if (
      "error" in blogPosts.body
      || "error" in blogPost.body
      || "error" in homepage.body
      || "error" in servicesPage.body
    ) {
      throw new Error("Expected successful public content responses.");
    }

    expect(blogPosts.body.items).toHaveLength(1);
    expect(blogPosts.body.items[0]?.slug).toBe("loose-leash-training-tips");
    expect(blogPost.body.item.title).toBe("Loose Leash Training Tips");
    expect(homepage.body.item.isHomepage).toBe(true);
    expect(servicesPage.body.item.slug).toBe("services");
  });

  it("returns and updates admin content and settings for a valid admin session", async () => {
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
        }
      ],
      settings: [
        {
          id: "setting-1",
          key: "turnstile_site_key",
          value: "site-key-1",
          type: "text",
          category: "advanced",
          label: "Turnstile Site Key",
          description: "Used on public booking forms.",
          secret: false,
          updatedAt: "2026-05-28T12:00:00.000Z"
        }
      ]
    });

    const handlers = createApiHandlers(createInMemoryApiDependencies(state));
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "admin" as const,
      issuedAt: "2026-05-29T16:00:00.000Z",
      expiresAt: "2026-05-29T18:00:00.000Z"
    };

    const posts = await handlers.handleAdminBlogPosts(adminSession);
    const post = await handlers.handleAdminBlogPostDetail(adminSession, "blog-1");
    const createdPost = await handlers.handleAdminBlogPostCreate(adminSession, {
      title: "Board and Train Preparation",
      slug: "board-and-train-preparation",
      content: "<p>Prep starts at home.</p>",
      excerpt: "Prep starts at home.",
      coverPhoto: "/images/blog/board-and-train.jpg",
      author: "Brook",
      published: false,
      publishDate: null
    });
    const updatedPost = await handlers.handleAdminBlogPostUpdate(adminSession, "blog-1", {
      title: "Loose Leash Training Tips Updated",
      slug: "loose-leash-training-tips",
      content: "<p>Updated content.</p>",
      excerpt: "Updated excerpt.",
      coverPhoto: "/images/blog/loose-leash-updated.jpg",
      author: "Brook",
      published: true,
      publishDate: "2026-05-29T12:00:00.000Z"
    });

    const pages = await handlers.handleAdminSitePages(adminSession);
    const page = await handlers.handleAdminSitePageDetail(adminSession, "page-home");
    const createdPage = await handlers.handleAdminSitePageCreate(adminSession, {
      slug: "faq",
      title: "FAQ",
      htmlContent: "<section><h1>FAQ</h1></section>",
      cssContent: "",
      metaDescription: "Frequently asked questions",
      metaKeywords: "faq",
      ogTitle: "FAQ",
      ogDescription: "Answers for new clients.",
      ogImage: "/images/og/faq.jpg",
      isHomepage: false,
      published: true,
      sortOrder: 3
    });
    const updatedPage = await handlers.handleAdminSitePageUpdate(adminSession, "page-home", {
      slug: "home",
      title: "Brook's Dog Training Academy Updated",
      htmlContent: "<section><h1>Updated home.</h1></section>",
      cssContent: "body { background: #fff; }",
      metaDescription: "Updated home page",
      metaKeywords: "dog training",
      ogTitle: "Updated Home",
      ogDescription: "Updated description",
      ogImage: "/images/og/home-updated.jpg",
      isHomepage: true,
      published: true,
      sortOrder: 1
    });

    const settings = await handlers.handleAdminSettings(adminSession);
    const setting = await handlers.handleAdminSettingDetail(adminSession, "turnstile_site_key");
    const updatedSetting = await handlers.handleAdminSettingUpdate(adminSession, "turnstile_site_key", {
      value: "site-key-2"
    });

    expect(posts.status).toBe(200);
    expect(post.status).toBe(200);
    expect(createdPost.status).toBe(201);
    expect(updatedPost.status).toBe(200);
    expect(pages.status).toBe(200);
    expect(page.status).toBe(200);
    expect(createdPage.status).toBe(201);
    expect(updatedPage.status).toBe(200);
    expect(settings.status).toBe(200);
    expect(setting.status).toBe(200);
    expect(updatedSetting.status).toBe(200);

    if (
      "error" in posts.body
      || "error" in post.body
      || "error" in createdPost.body
      || "error" in updatedPost.body
      || "error" in pages.body
      || "error" in page.body
      || "error" in createdPage.body
      || "error" in updatedPage.body
      || "error" in settings.body
      || "error" in setting.body
      || "error" in updatedSetting.body
    ) {
      throw new Error("Expected successful admin content responses.");
    }

    expect(posts.body.items[0]?.id).toBe("blog-1");
    expect(post.body.item.slug).toBe("loose-leash-training-tips");
    expect(createdPost.body.item.slug).toBe("board-and-train-preparation");
    expect(updatedPost.body.item.title).toBe("Loose Leash Training Tips Updated");
    expect(pages.body.items[0]?.id).toBe("page-home");
    expect(page.body.item.isHomepage).toBe(true);
    expect(createdPage.body.item.slug).toBe("faq");
    expect(updatedPage.body.item.title).toBe("Brook's Dog Training Academy Updated");
    expect(settings.body.items[0]?.key).toBe("turnstile_site_key");
    expect(setting.body.item.value).toBe("site-key-1");
    expect(updatedSetting.body.item.value).toBe("site-key-2");
  });
});
