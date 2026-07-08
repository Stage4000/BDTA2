import {
  type AdminCalendarSyncDependencies,
  type PortalCommerceDependencies,
  type PublicDocumentAccessDependencies,
  type AdminDashboardDependencies,
  type AdminOperationsDependencies,
  type AchievementDependencies,
  type AdminResourceReadDependencies,
  type ClientProfileDependencies,
  type ContentManagementDependencies,
  type ContactManagementDependencies,
  createApiHandlers,
  type AdminActorProfileDependencies,
  type IntegrationCallbackDependencies,
  type AdminLoginDependencies,
  type ApiDependencies,
  type PetFileManagementDependencies,
  type PortalResourceReadDependencies,
  type PortalSummaryDependencies,
  type PortalActorProfileDependencies,
  type PortalLoginDependencies,
  type PublicContactDependencies,
  type PublicBookingDependencies,
  type WorkflowManagementDependencies
} from "@bdta/application";

function createPublicBookingDependencies(overrides: Partial<PublicBookingDependencies> = {}): PublicBookingDependencies {
  let sequence = 0;

  return {
    now: () => "2026-05-27T18:00:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
    verifyCaptcha: async () => true,
    isTimeSlotAvailable: async () => true,
    ensureClientForBooking: async () => ({ clientId: "client-1", portalUserId: "portal-1", displayName: "Client One" }),
    issueIcalToken: async ({ bookingId, issuedAt }) => ({
      token: `ical-${bookingId}-token`,
      issuedAt,
      expiresAt: null,
      legacySourceId: null
    }),
    saveBooking: async () => undefined,
    queueConfirmationEmail: async () => undefined,
    queueJob: async () => undefined,
    buildPortalReturnUrl: (clientId) => `https://portal.example.test/portal?client=${clientId}`,
    ...overrides
  };
}

function createPublicContactDependencies(overrides: Partial<PublicContactDependencies> = {}): PublicContactDependencies {
  const clients = [{
    clientId: "client-1",
    notes: "Existing note"
  }];
  let sequence = clients.length;

  return {
    now: () => "2026-05-27T18:00:00.000Z",
    verifyCaptcha: async () => true,
    findLatestClientByEmail: async (email) => email.trim().toLowerCase() === "client@example.com"
      ? clients[0] ?? null
      : null,
    updateClientNotes: async (clientId, notes) => {
      const index = clients.findIndex((client) => client.clientId === clientId);
      if (index >= 0) {
        clients[index] = {
          ...clients[index],
          notes
        };
      }
    },
    createClientLead: async () => ({
      clientId: `client-${++sequence}`
    }),
    ...overrides
  };
}

function createIntegrationCallbackDependencies(
  overrides: Partial<IntegrationCallbackDependencies> = {}
): IntegrationCallbackDependencies {
  let sequence = 0;

  return {
    now: () => "2026-05-27T18:00:00.000Z",
    generateId: (prefix) => `${prefix}-${++sequence}`,
    recordIntegrationCallback: async () => undefined,
    queueJob: async () => undefined,
    applyStripeInvoiceUpdate: async () => undefined,
    applyGoogleCalendarSyncUpdate: async () => undefined,
    ...overrides
  };
}

function createPortalDependencies(overrides: Partial<PortalLoginDependencies> = {}): PortalLoginDependencies {
  return {
    now: () => "2026-05-27T18:00:00.000Z",
    findPortalUserByEmail: async (email) =>
      email === "client@example.com"
        ? {
            clientId: "client-1",
            email,
            displayName: "Client One",
            passwordHash: "hash-1",
            archived: false
          }
        : null,
    verifyPassword: async (password, hash) => password === "correct-password" && hash === "hash-1",
    buildPortalReturnUrl: (_clientId, requestedReturnTo) => requestedReturnTo ?? "https://portal.example.test/portal",
    recordSuccessfulLogin: async () => undefined,
    ...overrides
  };
}

function createAdminDependencies(overrides: Partial<AdminLoginDependencies> = {}): AdminLoginDependencies {
  return {
    now: () => "2026-05-27T18:00:00.000Z",
    findAdminUserByUsername: async (username) =>
      username === "accountant"
        ? {
            actorId: "admin-1",
            source: "admin_user",
            username: "accountant",
            displayName: "Accountant User",
            passwordHash: "admin-hash",
            role: "accountant"
          }
        : null,
    findAdminClientByEmail: async (email) =>
      email === "owner@example.com"
        ? {
            actorId: "client-admin-1",
            source: "client_admin",
            email,
            displayName: "Owner Client",
            passwordHash: "client-hash",
            role: "admin"
          }
        : null,
    verifyPassword: async (password, hash) => (
      (password === "correct-password" && hash === "admin-hash")
      || (password === "client-password" && hash === "client-hash")
    ),
    buildAdminRedirectPath: (role) => role === "accountant" ? "/client/invoices_list.php" : "/client/index.php",
    recordSuccessfulLogin: async () => undefined,
    ...overrides
  };
}

function createPortalActorProfileDependencies(overrides: Partial<PortalActorProfileDependencies> = {}): PortalActorProfileDependencies {
  return {
    findPortalActorById: async (clientId) =>
      clientId === "client-1"
        ? {
            clientId: "client-1",
            email: "client@example.com",
            displayName: "Client One",
            archived: false
          }
        : null,
    ...overrides
  };
}

function createAdminActorProfileDependencies(overrides: Partial<AdminActorProfileDependencies> = {}): AdminActorProfileDependencies {
  return {
    findAdminActorById: async (actorId) =>
      actorId === "admin-1"
        ? {
            actorId: "admin-1",
            source: "admin_user",
            username: "accountant",
            displayName: "Accountant User",
            role: "accountant",
            active: true
          }
        : null,
    ...overrides
  };
}

