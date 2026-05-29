import type {
  AdminCalendarSyncDependencies,
  AdminActorProfileDependencies,
  AdminDashboardDependencies,
  AdminIdentity,
  AdminOperationsDependencies,
  AchievementDependencies,
  ClientProfileDependencies,
  ContentManagementDependencies,
  ContactManagementDependencies,
  IntegrationCallbackDependencies,
  AdminLoginDependencies,
  PetFileManagementDependencies,
  AdminResourceReadDependencies,
  ApiDependencies,
  BackgroundProcessorDependencies,
  InboundEmailProcessingDependencies,
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
  ClientAchievement,
  ClientContact,
  ClientProfile,
  Contract,
  Credit,
  FormSubmission,
  InboundEmail,
  Invoice,
  OutboundEmailMessage,
  Package,
  Pet,
  PetFile,
  PublicAccessToken,
  Quote,
  Setting,
  SitePage,
  UnmatchedEmail
} from "@bdta/domain";
import type { JobEnvelope, JobResult, SupportedJobKind } from "@bdta/contracts";

export type InMemoryPortalUser = {
  clientId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  phone?: string;
  address?: string;
  notes?: string;
  isAdmin?: boolean;
  archived: boolean;
};

export type InMemoryAdminUser = {
  actorId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "owner" | "admin" | "accountant" | "staff";
  active: boolean;
};

export type InMemoryPlatformState = {
  now: () => string;
  blogPosts: BlogPost[];
  sitePages: SitePage[];
  settings: Setting[];
  bookings: Booking[];
  contacts: ClientContact[];
  pets: Pet[];
  petFiles: PetFile[];
  petFileContents: Record<string, string | Uint8Array>;
  achievementTypes: AchievementType[];
  clientAchievements: ClientAchievement[];
  invoices: Invoice[];
  quotes: Quote[];
  contracts: Contract[];
  packages: Package[];
  credits: Credit[];
  formSubmissions: FormSubmission[];
  portalUsers: InMemoryPortalUser[];
  adminUsers: InMemoryAdminUser[];
  sessions: Map<string, string>;
  queuedEmails: OutboundEmailMessage[];
  queuedJobs: JobEnvelope[];
  integrationCallbacks: Array<{
    callbackId: string;
    provider: "stripe" | "google_calendar" | "mail_provider" | "imap";
    receivedAt: string;
    payload: Record<string, unknown>;
    queuedJobId: string | null;
  }>;
  inboundEmails: InboundEmail[];
  unmatchedEmails: UnmatchedEmail[];
  calendarSyncs: Array<{
    bookingId: string;
    provider: "google_calendar";
    externalEventId: string;
    externalEventUrl: string | null;
    syncedAt: string;
  }>;
  jobHistory: Array<{
    job: JobEnvelope;
    status: "processed" | "failed";
    processedAt: string;
    summary: string;
  }>;
  processedJobResults: JobResult[];
  failedJobResults: JobResult[];
  sentEmails: OutboundEmailMessage[];
  failedEmailAttempts: Array<{ message: OutboundEmailMessage; reason: string }>;
  loginEvents: string[];
  captchaVerifier: (token: string) => Promise<boolean>;
  availabilityChecker: PublicBookingDependencies["isTimeSlotAvailable"];
  passwordVerifier: (password: string, hash: string) => Promise<boolean>;
};

type InMemoryPlatformStateInput = Partial<Pick<InMemoryPlatformState, "portalUsers" | "adminUsers" | "blogPosts" | "sitePages" | "settings" | "invoices" | "quotes" | "bookings" | "contacts" | "pets" | "petFiles" | "petFileContents" | "achievementTypes" | "clientAchievements" | "contracts" | "packages" | "credits" | "formSubmissions" | "queuedEmails" | "queuedJobs">> & {
  now?: () => string;
  captchaVerifier?: (token: string) => Promise<boolean>;
  availabilityChecker?: PublicBookingDependencies["isTimeSlotAvailable"];
  passwordVerifier?: (password: string, hash: string) => Promise<boolean>;
};

