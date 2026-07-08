import { Buffer } from "node:buffer";

import {
  createInMemoryPlatformState,
  type InMemoryPlatformState,
  type InMemoryAdminUser,
  type InMemoryPortalUser
} from "@bdta/infrastructure";
import type {
  AchievementType,
  BlogPost,
  Booking,
  ClientAchievement,
  ClientContact,
  Contract,
  Credit,
  FormTemplate,
  FormSubmission,
  Invoice,
  Notification,
  Package,
  Pet,
  PetFile,
  Quote,
  Setting,
  SitePage,
  Workflow,
  WorkflowAutoEnrollmentTrigger,
  WorkflowEnrollment,
  WorkflowStep,
  WorkflowStepExecution
} from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";
import { createManagedSettingsCatalog } from "./settings-catalog.js";

export const releaseValidationNow = "2026-06-01T18:00:00.000Z";

export const releaseValidationPortalCredentials = {
  email: "portal@example.com",
  password: "portal-password"
} as const;

export const releaseValidationAdminCredentials = {
  username: "brook",
  password: "admin-password"
} as const;

export const releaseValidationIds = {
  portalClientId: "client-portal-1",
  adminActorId: "admin-1",
  bookingId: "booking-1",
  invoiceId: "invoice-1",
  quoteId: "quote-1",
  contractId: "contract-1",
  formId: "form-1",
  packageId: "package-1",
  creditId: "credit-1",
  workflowId: "workflow-1",
  workflowTriggerId: "workflow-trigger-1",
  workflowEnrollmentId: "workflow-enrollment-1",
  workflowStepId: "workflow-step-1",
  workflowStepExecutionId: "workflow-step-execution-1",
  scheduledTaskId: "scheduled-task-1",
  workflowEmailTemplateId: "email-template-1",
  workflowAppointmentTypeId: "appointment-type-1",
  checkoutFormTemplateId: "template-2",
  surveyFormTemplateId: "template-4",
  petId: "pet-1",
  petFileId: "pet-file-1",
  contactId: "contact-1",
  achievementTypeId: "achievement-type-1",
  achievementId: "achievement-1",
  blogPostId: "blog-1",
  blogSlug: "loose-leash-training-tips",
  servicesPageId: "page-services",
  directoryPageId: "page-directory",
  settingsKey: "turnstile_site_key",
  jobId: "job-queued-1",
  callbackId: "callback-1"
} as const;

function createPortalUsers(): InMemoryPortalUser[] {
  return [
    {
      clientId: releaseValidationIds.portalClientId,
      email: releaseValidationPortalCredentials.email,
      displayName: "Casey Client",
      passwordHash: "portal-hash",
      phone: "555-0100",
      address: "123 Harbor Way",
      notes: "Portal validation fixture.",
      archived: false,
      isAdmin: false
    }
  ];
}

function createAdminUsers(): InMemoryAdminUser[] {
  return [
    {
      actorId: releaseValidationIds.adminActorId,
      username: releaseValidationAdminCredentials.username,
      displayName: "Brook Admin",
      passwordHash: "admin-hash",
      role: "owner",
      active: true
    }
  ];
}

function createBlogPosts(): BlogPost[] {
  return [
    {
      id: releaseValidationIds.blogPostId,
      title: "Loose Leash Training Tips",
      slug: releaseValidationIds.blogSlug,
      content: "<p>Walks start before the leash clips on.</p><p>Reward the dog in front of you.</p>",
      excerpt: "Walks start before the leash clips on.",
      coverPhoto: "/assets/images/hero-dog-real.jpg",
      author: "Brook",
      published: true,
      publishDate: "2026-05-30T15:00:00.000Z",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-30T15:00:00.000Z"
    }
  ];
}