function createPortalSummaryDependencies(overrides: Partial<PortalSummaryDependencies> = {}): PortalSummaryDependencies {
  return {
    listBookingsForPortalActor: async (clientId) => clientId === "client-1"
      ? [{
          id: "booking-1",
          clientId: "client-1",
          petIds: ["pet-1"],
          serviceId: "svc-private-lesson",
          startsAt: "2026-06-01T16:00:00.000Z",
          endsAt: "2026-06-01T17:00:00.000Z",
          status: "confirmed",
          icalAccess: null
        }]
      : [],
    listInvoicesForPortalActor: async (clientId) => clientId === "client-1"
      ? [{
          id: "invoice-1",
          clientId: "client-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        }]
      : [],
    listQuotesForPortalActor: async (clientId) => clientId === "client-1"
      ? [{
          id: "quote-1",
          clientId: "client-1",
          status: "sent",
          totalAmount: 450,
          publicAccess: null
        }]
      : [],
    ...overrides
  };
}

function createClientProfileDependencies(
  overrides: Partial<ClientProfileDependencies> = {}
): ClientProfileDependencies {
  return {
    findPortalProfile: async (clientId) => clientId === "client-1" ? {
      id: "client-1",
      name: "Client One",
      email: "client@example.com",
      phone: "555-0100",
      address: "123 Main St",
      notes: "",
      isAdmin: false,
      archived: false
    } : null,
    verifyPortalCurrentPassword: async (clientId, currentPassword) => clientId === "client-1" && currentPassword === "correct-password",
    updatePortalProfile: async (clientId, input) => clientId === "client-1" ? {
      id: "client-1",
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      notes: "",
      isAdmin: false,
      archived: false
    } : null,
    findAdminClientProfile: async (clientId) => clientId === "client-1" ? {
      id: "client-1",
      name: "Client One",
      email: "client@example.com",
      phone: "555-0100",
      address: "123 Main St",
      notes: "Needs follow-up",
      isAdmin: false,
      archived: false
    } : null,
    createAdminClientProfile: async (input) => ({
      id: "client-2",
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      isAdmin: input.isAdmin,
      archived: false
    }),
    updateAdminClientProfile: async (clientId, input) => clientId === "client-1" ? {
      id: "client-1",
      name: input.name,
      email: input.email,
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      isAdmin: input.isAdmin,
      archived: false
    } : null,
    isClientEmailInUse: async (email, excludeClientId) => email === "taken@example.com" && excludeClientId !== "taken-client",
    ...overrides
  };
}

function createAdminDashboardDependencies(overrides: Partial<AdminDashboardDependencies> = {}): AdminDashboardDependencies {
  return {
    countPendingBookings: async () => 4,
    countTodaysBookings: async () => 6,
    countOverdueInvoices: async () => 2,
    countActiveClients: async () => 38,
    listRecentBookings: async () => [{
      id: "booking-2",
      clientId: "client-2",
      petIds: ["pet-9"],
      serviceId: "svc-board-train",
      startsAt: "2026-05-28T17:00:00.000Z",
      endsAt: "2026-05-28T18:00:00.000Z",
      status: "pending",
      icalAccess: null
    }],
    ...overrides
  };
}

function createAdminOperationsDependencies(
  overrides: Partial<AdminOperationsDependencies> = {}
): AdminOperationsDependencies {
  return {
    listAdminJobLogs: async () => [{
      jobId: "job-1",
      kind: "workflow_processor",
      scheduledFor: "2026-05-27T17:30:00.000Z",
      status: "processed",
      processedAt: "2026-05-27T18:00:00.000Z",
      summary: "Processed 1 workflow enrollment.",
      payload: {
        limit: 10
      }
    }],
    findAdminJobLogById: async (jobId) => jobId === "job-1" ? {
      jobId: "job-1",
      kind: "workflow_processor",
      scheduledFor: "2026-05-27T17:30:00.000Z",
      status: "processed",
      processedAt: "2026-05-27T18:00:00.000Z",
      summary: "Processed 1 workflow enrollment.",
      payload: {
        limit: 10
      }
    } : null,
    listAdminIntegrationCallbackLogs: async () => [{
      callbackId: "callback-1",
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      queuedJobId: "job-email-1",
      payload: {
        messageId: "imap-message-1",
        from: "owner@example.com",
        subject: "Need help with my booking"
      }
    }],
    findAdminIntegrationCallbackLogById: async (callbackId) => callbackId === "callback-1" ? {
      callbackId: "callback-1",
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      queuedJobId: "job-email-1",
      payload: {
        messageId: "imap-message-1",
        from: "owner@example.com",
        subject: "Need help with my booking"
      }
    } : null,
    ...overrides
  };
}

function createContentManagementDependencies(
  overrides: Partial<ContentManagementDependencies> = {}
): ContentManagementDependencies {
  return {
    now: () => "2026-05-27T18:00:00.000Z",
    listPublicBlogPosts: async () => [{
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
    }],
    findPublicBlogPostBySlug: async (slug) => slug === "loose-leash-training-tips" ? {
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
    } : null,
    findPublicSitePageBySlug: async (slug) => slug == null || slug === "services" ? {
      id: slug === "services" ? "page-services" : "page-home",
      slug: slug ?? "home",
      title: slug === "services" ? "Services" : "Brook's Dog Training Academy",
      htmlContent: slug === "services"
        ? "<section><h1>Programs</h1></section>"
        : "<section><h1>Train the dog in front of you.</h1></section>",
      cssContent: "",
      metaDescription: "Public page",
      metaKeywords: "",
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      isHomepage: slug == null,
      published: true,
      sortOrder: slug === "services" ? 2 : 1,
      updatedByAdminUserId: "admin-1",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-28T12:00:00.000Z"
    } : null,
    listAdminBlogPosts: async () => [{
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
    }],
    findAdminBlogPostById: async (postId) => postId === "blog-1" ? {
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
    } : null,
    createAdminBlogPost: async (input) => ({
      id: "blog-2",
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      coverPhoto: input.coverPhoto,
      author: input.author,
      published: input.published,
      publishDate: input.publishDate,
      createdAt: "2026-05-27T18:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    }),
    updateAdminBlogPost: async (postId, input) => postId === "blog-1" ? {
      id: "blog-1",
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      coverPhoto: input.coverPhoto,
      author: input.author,
      published: input.published,
      publishDate: input.publishDate,
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    } : null,
    deleteAdminBlogPost: async (postId) => postId === "blog-1",
    listAdminSitePages: async () => [{
      id: "page-home",
      slug: "home",
      title: "Brook's Dog Training Academy",
      htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
      cssContent: "",
      metaDescription: "Public page",
      metaKeywords: "",
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      isHomepage: true,
      published: true,
      sortOrder: 1,
      updatedByAdminUserId: "admin-1",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-28T12:00:00.000Z"
    }],
    findAdminSitePageById: async (pageId) => pageId === "page-home" ? {
      id: "page-home",
      slug: "home",
      title: "Brook's Dog Training Academy",
      htmlContent: "<section><h1>Train the dog in front of you.</h1></section>",
      cssContent: "",
      metaDescription: "Public page",
      metaKeywords: "",
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      isHomepage: true,
      published: true,
      sortOrder: 1,
      updatedByAdminUserId: "admin-1",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-28T12:00:00.000Z"
    } : null,
    createAdminSitePage: async (adminUserId, input) => ({
      id: "page-2",
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
      createdAt: "2026-05-27T18:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    }),
    updateAdminSitePage: async (pageId, adminUserId, input) => pageId === "page-home" ? {
      id: "page-home",
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
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    } : null,
    deleteAdminSitePage: async () => true,
    listAdminSettings: async () => [{
      id: "setting-1",
      key: "turnstile_site_key",
      value: "site-key-1",
      type: "text",
      category: "advanced",
      label: "Turnstile Site Key",
      description: "Used on public booking forms.",
      secret: false,
      updatedAt: "2026-05-28T12:00:00.000Z"
    }],
    findAdminSettingByKey: async (key) => key === "turnstile_site_key" ? {
      id: "setting-1",
      key: "turnstile_site_key",
      value: "site-key-1",
      type: "text",
      category: "advanced",
      label: "Turnstile Site Key",
      description: "Used on public booking forms.",
      secret: false,
      updatedAt: "2026-05-28T12:00:00.000Z"
    } : null,
    updateAdminSetting: async (key, input) => key === "turnstile_site_key" ? {
      id: "setting-1",
      key: "turnstile_site_key",
      value: input.value,
      type: "text",
      category: "advanced",
      label: "Turnstile Site Key",
      description: "Used on public booking forms.",
      secret: false,
      updatedAt: "2026-05-27T18:00:00.000Z"
    } : null,
    findAdminSettingsUserByActorId: async (actorId) => actorId === "admin-1" ? {
      actorId: "admin-1",
      username: "owner",
      email: "owner@example.com",
      accountType: "main",
      role: "owner",
      isMainAccount: true,
      canManageAdminUsers: true,
      canManageApiKeys: true,
      active: true
    } : null,
    listAdminSettingsUsers: async () => [{
      actorId: "admin-1",
      username: "owner",
      email: "owner@example.com",
      accountType: "main",
      role: "owner",
      isMainAccount: true,
      canManageAdminUsers: true,
      canManageApiKeys: true,
      active: true
    }],
    findAdminSettingsUserByUsername: async () => null,
    createAdminSettingsUser: async (input) => ({
      actorId: "admin-2",
      username: input.username,
      email: input.email,
      accountType: input.accountType,
      role: input.accountType === "accountant" ? "accountant" : "admin",
      isMainAccount: false,
      canManageAdminUsers: false,
      canManageApiKeys: false,
      active: true
    }),
    updateAdminSettingsUserPermissions: async (actorId, input) => actorId === "admin-2" ? {
      actorId: "admin-2",
      username: "new-admin",
      email: "new-admin@example.com",
      accountType: "standard",
      role: "admin",
      isMainAccount: false,
      canManageAdminUsers: input.canManageAdminUsers,
      canManageApiKeys: input.canManageApiKeys,
      active: true
    } : null,
    deleteAdminSettingsUser: async () => true,
    ...overrides
  };
}

function createPortalResourceReadDependencies(
  overrides: Partial<PortalResourceReadDependencies> = {}
): PortalResourceReadDependencies {
  return {
    listPortalBookings: async (clientId) => clientId === "client-1" ? [{
      id: "booking-1",
      clientId: "client-1",
      petIds: ["pet-1"],
      serviceId: "svc-private-lesson",
      startsAt: "2026-06-01T16:00:00.000Z",
      endsAt: "2026-06-01T17:00:00.000Z",
      status: "confirmed",
      icalAccess: null
    }] : [],
    listPortalPets: async (clientId) => clientId === "client-1" ? [{
      id: "pet-1",
      clientId: "client-1",
      name: "Buddy",
      species: "Dog",
      petSittingNotes: "Use the side gate and towel paws before re-entry.",
      archived: false
    }] : [],
    findPortalPetById: async (clientId, petId) => clientId === "client-1" && petId === "pet-1" ? {
      id: "pet-1",
      clientId: "client-1",
      name: "Buddy",
      species: "Dog",
      petSittingNotes: "Use the side gate and towel paws before re-entry.",
      archived: false
    } : null,
    listPortalPetFiles: async (clientId, petId) => clientId === "client-1" && petId === "pet-1" ? [{
      id: "pet-file-1",
      petId: "pet-1",
      fileType: "document",
      fileName: "vaccination-record.pdf",
      originalName: "Vaccination Record.pdf",
      fileSize: 120340,
      mimeType: "application/pdf",
      description: "Vaccination record",
      uploadedByAdminUserId: null,
      uploadedAt: "2026-05-26T12:00:00.000Z"
    }] : [],
    findPortalPetFileById: async (clientId, petId, fileId) => clientId === "client-1" && petId === "pet-1" && fileId === "pet-file-1" ? {
      id: "pet-file-1",
      petId: "pet-1",
      fileType: "document",
      fileName: "vaccination-record.pdf",
      originalName: "Vaccination Record.pdf",
      fileSize: 120340,
      mimeType: "application/pdf",
      description: "Vaccination record",
      uploadedByAdminUserId: null,
      uploadedAt: "2026-05-26T12:00:00.000Z"
    } : null,
    loadPortalPetFileContent: async (clientId, petId, fileId) => clientId === "client-1" && petId === "pet-1" && fileId === "pet-file-1" ? {
      item: {
        id: "pet-file-1",
        petId: "pet-1",
        fileType: "document",
        fileName: "vaccination-record.pdf",
        originalName: "Vaccination Record.pdf",
        fileSize: 120340,
        mimeType: "application/pdf",
        description: "Vaccination record",
        uploadedByAdminUserId: null,
        uploadedAt: "2026-05-26T12:00:00.000Z"
      },
      fileName: "Vaccination Record.pdf",
      disposition: "inline",
      contentBase64: Buffer.from("vaccination-record-body", "utf8").toString("base64")
    } : null,
    deletePortalPetFile: async (clientId, petId, fileId) => clientId === "client-1" && petId === "pet-1" && fileId === "pet-file-1",
    findPortalBookingById: async (clientId, bookingId) => clientId === "client-1" && bookingId === "booking-1" ? {
      id: "booking-1",
      clientId: "client-1",
      petIds: ["pet-1"],
      serviceId: "svc-private-lesson",
      startsAt: "2026-06-01T16:00:00.000Z",
      endsAt: "2026-06-01T17:00:00.000Z",
      status: "confirmed",
      icalAccess: null
    } : null,
    listPortalInvoices: async (clientId) => clientId === "client-1" ? [{
      id: "invoice-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 225,
      outstandingAmount: 125,
      dueAt: "2026-06-05T00:00:00.000Z"
    }] : [],
    findPortalInvoiceById: async (clientId, invoiceId) => clientId === "client-1" && invoiceId === "invoice-1" ? {
      id: "invoice-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 225,
      outstandingAmount: 125,
      dueAt: "2026-06-05T00:00:00.000Z"
    } : null,
    listPortalQuotes: async (clientId) => clientId === "client-1" ? [{
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: null
    }] : [],
    findPortalQuoteById: async (clientId, quoteId) => clientId === "client-1" && quoteId === "quote-1" ? {
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: null
    } : null,
    listPortalContracts: async (clientId) => clientId === "client-1" ? [{
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: null
    }] : [],
    findPortalContractById: async (clientId, contractId) => clientId === "client-1" && contractId === "contract-1" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: null
    } : null,
    listPortalForms: async (clientId) => clientId === "client-1" ? [{
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-26T11:00:00.000Z",
      publicAccess: null
    }, {
      id: "form-hidden-1",
      templateId: "template-2",
      clientId: "client-1",
      templateName: "Internal Pet Form",
      formType: "client_form",
      submittedAt: "2026-05-25T09:00:00.000Z",
      publicAccess: null
    }] : [],
    findPortalFormById: async (clientId, formId) => clientId === "client-1" && formId === "form-1" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-26T11:00:00.000Z",
      publicAccess: null
    } : clientId === "client-1" && formId === "form-hidden-1" ? {
      id: "form-hidden-1",
      templateId: "template-2",
      clientId: "client-1",
      templateName: "Internal Pet Form",
      formType: "client_form",
      submittedAt: "2026-05-25T09:00:00.000Z",
      publicAccess: null
    } : null,
    listPortalNotifications: async (clientId) => clientId === "client-1" ? [{
      id: "notification-1",
      clientId: "client-1",
      channel: "portal",
      entityType: "follow_up_note",
      entityId: "form-1",
      subject: "New follow-up note available",
      message: "Your Follow-up Note is ready to review in the client portal.",
      url: "/portal/forms/form-1",
      isRead: false,
      createdAt: "2026-05-26T12:00:00.000Z"
    }] : [],
    listPortalPackages: async (clientId) => clientId === "client-1" ? [{
      id: "package-1",
      name: "Starter Package",
      active: true,
      price: 325
    }] : [],
    findPortalPackageById: async (clientId, packageId) => clientId === "client-1" && packageId === "package-1" ? {
      id: "package-1",
      name: "Starter Package",
      active: true,
      price: 325
    } : null,
    listPortalCredits: async (clientId) => clientId === "client-1" ? [{
      id: "credit-1",
      clientId: "client-1",
      packageId: "package-1",
      appointmentTypeId: "appointment-type-1",
      remainingUnits: 4
    }] : [],
    findPortalCreditById: async (clientId, creditId) => clientId === "client-1" && creditId === "credit-1" ? {
      id: "credit-1",
      clientId: "client-1",
      packageId: "package-1",
      appointmentTypeId: "appointment-type-1",
      remainingUnits: 4
    } : null,
    ...overrides
  };
}

function createAdminResourceReadDependencies(
  overrides: Partial<AdminResourceReadDependencies> = {}
): AdminResourceReadDependencies {
  return {
    listAdminClients: async () => [{
      id: "client-1",
      email: "client@example.com",
      firstName: "Client",
      lastName: "One",
      archived: false
    }],
    listAdminPets: async () => [{
      id: "pet-1",
      clientId: "client-1",
      name: "Buddy",
      species: "Dog",
      petSittingNotes: "Use the side gate and towel paws before re-entry.",
      archived: false
    }],
    findAdminPetById: async (petId) => petId === "pet-1" ? {
      id: "pet-1",
      clientId: "client-1",
      name: "Buddy",
      species: "Dog",
      petSittingNotes: "Use the side gate and towel paws before re-entry.",
      archived: false
    } : null,
    listAdminPetFiles: async (petId) => petId === "pet-1" ? [{
      id: "pet-file-1",
      petId: "pet-1",
      fileType: "photo",
      fileName: "buddy-headshot.jpg",
      originalName: "Buddy Headshot.jpg",
      fileSize: 98342,
      mimeType: "image/jpeg",
      description: "Front profile",
      uploadedByAdminUserId: "admin-1",
      uploadedAt: "2026-05-25T09:30:00.000Z"
    }] : [],
    findAdminPetFileById: async (petId, fileId) => petId === "pet-1" && fileId === "pet-file-1" ? {
      id: "pet-file-1",
      petId: "pet-1",
      fileType: "photo",
      fileName: "buddy-headshot.jpg",
      originalName: "Buddy Headshot.jpg",
      fileSize: 98342,
      mimeType: "image/jpeg",
      description: "Front profile",
      uploadedByAdminUserId: "admin-1",
      uploadedAt: "2026-05-25T09:30:00.000Z"
    } : null,
    loadAdminPetFileContent: async (petId, fileId, download) => petId === "pet-1" && fileId === "pet-file-1" ? {
      item: {
        id: "pet-file-1",
        petId: "pet-1",
        fileType: "photo",
        fileName: "buddy-headshot.jpg",
        originalName: "Buddy Headshot.jpg",
        fileSize: 98342,
        mimeType: "image/jpeg",
        description: "Front profile",
        uploadedByAdminUserId: "admin-1",
        uploadedAt: "2026-05-25T09:30:00.000Z"
      },
      fileName: "Buddy Headshot.jpg",
      disposition: download ? "attachment" : "inline",
      contentBase64: Buffer.from("buddy-headshot-body", "utf8").toString("base64")
    } : null,
    deleteAdminPetFile: async (petId, fileId) => petId === "pet-1" && fileId === "pet-file-1",
    findAdminClientById: async (clientId) => clientId === "client-1" ? {
      id: "client-1",
      email: "client@example.com",
      firstName: "Client",
      lastName: "One",
      archived: false
    } : null,
    listAdminBookings: async () => [{
      id: "booking-2",
      clientId: "client-2",
      petIds: ["pet-9"],
      serviceId: "svc-board-train",
      startsAt: "2026-05-28T17:00:00.000Z",
      endsAt: "2026-05-28T18:00:00.000Z",
      status: "pending",
      icalAccess: null
    }],
    findAdminBookingById: async (bookingId) => bookingId === "booking-2" ? {
      id: "booking-2",
      clientId: "client-2",
      petIds: ["pet-9"],
      serviceId: "svc-board-train",
      startsAt: "2026-05-28T17:00:00.000Z",
      endsAt: "2026-05-28T18:00:00.000Z",
      status: "pending",
      icalAccess: null
    } : null,
    listAdminInvoices: async () => [{
      id: "invoice-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 225,
      outstandingAmount: 125,
      dueAt: "2026-06-05T00:00:00.000Z"
    }],
    findAdminInvoiceById: async (invoiceId) => invoiceId === "invoice-1" ? {
      id: "invoice-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 225,
      outstandingAmount: 125,
      dueAt: "2026-06-05T00:00:00.000Z"
    } : null,
    listAdminQuotes: async () => [{
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: null
    }],
    findAdminQuoteById: async (quoteId) => quoteId === "quote-1" ? {
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: null
    } : null,
    listAdminContracts: async () => [{
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: null
    }],
    findAdminContractById: async (contractId) => contractId === "contract-1" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: null
    } : null,
    listAdminForms: async () => [{
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-26T11:00:00.000Z",
      publicAccess: null
    }, {
      id: "form-hidden-1",
      templateId: "template-2",
      clientId: "client-1",
      templateName: "Internal Pet Form",
      formType: "client_form",
      submittedAt: "2026-05-25T09:00:00.000Z",
      publicAccess: null
    }],
    listAdminFormsByTemplate: async (templateId) => [{
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-26T11:00:00.000Z",
      publicAccess: null
    }, {
      id: "form-hidden-1",
      templateId: "template-2",
      clientId: "client-1",
      templateName: "Internal Pet Form",
      formType: "client_form",
      submittedAt: "2026-05-25T09:00:00.000Z",
      publicAccess: null
    }].filter((form) => form.templateId === templateId),
    findAdminFormById: async (formId) => formId === "form-1" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-26T11:00:00.000Z",
      publicAccess: null
    } : formId === "form-hidden-1" ? {
      id: "form-hidden-1",
      templateId: "template-2",
      clientId: "client-1",
      templateName: "Internal Pet Form",
      formType: "client_form",
      submittedAt: "2026-05-25T09:00:00.000Z",
      publicAccess: null
    } : null,
    createAdminFormRequest: async (input) => ({
      id: "form-request-1",
      templateId: input.templateId,
      clientId: input.clientId,
      bookingId: input.bookingId ?? null,
      petId: input.petId ?? null,
      templateName: "Generated Request",
      formType: "client_form",
      status: "pending",
      submittedAt: null,
      publicAccess: {
        token: "form-request-public-token",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: null
      }
    }),
    reviewAdminForm: async (formId, adminUserId, notes) => {
      const item = formId === "form-1"
        ? {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          submittedAt: "2026-05-26T11:00:00.000Z",
          publicAccess: null
        }
        : null;
      return item == null ? null : {
        ...item,
        status: "reviewed",
        reviewedByAdminUserId: adminUserId,
        reviewedByName: "Admin Reviewer",
        reviewedAt: "2026-05-27T18:00:00.000Z",
        notes
      };
    },
    unreviewAdminForm: async (formId) => {
      const item = formId === "form-1"
        ? {
          id: "form-1",
          templateId: "template-1",
          clientId: "client-1",
          templateName: "Follow-up Note",
          formType: "follow_up_note",
          templateIsInternal: true,
          templateShowInClientPortal: true,
          clientReviewSubmission: true,
          submittedAt: "2026-05-26T11:00:00.000Z",
          publicAccess: null
        }
        : null;
      return item == null ? null : {
        ...item,
        status: "submitted",
        reviewedByAdminUserId: null,
        reviewedByName: null,
        reviewedAt: null,
        notes: "Kept note"
      };
    },
    listAdminPackages: async () => [{
      id: "package-1",
      name: "Starter Package",
      active: true,
      price: 325
    }],
    findAdminPackageById: async (packageId) => packageId === "package-1" ? {
      id: "package-1",
      name: "Starter Package",
      active: true,
      price: 325
    } : null,
    listAdminCredits: async () => [{
      id: "credit-1",
      clientId: "client-1",
      packageId: "package-1",
      appointmentTypeId: "appointment-type-1",
      remainingUnits: 4
    }],
    findAdminCreditById: async (creditId) => creditId === "credit-1" ? {
      id: "credit-1",
      clientId: "client-1",
      packageId: "package-1",
      appointmentTypeId: "appointment-type-1",
      remainingUnits: 4
    } : null,
    ...overrides
  };
}

function createContactManagementDependencies(
  overrides: Partial<ContactManagementDependencies> = {}
): ContactManagementDependencies {
  let sequence = 1;

  return {
    listPortalContacts: async (clientId) => clientId === "client-1" ? [{
      id: "contact-1",
      clientId: "client-1",
      name: "Primary Contact",
      email: "contact@example.com",
      phone: "555-0100",
      isPrimary: true
    }] : [],
    findPortalContactById: async (clientId, contactId) => clientId === "client-1" && contactId === "contact-1" ? {
      id: "contact-1",
      clientId: "client-1",
      name: "Primary Contact",
      email: "contact@example.com",
      phone: "555-0100",
      isPrimary: true
    } : null,
    createPortalContact: async (clientId, input) => ({
      id: `contact-${sequence++}`,
      clientId,
      ...input
    }),
    updatePortalContact: async (clientId, contactId, input) => clientId === "client-1" && contactId === "contact-1" ? {
      id: "contact-1",
      clientId,
      ...input
    } : null,
    deletePortalContact: async (clientId, contactId) => clientId === "client-1" && contactId === "contact-1",
    listAdminClientContacts: async (clientId) => clientId === "client-1" ? [{
      id: "contact-1",
      clientId: "client-1",
      name: "Primary Contact",
      email: "contact@example.com",
      phone: "555-0100",
      isPrimary: true
    }] : [],
    findAdminClientContactById: async (clientId, contactId) => clientId === "client-1" && contactId === "contact-1" ? {
      id: "contact-1",
      clientId: "client-1",
      name: "Primary Contact",
      email: "contact@example.com",
      phone: "555-0100",
      isPrimary: true
    } : null,
    createAdminClientContact: async (clientId, input) => ({
      id: `contact-${sequence++}`,
      clientId,
      ...input
    }),
    updateAdminClientContact: async (clientId, contactId, input) => clientId === "client-1" && contactId === "contact-1" ? {
      id: "contact-1",
      clientId,
      ...input
    } : null,
    deleteAdminClientContact: async (clientId, contactId) => clientId === "client-1" && contactId === "contact-1",
    ...overrides
  };
}

function createPetFileManagementDependencies(
  overrides: Partial<PetFileManagementDependencies> = {}
): PetFileManagementDependencies {
  let sequence = 1;

  return {
    now: () => "2026-05-27T18:00:00.000Z",
    createPortalPetFile: async (clientId, petId, input) => clientId === "client-1" && petId === "pet-1" ? {
      id: `pet-file-${sequence++}`,
      petId,
      fileType: input.fileType,
      fileName: `pet_${petId}_upload.${input.fileExtension}`,
      originalName: input.originalName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      description: input.description,
      uploadedByAdminUserId: null,
      uploadedAt: input.uploadedAt
    } : null,
    createAdminPetFile: async (petId, input) => petId === "pet-1" ? {
      id: `pet-file-${sequence++}`,
      petId,
      fileType: input.fileType,
      fileName: `pet_${petId}_upload.${input.fileExtension}`,
      originalName: input.originalName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      description: input.description,
      uploadedByAdminUserId: input.uploadedByAdminUserId,
      uploadedAt: input.uploadedAt
    } : null,
    ...overrides
  };
}

function createAdminCalendarSyncDependencies(
  overrides: Partial<AdminCalendarSyncDependencies> = {}
): AdminCalendarSyncDependencies {
  return {
    syncAdminBookingCalendar: async (bookingId, provider) => bookingId === "booking-2" && provider === "google_calendar" ? {
      booking: {
        id: "booking-2",
        clientId: "client-2",
        petIds: ["pet-9"],
        serviceId: "svc-board-train",
        startsAt: "2026-05-28T17:00:00.000Z",
        endsAt: "2026-05-28T18:00:00.000Z",
        status: "pending",
        icalAccess: null
      },
      provider: "google_calendar" as const,
      externalEventId: "google-calendar-booking-2-2026-05-27",
      externalEventUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      syncedAt: "2026-05-27T18:00:00.000Z"
    } : null,
    getAdminBookingCalendarSync: async (bookingId, provider) => bookingId === "booking-2" && provider === "google_calendar" ? {
      booking: {
        id: "booking-2",
        clientId: "client-2",
        petIds: ["pet-9"],
        serviceId: "svc-board-train",
        startsAt: "2026-05-28T17:00:00.000Z",
        endsAt: "2026-05-28T18:00:00.000Z",
        status: "pending",
        icalAccess: null
      },
      provider: "google_calendar" as const,
      externalEventId: "google-calendar-booking-2-2026-05-27",
      externalEventUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      syncedAt: "2026-05-27T18:00:00.000Z"
    } : null,
    ...overrides
  };
}

function createPortalCommerceDependencies(
  overrides: Partial<PortalCommerceDependencies> = {}
): PortalCommerceDependencies {
  return {
    acceptPortalQuote: async (clientId, quoteId) => clientId === "client-1" && quoteId === "quote-1" ? {
      id: "quote-1",
      clientId: "client-1",
      status: "accepted",
      totalAmount: 450,
      publicAccess: null
    } : null,
    createInvoicePaymentSession: async (clientId, invoiceId, input) => {
      if (clientId !== "client-1" || invoiceId !== "invoice-1") {
        return null;
      }

      return {
        invoice: {
          id: "invoice-1",
          clientId: "client-1",
          status: "sent",
          totalAmount: 225,
          outstandingAmount: 125,
          dueAt: "2026-06-05T00:00:00.000Z"
        },
        paymentSession: {
          provider: "stripe",
          checkoutUrl: `${input.returnUrl}?checkout=invoice-1`,
          expiresAt: "2026-05-28T18:00:00.000Z"
        }
      };
    },
    signPortalContract: async (clientId, contractId) => clientId === "client-1" && contractId === "contract-1" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "signed",
      publicAccess: null
    } : null,
    submitPortalForm: async (clientId, formId) => clientId === "client-1" && formId === "form-1" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      submittedAt: "2026-05-27T18:00:00.000Z",
      publicAccess: null
    } : null,
    ...overrides
  };
}