export function createInMemoryPlatformState(input: InMemoryPlatformStateInput = {}): InMemoryPlatformState {
  return {
    now: input.now ?? (() => "2026-05-27T18:00:00.000Z"),
    blogPosts: input.blogPosts ?? [],
    sitePages: input.sitePages ?? [],
    settings: input.settings ?? [],
    bookings: input.bookings ?? [],
    contacts: input.contacts ?? [],
    pets: input.pets ?? [],
    petFiles: input.petFiles ?? [],
    petFileContents: input.petFileContents ?? {},
    achievementTypes: input.achievementTypes ?? [],
    clientAchievements: input.clientAchievements ?? [],
    invoices: input.invoices ?? [],
    quotes: input.quotes ?? [],
    contracts: input.contracts ?? [],
    packages: input.packages ?? [],
    credits: input.credits ?? [],
    formSubmissions: input.formSubmissions ?? [],
    portalUsers: input.portalUsers ?? [],
    adminUsers: input.adminUsers ?? [],
    sessions: new Map<string, string>(),
    queuedEmails: input.queuedEmails ?? [],
    queuedJobs: input.queuedJobs ?? [],
    integrationCallbacks: [],
    inboundEmails: [],
    unmatchedEmails: [],
    calendarSyncs: [],
    jobHistory: [],
    processedJobResults: [],
    failedJobResults: [],
    sentEmails: [],
    failedEmailAttempts: [],
    loginEvents: [],
    captchaVerifier: input.captchaVerifier ?? (async () => true),
    availabilityChecker: input.availabilityChecker ?? (async () => true),
    passwordVerifier: input.passwordVerifier ?? (async (password, hash) => password === hash)
  };
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
  const dogName = escapeHtml(achievement.dogName ?? "Achievement Recipient");
  const title = escapeHtml(achievement.title);
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

function createIntegrationCallbackDependencies(state: InMemoryPlatformState): IntegrationCallbackDependencies {
  let sequence = 0;

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    recordIntegrationCallback: async (record) => {
      state.integrationCallbacks.push(record);
    },
    queueJob: async (job) => {
      state.queuedJobs.push(job);
    },
    applyStripeInvoiceUpdate: async ({ invoiceId, paymentStatus, outstandingAmount }) => {
      const index = state.invoices.findIndex((invoice) => invoice.id === invoiceId);
      if (index < 0) {
        return;
      }

      state.invoices[index] = {
        ...state.invoices[index],
        status: paymentStatus,
        outstandingAmount
      };
    },
    applyGoogleCalendarSyncUpdate: async ({ bookingId, externalEventId, externalEventUrl, syncedAt }) => {
      const record = {
        bookingId,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };
      const index = state.calendarSyncs.findIndex((candidate) => (
        candidate.bookingId === bookingId
        && candidate.provider === "google_calendar"
      ));

      if (index >= 0) {
        state.calendarSyncs[index] = record;
        return;
      }

      state.calendarSyncs.push(record);
    }
  };
}

type InMemoryJobProcessorOptions = {
  handlers?: Partial<Record<SupportedJobKind, (job: JobEnvelope) => Promise<string>>>;
  sendEmail?: (message: OutboundEmailMessage) => Promise<void>;
};

function createPublicBookingDependencies(state: InMemoryPlatformState): PublicBookingDependencies {
  let sequence = 0;

  async function ensureClientForBooking(email: string): Promise<{ clientId: string; portalUserId: string | null; displayName: string }> {
    const existing = state.portalUsers.find((user) => user.email === email);
    if (existing != null) {
      return {
        clientId: existing.clientId,
        portalUserId: existing.clientId,
        displayName: existing.displayName
      };
    }

    const clientId = `client-${state.portalUsers.length + 1}`;
    state.portalUsers.push({
      clientId,
      email,
      displayName: email,
      passwordHash: "",
      archived: false
    });

    return {
      clientId,
      portalUserId: null,
      displayName: email
    };
  }

  async function issueIcalToken(input: { bookingId: string; issuedAt: string }): Promise<PublicAccessToken> {
    return {
      token: `ical-${input.bookingId}-token`,
      issuedAt: input.issuedAt,
      expiresAt: null,
      legacySourceId: null
    };
  }

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    verifyCaptcha: state.captchaVerifier,
    isTimeSlotAvailable: state.availabilityChecker,
    ensureClientForBooking,
    issueIcalToken,
    saveBooking: async ({ booking }) => {
      state.bookings.push(booking);
    },
    queueConfirmationEmail: async (message) => {
      state.queuedEmails.push(message);
    },
    queueJob: async (job) => {
      state.queuedJobs.push(job);
    },
    buildPortalReturnUrl: (clientId) => `https://portal.example.test/portal?client=${clientId}`
  };
}

function createPortalLoginDependencies(state: InMemoryPlatformState): PortalLoginDependencies {
  return {
    now: state.now,
    findPortalUserByEmail: async (email) => state.portalUsers.find((user) => user.email === email) ?? null,
    verifyPassword: state.passwordVerifier,
    buildPortalReturnUrl: (_clientId, requestedReturnTo) => requestedReturnTo ?? "https://portal.example.test/portal",
    recordSuccessfulLogin: async (clientId) => {
      state.loginEvents.push(clientId);
    }
  };
}

function createAdminLoginDependencies(state: InMemoryPlatformState): AdminLoginDependencies {
  return {
    now: state.now,
    findAdminUserByUsername: async (username) => {
      const user = state.adminUsers.find((candidate) => candidate.username === username && candidate.active);
      if (user == null) {
        return null;
      }

      return {
        actorId: user.actorId,
        source: "admin_user",
        username: user.username,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: user.role
      };
    },
    findAdminClientByEmail: async (email) => {
      const user = state.portalUsers.find((candidate) => candidate.email === email && !candidate.archived);
      if (user == null) {
        return null;
      }

      return {
        actorId: user.clientId,
        source: "client_admin",
        email: user.email,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        role: "admin"
      };
    },
    verifyPassword: state.passwordVerifier,
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/client/index.php",
    recordSuccessfulLogin: async (identity: AdminIdentity) => {
      state.loginEvents.push(identity.actorId);
    }
  };
}

function createPortalActorProfileDependencies(state: InMemoryPlatformState): PortalActorProfileDependencies {
  return {
    findPortalActorById: async (clientId) => {
      const actor = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      if (actor == null) {
        return null;
      }

      return {
        clientId: actor.clientId,
        email: actor.email,
        displayName: actor.displayName,
        archived: actor.archived
      };
    }
  };
}