function createSitePages(): SitePage[] {
  return [
    {
      id: "page-home",
      slug: "home",
      title: "Brook's Dog Training Academy",
      htmlContent: [
        "<section>",
        "<p class=\"eyebrow\">Balanced Training for Real Family Life</p>",
        "<h1>Train the dog in front of you.</h1>",
        "<p>Private lessons, board-and-train, and practical follow-through for real homes.</p>",
        "</section>"
      ].join(""),
      cssContent: "h1 { color: #6b2c5d; }",
      metaDescription: "Private lessons and board-and-train programs.",
      metaKeywords: "dog training, obedience",
      ogTitle: "BDTA Home",
      ogDescription: "Dog training for real family life.",
      ogImage: "/images/og/home.jpg",
      isHomepage: true,
      published: true,
      sortOrder: 1,
      updatedByAdminUserId: releaseValidationIds.adminActorId,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-30T12:00:00.000Z"
    },
    {
      id: releaseValidationIds.servicesPageId,
      slug: "services",
      title: "Services",
      htmlContent: "<section><h1>Programs</h1><p>Private lessons and board-and-train.</p></section>",
      cssContent: "",
      metaDescription: "Training services",
      metaKeywords: "private lessons, board and train",
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      isHomepage: false,
      published: true,
      sortOrder: 2,
      updatedByAdminUserId: releaseValidationIds.adminActorId,
      createdAt: "2026-05-02T10:00:00.000Z",
      updatedAt: "2026-05-30T12:00:00.000Z"
    },
    {
      id: releaseValidationIds.directoryPageId,
      slug: "directory",
      title: "Directory",
      htmlContent: "<section><h1>Directory</h1><p>Trusted resources and local referrals.</p></section>",
      cssContent: "",
      metaDescription: "Training directory",
      metaKeywords: "directory, referrals",
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      isHomepage: false,
      published: true,
      sortOrder: 3,
      updatedByAdminUserId: releaseValidationIds.adminActorId,
      createdAt: "2026-05-03T10:00:00.000Z",
      updatedAt: "2026-05-30T12:00:00.000Z"
    }
  ];
}

function createSettings(): Setting[] {
  return createManagedSettingsCatalog("2026-05-30T12:00:00.000Z").map((setting) => (
    setting.key === "business_email"
      ? {
          ...setting,
          value: "help@example.com"
        }
      : setting
  ));
}

function createBookings(): Booking[] {
  return [
    {
      id: releaseValidationIds.bookingId,
      clientId: releaseValidationIds.portalClientId,
      petIds: [releaseValidationIds.petId],
      serviceId: "svc-private-lesson",
      startsAt: "2026-06-05T16:00:00.000Z",
      endsAt: "2026-06-05T17:00:00.000Z",
      status: "confirmed",
      icalAccess: {
        token: "booking-ical-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-booking-1"
      }
    }
  ];
}

function createInvoices(): Invoice[] {
  return [
    {
      id: releaseValidationIds.invoiceId,
      clientId: releaseValidationIds.portalClientId,
      status: "sent",
      totalAmount: 225,
      outstandingAmount: 125,
      dueAt: "2026-06-10T00:00:00.000Z"
    }
  ];
}

function createQuotes(): Quote[] {
  return [
    {
      id: releaseValidationIds.quoteId,
      clientId: releaseValidationIds.portalClientId,
      status: "sent",
      totalAmount: 450,
      publicAccess: {
        token: "quote-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-quote-1"
      }
    }
  ];
}

function createContracts(): Contract[] {
  return [
    {
      id: releaseValidationIds.contractId,
      clientId: releaseValidationIds.portalClientId,
      status: "sent",
      publicAccess: {
        token: "contract-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-contract-1"
      }
    }
  ];
}