function createPublicDocumentAccessDependencies(
  overrides: Partial<PublicDocumentAccessDependencies> = {}
): PublicDocumentAccessDependencies {
  const defaults: PublicDocumentAccessDependencies = {
    now: () => "2026-05-27T18:00:00.000Z",
    verifyCaptcha: async () => true,
    findPublicQuoteById: async (quoteId) => quoteId === "quote-1" ? {
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: {
        token: "quote-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "quote-1"
      }
    } : null,
    findPublicQuoteByToken: async (token) => token === "quote-access-token-1234" ? {
      id: "quote-1",
      clientId: "client-1",
      status: "sent",
      totalAmount: 450,
      publicAccess: {
        token: "quote-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "quote-1"
      }
    } : null,
    respondPublicQuote: async (quoteId, action) => quoteId === "quote-1" ? {
      id: "quote-1",
      clientId: "client-1",
      status: action === "accept" ? "accepted" : "declined",
      totalAmount: 450,
      publicAccess: {
        token: "quote-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "quote-1"
      }
    } : null,
    findPublicContractById: async (contractId) => contractId === "contract-1" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: {
        token: "contract-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "contract-1"
      }
    } : null,
    findPublicContractByToken: async (token) => token === "contract-access-token-1234" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "sent",
      publicAccess: {
        token: "contract-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "contract-1"
      }
    } : null,
    signPublicContract: async (input) => input.contractId === "contract-1" ? {
      id: "contract-1",
      clientId: "client-1",
      status: "signed",
      signatureTypedName: input.typedName,
      signatureFont: input.signatureFont,
      signedAt: "2026-05-27T18:00:00.000Z",
      publicAccess: {
        token: "contract-access-token-1234",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "contract-1"
      }
    } : null,
    findPublicFormSubmissionById: async (submissionId) => submissionId === "form-1" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Client Intake",
      templateDescription: "Complete the onboarding form.",
      templateFields: [
        {
          label: "Dog Name",
          type: "text",
          required: true
        }
      ],
      contactName: "Casey Client",
      contactEmail: "casey@example.com",
      contactPhone: "555-0110",
      responses: [],
      submittedAt: null,
      publicAccess: {
        token: "form-access-token-123456",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "form-1"
      }
    } : null,
    findPublicFormSubmissionByToken: async (token) => token === "form-access-token-123456" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Client Intake",
      templateDescription: "Complete the onboarding form.",
      templateFields: [
        {
          label: "Dog Name",
          type: "text",
          required: true
        }
      ],
      contactName: "Casey Client",
      contactEmail: "casey@example.com",
      contactPhone: "555-0110",
      responses: [],
      submittedAt: null,
      publicAccess: {
        token: "form-access-token-123456",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "form-1"
      }
    } : null,
    submitPublicForm: async (input) => input.submissionId === "form-1" ? {
      id: "form-1",
      templateId: "template-1",
      clientId: "client-1",
      templateName: "Client Intake",
      templateDescription: "Complete the onboarding form.",
      templateFields: [
        {
          label: "Dog Name",
          type: "text",
          required: true
        }
      ],
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      responses: input.responses,
      submittedAt: "2026-05-27T18:00:00.000Z",
      publicAccess: {
        token: "form-access-token-123456",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: null,
        legacySourceId: "form-1"
      }
    } : null,
    findPublicBookingIcalById: async (bookingId) => bookingId === "booking-ical-1" ? {
      id: "booking-ical-1",
      clientId: "client-1",
      petIds: ["pet-1"],
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
    } : null,
    findPublicBookingIcalByToken: async (token) => token === "ical-access-token-123456" ? {
      id: "booking-ical-1",
      clientId: "client-1",
      petIds: ["pet-1"],
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
    } : null
  };
  return {
    ...defaults,
    ...overrides
  };
}

