import { z } from "zod";

import {
  adminBlogPostUpsertRequestSchema,
  adminSettingsOverviewSchema,
  adminSettingsUserCreateRequestSchema,
  adminSettingsUserPermissionUpdateRequestSchema,
  adminSettingsUserSchema,
  adminSettingUpdateRequestSchema,
  adminSitePageUpsertRequestSchema,
  blogPostCollectionSchema,
  blogPostDetailSchema,
  deleteResponseSchema,
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
import { normalizeNullableBlogCoverPhotoPath } from "./blog-cover-photo.js";
import { SessionActorError, type SessionSnapshot } from "./session-actors.js";

export class ContentError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_operation",
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
  deleteAdminBlogPost(postId: string): Promise<boolean>;
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
  deleteAdminSitePage(pageId: string): Promise<boolean>;
  listAdminSettings(): Promise<Setting[]>;
  findAdminSettingByKey(key: string): Promise<Setting | null>;
  updateAdminSetting(key: string, input: z.infer<typeof adminSettingUpdateRequestSchema>): Promise<Setting | null>;
  findAdminSettingsUserByActorId(actorId: string): Promise<z.infer<typeof adminSettingsUserSchema> | null>;
  listAdminSettingsUsers(): Promise<Array<z.infer<typeof adminSettingsUserSchema>>>;
  findAdminSettingsUserByUsername(username: string): Promise<z.infer<typeof adminSettingsUserSchema> | null>;
  createAdminSettingsUser(
    input: z.infer<typeof adminSettingsUserCreateRequestSchema>
  ): Promise<z.infer<typeof adminSettingsUserSchema>>;
  updateAdminSettingsUserPermissions(
    actorId: string,
    input: z.infer<typeof adminSettingsUserPermissionUpdateRequestSchema>
  ): Promise<z.infer<typeof adminSettingsUserSchema> | null>;
  deleteAdminSettingsUser(actorId: string): Promise<boolean>;
};

const apiKeySettingKeys = new Set([
  "sendgrid_api_key",
  "mailgun_api_key",
  "mailjet_api_key",
  "mailjet_api_secret",
  "mailjet_newsletter_list_id",
  "smtp_host",
  "smtp_port",
  "smtp_encryption",
  "smtp_username",
  "smtp_password",
  "smtp_debug",
  "imap_enabled",
  "imap_host",
  "imap_port",
  "imap_encryption",
  "imap_username",
  "imap_password",
  "imap_folder",
  "imap_sync_days",
  "stripe_test_publishable_key",
  "stripe_test_secret_key",
  "stripe_live_publishable_key",
  "stripe_live_secret_key",
  "google_calendar_enabled",
  "google_calendar_id",
  "google_calendar_credentials_file",
  "google_oauth_client_id",
  "google_oauth_client_secret",
  "google_oauth_redirect_uri",
  "moxie_api_key",
  "tawk_to_property_id",
  "tawk_to_widget_id",
  "newsletter_embed_html",
  "turnstile_site_key",
  "turnstile_secret_key",
  "db_host",
  "db_port",
  "db_name",
  "db_user",
  "db_password"
]);

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