function createAdminActorProfileDependencies(state: InMemoryPlatformState): AdminActorProfileDependencies {
  return {
    findAdminActorById: async (actorId) => {
      const adminUser = state.adminUsers.find((candidate) => candidate.actorId === actorId);
      if (adminUser != null) {
        return {
          actorId: adminUser.actorId,
          source: "admin_user",
          username: adminUser.username,
          displayName: adminUser.displayName,
          role: adminUser.role,
          active: adminUser.active
        };
      }

      const clientAdmin = state.portalUsers.find((candidate) => candidate.clientId === actorId && !candidate.archived);
      if (clientAdmin == null) {
        return null;
      }

      return {
        actorId: clientAdmin.clientId,
        source: "client_admin",
        email: clientAdmin.email,
        displayName: clientAdmin.displayName,
        role: "admin",
        active: true
      };
    }
  };
}

function createPortalSummaryDependencies(state: InMemoryPlatformState): PortalSummaryDependencies {
  return {
    listBookingsForPortalActor: async (clientId) => state.bookings.filter((booking) => booking.clientId === clientId),
    listInvoicesForPortalActor: async (clientId) => state.invoices.filter((invoice) => invoice.clientId === clientId && invoice.outstandingAmount > 0),
    listQuotesForPortalActor: async (clientId) => state.quotes.filter((quote) => quote.clientId === clientId && quote.status !== "accepted" && quote.status !== "declined")
  };
}

function createAdminDashboardDependencies(state: InMemoryPlatformState): AdminDashboardDependencies {
  return {
    countPendingBookings: async () => state.bookings.filter((booking) => booking.status === "pending").length,
    countTodaysBookings: async () => state.bookings.filter((booking) => booking.startsAt.slice(0, 10) === state.now().slice(0, 10)).length,
    countOverdueInvoices: async () => state.invoices.filter((invoice) => invoice.status === "overdue").length,
    countActiveClients: async () => state.portalUsers.filter((user) => !user.archived).length,
    listRecentBookings: async () =>
      [...state.bookings]
        .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
        .slice(0, 5)
  };
}

function createAdminOperationsDependencies(state: InMemoryPlatformState): AdminOperationsDependencies {
  function toQueuedJobLog(job: JobEnvelope) {
    return {
      jobId: job.jobId,
      kind: job.kind,
      scheduledFor: job.scheduledFor,
      status: "queued" as const,
      processedAt: null,
      summary: null,
      payload: job.payload
    };
  }

  function toHistoricalJobLog(entry: InMemoryPlatformState["jobHistory"][number]) {
    return {
      jobId: entry.job.jobId,
      kind: entry.job.kind,
      scheduledFor: entry.job.scheduledFor,
      status: entry.status,
      processedAt: entry.processedAt,
      summary: entry.summary,
      payload: entry.job.payload
    };
  }

  return {
    listAdminJobLogs: async () => [
      ...state.queuedJobs.map(toQueuedJobLog),
      ...state.jobHistory.map(toHistoricalJobLog)
    ],
    findAdminJobLogById: async (jobId) => {
      const queued = state.queuedJobs.find((job) => job.jobId === jobId);
      if (queued != null) {
        return toQueuedJobLog(queued);
      }

      const historical = state.jobHistory.find((entry) => entry.job.jobId === jobId);
      return historical == null ? null : toHistoricalJobLog(historical);
    },
    listAdminIntegrationCallbackLogs: async () => state.integrationCallbacks,
    findAdminIntegrationCallbackLogById: async (callbackId) => (
      state.integrationCallbacks.find((record) => record.callbackId === callbackId) ?? null
    )
  };
}