function createAchievementDependencies(
  overrides: Partial<AchievementDependencies> = {}
): AchievementDependencies {
  return {
    listPortalAchievements: async (clientId) => clientId === "client-1" ? [{
      id: "achievement-1",
      clientId: "client-1",
      achievementTypeId: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      status: "awarded",
      awardedOn: "2026-05-20",
      dogName: "Buddy",
      programName: "Obedience 101",
      notes: "Great progress",
      awardedByAdminUserId: "admin-1",
      updatedByAdminUserId: "admin-1",
      revokedByAdminUserId: null,
      revokedAt: null,
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z"
    }] : [],
    findPortalAchievementById: async (clientId, achievementId) => clientId === "client-1" && achievementId === "achievement-1" ? {
      id: "achievement-1",
      clientId: "client-1",
      achievementTypeId: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      status: "awarded",
      awardedOn: "2026-05-20",
      dogName: "Buddy",
      programName: "Obedience 101",
      notes: "Great progress",
      awardedByAdminUserId: "admin-1",
      updatedByAdminUserId: "admin-1",
      revokedByAdminUserId: null,
      revokedAt: null,
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z"
    } : null,
    listAdminAchievementTypes: async () => [{
      id: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      active: true
    }],
    findAdminAchievementTypeById: async (achievementTypeId) => achievementTypeId === "achievement-type-1" ? {
      id: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      active: true
    } : null,
    listAdminClientAchievements: async (clientId) => clientId === "client-1" ? [{
      id: "achievement-1",
      clientId: "client-1",
      achievementTypeId: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      status: "awarded",
      awardedOn: "2026-05-20",
      dogName: "Buddy",
      programName: "Obedience 101",
      notes: "Great progress",
      awardedByAdminUserId: "admin-1",
      updatedByAdminUserId: "admin-1",
      revokedByAdminUserId: null,
      revokedAt: null,
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z"
    }] : [],
    findAdminClientAchievementById: async (clientId, achievementId) => clientId === "client-1" && achievementId === "achievement-1" ? {
      id: "achievement-1",
      clientId: "client-1",
      achievementTypeId: "achievement-type-1",
      title: "Canine Good Citizen",
      description: "Completed foundational obedience milestones.",
      scopeType: "general",
      awardMode: "badge_certificate",
      badgeIconPath: "/backend/uploads/achievements/icons/cgc.png",
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>{{client_name}}</p><p>{{achievement_title}}</p>",
      status: "awarded",
      awardedOn: "2026-05-20",
      dogName: "Buddy",
      programName: "Obedience 101",
      notes: "Great progress",
      awardedByAdminUserId: "admin-1",
      updatedByAdminUserId: "admin-1",
      revokedByAdminUserId: null,
      revokedAt: null,
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z"
    } : null,
    buildAchievementCertificateHtml: async (achievement, options) => (
      `<html><body data-download="${options.download ? "1" : "0"}"><h1>${achievement.title}</h1><p>${achievement.dogName}</p></body></html>`
    ),
    buildPortalCertificateBackPath: () => "/portal/achievements",
    buildAdminCertificateBackPath: (clientId) => `/client/clients_view.php?id=${clientId}&tab=achievements`,
    ...overrides
  };
}

