import { z } from "zod";

import {
  adminBlogPostUpsertRequestSchema,
  adminSettingUpdateRequestSchema,
  adminSitePageUpsertRequestSchema,
  blogPostCollectionSchema,
  blogPostDetailSchema,
  settingCollectionSchema,
  settingDetailSchema,
  sitePageCollectionSchema,
  sitePageDetailSchema
} from "@bdta/contracts";
import {
  blogPostSchema,
  idSchema,
  settingSchema,
  sitePageSchema,
  type BlogPost,
  type Setting,
  type SitePage
} from "@bdta/domain";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class ContentError extends Error {
  constructor(
    public readonly code: "not_found",
    message: string
  ) {
    super(message);
    this.name = "ContentError";
  }
}

export type ContentManagementDependencies = {
  now(): string;
  listPublicBlogPosts(): Promise<BlogPost[]>;
  findPublicBlogPostBySlug(slug: string): Promise<BlogPost | null>;
  findPublicSitePageBySlug(slug: string | null): Promise<SitePage | null>;
  listAdminBlogPosts(): Promise<BlogPost[]>;
  findAdminBlogPostById(postId: string): Promise<BlogPost | null>;
  createAdminBlogPost(input: z.infer<typeof adminBlogPostUpsertRequestSchema>): Promise<BlogPost>;
  updateAdminBlogPost(postId: string, input: z.infer<typeof adminBlogPostUpsertRequestSchema>): Promise<BlogPost | null>;
  listAdminSitePages(): Promise<SitePage[]>;
  findAdminSitePageById(pageId: string): Promise<SitePage | null>;
  createAdminSitePage(
    adminUserId: string,
    input: z.infer<typeof adminSitePageUpsertRequestSchema>
  ): Promise<SitePage>;
  updateAdminSitePage(
    pageId: string,
    adminUserId: string,
    input: z.infer<typeof adminSitePageUpsertRequestSchema>
  ): Promise<SitePage | null>;
  listAdminSettings(): Promise<Setting[]>;
  findAdminSettingByKey(key: string): Promise<Setting | null>;
  updateAdminSetting(key: string, input: z.infer<typeof adminSettingUpdateRequestSchema>): Promise<Setting | null>;
};

function requireAdminSession(session: SessionSnapshot): string {
  if (session.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  return session.actorId;
}

function requireFound<T>(item: T | null, message: string): T {
  if (item == null) {
    throw new ContentError("not_found", message);
  }

  return item;
}

export async function listPublicBlogPosts(dependencies: ContentManagementDependencies) {
  return blogPostCollectionSchema.parse({
    items: (await dependencies.listPublicBlogPosts()).map((item) => blogPostSchema.parse(item))
  });
}

export async function getPublicBlogPostDetail(slug: string, dependencies: ContentManagementDependencies) {
  const item = requireFound(
    await dependencies.findPublicBlogPostBySlug(z.string().trim().min(1).parse(slug)),
    "Public blog post not found."
  );

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(item) });
}

export async function getPublicSitePage(slug: string | null, dependencies: ContentManagementDependencies) {
  const normalizedSlug = slug == null || slug.trim() === "" ? null : slug.trim();
  const item = requireFound(
    await dependencies.findPublicSitePageBySlug(normalizedSlug),
    "Public site page not found."
  );

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(item) });
}

export async function listAdminBlogPosts(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  requireAdminSession(session);
  return blogPostCollectionSchema.parse({
    items: (await dependencies.listAdminBlogPosts()).map((item) => blogPostSchema.parse(item))
  });
}

export async function getAdminBlogPostDetail(
  session: SessionSnapshot,
  postId: string,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminBlogPostById(idSchema.parse(postId)),
    "Admin blog post not found."
  );

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(item) });
}

export async function createAdminBlogPost(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  return blogPostDetailSchema.parse({
    item: blogPostSchema.parse(await dependencies.createAdminBlogPost(adminBlogPostUpsertRequestSchema.parse(input)))
  });
}

export async function updateAdminBlogPost(
  session: SessionSnapshot,
  postId: string,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.updateAdminBlogPost(idSchema.parse(postId), adminBlogPostUpsertRequestSchema.parse(input)),
    "Admin blog post not found."
  );

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(item) });
}

export async function listAdminSitePages(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  requireAdminSession(session);
  return sitePageCollectionSchema.parse({
    items: (await dependencies.listAdminSitePages()).map((item) => sitePageSchema.parse(item))
  });
}

export async function getAdminSitePageDetail(
  session: SessionSnapshot,
  pageId: string,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminSitePageById(idSchema.parse(pageId)),
    "Admin site page not found."
  );

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(item) });
}

export async function createAdminSitePage(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  return sitePageDetailSchema.parse({
    item: sitePageSchema.parse(
      await dependencies.createAdminSitePage(adminUserId, adminSitePageUpsertRequestSchema.parse(input))
    )
  });
}

export async function updateAdminSitePage(
  session: SessionSnapshot,
  pageId: string,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  const item = requireFound(
    await dependencies.updateAdminSitePage(
      idSchema.parse(pageId),
      adminUserId,
      adminSitePageUpsertRequestSchema.parse(input)
    ),
    "Admin site page not found."
  );

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(item) });
}

export async function listAdminSettings(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  requireAdminSession(session);
  return settingCollectionSchema.parse({
    items: (await dependencies.listAdminSettings()).map((item) => settingSchema.parse(item))
  });
}

export async function getAdminSettingDetail(
  session: SessionSnapshot,
  key: string,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.findAdminSettingByKey(z.string().trim().min(1).parse(key)),
    "Admin setting not found."
  );

  return settingDetailSchema.parse({ item: settingSchema.parse(item) });
}

export async function updateAdminSetting(
  session: SessionSnapshot,
  key: string,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const item = requireFound(
    await dependencies.updateAdminSetting(
      z.string().trim().min(1).parse(key),
      adminSettingUpdateRequestSchema.parse(input)
    ),
    "Admin setting not found."
  );

  return settingDetailSchema.parse({ item: settingSchema.parse(item) });
}