function createContentManagementDependencies(state: InMemoryPlatformState): ContentManagementDependencies {
  let blogSequence = state.blogPosts.length;
  let pageSequence = state.sitePages.length;

  function nextBlogId(): string {
    blogSequence += 1;
    return `blog-${blogSequence}`;
  }

  function nextPageId(): string {
    pageSequence += 1;
    return `page-${pageSequence}`;
  }

  function sortBlogPosts(items: BlogPost[]): BlogPost[] {
    return [...items].sort((left, right) => {
      const leftKey = left.publishDate ?? left.createdAt;
      const rightKey = right.publishDate ?? right.createdAt;
      return rightKey.localeCompare(leftKey);
    });
  }

  function sortSitePages(items: SitePage[]): SitePage[] {
    return [...items].sort((left, right) => (
      left.sortOrder === right.sortOrder
        ? left.title.localeCompare(right.title)
        : left.sortOrder - right.sortOrder
    ));
  }

  function sortSettings(items: Setting[]): Setting[] {
    return [...items].sort((left, right) => {
      const categoryComparison = left.category.localeCompare(right.category);
      return categoryComparison !== 0 ? categoryComparison : left.label.localeCompare(right.label);
    });
  }

  function normalizeBlogPost(id: string, input: Omit<BlogPost, "id" | "createdAt" | "updatedAt">, createdAt: string): BlogPost {
    return {
      id,
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      coverPhoto: input.coverPhoto,
      author: input.author,
      published: input.published,
      publishDate: input.publishDate,
      createdAt,
      updatedAt: state.now()
    };
  }

  function normalizeSitePage(
    id: string,
    adminUserId: string,
    input: Omit<SitePage, "id" | "updatedByAdminUserId" | "createdAt" | "updatedAt">,
    createdAt: string
  ): SitePage {
    return {
      id,
      slug: input.slug,
      title: input.title,
      htmlContent: input.htmlContent,
      cssContent: input.cssContent,
      metaDescription: input.metaDescription,
      metaKeywords: input.metaKeywords,
      ogTitle: input.ogTitle,
      ogDescription: input.ogDescription,
      ogImage: input.ogImage,
      isHomepage: input.isHomepage,
      published: input.published,
      sortOrder: input.sortOrder,
      updatedByAdminUserId: adminUserId,
      createdAt,
      updatedAt: state.now()
    };
  }

  function ensureSingleHomepage(pageId: string): void {
    state.sitePages = state.sitePages.map((page) => (
      page.id === pageId || !page.isHomepage
        ? page
        : { ...page, isHomepage: false, updatedAt: state.now() }
    ));
  }

  return {
    now: state.now,
    listPublicBlogPosts: async () => sortBlogPosts(state.blogPosts.filter((post) => post.published)),
    findPublicBlogPostBySlug: async (slug) => (
      state.blogPosts.find((post) => post.slug === slug && post.published) ?? null
    ),
    findPublicSitePageBySlug: async (slug) => {
      if (slug == null) {
        return state.sitePages.find((page) => page.isHomepage && page.published) ?? null;
      }

      return state.sitePages.find((page) => page.slug === slug && page.published) ?? null;
    },
    listAdminBlogPosts: async () => sortBlogPosts(state.blogPosts),
    findAdminBlogPostById: async (postId) => state.blogPosts.find((post) => post.id === postId) ?? null,
    createAdminBlogPost: async (input) => {
      const createdAt = state.now();
      const item = normalizeBlogPost(nextBlogId(), input, createdAt);
      state.blogPosts.push(item);
      return item;
    },
    updateAdminBlogPost: async (postId, input) => {
      const index = state.blogPosts.findIndex((post) => post.id === postId);
      if (index < 0) {
        return null;
      }

      const current = state.blogPosts[index];
      const updated = normalizeBlogPost(postId, input, current.createdAt);
      state.blogPosts[index] = updated;
      return updated;
    },
    listAdminSitePages: async () => sortSitePages(state.sitePages),
    findAdminSitePageById: async (pageId) => state.sitePages.find((page) => page.id === pageId) ?? null,
    createAdminSitePage: async (adminUserId, input) => {
      const createdAt = state.now();
      const item = normalizeSitePage(nextPageId(), adminUserId, input, createdAt);
      state.sitePages.push(item);
      if (item.isHomepage) {
        ensureSingleHomepage(item.id);
      }
      return item;
    },
    updateAdminSitePage: async (pageId, adminUserId, input) => {
      const index = state.sitePages.findIndex((page) => page.id === pageId);
      if (index < 0) {
        return null;
      }

      const current = state.sitePages[index];
      const updated = normalizeSitePage(pageId, adminUserId, input, current.createdAt);
      state.sitePages[index] = updated;
      if (updated.isHomepage) {
        ensureSingleHomepage(pageId);
      }
      return updated;
    },
    listAdminSettings: async () => sortSettings(state.settings),
    findAdminSettingByKey: async (key) => state.settings.find((setting) => setting.key === key) ?? null,
    updateAdminSetting: async (key, input) => {
      const index = state.settings.findIndex((setting) => setting.key === key);
      if (index < 0) {
        return null;
      }

      const updated: Setting = {
        ...state.settings[index],
        value: input.value,
        updatedAt: state.now()
      };
      state.settings[index] = updated;
      return updated;
    }
  };
}

function createAchievementDependencies(state: InMemoryPlatformState): AchievementDependencies {
  return {
    listPortalAchievements: async (clientId) => state.clientAchievements.filter((achievement) => achievement.clientId === clientId),
    findPortalAchievementById: async (clientId, achievementId) => (
      state.clientAchievements.find((achievement) => achievement.clientId === clientId && achievement.id === achievementId) ?? null
    ),
    listAdminAchievementTypes: async () => state.achievementTypes.filter((item) => item.active),
    findAdminAchievementTypeById: async (achievementTypeId) => (
      state.achievementTypes.find((item) => item.id === achievementTypeId) ?? null
    ),
    listAdminClientAchievements: async (clientId) => state.clientAchievements.filter((achievement) => achievement.clientId === clientId),
    findAdminClientAchievementById: async (clientId, achievementId) => (
      state.clientAchievements.find((achievement) => achievement.clientId === clientId && achievement.id === achievementId) ?? null
    ),
    buildAchievementCertificateHtml: async (achievement, options) => renderAchievementCertificateHtml(achievement, options),
    buildPortalCertificateBackPath: () => "/portal/achievements",
    buildAdminCertificateBackPath: (clientId) => `/client/client_achievements.php?client_id=${encodeURIComponent(clientId)}`
  };
}

function toClientRecord(user: InMemoryPortalUser) {
  const [firstName, ...rest] = user.displayName.trim().split(/\s+/);
  return {
    id: user.clientId,
    email: user.email,
    firstName: firstName || user.displayName,
    lastName: rest.join(" ") || firstName || user.displayName,
    archived: user.archived
  };
}

function toClientProfile(user: InMemoryPortalUser): ClientProfile {
  return {
    id: user.clientId,
    name: user.displayName,
    email: user.email,
    phone: user.phone ?? "",
    address: user.address ?? "",
    notes: user.notes ?? "",
    isAdmin: user.isAdmin ?? false,
    archived: user.archived
  };
}