function createWorkflowManagementDependencies(
  overrides: Partial<WorkflowManagementDependencies> = {}
): WorkflowManagementDependencies {
  return {
    listAdminWorkflows: async () => [],
    findAdminWorkflowById: async () => null,
    createAdminWorkflow: async (_adminUserId, input) => ({
      id: "workflow-1",
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      active: input.active,
      createdAt: "2026-05-27T18:00:00.000Z"
    }),
    updateAdminWorkflow: async (workflowId, _adminUserId, input) => ({
      id: workflowId,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      active: input.active,
      createdAt: "2026-05-27T18:00:00.000Z"
    }),
    deleteAdminWorkflow: async () => true,
    listAdminWorkflowTriggers: async () => [],
    listWorkflowTriggerOptions: async () => ({
      appointmentTypes: [],
      formTemplates: []
    }),
    createAdminWorkflowTrigger: async (workflowId, _adminUserId, input) => ({
      id: "workflow-trigger-1",
      workflowId,
      triggerType: input.triggerType,
      appointmentTypeId: input.appointmentTypeId,
      formTemplateId: input.formTemplateId,
      active: input.active,
      createdAt: "2026-05-27T18:00:00.000Z",
      appointmentTypeName: input.appointmentTypeId,
      formTemplateName: input.formTemplateId
    }),
    deleteAdminWorkflowTrigger: async () => true,
    listAdminWorkflowEnrollments: async () => [],
    listWorkflowEnrollableClients: async () => [],
    enrollWorkflowClients: async () => undefined,
    cancelWorkflowEnrollment: async () => true,
    listAdminWorkflowSteps: async () => [],
    findAdminWorkflowStepById: async () => null,
    createAdminWorkflowStep: async (workflowId, _adminUserId, input) => ({
      id: "workflow-step-1",
      workflowId,
      stepOrder: 1,
      stepName: input.stepName,
      emailSubject: input.emailSubject,
      emailBodyHtml: input.emailBodyHtml,
      emailBodyText: input.emailBodyText,
      delayType: input.delayType,
      delayValue: input.delayValue,
      scheduledDate: input.scheduledDate,
      attachContractId: input.attachContractId,
      attachFormId: input.attachFormId,
      attachQuoteId: input.attachQuoteId,
      attachInvoiceId: input.attachInvoiceId,
      includeAppointmentLink: input.includeAppointmentLink,
      appointmentTypeId: input.appointmentTypeId,
      createdAt: "2026-05-27T18:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    }),
    updateAdminWorkflowStep: async (workflowId, stepId, _adminUserId, input) => ({
      id: stepId,
      workflowId,
      stepOrder: 1,
      stepName: input.stepName,
      emailSubject: input.emailSubject,
      emailBodyHtml: input.emailBodyHtml,
      emailBodyText: input.emailBodyText,
      delayType: input.delayType,
      delayValue: input.delayValue,
      scheduledDate: input.scheduledDate,
      attachContractId: input.attachContractId,
      attachFormId: input.attachFormId,
      attachQuoteId: input.attachQuoteId,
      attachInvoiceId: input.attachInvoiceId,
      includeAppointmentLink: input.includeAppointmentLink,
      appointmentTypeId: input.appointmentTypeId,
      createdAt: "2026-05-27T18:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    }),
    deleteAdminWorkflowStep: async () => true,
    listWorkflowStepEditorOptions: async () => ({
      contractTemplates: [],
      formTemplates: [],
      appointmentTypes: [],
      quotes: [],
      invoices: [],
      emailTemplates: [],
      processorIntervalMinutes: 60
    }),
    ...overrides
  };
}

function createAdminConfigurationDependencies(overrides: Record<string, unknown> = {}) {
  return {
    listAdminAppointmentTypes: async () => [{
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
      formTemplateIds: ["form-template-1", "form-template-2"],
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
      perDaySchedule: {
        1: { start: "09:00", end: "17:00" },
        3: { start: "10:00", end: "16:00" }
      },
      isMiniSession: false,
      miniSessionLocation: "",
      miniSessionTopic: "",
      isFieldRental: false,
      fieldRentalLocation: "",
      groupClassLocation: "",
      locationTypes: ["client_address", "phone_inbound"],
      confirmationTemplateId: "email-template-1",
      bookingRequestTemplateId: "email-template-2",
      invoiceTemplateId: "email-template-3",
      reminderTemplateId: "email-template-4",
      cancellationTemplateId: "email-template-5",
      requiresAdminConfirmation: true,
      usesResource: true,
      resourceName: "Trainer Vehicle",
      resourceCapacity: 1,
      resourceAllocation: "per_appointment",
      uniqueLink: "private-coaching-link",
      active: true,
      createdAt: "2026-05-27T17:00:00.000Z",
      updatedAt: "2026-05-27T18:00:00.000Z"
    }],
    findAdminAppointmentTypeById: async (appointmentTypeId: string) => appointmentTypeId === "appointment-type-1"
      ? {
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
        formTemplateIds: ["form-template-1", "form-template-2"],
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
        perDaySchedule: {
          1: { start: "09:00", end: "17:00" },
          3: { start: "10:00", end: "16:00" }
        },
        isMiniSession: false,
        miniSessionLocation: "",
        miniSessionTopic: "",
        isFieldRental: false,
        fieldRentalLocation: "",
        groupClassLocation: "",
        locationTypes: ["client_address", "phone_inbound"],
        confirmationTemplateId: "email-template-1",
        bookingRequestTemplateId: "email-template-2",
        invoiceTemplateId: "email-template-3",
        reminderTemplateId: "email-template-4",
        cancellationTemplateId: "email-template-5",
        requiresAdminConfirmation: true,
        usesResource: true,
        resourceName: "Trainer Vehicle",
        resourceCapacity: 1,
        resourceAllocation: "per_appointment",
        uniqueLink: "private-coaching-link",
        active: true,
        createdAt: "2026-05-27T17:00:00.000Z",
        updatedAt: "2026-05-27T18:00:00.000Z"
      }
      : null,
    createAdminAppointmentType: async (_adminUserId: string, input: Record<string, unknown>) => ({
      id: "appointment-type-created",
      ...input
    }),
    updateAdminAppointmentType: async (appointmentTypeId: string, _adminUserId: string, input: Record<string, unknown>) => ({
      id: appointmentTypeId,
      ...input
    }),
    deleteAdminAppointmentType: async (appointmentTypeId: string) => appointmentTypeId === "appointment-type-1",
    listAdminFormTemplates: async () => [{
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
    }],
    findAdminFormTemplateById: async (templateId: string) => templateId === "form-template-1"
      ? {
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
      }
      : null,
    createAdminFormTemplate: async (_adminUserId: string, input: Record<string, unknown>) => ({
      id: "form-template-created",
      name: String(input.name ?? ""),
      active: Boolean(input.active),
      description: String(input.description ?? ""),
      fields: Array.isArray(input.fields) ? input.fields as Array<Record<string, unknown>> : [],
      formType: String(input.formType ?? "client_form"),
      requiredFrequency: typeof input.requiredFrequency === "string" ? input.requiredFrequency : null,
      appointmentTypeId: typeof input.appointmentTypeId === "string" ? input.appointmentTypeId : null,
      templateIsInternal: Boolean(input.templateIsInternal),
      templateShowInClientPortal: input.templateShowInClientPortal !== false
    }),
    updateAdminFormTemplate: async (templateId: string, _adminUserId: string, input: Record<string, unknown>) => ({
      id: templateId,
      name: String(input.name ?? ""),
      active: Boolean(input.active),
      description: String(input.description ?? ""),
      fields: Array.isArray(input.fields) ? input.fields as Array<Record<string, unknown>> : [],
      formType: String(input.formType ?? "client_form"),
      requiredFrequency: typeof input.requiredFrequency === "string" ? input.requiredFrequency : null,
      appointmentTypeId: typeof input.appointmentTypeId === "string" ? input.appointmentTypeId : null,
      templateIsInternal: Boolean(input.templateIsInternal),
      templateShowInClientPortal: input.templateShowInClientPortal !== false
    }),
    countAdminFormTemplateSubmissions: async (templateId: string) => templateId === "form-template-in-use" ? 2 : 0,
    deleteAdminFormTemplate: async (templateId: string) => templateId === "form-template-1",
    listAdminEmailTemplates: async () => [{
      id: "email-template-1",
      name: "Booking Confirmation",
      templateType: "booking_confirmation",
      subject: "Your booking is confirmed",
      bodyHtml: "<p>Confirmed.</p>",
      bodyText: "Confirmed.",
      active: true
    }],
    findAdminEmailTemplateById: async (templateId: string) => templateId === "email-template-1"
      ? {
        id: "email-template-1",
        name: "Booking Confirmation",
        templateType: "booking_confirmation",
        subject: "Your booking is confirmed",
        bodyHtml: "<p>Confirmed.</p>",
        bodyText: "Confirmed.",
        active: true
      }
      : null,
    createAdminEmailTemplate: async (_adminUserId: string, input: Record<string, unknown>) => ({
      id: "email-template-created",
      name: String(input.name ?? ""),
      templateType: String(input.templateType ?? ""),
      subject: String(input.subject ?? ""),
      bodyHtml: String(input.bodyHtml ?? ""),
      bodyText: String(input.bodyText ?? ""),
      active: Boolean(input.active)
    }),
    updateAdminEmailTemplate: async (templateId: string, _adminUserId: string, input: Record<string, unknown>) => ({
      id: templateId,
      name: String(input.name ?? ""),
      templateType: String(input.templateType ?? ""),
      subject: String(input.subject ?? ""),
      bodyHtml: String(input.bodyHtml ?? ""),
      bodyText: String(input.bodyText ?? ""),
      active: Boolean(input.active)
    }),
    listAdminScheduledTasks: async () => [{
      id: "scheduled-task-1",
      name: "Workflow Processor",
      taskType: "workflow_processor",
      scheduleType: "interval",
      scheduleValue: "60",
      active: true,
      lastRunAt: "2026-05-27T17:00:00.000Z",
      nextRunAt: "2026-05-27T18:00:00.000Z"
    }],
    findAdminScheduledTaskById: async (taskId: string) => taskId === "scheduled-task-1"
      ? {
        id: "scheduled-task-1",
        name: "Workflow Processor",
        taskType: "workflow_processor",
        scheduleType: "interval",
        scheduleValue: "60",
        active: true,
        lastRunAt: "2026-05-27T17:00:00.000Z",
        nextRunAt: "2026-05-27T18:00:00.000Z"
      }
      : null,
    createAdminScheduledTask: async (_adminUserId: string, input: Record<string, unknown>) => ({
      id: "scheduled-task-created",
      name: String(input.name ?? ""),
      taskType: String(input.taskType ?? ""),
      scheduleType: String(input.scheduleType ?? ""),
      scheduleValue: String(input.scheduleValue ?? ""),
      active: Boolean(input.active),
      lastRunAt: null,
      nextRunAt: null
    }),
    updateAdminScheduledTask: async (taskId: string, _adminUserId: string, input: Record<string, unknown>) => ({
      id: taskId,
      name: String(input.name ?? ""),
      taskType: String(input.taskType ?? ""),
      scheduleType: String(input.scheduleType ?? ""),
      scheduleValue: String(input.scheduleValue ?? ""),
      active: Boolean(input.active),
      lastRunAt: "2026-05-27T17:00:00.000Z",
      nextRunAt: "2026-05-27T18:00:00.000Z"
    }),
    ...overrides
  };
}

function createApiDependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  return {
    publicBooking: createPublicBookingDependencies(),
    publicContact: createPublicContactDependencies(),
    publicPackages: {
      now: () => "2026-05-27T18:00:00.000Z",
      findPublicPackageByToken: async (token) => token === "starter-package-token" ? {
        id: "package-1",
        name: "Starter Package",
        active: true,
        price: 325,
        items: []
      } : null,
      findPublicCheckoutForm: async () => null,
      findClientIdByEmail: async () => null,
      hasSubmittedCheckoutForm: async () => false,
      finalizePublicPackagePurchase: async () => ({
        clientId: "client-1",
        clientPackageId: "client-package-1"
      })
    },
    integrationCallbacks: createIntegrationCallbackDependencies(),
    portalLogin: createPortalDependencies(),
    adminLogin: createAdminDependencies(),
    portalActorProfile: createPortalActorProfileDependencies(),
    adminActorProfile: createAdminActorProfileDependencies(),
    clientProfiles: createClientProfileDependencies(),
    portalSummary: createPortalSummaryDependencies(),
    adminDashboard: createAdminDashboardDependencies(),
    adminOperations: createAdminOperationsDependencies(),
    adminConfiguration: createAdminConfigurationDependencies() as never,
    content: createContentManagementDependencies(),
    achievements: createAchievementDependencies(),
    portalResources: createPortalResourceReadDependencies(),
    adminResources: createAdminResourceReadDependencies(),
    petFiles: createPetFileManagementDependencies(),
    contacts: createContactManagementDependencies(),
    adminCalendarSync: createAdminCalendarSyncDependencies(),
    portalCommerce: createPortalCommerceDependencies(),
    publicDocuments: createPublicDocumentAccessDependencies(),
    workflows: createWorkflowManagementDependencies(),
    ...overrides
  };
}

describe("api handlers", () => {
  it("returns a success envelope for a valid public booking request", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePublicBooking({
      serviceId: "svc-private-lesson",
      clientEmail: "client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(201);
    if ("error" in result.body) {
      throw new Error("Expected successful public booking response.");
    }
    expect(result.body.status).toBe("confirmed");
  });

  it("maps business validation failures to 409 responses", async () => {
    const handlers = createApiHandlers(
      createApiDependencies({
        publicBooking: createPublicBookingDependencies({
          isTimeSlotAvailable: async () => false
        })
      })
    );

    const result = await handlers.handlePublicBooking({
      serviceId: "svc-private-lesson",
      clientEmail: "client@example.com",
      petIds: ["pet-1"],
      requestedStart: "2026-06-01T16:00:00.000Z",
      requestedEnd: "2026-06-01T17:00:00.000Z",
      turnstileToken: "turnstile-ok"
    });

    expect(result.status).toBe(409);
    if (!("error" in result.body)) {
      throw new Error("Expected conflict public booking response.");
    }
    expect(result.body.error.code).toBe("slot_unavailable");
  });

  it("returns a success envelope for a valid public contact request", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePublicContact({
      name: "Contact New",
      email: "Contact-New@Example.com",
      phone: "555-1100",
      service: "pet-sitting",
      message: "Need help with training basics.",
      turnstile_token: "turnstile-ok"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful public contact response.");
    }
    expect(result.body).toEqual({ success: true });
  });

  it("maps public contact captcha failures to 400 responses", async () => {
    const handlers = createApiHandlers(createApiDependencies({
      publicContact: createPublicContactDependencies({
        verifyCaptcha: async () => false
      })
    }));

    const result = await handlers.handlePublicContact({
      name: "Contact New",
      email: "contact@example.com",
      phone: "555-1100",
      service: "",
      message: "Need help with training basics.",
      turnstileToken: "turnstile-fail"
    });

    expect(result.status).toBe(400);
    if (!("error" in result.body)) {
      throw new Error("Expected failed public contact response.");
    }
    expect(result.body.error.code).toBe("captcha_failed");
  });

  it("returns admin configuration payloads and mutations for appointment types, form templates, email templates, and scheduled tasks", async () => {
    const handlers = createApiHandlers({
      ...createApiDependencies(),
      adminConfiguration: createAdminConfigurationDependencies()
    } as never);
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "owner" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T19:00:00.000Z"
    };
    const adminHandlers = handlers as Record<string, (...args: unknown[]) => Promise<{ status: number; body: unknown }>>;

    const appointmentTypes = await adminHandlers.handleAdminAppointmentTypes(session);
    const appointmentType = await adminHandlers.handleAdminAppointmentTypeDetail(session, "appointment-type-1");
    const createdAppointmentType = await adminHandlers.handleAdminAppointmentTypeCreate(session, {
      name: "Mini Session Saturday",
      description: "Short-format mini session.",
      bulletPoints: ["Outdoor setup", "Photo-ready training"],
      adminUserId: "admin-1",
      durationMinutes: 45,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      useTravelTimeBuffer: false,
      travelTimeMinutes: 0,
      advanceBookingMinDays: 1,
      advanceBookingMaxDays: 14,
      cancellationNoticeHours: 12,
      requiresForms: true,
      formTemplateIds: ["form-template-1"],
      requiresContract: false,
      contractTemplateId: null,
      autoInvoice: true,
      invoiceDueDays: 3,
      invoiceDueTiming: "before",
      defaultAmount: 95,
      consumesCredits: false,
      creditCount: 1,
      isGroupClass: false,
      maxParticipants: 1,
      publicAvailable: false,
      portalAvailable: true,
      scheduleType: "specific_date",
      specificDate: "2026-06-21",
      specificDates: [{
        date: "2026-06-21",
        timeslots: [{ type: "point", time: "10:00" }]
      }],
      availableDays: [0],
      availableStartTime: "10:00",
      availableEndTime: "14:00",
      timeSlotInterval: 30,
      perDaySchedule: {},
      isMiniSession: true,
      miniSessionLocation: "Downtown Park",
      miniSessionTopic: "Recall refresh",
      isFieldRental: false,
      fieldRentalLocation: "",
      groupClassLocation: "",
      locationTypes: [],
      confirmationTemplateId: "email-template-1",
      bookingRequestTemplateId: null,
      invoiceTemplateId: null,
      reminderTemplateId: null,
      cancellationTemplateId: null,
      requiresAdminConfirmation: true,
      usesResource: false,
      resourceName: "",
      resourceCapacity: 1,
      resourceAllocation: "per_appointment",
      uniqueLink: "mini-session-june-21",
      active: true
    });
    const updatedAppointmentType = await adminHandlers.handleAdminAppointmentTypeUpdate(session, "appointment-type-1", {
      name: "Private Coaching Updated",
      description: "Updated coaching session.",
      bulletPoints: ["Updated assessment"],
      adminUserId: "admin-1",
      durationMinutes: 60,
      bufferBeforeMinutes: 5,
      bufferAfterMinutes: 5,
      useTravelTimeBuffer: false,
      travelTimeMinutes: 0,
      advanceBookingMinDays: 1,
      advanceBookingMaxDays: 30,
      cancellationNoticeHours: 12,
      requiresForms: false,
      formTemplateIds: [],
      requiresContract: false,
      contractTemplateId: null,
      autoInvoice: false,
      invoiceDueDays: 7,
      invoiceDueTiming: "after",
      defaultAmount: 175,
      consumesCredits: false,
      creditCount: 1,
      isGroupClass: false,
      maxParticipants: 1,
      publicAvailable: true,
      portalAvailable: true,
      scheduleType: "recurring",
      specificDate: null,
      specificDates: [],
      availableDays: [1, 2, 3],
      availableStartTime: "08:00",
      availableEndTime: "12:00",
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
      requiresAdminConfirmation: false,
      usesResource: false,
      resourceName: "",
      resourceCapacity: 1,
      resourceAllocation: "per_appointment",
      uniqueLink: "private-coaching-updated",
      active: true
    });
    const deletedAppointmentType = await adminHandlers.handleAdminAppointmentTypeDelete(session, "appointment-type-1");
    const formTemplates = await adminHandlers.handleAdminFormTemplates(session);
    const formTemplate = await adminHandlers.handleAdminFormTemplateDetail(session, "form-template-1");
    const createdFormTemplate = await adminHandlers.handleAdminFormTemplateCreate(session, {
      name: "Follow-Up Survey",
      active: true,
      description: "Collect post-program survey responses.",
      fields: [{ label: "How did training go?", type: "textarea", required: true }],
      formType: "survey_form",
      requiredFrequency: "yearly",
      appointmentTypeId: null,
      templateIsInternal: false,
      templateShowInClientPortal: true
    });
    const updatedFormTemplate = await adminHandlers.handleAdminFormTemplateUpdate(session, "form-template-1", {
      name: "Boarding Intake Updated",
      active: false,
      description: "Updated boarding intake workflow.",
      fields: [{ label: "Pet Name", type: "text", required: true }, { label: "Medication Notes", type: "textarea" }],
      formType: "client_form",
      requiredFrequency: "once_per_pet",
      appointmentTypeId: "appointment-type-1",
      templateIsInternal: true,
      templateShowInClientPortal: false
    });
    const deletedFormTemplate = await adminHandlers.handleAdminFormTemplateDelete(session, "form-template-1");
    const emailTemplates = await adminHandlers.handleAdminEmailTemplates(session);
    const emailTemplate = await adminHandlers.handleAdminEmailTemplateDetail(session, "email-template-1");
    const createdEmailTemplate = await adminHandlers.handleAdminEmailTemplateCreate(session, {
      name: "Reminder Template",
      templateType: "booking_reminder",
      subject: "Reminder",
      bodyHtml: "<p>Reminder</p>",
      bodyText: "Reminder",
      active: true
    });
    const updatedEmailTemplate = await adminHandlers.handleAdminEmailTemplateUpdate(session, "email-template-1", {
      name: "Booking Confirmation Updated",
      templateType: "booking_confirmation",
      subject: "Updated subject",
      bodyHtml: "<p>Updated</p>",
      bodyText: "Updated",
      active: false
    });
    const scheduledTasks = await adminHandlers.handleAdminScheduledTasks(session);
    const scheduledTask = await adminHandlers.handleAdminScheduledTaskDetail(session, "scheduled-task-1");
    const createdScheduledTask = await adminHandlers.handleAdminScheduledTaskCreate(session, {
      name: "Inbox Poller",
      taskType: "email_receiver",
      scheduleType: "custom",
      scheduleValue: "*/5 * * * *",
      active: true
    });
    const updatedScheduledTask = await adminHandlers.handleAdminScheduledTaskUpdate(session, "scheduled-task-1", {
      name: "Workflow Processor Revised",
      taskType: "workflow_processor",
      scheduleType: "interval",
      scheduleValue: "30",
      active: true
    });

    expect(appointmentTypes.status).toBe(200);
    expect(appointmentType.status).toBe(200);
    expect(createdAppointmentType.status).toBe(201);
    expect(updatedAppointmentType.status).toBe(200);
    expect(deletedAppointmentType.status).toBe(200);
    expect(formTemplates.status).toBe(200);
    expect(formTemplate.status).toBe(200);
    expect(createdFormTemplate.status).toBe(201);
    expect(updatedFormTemplate.status).toBe(200);
    expect(deletedFormTemplate.status).toBe(200);
    expect(emailTemplates.status).toBe(200);
    expect(emailTemplate.status).toBe(200);
    expect(createdEmailTemplate.status).toBe(201);
    expect(updatedEmailTemplate.status).toBe(200);
    expect(scheduledTasks.status).toBe(200);
    expect(scheduledTask.status).toBe(200);
    expect(createdScheduledTask.status).toBe(201);
    expect(updatedScheduledTask.status).toBe(200);

    const appointmentTypesBody = appointmentTypes.body as {
      items: Array<{ publicAvailable: boolean; formTemplateIds: string[] }>;
    };
    const appointmentTypeBody = appointmentType.body as {
      item: { uniqueLink: string };
    };
    const formTemplatesBody = formTemplates.body as {
      items: Array<{ formType?: string; templateShowInClientPortal?: boolean | null }>;
    };
    const formTemplateBody = formTemplate.body as {
      item: { requiredFrequency?: string | null; appointmentTypeId?: string | null };
    };
    expect(appointmentTypesBody.items[0]?.publicAvailable).toBe(true);
    expect(appointmentTypesBody.items[0]?.formTemplateIds).toEqual(["form-template-1", "form-template-2"]);
    expect(appointmentTypeBody.item.uniqueLink).toBe("private-coaching-link");
    expect(deletedAppointmentType.body).toEqual({ deleted: true });
    expect(formTemplatesBody.items[0]?.formType).toBe("client_form");
    expect(formTemplatesBody.items[0]?.templateShowInClientPortal).toBe(true);
    expect(formTemplateBody.item.requiredFrequency).toBe("once");
    expect(formTemplateBody.item.appointmentTypeId).toBe("appointment-type-1");
    expect(deletedFormTemplate.body).toEqual({ deleted: true });
  });

  it("returns a session envelope for successful portal login", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePortalLogin({
      email: "client@example.com",
      password: "correct-password",
      returnTo: "https://portal.example.test/portal/appointments"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful portal login response.");
    }
    expect(result.body.clientId).toBe("client-1");
    expect(result.body.session.actorType).toBe("portal_user");
    expect(result.body.redirectTo).toContain("/portal/appointments");
  });

  it("returns 401 for invalid portal credentials", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePortalLogin({
      email: "client@example.com",
      password: "wrong-password",
      returnTo: null
    });

    expect(result.status).toBe(401);
    if (!("error" in result.body)) {
      throw new Error("Expected unauthorized portal login response.");
    }
    expect(result.body.error.code).toBe("invalid_credentials");
  });

  it("returns a session envelope for successful admin login", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handleAdminLogin({
      username: "accountant",
      password: "correct-password"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful admin login response.");
    }
    expect(result.body.actorId).toBe("admin-1");
    expect(result.body.session.role).toBe("accountant");
    expect(result.body.redirectTo).toBe("/client/invoices_list.php");
  });

  it("returns 401 for invalid admin credentials", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handleAdminLogin({
      username: "missing-user",
      password: "wrong-password"
    });

    expect(result.status).toBe(401);
    if (!("error" in result.body)) {
      throw new Error("Expected unauthorized admin login response.");
    }
    expect(result.body.error.code).toBe("invalid_credentials");
  });

  it("returns the current portal actor profile for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePortalActorProfile({
      actorId: "client-1",
      actorType: "portal_user",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful portal actor profile response.");
    }
    expect(result.body.actor.displayName).toBe("Client One");
  });

  it("returns and updates the portal profile for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const profile = await handlers.handlePortalProfile(session);
    const updated = await handlers.handlePortalProfileUpdate(session, {
      name: "Client One Updated",
      email: "client.updated@example.com",
      phone: "555-0111",
      address: "456 Oak Ave",
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    });

    expect(profile.status).toBe(200);
    expect(updated.status).toBe(200);
    if ("error" in profile.body || "error" in updated.body) {
      throw new Error("Expected successful portal profile responses.");
    }
    expect(profile.body.item.name).toBe("Client One");
    expect(updated.body.item.email).toBe("client.updated@example.com");
    expect(updated.body.item.address).toBe("456 Oak Ave");
  });

  it("returns the current admin actor profile and access decision for an admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const profile = await handlers.handleAdminActorProfile({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    expect(profile.status).toBe(200);
    if ("error" in profile.body) {
      throw new Error("Expected successful admin actor profile response.");
    }
    expect(profile.body.actor.role).toBe("accountant");

    const access = await handlers.handleAdminRouteAccess({
      session: {
        actorId: "admin-1",
        actorType: "admin_user",
        role: "accountant",
        issuedAt: "2026-05-27T18:00:00.000Z",
        expiresAt: "2026-05-27T18:00:00.000Z"
      },
      path: "/client/settings.php"
    });

    expect(access.status).toBe(200);
    if ("error" in access.body) {
      throw new Error("Expected successful admin route access response.");
    }
    expect(access.body.allowed).toBe(false);
    expect(access.body.reason).toBe("accountant_restricted");
  });

  it("returns a portal summary for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handlePortalSummary({
      actorId: "client-1",
      actorType: "portal_user",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful portal summary response.");
    }
    expect(result.body.upcomingBookings).toHaveLength(1);
    expect(result.body.openInvoices[0]?.outstandingAmount).toBe(125);
    expect(result.body.activeQuotes[0]?.id).toBe("quote-1");
  });

  it("returns an admin dashboard for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const result = await handlers.handleAdminDashboard({
      actorId: "admin-1",
      actorType: "admin_user",
      role: "accountant",
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful admin dashboard response.");
    }
    expect(result.body.metrics.pendingBookings).toBe(4);
    expect(result.body.metrics.overdueInvoices).toBe(2);
    expect(result.body.recentBookings).toHaveLength(1);
  });

  it("returns admin job logs and integration callback logs for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const jobs = await handlers.handleAdminJobLogs(session);
    const job = await handlers.handleAdminJobLogDetail(session, "job-1");
    const callbacks = await handlers.handleAdminIntegrationCallbackLogs(session);
    const callback = await handlers.handleAdminIntegrationCallbackLogDetail(session, "callback-1");

    expect(jobs.status).toBe(200);
    expect(job.status).toBe(200);
    expect(callbacks.status).toBe(200);
    expect(callback.status).toBe(200);
    if ("error" in jobs.body || "error" in job.body || "error" in callbacks.body || "error" in callback.body) {
      throw new Error("Expected successful admin operations responses.");
    }
    expect(jobs.body.items[0]?.jobId).toBe("job-1");
    expect(job.body.item.status).toBe("processed");
    expect(callbacks.body.items[0]?.callbackId).toBe("callback-1");
    expect(callback.body.item.provider).toBe("imap");
  });

  it("returns portal resource collections and details for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const bookings = await handlers.handlePortalBookings(session);
    const pets = await handlers.handlePortalPets(session);
    const pet = await handlers.handlePortalPetDetail(session, "pet-1");
    const contracts = await handlers.handlePortalContracts(session);
    const contract = await handlers.handlePortalContractDetail(session, "contract-1");
    const forms = await handlers.handlePortalForms(session);
    const form = await handlers.handlePortalFormDetail(session, "form-1");
    const invoice = await handlers.handlePortalInvoiceDetail(session, "invoice-1");
    const quote = await handlers.handlePortalQuoteDetail(session, "quote-1");

    expect(bookings.status).toBe(200);
    expect(pets.status).toBe(200);
    expect(pet.status).toBe(200);
    expect(contracts.status).toBe(200);
    expect(contract.status).toBe(200);
    expect(forms.status).toBe(200);
    expect(form.status).toBe(200);
    expect(invoice.status).toBe(200);
    expect(quote.status).toBe(200);
    if ("error" in bookings.body || "error" in pets.body || "error" in pet.body || "error" in contracts.body || "error" in contract.body || "error" in forms.body || "error" in form.body || "error" in invoice.body || "error" in quote.body) {
      throw new Error("Expected successful portal resource responses.");
    }
    expect(bookings.body.items).toHaveLength(1);
    expect(pets.body.items[0]?.name).toBe("Buddy");
    expect(pets.body.items[0]?.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(pet.body.item.id).toBe("pet-1");
    expect(pet.body.item.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(contracts.body.items).toHaveLength(1);
    expect(contract.body.item.id).toBe("contract-1");
    expect(forms.body.items).toHaveLength(1);
    expect(forms.body.items[0]?.formType).toBe("follow_up_note");
    expect(forms.body.items[0]?.clientReviewSubmission).toBe(true);
    expect(form.body.item.id).toBe("form-1");
    expect(form.body.item.templateShowInClientPortal).toBe(true);
    expect(invoice.body.item.id).toBe("invoice-1");
    expect(quote.body.item.id).toBe("quote-1");
  });

  it("hides non-portal-visible internal submissions from portal resource reads", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const form = await handlers.handlePortalFormDetail(session, "form-hidden-1");

    expect(form.status).toBe(404);
    expect(form.body).toEqual({
      error: {
        code: "actor_not_found",
        message: "Portal form not found."
      }
    });
  });

  it("returns portal package and credit collections and details for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const packages = await handlers.handlePortalPackages(session);
    const packageDetail = await handlers.handlePortalPackageDetail(session, "package-1");
    const credits = await handlers.handlePortalCredits(session);
    const creditDetail = await handlers.handlePortalCreditDetail(session, "credit-1");

    expect(packages.status).toBe(200);
    expect(packageDetail.status).toBe(200);
    expect(credits.status).toBe(200);
    expect(creditDetail.status).toBe(200);
    if ("error" in packages.body || "error" in packageDetail.body || "error" in credits.body || "error" in creditDetail.body) {
      throw new Error("Expected successful portal package and credit responses.");
    }
    expect(packages.body.items[0]?.id).toBe("package-1");
    expect(packageDetail.body.item.price).toBe(325);
    expect(credits.body.items[0]?.remainingUnits).toBe(4);
    expect(creditDetail.body.item.packageId).toBe("package-1");
  });

  it("returns portal contact collections and supports portal contact mutations", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const contacts = await handlers.handlePortalContacts(session);
    const contact = await handlers.handlePortalContactDetail(session, "contact-1");
    const created = await handlers.handlePortalContactCreate(session, {
      name: "Backup Contact",
      email: "backup@example.com",
      phone: "555-0101",
      isPrimary: false
    });
    const updated = await handlers.handlePortalContactUpdate(session, "contact-1", {
      name: "Primary Contact Updated",
      email: "contact@example.com",
      phone: "555-0199",
      isPrimary: true
    });
    const deleted = await handlers.handlePortalContactDelete(session, "contact-1");

    expect(contacts.status).toBe(200);
    expect(contact.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(200);
    if ("error" in contacts.body || "error" in contact.body || "error" in created.body || "error" in updated.body || "error" in deleted.body) {
      throw new Error("Expected successful portal contact responses.");
    }
    expect(contacts.body.items[0]?.email).toBe("contact@example.com");
    expect(contact.body.item.name).toBe("Primary Contact");
    expect(created.body.item.clientId).toBe("client-1");
    expect(updated.body.item.phone).toBe("555-0199");
    expect(deleted.body).toEqual({ deleted: true });
  });

  it("returns portal and admin pet file collections, details, and deletes", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalFiles = await handlers.handlePortalPetFiles(portalSession, "pet-1");
    const portalFile = await handlers.handlePortalPetFileDetail(portalSession, "pet-1", "pet-file-1");
    const portalDeleted = await handlers.handlePortalPetFileDelete(portalSession, "pet-1", "pet-file-1");
    const adminFiles = await handlers.handleAdminPetFiles(adminSession, "pet-1");
    const adminFile = await handlers.handleAdminPetFileDetail(adminSession, "pet-1", "pet-file-1");
    const adminDeleted = await handlers.handleAdminPetFileDelete(adminSession, "pet-1", "pet-file-1");

    expect(portalFiles.status).toBe(200);
    expect(portalFile.status).toBe(200);
    expect(portalDeleted.status).toBe(200);
    expect(adminFiles.status).toBe(200);
    expect(adminFile.status).toBe(200);
    expect(adminDeleted.status).toBe(200);
    if (
      "error" in portalFiles.body
      || "error" in portalFile.body
      || "error" in portalDeleted.body
      || "error" in adminFiles.body
      || "error" in adminFile.body
      || "error" in adminDeleted.body
    ) {
      throw new Error("Expected successful pet file responses.");
    }
    expect(portalFiles.body.items[0]?.fileType).toBe("document");
    expect(portalFile.body.item.originalName).toBe("Vaccination Record.pdf");
    expect(portalDeleted.body).toEqual({ deleted: true });
    expect(adminFiles.body.items[0]?.uploadedByAdminUserId).toBe("admin-1");
    expect(adminFile.body.item.mimeType).toBe("image/jpeg");
    expect(adminDeleted.body).toEqual({ deleted: true });
  });

  it("returns portal and admin pet file content payloads", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalContent = await handlers.handlePortalPetFileContent(portalSession, "pet-1", "pet-file-1", false);
    const adminContent = await handlers.handleAdminPetFileContent(adminSession, "pet-1", "pet-file-1", true);

    expect(portalContent.status).toBe(200);
    expect(adminContent.status).toBe(200);
    if ("error" in portalContent.body || "error" in adminContent.body) {
      throw new Error("Expected successful pet file content responses.");
    }
    expect(portalContent.body.disposition).toBe("inline");
    expect(Buffer.from(portalContent.body.contentBase64, "base64").toString("utf8")).toBe("vaccination-record-body");
    expect(adminContent.body.disposition).toBe("attachment");
    expect(Buffer.from(adminContent.body.contentBase64, "base64").toString("utf8")).toBe("buddy-headshot-body");
  });

  it("returns portal and admin achievement resources plus printable certificate html", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const portalSession = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };
    const adminSession = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const portalAchievements = await handlers.handlePortalAchievements(portalSession);
    const portalAchievement = await handlers.handlePortalAchievementDetail(portalSession, "achievement-1");
    const portalCertificate = await handlers.handlePortalAchievementCertificate(portalSession, "achievement-1", false);
    const adminAchievementTypes = await handlers.handleAdminAchievementTypes(adminSession);
    const adminAchievementType = await handlers.handleAdminAchievementTypeDetail(adminSession, "achievement-type-1");
    const adminClientAchievements = await handlers.handleAdminClientAchievements(adminSession, "client-1");
    const adminClientAchievement = await handlers.handleAdminClientAchievementDetail(adminSession, "client-1", "achievement-1");
    const adminCertificate = await handlers.handleAdminClientAchievementCertificate(adminSession, "client-1", "achievement-1", true);

    expect(portalAchievements.status).toBe(200);
    expect(portalAchievement.status).toBe(200);
    expect(portalCertificate.status).toBe(200);
    expect(adminAchievementTypes.status).toBe(200);
    expect(adminAchievementType.status).toBe(200);
    expect(adminClientAchievements.status).toBe(200);
    expect(adminClientAchievement.status).toBe(200);
    expect(adminCertificate.status).toBe(200);
    if (
      "error" in portalAchievements.body
      || "error" in portalAchievement.body
      || "error" in adminAchievementTypes.body
      || "error" in adminAchievementType.body
      || "error" in adminClientAchievements.body
      || "error" in adminClientAchievement.body
    ) {
      throw new Error("Expected successful achievement responses.");
    }
    if (typeof portalCertificate.body !== "string" || typeof adminCertificate.body !== "string") {
      throw new Error("Expected printable achievement certificate HTML.");
    }

    expect(portalAchievements.body.items[0]?.title).toBe("Canine Good Citizen");
    expect(portalAchievement.body.item.dogName).toBe("Buddy");
    expect(portalCertificate.body).toContain("<h1>Canine Good Citizen</h1>");
    expect(adminAchievementTypes.body.items[0]?.awardMode).toBe("badge_certificate");
    expect(adminAchievementType.body.item.scopeType).toBe("general");
    expect(adminClientAchievements.body.items[0]?.status).toBe("awarded");
    expect(adminClientAchievement.body.item.programName).toBe("Obedience 101");
    expect(adminCertificate.body).toContain('data-download="1"');
  });

  it("returns admin resource collections and details for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const clients = await handlers.handleAdminClients(session);
    const pets = await handlers.handleAdminPets(session);
    const pet = await handlers.handleAdminPetDetail(session, "pet-1");
    const client = await handlers.handleAdminClientDetail(session, "client-1");
    const booking = await handlers.handleAdminBookingDetail(session, "booking-2");
    const invoices = await handlers.handleAdminInvoices(session);
    const invoice = await handlers.handleAdminInvoiceDetail(session, "invoice-1");
    const quotes = await handlers.handleAdminQuotes(session);
    const quote = await handlers.handleAdminQuoteDetail(session, "quote-1");
    const contracts = await handlers.handleAdminContracts(session);
    const contract = await handlers.handleAdminContractDetail(session, "contract-1");
    const forms = await handlers.handleAdminForms(session);
    const form = await handlers.handleAdminFormDetail(session, "form-1");

    expect(clients.status).toBe(200);
    expect(pets.status).toBe(200);
    expect(pet.status).toBe(200);
    expect(client.status).toBe(200);
    expect(booking.status).toBe(200);
    expect(invoices.status).toBe(200);
    expect(invoice.status).toBe(200);
    expect(quotes.status).toBe(200);
    expect(quote.status).toBe(200);
    expect(contracts.status).toBe(200);
    expect(contract.status).toBe(200);
    expect(forms.status).toBe(200);
    expect(form.status).toBe(200);
    if (
      "error" in clients.body
      || "error" in pets.body
      || "error" in pet.body
      || "error" in client.body
      || "error" in booking.body
      || "error" in invoices.body
      || "error" in invoice.body
      || "error" in quotes.body
      || "error" in quote.body
      || "error" in contracts.body
      || "error" in contract.body
      || "error" in forms.body
      || "error" in form.body
    ) {
      throw new Error("Expected successful admin resource responses.");
    }
    expect(clients.body.items).toHaveLength(1);
    expect(pets.body.items[0]?.id).toBe("pet-1");
    expect(pets.body.items[0]?.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(pet.body.item.species).toBe("Dog");
    expect(pet.body.item.petSittingNotes).toBe("Use the side gate and towel paws before re-entry.");
    expect(client.body.item.email).toBe("client@example.com");
    expect(booking.body.item.id).toBe("booking-2");
    expect(invoices.body.items[0]?.id).toBe("invoice-1");
    expect(invoice.body.item.id).toBe("invoice-1");
    expect(quotes.body.items[0]?.id).toBe("quote-1");
    expect(quote.body.item.id).toBe("quote-1");
    expect(contracts.body.items[0]?.id).toBe("contract-1");
    expect(contract.body.item.id).toBe("contract-1");
    expect(forms.body.items).toHaveLength(2);
    expect(forms.body.items[0]?.id).toBe("form-1");
    expect(forms.body.items[1]?.id).toBe("form-hidden-1");
    expect(form.body.item.id).toBe("form-1");
    expect(form.body.item.clientReviewSubmission).toBe(true);
  });

  it("returns, creates, and updates admin client profiles for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const profile = await handlers.handleAdminClientProfile(session, "client-1");
    const created = await handlers.handleAdminClientCreate(session, {
      name: "Client Two",
      email: "client2@example.com",
      phone: "555-0200",
      address: "789 Pine Rd",
      notes: "New intake",
      isAdmin: true
    });
    const updated = await handlers.handleAdminClientUpdate(session, "client-1", {
      name: "Client One Updated",
      email: "client1-updated@example.com",
      phone: "555-0210",
      address: "123 Main St",
      notes: "Needs call back",
      isAdmin: false
    });

    expect(profile.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    if ("error" in profile.body || "error" in created.body || "error" in updated.body) {
      throw new Error("Expected successful admin client profile responses.");
    }
    expect(profile.body.item.notes).toBe("Needs follow-up");
    expect(created.body.item.isAdmin).toBe(true);
    expect(updated.body.item.name).toBe("Client One Updated");
    expect(updated.body.item.notes).toBe("Needs call back");
  });

  it("returns admin package and credit collections and details for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const packages = await handlers.handleAdminPackages(session);
    const packageDetail = await handlers.handleAdminPackageDetail(session, "package-1");
    const credits = await handlers.handleAdminCredits(session);
    const creditDetail = await handlers.handleAdminCreditDetail(session, "credit-1");

    expect(packages.status).toBe(200);
    expect(packageDetail.status).toBe(200);
    expect(credits.status).toBe(200);
    expect(creditDetail.status).toBe(200);
    if ("error" in packages.body || "error" in packageDetail.body || "error" in credits.body || "error" in creditDetail.body) {
      throw new Error("Expected successful admin package and credit responses.");
    }
    expect(packages.body.items[0]?.name).toBe("Starter Package");
    expect(packageDetail.body.item.price).toBe(325);
    expect(credits.body.items[0]?.id).toBe("credit-1");
    expect(creditDetail.body.item.remainingUnits).toBe(4);
  });

  it("returns admin client contact collections and supports admin client contact mutations", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const contacts = await handlers.handleAdminClientContacts(session, "client-1");
    const contact = await handlers.handleAdminClientContactDetail(session, "client-1", "contact-1");
    const created = await handlers.handleAdminClientContactCreate(session, "client-1", {
      name: "Office Contact",
      email: "office@example.com",
      phone: "555-0200",
      isPrimary: false
    });
    const updated = await handlers.handleAdminClientContactUpdate(session, "client-1", "contact-1", {
      name: "Office Contact Updated",
      email: "office@example.com",
      phone: "555-0201",
      isPrimary: true
    });
    const deleted = await handlers.handleAdminClientContactDelete(session, "client-1", "contact-1");

    expect(contacts.status).toBe(200);
    expect(contact.status).toBe(200);
    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(200);
    if ("error" in contacts.body || "error" in contact.body || "error" in created.body || "error" in updated.body || "error" in deleted.body) {
      throw new Error("Expected successful admin client contact responses.");
    }
    expect(contacts.body.items[0]?.isPrimary).toBe(true);
    expect(contact.body.item.id).toBe("contact-1");
    expect(created.body.item.email).toBe("office@example.com");
    expect(updated.body.item.isPrimary).toBe(true);
    expect(deleted.body).toEqual({ deleted: true });
  });

  it("syncs an admin booking to google calendar for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const result = await handlers.handleAdminBookingCalendarSync(session, "booking-2", {
      provider: "google_calendar"
    });

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful admin booking calendar sync response.");
    }
    expect(result.body.provider).toBe("google_calendar");
    expect(result.body.externalEventId).toBe("google-calendar-booking-2-2026-05-27");
    expect(result.body.booking.id).toBe("booking-2");
  });

  it("returns an existing admin booking google calendar sync for a valid admin session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "admin-1",
      actorType: "admin_user" as const,
      role: "accountant" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const result = await handlers.handleAdminBookingCalendarSyncDetail(session, "booking-2");

    expect(result.status).toBe(200);
    if ("error" in result.body) {
      throw new Error("Expected successful admin booking calendar sync detail response.");
    }
    expect(result.body.provider).toBe("google_calendar");
    expect(result.body.externalEventId).toBe("google-calendar-booking-2-2026-05-27");
    expect(result.body.booking.id).toBe("booking-2");
  });

  it("accepts a portal quote and creates an invoice payment session for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const acceptedQuote = await handlers.handlePortalQuoteAccept(session, "quote-1");
    const paymentSession = await handlers.handlePortalInvoicePaymentSession(session, "invoice-1", {
      returnUrl: "https://portal.example.test/portal/payments/complete",
      cancelUrl: "https://portal.example.test/portal/payments/cancelled"
    });

    expect(acceptedQuote.status).toBe(200);
    expect(paymentSession.status).toBe(200);
    if ("error" in acceptedQuote.body || "error" in paymentSession.body) {
      throw new Error("Expected successful portal commerce responses.");
    }
    expect(acceptedQuote.body.item.status).toBe("accepted");
    expect(paymentSession.body.paymentSession.provider).toBe("stripe");
    expect(paymentSession.body.invoice.id).toBe("invoice-1");
  });

  it("signs a portal contract and submits a portal form for a valid portal session", async () => {
    const handlers = createApiHandlers(createApiDependencies());
    const session = {
      actorId: "client-1",
      actorType: "portal_user" as const,
      issuedAt: "2026-05-27T18:00:00.000Z",
      expiresAt: "2026-05-27T18:00:00.000Z"
    };

    const signedContract = await handlers.handlePortalContractSign(session, "contract-1");
    const submittedForm = await handlers.handlePortalFormSubmit(session, "form-1");

    expect(signedContract.status).toBe(200);
    expect(submittedForm.status).toBe(200);
    if ("error" in signedContract.body || "error" in submittedForm.body) {
      throw new Error("Expected successful portal document action responses.");
    }
    expect(signedContract.body.item.status).toBe("signed");
    expect(submittedForm.body.item.submittedAt).toBe("2026-05-27T18:00:00.000Z");
  });

  it("returns public tokenized quote, contract, form, and booking iCal resources when access is valid", async () => {
    const handlers = createApiHandlers(createApiDependencies());

    const quote = await handlers.handlePublicQuoteDetail({
      token: "quote-access-token-1234",
      quoteId: "quote-1",
      session: null
    });
    const contract = await handlers.handlePublicContractDetail({
      token: "contract-access-token-1234",
      contractId: "contract-1",
      session: null
    });
    const form = await handlers.handlePublicFormSubmissionDetail({
      token: "form-access-token-123456",
      submissionId: "form-1",
      session: null
    });
    const bookingIcal = await handlers.handlePublicBookingIcalDetail({
      token: "ical-access-token-123456",
      bookingId: "booking-ical-1",
      session: null
    });

    expect(quote.status).toBe(200);
    expect(contract.status).toBe(200);
    expect(form.status).toBe(200);
    expect(bookingIcal.status).toBe(200);
    if ("error" in quote.body || "error" in contract.body || "error" in form.body) {
      throw new Error("Expected successful public-access responses.");
    }
    if (typeof bookingIcal.body !== "string") {
      throw new Error("Expected iCal feed string response.");
    }
    expect(quote.body.item.id).toBe("quote-1");
    expect(contract.body.item.id).toBe("contract-1");
    expect(form.body.item.id).toBe("form-1");
    expect(bookingIcal.body).toContain("BEGIN:VCALENDAR");
    expect(bookingIcal.body).toContain("UID:booking-ical-1@bdta.local");
    expect(bookingIcal.body).toContain("SUMMARY:BDTA Booking - svc-private-lesson");
  });

  it("accepts IMAP callbacks and returns a queued email receiver job receipt", async () => {
    let queuedJobPayload: Record<string, unknown> | null = null;
    const handlers = createApiHandlers(createApiDependencies({
      integrationCallbacks: createIntegrationCallbackDependencies({
        queueJob: async (job) => {
          queuedJobPayload = job.payload as Record<string, unknown>;
        }
      })
    }));

    const result = await handlers.handleIntegrationCallback({
      provider: "imap",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        messageId: "imap-message-1",
        from: "owner@example.com",
        subject: "Need help with my booking"
      }
    });

    expect(result.status).toBe(202);
    if ("error" in result.body) {
      throw new Error("Expected successful integration callback response.");
    }
    expect(result.body.accepted).toBe(true);
    expect(result.body.provider).toBe("imap");
    expect(result.body.callbackId).toMatch(/^callback-/);
    expect(result.body.queuedJobId).toMatch(/^job-/);
    expect(queuedJobPayload).toEqual({
      callbackId: result.body.callbackId,
      provider: "imap",
      messageId: "imap-message-1",
      from: "owner@example.com",
      subject: "Need help with my booking",
      receivedAt: "2026-05-27T18:05:00.000Z"
    });
  });

  it("accepts mail provider callbacks and returns a queued email receiver job receipt", async () => {
    let queuedJob: { kind: string; payload: Record<string, unknown> } | null = null;
    const handlers = createApiHandlers(createApiDependencies({
      integrationCallbacks: createIntegrationCallbackDependencies({
        queueJob: async (job) => {
          queuedJob = job;
        }
      })
    }));

    const result = await handlers.handleIntegrationCallback({
      provider: "mail_provider",
      receivedAt: "2026-05-27T18:06:00.000Z",
      payload: {
        mailbox: "support",
        messageId: "provider-message-1",
        from: "client@example.com",
        subject: "Reply to contract reminder"
      }
    });

    expect(result.status).toBe(202);
    if ("error" in result.body) {
      throw new Error("Expected successful mail provider callback response.");
    }
    expect(result.body.accepted).toBe(true);
    expect(result.body.provider).toBe("mail_provider");
    expect(result.body.callbackId).toMatch(/^callback-/);
    expect(result.body.queuedJobId).toMatch(/^job-/);
    expect(queuedJob).toEqual(expect.objectContaining({
      kind: "email_receiver",
      payload: {
        callbackId: result.body.callbackId,
        provider: "mail_provider",
        mailbox: "support",
        messageId: "provider-message-1",
        from: "client@example.com",
        subject: "Reply to contract reminder",
        receivedAt: "2026-05-27T18:06:00.000Z"
      }
    }));
  });

  it("accepts google calendar callbacks and applies calendar sync updates", async () => {
    let receivedUpdate: {
      bookingId: string;
      externalEventId: string;
      externalEventUrl: string | null;
      syncedAt: string;
    } | null = null;
    const handlers = createApiHandlers(createApiDependencies({
      integrationCallbacks: createIntegrationCallbackDependencies({
        applyGoogleCalendarSyncUpdate: async (input) => {
          receivedUpdate = input;
        }
      })
    }));

    const result = await handlers.handleIntegrationCallback({
      provider: "google_calendar",
      receivedAt: "2026-05-27T18:05:00.000Z",
      payload: {
        bookingId: "booking-sync-1",
        externalEventId: "google-event-1",
        externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1"
      }
    });

    expect(result.status).toBe(202);
    if ("error" in result.body) {
      throw new Error("Expected successful google calendar callback response.");
    }
    expect(result.body.accepted).toBe(true);
    expect(result.body.provider).toBe("google_calendar");
    expect(result.body.queuedJobId).toBeNull();
    expect(receivedUpdate).toEqual({
      bookingId: "booking-sync-1",
      externalEventId: "google-event-1",
      externalEventUrl: "https://calendar.google.com/calendar/event?eid=google-event-1",
      syncedAt: "2026-05-27T18:05:00.000Z"
    });
  });
});