function normalizeOptionalTrimmedString(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeRequiredTrimmedString(value: string, fallback: string): string {
  const normalized = value.trim();
  return normalized === "" ? fallback : normalized;
}

function normalizeBlogPost(item: BlogPost): BlogPost {
  return {
    ...item,
    title: normalizeRequiredTrimmedString(item.title, "Untitled Post"),
    slug: normalizeRequiredTrimmedString(item.slug, `blog-post-${item.id}`),
    author: normalizeRequiredTrimmedString(item.author, "Brook's Dog Training Academy"),
    coverPhoto: normalizeNullableBlogCoverPhotoPath(item.coverPhoto)
  };
}

function normalizeSitePage(item: SitePage): SitePage {
  return {
    ...item,
    slug: normalizeRequiredTrimmedString(item.slug, item.isHomepage ? "home" : `page-${item.id}`),
    title: normalizeRequiredTrimmedString(item.title, item.isHomepage ? "Home" : "Untitled Page"),
    ogTitle: normalizeOptionalTrimmedString(item.ogTitle),
    ogDescription: normalizeOptionalTrimmedString(item.ogDescription),
    ogImage: normalizeOptionalTrimmedString(item.ogImage)
  };
}

function normalizeAdminBlogPostInput(input: unknown) {
  const parsed = adminBlogPostUpsertRequestSchema.parse(input);
  return {
    ...parsed,
    coverPhoto: normalizeNullableBlogCoverPhotoPath(parsed.coverPhoto)
  };
}

function canManageAdminUsers(
  adminUser: z.infer<typeof adminSettingsUserSchema>
): boolean {
  return adminUser.isMainAccount || adminUser.canManageAdminUsers;
}

function canManageApiKeys(
  adminUser: z.infer<typeof adminSettingsUserSchema>
): boolean {
  return adminUser.isMainAccount || adminUser.canManageApiKeys;
}

function isApiKeySetting(settingKey: string): boolean {
  return apiKeySettingKeys.has(settingKey);
}

function filterVisibleSettings(
  settings: Setting[],
  adminUser: z.infer<typeof adminSettingsUserSchema>
): Setting[] {
  if (canManageApiKeys(adminUser)) {
    return settings;
  }

  return settings.filter((item) => !isApiKeySetting(item.key));
}

async function requireAdminSettingsUser(
  session: SessionSnapshot,
  dependencies: ContentManagementDependencies
) {
  const actorId = requireAdminSession(session);
  const actor = await dependencies.findAdminSettingsUserByActorId(actorId);
  if (actor == null || !actor.active) {
    throw new SessionActorError("actor_not_found", "Admin actor no longer exists.");
  }

  return adminSettingsUserSchema.parse(actor);
}

export async function listPublicBlogPosts(dependencies: ContentManagementDependencies) {
  return blogPostCollectionSchema.parse({
    items: (await dependencies.listPublicBlogPosts()).map((item) => blogPostSchema.parse(normalizeBlogPost(item)))
  });
}

export async function getPublicBlogPostDetail(slug: string, dependencies: ContentManagementDependencies) {
  const item = requireFound(
    await dependencies.findPublicBlogPostBySlug(z.string().trim().min(1).parse(slug)),
    "Public blog post not found."
  );

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(normalizeBlogPost(item)) });
}

export async function getPublicSitePage(slug: string | null, dependencies: ContentManagementDependencies) {
  const normalizedSlug = slug == null || slug.trim() === "" ? null : slug.trim();
  const item = requireFound(
    await dependencies.findPublicSitePageBySlug(normalizedSlug),
    "Public site page not found."
  );

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(normalizeSitePage(item)) });
}

export async function listAdminBlogPosts(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  requireAdminSession(session);
  return blogPostCollectionSchema.parse({
    items: (await dependencies.listAdminBlogPosts()).map((item) => blogPostSchema.parse(normalizeBlogPost(item)))
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

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(normalizeBlogPost(item)) });
}