function createForms(): FormSubmission[] {
  return [
    {
      id: releaseValidationIds.formId,
      templateId: "template-1",
      clientId: releaseValidationIds.portalClientId,
      templateName: "Follow-up Note",
      formType: "follow_up_note",
      templateIsInternal: true,
      templateShowInClientPortal: true,
      clientReviewSubmission: true,
      submittedAt: "2026-05-31T16:30:00.000Z",
      publicAccess: {
        token: "form-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-form-1"
      }
    },
    {
      id: "form-pending-1",
      templateId: "template-2",
      clientId: releaseValidationIds.portalClientId,
      templateName: "Client Intake",
      formType: "client_form",
      templateIsInternal: false,
      templateShowInClientPortal: true,
      submittedAt: null,
      publicAccess: {
        token: "form-pending-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-form-pending-1"
      }
    },
    {
      id: "form-hidden-1",
      templateId: "template-3",
      clientId: releaseValidationIds.portalClientId,
      templateName: "Internal Staff Note",
      formType: "client_form",
      templateIsInternal: true,
      templateShowInClientPortal: false,
      submittedAt: "2026-05-30T09:15:00.000Z",
      publicAccess: {
        token: "form-hidden-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-form-hidden-1"
      }
    },
    {
      id: "form-survey-1",
      templateId: releaseValidationIds.surveyFormTemplateId,
      clientId: releaseValidationIds.portalClientId,
      templateName: "Program Feedback Survey",
      formType: "survey_form",
      templateIsInternal: false,
      templateShowInClientPortal: true,
      status: "reviewed",
      reviewedByAdminUserId: releaseValidationIds.adminActorId,
      reviewedByName: "Brook Admin",
      reviewedAt: "2026-05-31T18:00:00.000Z",
      notes: "Client submitted positive program feedback.",
      submittedAt: "2026-05-31T17:15:00.000Z",
      responses: ["Very prepared", "Loved the prep checklist and pacing."],
      publicAccess: {
        token: "form-survey-public-token",
        issuedAt: "2026-05-30T12:00:00.000Z",
        expiresAt: null,
        legacySourceId: "legacy-form-survey-1"
      }
    }
  ];
}

function createFormTemplates(): FormTemplate[] {
  return [
    {
      id: "template-1",
      name: "Follow-up Note",
      active: true,
      description: "Post-appointment follow-up note.",
      fields: [{ label: "Follow-up Summary", type: "textarea", required: true }],
      formType: "follow_up_note",
      requiredFrequency: null,
      appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
      templateIsInternal: true,
      templateShowInClientPortal: true
    },
    {
      id: releaseValidationIds.checkoutFormTemplateId,
      name: "Client Intake",
      active: true,
      description: "Client-facing intake form used for onboarding and package checkout.",
      fields: [{ label: "Primary Concern", type: "textarea", required: true }],
      formType: "client_form",
      requiredFrequency: "once",
      appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
      templateIsInternal: false,
      templateShowInClientPortal: true
    },
    {
      id: "template-3",
      name: "Internal Staff Note",
      active: true,
      description: "Internal-only staff notes form.",
      fields: [{ label: "Internal Notes", type: "textarea", required: false }],
      formType: "pet_form",
      requiredFrequency: null,
      appointmentTypeId: null,
      templateIsInternal: true,
      templateShowInClientPortal: false
    },
    {
      id: releaseValidationIds.surveyFormTemplateId,
      name: "Program Feedback Survey",
      active: true,
      description: "Client survey used to collect post-program readiness feedback.",
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
      requiredFrequency: null,
      appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
      templateIsInternal: false,
      templateShowInClientPortal: true
    }
  ];
}

function createNotifications(): Notification[] {
  return [
    {
      id: "notification-follow-up-1",
      clientId: releaseValidationIds.portalClientId,
      channel: "portal",
      entityType: "follow_up_note",
      entityId: releaseValidationIds.formId,
      subject: "New follow-up note available",
      message: "Your Follow-up Note is ready to review in the client portal.",
      url: `/portal/forms/${releaseValidationIds.formId}`,
      isRead: false,
      createdAt: "2026-05-31T16:35:00.000Z"
    }
  ];
}

function createPackages(): Package[] {
  return [
    {
      id: releaseValidationIds.packageId,
      name: "Starter Package",
      description: "Four-session starter bundle for foundational training.",
      bulletPoints: ["Four consultations", "Homework support"],
      price: 450,
      active: true,
      expirationDays: 120,
      shareToken: "starter-package-token",
      portalAvailable: true,
      formTemplateId: null,
      items: [
        {
          appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
          appointmentTypeName: "Consultation",
          quantity: 4
        }
      ]
    }
  ];
}

function createCredits(): Credit[] {
  return [
    {
      id: releaseValidationIds.creditId,
      clientId: releaseValidationIds.portalClientId,
      packageId: releaseValidationIds.packageId,
      appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
      remainingUnits: 2
    }
  ];
}