function createClientProfileDependencies(state: InMemoryPlatformState): ClientProfileDependencies {
  async function isClientEmailInUse(email: string, excludeClientId: string | null): Promise<boolean> {
    return state.portalUsers.some((user) => user.email === email && user.clientId !== excludeClientId);
  }

  let sequence = state.portalUsers.length;

  return {
    findPortalProfile: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientProfile(user);
    },
    verifyPortalCurrentPassword: async (clientId, currentPassword) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      if (user == null) {
        return false;
      }

      return state.passwordVerifier(currentPassword, user.passwordHash);
    },
    updatePortalProfile: async (clientId, input) => {
      const index = state.portalUsers.findIndex((candidate) => candidate.clientId === clientId);
      if (index < 0) {
        return null;
      }

      const current = state.portalUsers[index];
      const updated: InMemoryPortalUser = {
        ...current,
        displayName: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        passwordHash: input.newPassword ?? current.passwordHash
      };
      state.portalUsers[index] = updated;
      return toClientProfile(updated);
    },
    findAdminClientProfile: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientProfile(user);
    },
    createAdminClientProfile: async (input) => {
      sequence += 1;
      const user: InMemoryPortalUser = {
        clientId: `client-${sequence}`,
        email: input.email,
        displayName: input.name,
        passwordHash: "",
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        isAdmin: input.isAdmin,
        archived: false
      };
      state.portalUsers.push(user);
      return toClientProfile(user);
    },
    updateAdminClientProfile: async (clientId, input) => {
      const index = state.portalUsers.findIndex((candidate) => candidate.clientId === clientId);
      if (index < 0) {
        return null;
      }

      const updated: InMemoryPortalUser = {
        ...state.portalUsers[index],
        displayName: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
        isAdmin: input.isAdmin
      };
      state.portalUsers[index] = updated;
      return toClientProfile(updated);
    },
    isClientEmailInUse
  };
}

function createContactManagementDependencies(state: InMemoryPlatformState): ContactManagementDependencies {
  let sequence = state.contacts.length;

  function nextId(): string {
    sequence += 1;
    return `contact-${sequence}`;
  }

  function normalizeContact(
    clientId: string,
    input: { name: string; email: string; phone: string; isPrimary: boolean },
    id: string
  ): ClientContact {
    return {
      id,
      clientId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      isPrimary: input.isPrimary
    };
  }

  function clearPrimary(clientId: string, exceptId: string | null = null): void {
    for (let index = 0; index < state.contacts.length; index += 1) {
      const contact = state.contacts[index];
      if (contact?.clientId !== clientId) {
        continue;
      }
      if (exceptId != null && contact.id === exceptId) {
        continue;
      }
      if (contact.isPrimary) {
        state.contacts[index] = {
          ...contact,
          isPrimary: false
        };
      }
    }
  }

  return {
    listPortalContacts: async (clientId) => state.contacts
      .filter((contact) => contact.clientId === clientId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name)),
    findPortalContactById: async (clientId, contactId) => state.contacts
      .find((contact) => contact.clientId === clientId && contact.id === contactId) ?? null,
    createPortalContact: async (clientId, input) => {
      if (input.isPrimary) {
        clearPrimary(clientId);
      }
      const contact = normalizeContact(clientId, input, nextId());
      state.contacts.push(contact);
      return contact;
    },
    updatePortalContact: async (clientId, contactId, input) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return null;
      }
      if (input.isPrimary) {
        clearPrimary(clientId, contactId);
      }
      const updated = normalizeContact(clientId, input, contactId);
      state.contacts[index] = updated;
      return updated;
    },
    deletePortalContact: async (clientId, contactId) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return false;
      }
      state.contacts.splice(index, 1);
      return true;
    },
    listAdminClientContacts: async (clientId) => state.contacts
      .filter((contact) => contact.clientId === clientId)
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name)),
    findAdminClientContactById: async (clientId, contactId) => state.contacts
      .find((contact) => contact.clientId === clientId && contact.id === contactId) ?? null,
    createAdminClientContact: async (clientId, input) => {
      if (input.isPrimary) {
        clearPrimary(clientId);
      }
      const contact = normalizeContact(clientId, input, nextId());
      state.contacts.push(contact);
      return contact;
    },
    updateAdminClientContact: async (clientId, contactId, input) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return null;
      }
      if (input.isPrimary) {
        clearPrimary(clientId, contactId);
      }
      const updated = normalizeContact(clientId, input, contactId);
      state.contacts[index] = updated;
      return updated;
    },
    deleteAdminClientContact: async (clientId, contactId) => {
      const index = state.contacts.findIndex((contact) => contact.clientId === clientId && contact.id === contactId);
      if (index < 0) {
        return false;
      }
      state.contacts.splice(index, 1);
      return true;
    }
  };
}