export async function createAdminBlogPost(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  return blogPostDetailSchema.parse({
    item: blogPostSchema.parse(await dependencies.createAdminBlogPost(normalizeAdminBlogPostInput(input)))
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
    await dependencies.updateAdminBlogPost(idSchema.parse(postId), normalizeAdminBlogPostInput(input)),
    "Admin blog post not found."
  );

  return blogPostDetailSchema.parse({ item: blogPostSchema.parse(normalizeBlogPost(item)) });
}

export async function deleteAdminBlogPost(
  session: SessionSnapshot,
  postId: string,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const normalizedPostId = idSchema.parse(postId);
  requireFound(
    await dependencies.findAdminBlogPostById(normalizedPostId),
    "Admin blog post not found."
  );

  const deleted = await dependencies.deleteAdminBlogPost(normalizedPostId);
  if (!deleted) {
    throw new ContentError("not_found", "Admin blog post not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listAdminSitePages(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  requireAdminSession(session);
  return sitePageCollectionSchema.parse({
    items: (await dependencies.listAdminSitePages()).map((item) => sitePageSchema.parse(normalizeSitePage(item)))
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

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(normalizeSitePage(item)) });
}

export async function createAdminSitePage(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const adminUserId = requireAdminSession(session);
  return sitePageDetailSchema.parse({
    item: sitePageSchema.parse(
      normalizeSitePage(await dependencies.createAdminSitePage(adminUserId, adminSitePageUpsertRequestSchema.parse(input)))
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

  return sitePageDetailSchema.parse({ item: sitePageSchema.parse(normalizeSitePage(item)) });
}

export async function deleteAdminSitePage(
  session: SessionSnapshot,
  pageId: string,
  dependencies: ContentManagementDependencies
) {
  requireAdminSession(session);
  const normalizedPageId = idSchema.parse(pageId);
  const existing = requireFound(
    await dependencies.findAdminSitePageById(normalizedPageId),
    "Admin site page not found."
  );

  if (existing.isHomepage) {
    throw new ContentError("invalid_operation", "Homepage cannot be deleted.");
  }

  const deleted = await dependencies.deleteAdminSitePage(normalizedPageId);
  if (!deleted) {
    throw new ContentError("not_found", "Admin site page not found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}

export async function listAdminSettings(session: SessionSnapshot, dependencies: ContentManagementDependencies) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  return settingCollectionSchema.parse({
    items: filterVisibleSettings(await dependencies.listAdminSettings(), currentAdmin)
      .map((item) => settingSchema.parse(item))
  });
}

export async function getAdminSettingDetail(
  session: SessionSnapshot,
  key: string,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  const item = requireFound(
    await dependencies.findAdminSettingByKey(z.string().trim().min(1).parse(key)),
    "Admin setting not found."
  );
  if (!canManageApiKeys(currentAdmin) && isApiKeySetting(item.key)) {
    throw new ContentError("not_found", "Admin setting not found.");
  }

  return settingDetailSchema.parse({ item: settingSchema.parse(item) });
}

export async function updateAdminSetting(
  session: SessionSnapshot,
  key: string,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  const normalizedKey = z.string().trim().min(1).parse(key);
  if (!canManageApiKeys(currentAdmin) && isApiKeySetting(normalizedKey)) {
    throw new ContentError("not_found", "Admin setting not found.");
  }
  const item = requireFound(
    await dependencies.updateAdminSetting(
      normalizedKey,
      adminSettingUpdateRequestSchema.parse(input)
    ),
    "Admin setting not found."
  );

  return settingDetailSchema.parse({ item: settingSchema.parse(item) });
}

export async function getAdminSettingsOverview(
  session: SessionSnapshot,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  const settings = filterVisibleSettings(await dependencies.listAdminSettings(), currentAdmin)
    .map((item) => settingSchema.parse(item));
  const categories = [...new Set(settings.map((item) => item.category))].sort((left, right) => left.localeCompare(right));

  return adminSettingsOverviewSchema.parse({
    currentAdmin,
    items: settings,
    adminUsers: (await dependencies.listAdminSettingsUsers()).map((item) => adminSettingsUserSchema.parse(item)),
    categories
  });
}

export async function createAdminSettingsUser(
  session: SessionSnapshot,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  if (!canManageAdminUsers(currentAdmin)) {
    throw new ContentError("invalid_operation", "You do not have permission to add admin users.");
  }

  const parsedInput = adminSettingsUserCreateRequestSchema.parse(input);
  const existing = await dependencies.findAdminSettingsUserByUsername(parsedInput.username);
  if (existing != null) {
    throw new ContentError("invalid_operation", "That admin username is already in use.");
  }

  return adminSettingsUserSchema.parse(await dependencies.createAdminSettingsUser(parsedInput));
}

export async function updateAdminSettingsUserPermissions(
  session: SessionSnapshot,
  actorId: string,
  input: unknown,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  if (!currentAdmin.isMainAccount) {
    throw new ContentError("invalid_operation", "Only the main admin account can change admin permissions.");
  }

  const targetActorId = idSchema.parse(actorId);
  const target = requireFound(
    await dependencies.findAdminSettingsUserByActorId(targetActorId),
    "That admin user could not be found."
  );

  if (target.isMainAccount) {
    throw new ContentError("invalid_operation", "The main admin account permissions cannot be changed.");
  }

  if (target.accountType === "accountant" || target.role === "accountant") {
    throw new ContentError("invalid_operation", "Accountant account permissions cannot be modified.");
  }

  const updated = requireFound(
    await dependencies.updateAdminSettingsUserPermissions(
      targetActorId,
      adminSettingsUserPermissionUpdateRequestSchema.parse(input)
    ),
    "That admin user could not be found."
  );

  return adminSettingsUserSchema.parse(updated);
}

export async function deleteAdminSettingsUser(
  session: SessionSnapshot,
  actorId: string,
  dependencies: ContentManagementDependencies
) {
  const currentAdmin = await requireAdminSettingsUser(session, dependencies);
  if (!canManageAdminUsers(currentAdmin)) {
    throw new ContentError("invalid_operation", "You do not have permission to delete admin users.");
  }

  const targetActorId = idSchema.parse(actorId);
  const target = requireFound(
    await dependencies.findAdminSettingsUserByActorId(targetActorId),
    "That admin user could not be found."
  );

  if (target.isMainAccount) {
    throw new ContentError("invalid_operation", "The main admin account cannot be deleted.");
  }

  if (target.actorId === currentAdmin.actorId) {
    throw new ContentError("invalid_operation", "You cannot delete the admin account you are currently using.");
  }

  const deleted = await dependencies.deleteAdminSettingsUser(targetActorId);
  if (!deleted) {
    throw new ContentError("not_found", "That admin user could not be found.");
  }

  return deleteResponseSchema.parse({ deleted: true });
}