function createContacts(): ClientContact[] {
  return [
    {
      id: releaseValidationIds.contactId,
      clientId: releaseValidationIds.portalClientId,
      name: "Primary Contact",
      email: "contact@example.com",
      phone: "555-0200",
      isPrimary: true
    }
  ];
}

function createPets(): Pet[] {
  return [
    {
      id: releaseValidationIds.petId,
      clientId: releaseValidationIds.portalClientId,
      name: "Scout",
      species: "Dog",
      petSittingNotes: "Use the side gate and towel paws before re-entry.",
      archived: false
    }
  ];
}

function createPetFiles(): PetFile[] {
  return [
    {
      id: releaseValidationIds.petFileId,
      petId: releaseValidationIds.petId,
      fileType: "document",
      fileName: "pet_pet-1_1.pdf",
      originalName: "Vaccination_Record.pdf",
      fileSize: 48,
      mimeType: "application/pdf",
      description: "Vaccination record",
      uploadedByAdminUserId: null,
      uploadedAt: "2026-05-30T12:00:00.000Z"
    }
  ];
}

function createAchievementTypes(): AchievementType[] {
  return [
    {
      id: releaseValidationIds.achievementTypeId,
      title: "Canine Citizen",
      description: "Core manners and handler confidence.",
      scopeType: "general",
      awardMode: "certificate_only",
      badgeIconPath: null,
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>Scout completed private lessons with steady public manners.</p>",
      active: true,
    }
  ];
}

function createClientAchievements(): ClientAchievement[] {
  return [
    {
      id: releaseValidationIds.achievementId,
      clientId: releaseValidationIds.portalClientId,
      achievementTypeId: releaseValidationIds.achievementTypeId,
      title: "Canine Citizen",
      description: "Completed private lessons with steady public manners.",
      scopeType: "general",
      programName: "Private Lessons",
      dogName: "Scout",
      awardedOn: "2026-05-28",
      awardMode: "certificate_only",
      badgeIconPath: null,
      certificateTemplatePath: null,
      certificateBodyHtml: "<p>Scout completed private lessons with steady public manners.</p>",
      status: "awarded",
      notes: "Awarded after final lesson.",
      awardedByAdminUserId: releaseValidationIds.adminActorId,
      updatedByAdminUserId: releaseValidationIds.adminActorId,
      revokedByAdminUserId: null,
      revokedAt: null,
      createdAt: "2026-05-28T18:00:00.000Z",
      updatedAt: "2026-05-28T18:00:00.000Z"
    }
  ];
}

function createWorkflows(): Workflow[] {
  return [
    {
      id: releaseValidationIds.workflowId,
      name: "Welcome Series",
      description: "New client onboarding workflow.",
      trigger: "manual",
      active: true,
      createdAt: "2026-05-27T18:00:00.000Z"
    }
  ];
}

function createWorkflowTriggers(): WorkflowAutoEnrollmentTrigger[] {
  return [
    {
      id: releaseValidationIds.workflowTriggerId,
      workflowId: releaseValidationIds.workflowId,
      triggerType: "appointment_booking",
      appointmentTypeId: releaseValidationIds.workflowAppointmentTypeId,
      formTemplateId: null,
      active: true,
      createdAt: "2026-05-27T18:00:00.000Z"
    }
  ];
}

function createWorkflowEnrollments(): WorkflowEnrollment[] {
  return [
    {
      id: releaseValidationIds.workflowEnrollmentId,
      workflowId: releaseValidationIds.workflowId,
      clientId: releaseValidationIds.portalClientId,
      status: "active",
      enrolledAt: "2026-05-27T18:00:00.000Z",
      nextRunAt: releaseValidationNow,
      completedAt: null,
      enrolledByAdminUserId: releaseValidationIds.adminActorId
    }
  ];
}