function createPetFileManagementDependencies(state: InMemoryPlatformState): PetFileManagementDependencies {
  let idSequence = state.petFiles.length;
  let fileSequence = state.petFiles.length;

  function nextId(): string {
    idSequence += 1;
    return `pet-file-${idSequence}`;
  }

  function nextStoredFileName(petId: string, fileExtension: string): string {
    fileSequence += 1;
    return `pet_${petId}_${fileSequence}.${fileExtension}`;
  }

  return {
    now: state.now,
    createPortalPetFile: async (clientId, petId, input) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return null;
      }

      const item: PetFile = {
        id: nextId(),
        petId,
        fileType: input.fileType,
        fileName: nextStoredFileName(petId, input.fileExtension),
        originalName: input.originalName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        description: input.description,
        uploadedByAdminUserId: null,
        uploadedAt: input.uploadedAt
      };

      state.petFiles.push(item);
      state.petFileContents[item.id] = input.content;
      return item;
    },
    createAdminPetFile: async (petId, input) => {
      if (!state.pets.some((pet) => pet.id === petId)) {
        return null;
      }

      const item: PetFile = {
        id: nextId(),
        petId,
        fileType: input.fileType,
        fileName: nextStoredFileName(petId, input.fileExtension),
        originalName: input.originalName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        description: input.description,
        uploadedByAdminUserId: input.uploadedByAdminUserId,
        uploadedAt: input.uploadedAt
      };

      state.petFiles.push(item);
      state.petFileContents[item.id] = input.content;
      return item;
    }
  };
}

function createPortalResourceReadDependencies(state: InMemoryPlatformState): PortalResourceReadDependencies {
  function toBase64Content(content: string | Uint8Array): string {
    return Buffer.from(content).toString("base64");
  }

  function portalPackageIds(clientId: string): Set<string> {
    return new Set(
      state.credits
        .filter((credit) => credit.clientId === clientId && credit.packageId != null)
        .map((credit) => credit.packageId as string)
    );
  }

  return {
    listPortalBookings: async (clientId) => state.bookings.filter((booking) => booking.clientId === clientId),
    findPortalBookingById: async (clientId, bookingId) => state.bookings.find((booking) => booking.clientId === clientId && booking.id === bookingId) ?? null,
    listPortalPets: async (clientId) => state.pets.filter((pet) => pet.clientId === clientId),
    findPortalPetById: async (clientId, petId) => state.pets.find((pet) => pet.clientId === clientId && pet.id === petId) ?? null,
    listPortalPetFiles: async (clientId, petId) => (
      state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)
        ? state.petFiles.filter((file) => file.petId === petId)
        : []
    ),
    findPortalPetFileById: async (clientId, petId, fileId) => (
      state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)
        ? state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null
        : null
    ),
    loadPortalPetFileContent: async (clientId, petId, fileId, download) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return null;
      }

      const item = state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null;
      if (item == null) {
        return null;
      }

      const content = state.petFileContents[fileId];
      if (content == null) {
        return null;
      }

      return {
        item,
        fileName: item.originalName,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: toBase64Content(content)
      };
    },
    deletePortalPetFile: async (clientId, petId, fileId) => {
      if (!state.pets.some((pet) => pet.clientId === clientId && pet.id === petId)) {
        return false;
      }

      const next = state.petFiles.filter((file) => !(file.petId === petId && file.id === fileId));
      if (next.length === state.petFiles.length) {
        return false;
      }

      state.petFiles = next;
      delete state.petFileContents[fileId];
      return true;
    },
    listPortalInvoices: async (clientId) => state.invoices.filter((invoice) => invoice.clientId === clientId),
    findPortalInvoiceById: async (clientId, invoiceId) => state.invoices.find((invoice) => invoice.clientId === clientId && invoice.id === invoiceId) ?? null,
    listPortalQuotes: async (clientId) => state.quotes.filter((quote) => quote.clientId === clientId),
    findPortalQuoteById: async (clientId, quoteId) => state.quotes.find((quote) => quote.clientId === clientId && quote.id === quoteId) ?? null,
    listPortalContracts: async (clientId) => state.contracts.filter((contract) => contract.clientId === clientId),
    findPortalContractById: async (clientId, contractId) => state.contracts.find((contract) => contract.clientId === clientId && contract.id === contractId) ?? null,
    listPortalForms: async (clientId) => state.formSubmissions.filter((submission) => submission.clientId === clientId),
    findPortalFormById: async (clientId, formId) => state.formSubmissions.find((submission) => submission.clientId === clientId && submission.id === formId) ?? null,
    listPortalPackages: async (clientId) => {
      const packageIds = portalPackageIds(clientId);
      return state.packages.filter((item) => packageIds.has(item.id));
    },
    findPortalPackageById: async (clientId, packageId) => {
      const packageIds = portalPackageIds(clientId);
      return packageIds.has(packageId) ? state.packages.find((item) => item.id === packageId) ?? null : null;
    },
    listPortalCredits: async (clientId) => state.credits.filter((credit) => credit.clientId === clientId),
    findPortalCreditById: async (clientId, creditId) => state.credits.find((credit) => credit.clientId === clientId && credit.id === creditId) ?? null
  };
}

function createAdminResourceReadDependencies(state: InMemoryPlatformState): AdminResourceReadDependencies {
  function toBase64Content(content: string | Uint8Array): string {
    return Buffer.from(content).toString("base64");
  }

  return {
    listAdminClients: async () => state.portalUsers.map(toClientRecord),
    findAdminClientById: async (clientId) => {
      const user = state.portalUsers.find((candidate) => candidate.clientId === clientId) ?? null;
      return user == null ? null : toClientRecord(user);
    },
    listAdminPets: async () => state.pets,
    findAdminPetById: async (petId) => state.pets.find((pet) => pet.id === petId) ?? null,
    listAdminPetFiles: async (petId) => state.petFiles.filter((file) => file.petId === petId),
    findAdminPetFileById: async (petId, fileId) => state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null,
    loadAdminPetFileContent: async (petId, fileId, download) => {
      const item = state.petFiles.find((file) => file.petId === petId && file.id === fileId) ?? null;
      if (item == null) {
        return null;
      }

      const content = state.petFileContents[fileId];
      if (content == null) {
        return null;
      }

      return {
        item,
        fileName: item.originalName,
        disposition: download ? "attachment" as const : "inline" as const,
        contentBase64: toBase64Content(content)
      };
    },
    deleteAdminPetFile: async (petId, fileId) => {
      const next = state.petFiles.filter((file) => !(file.petId === petId && file.id === fileId));
      if (next.length === state.petFiles.length) {
        return false;
      }

      state.petFiles = next;
      delete state.petFileContents[fileId];
      return true;
    },
    listAdminBookings: async () => state.bookings,
    findAdminBookingById: async (bookingId) => state.bookings.find((booking) => booking.id === bookingId) ?? null,
    listAdminInvoices: async () => state.invoices,
    findAdminInvoiceById: async (invoiceId) => state.invoices.find((invoice) => invoice.id === invoiceId) ?? null,
    listAdminQuotes: async () => state.quotes,
    findAdminQuoteById: async (quoteId) => state.quotes.find((quote) => quote.id === quoteId) ?? null,
    listAdminContracts: async () => state.contracts,
    findAdminContractById: async (contractId) => state.contracts.find((contract) => contract.id === contractId) ?? null,
    listAdminForms: async () => state.formSubmissions,
    findAdminFormById: async (formId) => state.formSubmissions.find((submission) => submission.id === formId) ?? null,
    listAdminPackages: async () => state.packages,
    findAdminPackageById: async (packageId) => state.packages.find((item) => item.id === packageId) ?? null,
    listAdminCredits: async () => state.credits,
    findAdminCreditById: async (creditId) => state.credits.find((item) => item.id === creditId) ?? null
  };
}

function createPortalCommerceDependencies(state: InMemoryPlatformState): PortalCommerceDependencies {
  return {
    acceptPortalQuote: async (clientId, quoteId) => {
      const index = state.quotes.findIndex((quote) => quote.clientId === clientId && quote.id === quoteId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.quotes[index],
        status: "accepted" as const
      };
      state.quotes[index] = updated;
      return updated;
    },
    signPortalContract: async (clientId, contractId) => {
      const index = state.contracts.findIndex((contract) => contract.clientId === clientId && contract.id === contractId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.contracts[index],
        status: "signed" as const
      };
      state.contracts[index] = updated;
      return updated;
    },
    submitPortalForm: async (clientId, formId) => {
      const index = state.formSubmissions.findIndex((submission) => submission.clientId === clientId && submission.id === formId);
      if (index < 0) {
        return null;
      }

      const updated = {
        ...state.formSubmissions[index],
        submittedAt: state.now()
      };
      state.formSubmissions[index] = updated;
      return updated;
    },
    createInvoicePaymentSession: async (clientId, invoiceId, input) => {
      const invoice = state.invoices.find((candidate) => candidate.clientId === clientId && candidate.id === invoiceId) ?? null;
      if (invoice == null) {
        return null;
      }

      return {
        invoice,
        paymentSession: {
          provider: "stripe" as const,
          checkoutUrl: `${input.returnUrl}?invoice=${encodeURIComponent(invoiceId)}`,
          expiresAt: new Date(Date.parse(state.now()) + 60 * 60 * 1000).toISOString()
        }
      };
    }
  };
}