function createWorkflowSteps(): WorkflowStep[] {
  return [
    {
      id: releaseValidationIds.workflowStepId,
      workflowId: releaseValidationIds.workflowId,
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
}

function createWorkflowStepExecutions(): WorkflowStepExecution[] {
  return [
    {
      id: releaseValidationIds.workflowStepExecutionId,
      enrollmentId: releaseValidationIds.workflowEnrollmentId,
      stepId: releaseValidationIds.workflowStepId,
      scheduledFor: releaseValidationNow,
      executedAt: null,
      status: "pending",
      errorMessage: null
    }
  ];
}

function createWorkflowEmailTemplates() {
  return [
    {
      id: releaseValidationIds.workflowEmailTemplateId,
      name: "Workflow Welcome Template",
      templateType: "workflow",
      subject: "Template Subject",
      bodyHtml: "<p>Template Html</p>",
      bodyText: "Template Text",
      active: true
    }
  ];
}

function createWorkflowAppointmentTypes() {
  return [
    {
      id: releaseValidationIds.workflowAppointmentTypeId,
      name: "Consultation",
      description: "One-on-one training consultation.",
      bulletPoints: ["Behavior review", "Custom action plan"],
      adminUserId: releaseValidationIds.adminActorId,
      durationMinutes: 60,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
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
      defaultAmount: 150,
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
      confirmationTemplateId: releaseValidationIds.workflowEmailTemplateId,
      bookingRequestTemplateId: null,
      invoiceTemplateId: null,
      reminderTemplateId: null,
      cancellationTemplateId: null,
      requiresAdminConfirmation: true,
      usesResource: false,
      resourceName: "",
      resourceCapacity: 1,
      resourceAllocation: "per_appointment",
      uniqueLink: "consultation-link",
      active: true
    }
  ];
}

function createScheduledTasks() {
  return [
    {
      id: releaseValidationIds.scheduledTaskId,
      name: "Workflow Processor",
      taskType: "workflow_processor",
      active: true,
      scheduleType: "hourly",
      scheduleValue: ""
    }
  ];
}

function createQueuedJobs(): JobEnvelope[] {
  return [
    {
      jobId: releaseValidationIds.jobId,
      kind: "workflow_processor",
      scheduledFor: releaseValidationNow,
      payload: {
        limit: 10
      }
    }
  ];
}

export function createReleaseValidationState(): InMemoryPlatformState {
  const state = createInMemoryPlatformState({
    now: () => releaseValidationNow,
    blogPosts: createBlogPosts(),
    sitePages: createSitePages(),
    settings: createSettings(),
    bookings: createBookings(),
    contacts: createContacts(),
    pets: createPets(),
    petFiles: createPetFiles(),
    petFileContents: {
      [releaseValidationIds.petFileId]: new Uint8Array(Buffer.from("%PDF-1.4\nrelease-validation-pdf-body", "utf8"))
    },
    achievementTypes: createAchievementTypes(),
    clientAchievements: createClientAchievements(),
    invoices: createInvoices(),
    quotes: createQuotes(),
    contracts: createContracts(),
    formTemplates: createFormTemplates(),
    packages: createPackages(),
    credits: createCredits(),
    formSubmissions: createForms(),
    notifications: createNotifications(),
    workflows: createWorkflows(),
    workflowTriggers: createWorkflowTriggers(),
    workflowEnrollments: createWorkflowEnrollments(),
    workflowSteps: createWorkflowSteps(),
    workflowStepExecutions: createWorkflowStepExecutions(),
    appointmentTypes: createWorkflowAppointmentTypes(),
    emailTemplates: createWorkflowEmailTemplates(),
    scheduledTasks: createScheduledTasks(),
    portalUsers: createPortalUsers(),
    adminUsers: createAdminUsers(),
    queuedJobs: createQueuedJobs(),
    passwordVerifier: async (password, hash) => (
      (password === releaseValidationPortalCredentials.password && hash === "portal-hash")
      || (password === releaseValidationAdminCredentials.password && hash === "admin-hash")
    )
  });

  state.integrationCallbacks.push({
    callbackId: releaseValidationIds.callbackId,
    provider: "stripe",
    receivedAt: "2026-05-30T13:00:00.000Z",
    payload: {
      invoiceId: releaseValidationIds.invoiceId,
      status: "paid"
    },
    queuedJobId: null
  });

  return state;
}