function buildGoogleCalendarUrl(booking: Booking): string {
  const startsAt = booking.startsAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const endsAt = booking.endsAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `BDTA Booking - ${booking.serviceId}`,
    dates: `${startsAt}/${endsAt}`,
    details: "Brook's Dog Training Academy booking"
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function createAdminCalendarSyncDependencies(state: InMemoryPlatformState): AdminCalendarSyncDependencies {
  return {
    async syncAdminBookingCalendar(bookingId) {
      const booking = state.bookings.find((candidate) => candidate.id === bookingId) ?? null;
      if (booking == null) {
        return null;
      }

      const syncedAt = state.now();
      const externalEventId = `google-calendar-${booking.id}-${syncedAt.slice(0, 10)}`;
      const externalEventUrl = buildGoogleCalendarUrl(booking);
      const existingIndex = state.calendarSyncs.findIndex((record) => record.bookingId === booking.id && record.provider === "google_calendar");
      const record = {
        bookingId: booking.id,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };

      if (existingIndex >= 0) {
        state.calendarSyncs[existingIndex] = record;
      } else {
        state.calendarSyncs.push(record);
      }

      return {
        booking,
        provider: "google_calendar" as const,
        externalEventId,
        externalEventUrl,
        syncedAt
      };
    },
    async getAdminBookingCalendarSync(bookingId) {
      const booking = state.bookings.find((candidate) => candidate.id === bookingId) ?? null;
      const record = state.calendarSyncs.find((candidate) => (
        candidate.bookingId === bookingId
        && candidate.provider === "google_calendar"
      )) ?? null;

      if (booking == null || record == null) {
        return null;
      }

      return {
        booking,
        provider: "google_calendar" as const,
        externalEventId: record.externalEventId,
        externalEventUrl: record.externalEventUrl,
        syncedAt: record.syncedAt
      };
    }
  };
}

function createPublicDocumentAccessDependencies(state: InMemoryPlatformState): PublicDocumentAccessDependencies {
  return {
    now: state.now,
    findPublicQuoteById: async (quoteId) => state.quotes.find((quote) => quote.id === quoteId) ?? null,
    findPublicContractById: async (contractId) => state.contracts.find((contract) => contract.id === contractId) ?? null,
    findPublicFormSubmissionById: async (submissionId) => state.formSubmissions.find((submission) => submission.id === submissionId) ?? null,
    findPublicBookingIcalById: async (bookingId) => state.bookings.find((booking) => booking.id === bookingId) ?? null
  };
}

export function createInMemoryApiDependencies(state: InMemoryPlatformState): ApiDependencies {
  return {
    publicBooking: createPublicBookingDependencies(state),
    integrationCallbacks: createIntegrationCallbackDependencies(state),
    portalLogin: createPortalLoginDependencies(state),
    adminLogin: createAdminLoginDependencies(state),
    portalActorProfile: createPortalActorProfileDependencies(state),
    adminActorProfile: createAdminActorProfileDependencies(state),
    clientProfiles: createClientProfileDependencies(state),
    portalSummary: createPortalSummaryDependencies(state),
    adminDashboard: createAdminDashboardDependencies(state),
    adminOperations: createAdminOperationsDependencies(state),
    content: createContentManagementDependencies(state),
    achievements: createAchievementDependencies(state),
    portalResources: createPortalResourceReadDependencies(state),
    adminResources: createAdminResourceReadDependencies(state),
    petFiles: createPetFileManagementDependencies(state),
    contacts: createContactManagementDependencies(state),
    adminCalendarSync: createAdminCalendarSyncDependencies(state),
    portalCommerce: createPortalCommerceDependencies(state),
    publicDocuments: createPublicDocumentAccessDependencies(state)
  };
}

export function createInMemoryJobProcessorDependencies(
  state: InMemoryPlatformState,
  options: InMemoryJobProcessorOptions = {}
): BackgroundProcessorDependencies {
  let emailSequence = 0;
  const claimedEmails = new Map<string, OutboundEmailMessage>();
  const claimedJobs = new Map<string, JobEnvelope>();

  return {
    now: state.now,
    async claimDueJobs(limit) {
      const dueJobs = state.queuedJobs
        .filter((job) => job.scheduledFor <= state.now())
        .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))
        .slice(0, limit);

      const claimedIds = new Set(dueJobs.map((job) => job.jobId));
      state.queuedJobs = state.queuedJobs.filter((job) => !claimedIds.has(job.jobId));
      for (const job of dueJobs) {
        claimedJobs.set(job.jobId, job);
      }
      return dueJobs;
    },
    async completeJob(result) {
      state.processedJobResults.push(result);
      const job = claimedJobs.get(result.jobId);
      if (job != null) {
        state.jobHistory.push({
          job,
          status: "processed",
          processedAt: result.processedAt,
          summary: result.summary
        });
        claimedJobs.delete(result.jobId);
      }
    },
    async failJob(result) {
      state.failedJobResults.push(result);
      const job = claimedJobs.get(result.jobId);
      if (job != null) {
        state.jobHistory.push({
          job,
          status: "failed",
          processedAt: result.processedAt,
          summary: result.summary
        });
        claimedJobs.delete(result.jobId);
      }
    },
    async claimQueuedEmails(limit) {
      const claimed = state.queuedEmails.splice(0, limit);
      return claimed.map((message) => {
        const emailId = `email-${++emailSequence}`;
        claimedEmails.set(emailId, message);
        return {
          emailId,
          message
        };
      });
    },
    async sendEmail(message) {
      if (options.sendEmail != null) {
        await options.sendEmail(message);
      }
    },
    async markEmailSent(emailId) {
      const message = claimedEmails.get(emailId);
      if (message != null) {
        state.sentEmails.push(message);
        claimedEmails.delete(emailId);
      }
    },
    async markEmailFailed(emailId, reason) {
      const message = claimedEmails.get(emailId);
      if (message != null) {
        state.failedEmailAttempts.push({ message, reason });
        claimedEmails.delete(emailId);
      }
    },
    handlers: options.handlers ?? {}
  };
}

export function createInMemoryInboundEmailProcessingDependencies(
  state: InMemoryPlatformState,
  overrides: Partial<InboundEmailProcessingDependencies> = {}
): InboundEmailProcessingDependencies {
  let sequence = 0;

  return {
    now: state.now,
    generateId: (prefix) => `${prefix}-${++sequence}`,
    saveInboundEmail: async (record) => {
      state.inboundEmails.push(record);
    },
    findPortalUsersByEmail: async (email) => state.portalUsers
      .filter((user) => user.email === email && !user.archived)
      .map((user) => ({
        id: user.clientId,
        email: user.email
      })),
    recordUnmatchedEmail: async (record) => {
      state.unmatchedEmails.push(record);
    },
    ...overrides
  };
}

export function createInMemorySessionStore(state: InMemoryPlatformState) {
  return {
    async save(sessionId: string, sessionData: string): Promise<void> {
      state.sessions.set(sessionId, sessionData);
    },
    async load(sessionId: string): Promise<string | null> {
      return state.sessions.get(sessionId) ?? null;
    },
    async delete(sessionId: string): Promise<void> {
      state.sessions.delete(sessionId);
    },
    async purgeExpired(): Promise<void> {
      return;
    }
  };
}
