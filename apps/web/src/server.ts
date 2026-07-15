import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { z } from "zod";

import {
  beginPublicPackagePurchase,
  ContentError,
  createAdminSettingsUser,
  createApiHandlers,
  deleteAdminSettingsUser,
  getAdminSettingsOverview,
  PublicDocumentMutationError,
  updateAdminSettingsUserPermissions,
  loadPublicPackageCheckoutForm,
  normalizeNullableBlogCoverPhotoPath,
  PublicPackagePurchaseError,
  respondPublicQuote,
  SessionActorError,
  signPublicContract,
  submitPublicForm,
  type PublicPackageCheckoutForm,
  getPublicBlogPostDetail,
  getPublicSitePage,
  listPublicBlogPosts,
  resumePublicPackagePurchase,
  type ApiDependencies,
  type ContentManagementDependencies
} from "@bdta/application";
import { authSessionSchema } from "@bdta/contracts";
import {
  buildLaunchReadinessAssessment,
  indexSettingValues,
  loadEnvFileIfPresent,
  type LaunchReadinessAssessment,
  updateEnvFileValues
} from "@bdta/platform";
import type {
  AppointmentType,
  Booking,
  Client,
  ClientAchievement,
  ClientContact,
  ClientProfile,
  Contract,
  FormSubmission,
  Invoice,
  Package,
  Pet,
  PetFile,
  Quote,
  Setting,
  SitePage
} from "@bdta/domain";
import { createInMemoryApiDependencies, createInMemorySessionStore, type InMemoryPlatformState } from "@bdta/infrastructure";

type SessionStore = {
  save(sessionId: string, sessionData: string): Promise<void>;
  load(sessionId: string): Promise<string | null>;
  delete(sessionId: string): Promise<void>;
} | null;

type WebHealthCheck = () => Promise<{
  status: "ok" | "degraded";
  checks: Record<string, "ok" | "error">;
}>;

type ServerErrorContext = {
  requestId: string;
  method: string;
  path: string;
};

type RequestCompletionContext = ServerErrorContext & {
  statusCode: number;
  durationMs: number;
};

type HttpWebServerOptions =
  | {
    dependencies: ApiDependencies;
    sessionStore?: SessionStore;
    state?: never;
    content?: never;
    runtimeEnvironmentFilePath?: string;
    runtimeEnvironmentProcessEnv?: Record<string, string | undefined>;
    runtimeEnvironmentTemplateFilePath?: string;
    healthCheck?: WebHealthCheck;
    requestIdFactory?: () => string;
    onError?: (error: unknown, context: ServerErrorContext) => void | Promise<void>;
    onRequestComplete?: (context: RequestCompletionContext) => void | Promise<void>;
  }
  | {
    state: InMemoryPlatformState;
    dependencies?: never;
    content?: never;
    sessionStore?: never;
    runtimeEnvironmentFilePath?: string;
    runtimeEnvironmentProcessEnv?: Record<string, string | undefined>;
    runtimeEnvironmentTemplateFilePath?: string;
    healthCheck?: WebHealthCheck;
    requestIdFactory?: () => string;
    onError?: (error: unknown, context: ServerErrorContext) => void | Promise<void>;
    onRequestComplete?: (context: RequestCompletionContext) => void | Promise<void>;
  }
  | {
    content: ContentManagementDependencies;
    dependencies?: never;
    state?: never;
    sessionStore?: never;
    runtimeEnvironmentFilePath?: string;
    runtimeEnvironmentProcessEnv?: Record<string, string | undefined>;
    runtimeEnvironmentTemplateFilePath?: string;
    healthCheck?: WebHealthCheck;
    requestIdFactory?: () => string;
    onError?: (error: unknown, context: ServerErrorContext) => void | Promise<void>;
    onRequestComplete?: (context: RequestCompletionContext) => void | Promise<void>;
  };

type ResolvedWebDependencies = {
  content: ContentManagementDependencies;
  api: ApiDependencies | null;
  sessionStore: SessionStore;
};

type LayoutVariant = "public" | "portal" | "admin" | "auth";

type SettingConsoleMetadata = {
  launchCritical: boolean;
  usage: string[];
  placeholder?: string;
  options?: Array<{
    value: string;
    label: string;
  }>;
  multiline?: boolean;
};

type AdminSettingsUserView = {
  actorId: string;
  username: string;
  email: string;
  accountType: "main" | "standard" | "accountant";
  role: "owner" | "admin" | "accountant" | "staff";
  isMainAccount: boolean;
  canManageAdminUsers: boolean;
  canManageApiKeys: boolean;
  active: boolean;
};

type SettingsConsoleViewModel = {
  basePath: string;
  currentCategory: string;
  settings: Setting[];
  categories: string[];
  currentAdmin: AdminSettingsUserView;
  adminUsers: AdminSettingsUserView[];
  runtimeEnvironmentFields?: RuntimeEnvironmentFieldView[];
  launchReadiness?: LaunchReadinessAssessment;
  notice?: {
    tone: "success" | "danger" | "info";
    title: string;
    message: string;
  };
};

type CalendarOAuthActionsViewModel = Pick<SettingsConsoleViewModel, "basePath" | "settings">;

const adminGoogleCalendarOAuthConnectPath = "/admin/settings/calendar/google/connect";
const adminGoogleCalendarOAuthCallbackPath = "/admin/settings/calendar/google/callback";
const legacyGoogleCalendarOAuthInitiatePath = "/backend/public/google_oauth_initiate.php";
const legacyGoogleCalendarOAuthCallbackPath = "/backend/public/google_oauth_callback.php";
const googleCalendarOAuthStateCookieName = "bdta_google_oauth_state";
const expiredGoogleCalendarOAuthStateCookie = `${googleCalendarOAuthStateCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
const googleCalendarOAuthScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email"
] as const;

type RuntimeEnvironmentFieldDefinition = {
  key: string;
  label: string;
  description: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
};

type RuntimeEnvironmentFieldView = RuntimeEnvironmentFieldDefinition & {
  value: string;
  source: "process-env" | "env-file" | "unset";
};

const runtimeEnvironmentFieldDefinitions: RuntimeEnvironmentFieldDefinition[] = [
  {
    key: "DB_HOST",
    label: "MySQL Host",
    description: "MySQL server hostname used when DATABASE_URL is not provided.",
    placeholder: "localhost",
    required: true
  },
  {
    key: "DB_PORT",
    label: "MySQL Port",
    description: "MySQL server port. Defaults to 3306 when this is left blank.",
    placeholder: "3306"
  },
  {
    key: "DB_NAME",
    label: "MySQL Database Name",
    description: "Database name used by the live site and staff tools.",
    placeholder: "bdta",
    required: true
  },
  {
    key: "DB_USER",
    label: "MySQL Username",
    description: "Database username used when DATABASE_URL is not provided.",
    placeholder: "bdta_user",
    required: true
  },
  {
    key: "DB_PASSWORD",
    label: "MySQL Password",
    description: "Database password used when DATABASE_URL is not provided.",
    secret: true,
    required: true
  },
  {
    key: "DATABASE_URL",
    label: "Database URL Override",
    description: "Optional direct MySQL connection string. Leave blank to use the legacy DB_* fields above.",
    placeholder: "mysql://user:password@localhost:3306/bdta",
    secret: true
  },
  {
    key: "SESSION_LIFETIME_SECONDS",
    label: "Session Lifetime Seconds",
    description: "Legacy-compatible session lifetime value used for admin and portal sessions.",
    placeholder: "1209600"
  },
  {
    key: "HOST",
    label: "Listen Host",
    description: "Optional server host override. Leave blank to use 0.0.0.0.",
    placeholder: "0.0.0.0"
  },
  {
    key: "PORT",
    label: "Listen Port",
    description: "Optional server port override. Leave blank to use 3000.",
    placeholder: "3000"
  },
  {
    key: "JOB_POLL_INTERVAL_MS",
    label: "Job Poll Interval (ms)",
    description: "Optional background job polling interval override.",
    placeholder: "30000"
  },
  {
    key: "JOB_BATCH_SIZE",
    label: "Job Batch Size",
    description: "Optional maximum number of jobs claimed per processing batch.",
    placeholder: "25"
  },
  {
    key: "EMAIL_BATCH_SIZE",
    label: "Email Batch Size",
    description: "Optional maximum number of queued emails claimed per processing batch.",
    placeholder: "25"
  }
];

const PUBLIC_IMPORTED_PAGE_ROOT_ID = "wb_root";

const PUBLIC_HOMEPAGE_SECTION_IDS = new Set([
  "home",
  "about",
  "services",
  "events",
  "testimonials",
  "contact"
]);

const PUBLIC_SOCIAL_LINK_SETTINGS = [
  {
    key: "facebook_url",
    label: "Facebook",
    icon: "facebook",
    placeholder: "https://www.facebook.com/BrooksDogTrainingAcademy"
  },
  {
    key: "instagram_url",
    label: "Instagram",
    icon: "instagram",
    placeholder: "https://www.instagram.com/brooksdogtrainingacademy"
  },
  {
    key: "linktree_url",
    label: "Linktree",
    icon: "link",
    placeholder: "https://linktr.ee/brooksdogtrainingacademy"
  },
  {
    key: "tiktok_url",
    label: "TikTok",
    icon: "tiktok",
    placeholder: "https://www.tiktok.com/@brooksdogtrainingacademy"
  },
  {
    key: "youtube_url",
    label: "YouTube",
    icon: "youtube",
    placeholder: "https://www.youtube.com/@brooksdogtrainingacademy"
  },
  {
    key: "twitter_x_url",
    label: "Twitter / X",
    icon: "x",
    placeholder: "https://x.com/brookstda"
  },
  {
    key: "threads_url",
    label: "Threads",
    icon: "threads",
    placeholder: "https://www.threads.net/@brooksdogtrainingacademy"
  },
  {
    key: "nextdoor_url",
    label: "Nextdoor",
    icon: "house",
    placeholder: "https://nextdoor.com/pages/brooks-dog-training-academy"
  },
  {
    key: "patreon_url",
    label: "Patreon",
    icon: "patreon",
    placeholder: "https://www.patreon.com/brookstda"
  },
  {
    key: "pinterest_url",
    label: "Pinterest",
    icon: "pinterest",
    placeholder: "https://www.pinterest.com/brookstda"
  },
  {
    key: "snapchat_url",
    label: "Snapchat",
    icon: "snapchat",
    placeholder: "https://www.snapchat.com/add/brookstda"
  },
  {
    key: "linkedin_url",
    label: "LinkedIn",
    icon: "linkedin",
    placeholder: "https://www.linkedin.com/company/brookstda"
  },
  {
    key: "bluesky_url",
    label: "Bluesky",
    icon: "custom:bluesky-butterfly",
    placeholder: "https://bsky.app/profile/brookstda.example"
  },
  {
    key: "yelp_url",
    label: "Yelp",
    icon: "yelp",
    placeholder: "https://www.yelp.com/biz/brooks-dog-training-academy"
  },
  {
    key: "substack_url",
    label: "Substack",
    icon: "newspaper",
    placeholder: "https://brooksdogtrainingacademy.substack.com"
  }
] as const;

const PUBLIC_ASSET_ROOT = resolve(process.cwd(), "public", "assets");
const PUBLIC_ASSET_PREFIX = "/assets/";
const BUILT_IN_PUBLIC_PAGE_SLUGS = new Set(["services", "directory"]);
const NEWSLETTER_EMBED_MARKUP_CACHE = new Map<string, Promise<string>>();

const SETTINGS_CATEGORY_LABELS = new Map<string, string>([
  ["site", "Site"],
  ["payments", "Payments"],
  ["security", "Security"],
  ["communications", "Communications"],
  ["integrations", "Integrations"],
  ["general", "General"],
  ["email", "Email"],
  ["payment", "Payments"],
  ["booking", "Booking"],
  ["calendar", "Calendar"],
  ["invoice", "Invoices"],
  ["time_tracking", "Time Tracking"],
  ["social", "Social"],
  ["database", "Database"],
  ["theme", "Theme"],
  ["advanced", "Advanced"],
  ["admins", "Admins"]
]);

const SETTINGS_CATEGORY_DESCRIPTIONS = new Map<string, string>([
  ["site", "Control public URLs, shared identity details, and the defaults that shape the customer-facing experience."],
  ["payments", "Manage Stripe mode, production keys, and the switches that control payment availability."],
  ["security", "Review verification, bot protection, and other settings that protect public form entry points."],
  ["communications", "Tune outbound email delivery, inbox processing, and follow-up channels used after bookings."],
  ["integrations", "Authorize calendar and other external services used by scheduling and follow-up work."],
  ["general", "Core business and website settings used across the public site, client accounts, and staff tools."],
  ["email", "Outbound and inbound mail delivery settings used by reminders, confirmations, and follow-up workflows."],
  ["payment", "Stripe mode, webhook credentials, and payment behavior used by invoices and package checkout."],
  ["booking", "Settings that shape booking requests, intake defaults, and customer scheduling flows."],
  ["calendar", "Calendar sync configuration and OAuth credentials used by scheduling integrations."],
  ["invoice", "Invoice behavior, defaults, and client-facing payment settings."],
  ["time_tracking", "Operational settings that affect time tracking and staff workflow capture."],
  ["social", "Public-facing social links and embed settings shown on the website."],
  ["database", "Database connection values used by the live site and staff tools."],
  ["theme", "Brand colors and front-end appearance settings used across the public site and portal."],
  ["advanced", "Advanced integrations, embeds, and operational switches that do not fit simpler categories."],
  ["admins", "Manage admin accounts, account types, and who can access sensitive operational settings."]
]);

const SETTINGS_CATEGORY_ORDER = [
  "site",
  "payments",
  "security",
  "communications",
  "integrations",
  "general",
  "email",
  "payment",
  "booking",
  "calendar",
  "invoice",
  "time_tracking",
  "social",
  "theme",
  "advanced"
] as const;

const SETTINGS_CONSOLE_METADATA = new Map<string, SettingConsoleMetadata>([
  ["base_url", {
    launchCritical: true,
    usage: [
      "Public redirects and canonical site URLs.",
      "Portal links included in emails and reminder workflows."
    ],
    placeholder: "https://dev.brooksdogtrainingacademy.com"
  }],
  ["stripe_enabled", {
    launchCritical: true,
    usage: [
      "Controls whether invoice payment flows can be offered in the portal.",
      "Used by payment-session creation and readiness checks."
    ],
    options: [
      { value: "1", label: "Enabled" },
      { value: "0", label: "Disabled" }
    ]
  }],
  ["stripe_mode", {
    launchCritical: true,
    usage: [
      "Chooses live or test Stripe credential sets.",
      "Readiness checks expect live mode for production launch."
    ],
    options: [
      { value: "live", label: "Live" },
      { value: "test", label: "Test" }
    ]
  }],
  ["stripe_live_secret_key", {
    launchCritical: true,
    usage: [
      "Used to create live payment sessions and process production charges."
    ]
  }],
  ["stripe_test_secret_key", {
    launchCritical: true,
    usage: [
      "Used for safe non-production validation of checkout flows."
    ]
  }],
  ["stripe_webhook_secret", {
    launchCritical: true,
    usage: [
      "Verifies raw Stripe webhook events posted to the callback endpoint.",
      "Required for direct invoice-payment and checkout completion callbacks in production."
    ]
  }],
  ["turnstile_site_key", {
    launchCritical: true,
    usage: [
      "Rendered on public booking forms.",
      "Paired with the Turnstile secret during form verification."
    ],
    placeholder: "0x4AAAA..."
  }],
  ["turnstile_secret_key", {
    launchCritical: true,
    usage: [
      "Validates public booking submissions before requests are accepted."
    ]
  }],
  ["imap_enabled", {
    launchCritical: true,
    usage: [
      "Turns inbound mailbox processing on or off."
    ],
    options: [
      { value: "1", label: "Enabled" },
      { value: "0", label: "Disabled" }
    ]
  }],
  ["imap_host", {
    launchCritical: true,
    usage: [
      "Used by inbound email ingestion jobs and unmatched-email reconciliation."
    ],
    placeholder: "imap.example.com"
  }],
  ["smtp_host", {
    launchCritical: true,
    usage: [
      "Used by outbound email delivery for confirmations, reminders, and workflow messages."
    ],
    placeholder: "smtp.example.com"
  }],
  ["google_oauth_client_id", {
    launchCritical: true,
    usage: [
      "Used when admins authorize Google Calendar sync."
    ],
    placeholder: "google-client-id.apps.googleusercontent.com"
  }],
  ["google_oauth_client_secret", {
    launchCritical: true,
    usage: [
      "Used with Google Calendar authorization and sync refresh paths."
    ]
  }],
  ["business_email", {
    launchCritical: false,
    usage: [
      "Used as the visible business contact address on public and CRM-facing messaging."
    ],
    placeholder: "hello@brooksdogtrainingacademy.com"
  }],
  ["smtp_port", {
    launchCritical: false,
    usage: [
      "Used by outbound SMTP delivery when the host requires a non-default port."
    ],
    placeholder: "587"
  }],
  ["smtp_encryption", {
    launchCritical: false,
    usage: [
      "Selects the encryption mode used for outbound SMTP connections."
    ],
    options: [
      { value: "tls", label: "TLS" },
      { value: "ssl", label: "SSL" },
      { value: "none", label: "None" }
    ]
  }],
  ["smtp_username", {
    launchCritical: false,
    usage: [
      "Used by outbound SMTP authentication when the provider requires credentials."
    ],
    placeholder: "bookings@example.com"
  }],
  ["smtp_password", {
    launchCritical: false,
    usage: [
      "Stored SMTP credential used for outgoing email delivery."
    ]
  }],
  ["smtp_debug", {
    launchCritical: false,
    usage: [
      "Enables verbose SMTP troubleshooting output during delivery diagnostics."
    ]
  }],
  ["sendgrid_api_key", {
    launchCritical: false,
    usage: [
      "Legacy SendGrid credential retained for parity with the previous admin settings catalog."
    ]
  }],
  ["mailgun_api_key", {
    launchCritical: false,
    usage: [
      "Legacy Mailgun credential retained for parity with the previous admin settings catalog."
    ]
  }],
  ["mailjet_api_key", {
    launchCritical: false,
    usage: [
      "Used by Mailjet-backed newsletter signup integrations."
    ]
  }],
  ["mailjet_api_secret", {
    launchCritical: false,
    usage: [
      "Secret paired with the Mailjet API key for newsletter integrations."
    ]
  }],
  ["mailjet_newsletter_list_id", {
    launchCritical: false,
    usage: [
      "Contacts list identifier used when syncing newsletter signups to Mailjet."
    ],
    placeholder: "0"
  }],
  ["imap_port", {
    launchCritical: false,
    usage: [
      "Used by inbound mailbox processing when the IMAP host requires a specific port."
    ],
    placeholder: "993"
  }],
  ["imap_encryption", {
    launchCritical: false,
    usage: [
      "Selects the encryption mode used for IMAP mailbox connections."
    ],
    options: [
      { value: "ssl", label: "SSL" },
      { value: "tls", label: "TLS" },
      { value: "none", label: "None" }
    ]
  }],
  ["imap_username", {
    launchCritical: false,
    usage: [
      "Mailbox username used by inbound email ingestion."
    ],
    placeholder: "inbox@example.com"
  }],
  ["imap_password", {
    launchCritical: false,
    usage: [
      "Mailbox password used by inbound email ingestion."
    ]
  }],
  ["imap_folder", {
    launchCritical: false,
    usage: [
      "Mailbox folder that the IMAP receiver polls for incoming messages."
    ],
    placeholder: "INBOX"
  }],
  ["imap_sync_days", {
    launchCritical: false,
    usage: [
      "Controls how many historical days of email the IMAP receiver syncs."
    ],
    placeholder: "30"
  }],
  ["stripe_test_publishable_key", {
    launchCritical: false,
    usage: [
      "Client-facing Stripe key used by test-mode payment flows."
    ],
    placeholder: "pk_test_..."
  }],
  ["stripe_live_publishable_key", {
    launchCritical: false,
    usage: [
      "Client-facing Stripe key used by live payment flows."
    ],
    placeholder: "pk_live_..."
  }],
  ["google_calendar_enabled", {
    launchCritical: false,
    usage: [
      "Enables the legacy Google Calendar service-account sync path."
    ]
  }],
  ["google_calendar_id", {
    launchCritical: false,
    usage: [
      "Calendar identifier used by the legacy service-account sync path."
    ],
    placeholder: "primary"
  }],
  ["google_calendar_credentials_file", {
    launchCritical: false,
    usage: [
      "Filesystem path to the service-account JSON credentials for legacy calendar sync."
    ],
    placeholder: "/secure/google-calendar-credentials.json"
  }],
  ["google_oauth_redirect_uri", {
    launchCritical: false,
    usage: [
      "OAuth callback URL used when admins authorize Google Calendar access."
    ],
    placeholder: "https://yourdomain.com/backend/public/google_oauth_callback.php"
  }],
  ["moxie_base_url", {
    launchCritical: false,
    usage: [
      "Workspace base URL used by the Moxie import utility."
    ],
    placeholder: "https://pod00.withmoxie.dev"
  }],
  ["moxie_api_key", {
    launchCritical: false,
    usage: [
      "API key used by the Moxie import utility."
    ]
  }],
  ["tawk_to_enabled", {
    launchCritical: false,
    usage: [
      "Controls whether the public Tawk.to chat widget is allowed to render.",
      "Admin sessions and legacy admin-area routes suppress the widget automatically."
    ]
  }],
  ["tawk_to_property_id", {
    launchCritical: false,
    usage: [
      "Property ID extracted from the Tawk.to embed snippet."
    ],
    placeholder: "0123456789abcdef01234567"
  }],
  ["tawk_to_widget_id", {
    launchCritical: false,
    usage: [
      "Optional widget ID extracted from the Tawk.to embed snippet."
    ],
    placeholder: "default"
  }],
  ["newsletter_embed_html", {
    launchCritical: false,
    usage: [
      "Trusted newsletter embed markup rendered directly on public site and blog pages.",
      "Only paste official provider embed code because raw HTML and scripts are stored as-is."
    ],
    multiline: true
  }]
]);

SETTINGS_CONSOLE_METADATA.set("public_notice_enabled", {
  launchCritical: false,
  usage: [
    "Controls whether the sticky public notice bar appears on public-facing pages.",
    "Visitors can dismiss the notice per page view without any stored preference."
  ]
});

SETTINGS_CONSOLE_METADATA.set("public_notice_text", {
  launchCritical: false,
  usage: [
    "Rendered as escaped multi-line notice text on public pages when the notice is enabled."
  ],
  placeholder: "Holiday hours, emergency notices, or temporary booking updates.",
  multiline: true
});

for (const socialLink of PUBLIC_SOCIAL_LINK_SETTINGS) {
  SETTINGS_CONSOLE_METADATA.set(socialLink.key, {
    launchCritical: false,
    usage: [
      `Public ${socialLink.label} link rendered in shared website social slots.`
    ],
    placeholder: socialLink.placeholder
  });
}

for (let index = 1; index <= 5; index += 1) {
  SETTINGS_CONSOLE_METADATA.set(`custom_social_link_${index}_label`, {
    launchCritical: false,
    usage: [
      `Optional short label shown for custom public social link ${index}.`
    ],
    placeholder: index === 1 ? "Podcast" : `Custom Link ${index}`
  });

  SETTINGS_CONSOLE_METADATA.set(`custom_social_link_${index}_url`, {
    launchCritical: false,
    usage: [
      `Optional public URL rendered for custom social link ${index}.`
    ],
    placeholder: index === 1 ? "https://example.com/podcast" : "https://example.com"
  });
}

const storedSessionSchema = z.object({
  session: authSessionSchema.extend({
    role: z.string().nullable().optional(),
    roleRefreshedAt: z.string().datetime().optional()
  })
});

type StoredSessionSnapshot = z.infer<typeof storedSessionSchema>["session"];

type PublicSocialLink = {
  name: string;
  url: string;
  icon: string;
};

type PublicRenderAssets = {
  newsletterEmbedWrappedMarkup: string;
  publicNoticeMarkup: string;
  socialLinks: PublicSocialLink[];
  tawkWidgetScript: string;
};

type PublicRenderFeatures = {
  includeNewsletterEmbed?: boolean;
  includeTawkWidget?: boolean;
};

type PublicRenderContext = {
  requestPath?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "";
}

function resolveSettingValue(settings: readonly Setting[], key: string): string {
  const match = settings.find((item) => item.key === key);
  return typeof match?.value === "string" ? match.value.trim() : "";
}

function readBooleanSettingValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function buildPublicNoticeMarkup(enabled: boolean, noticeText: string): string {
  const normalizedNoticeText = noticeText
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();

  if (!enabled || normalizedNoticeText === "") {
    return "";
  }

  const message = escapeHtml(normalizedNoticeText).replaceAll("\n", "<br>");

  return [
    "<style>",
    "body.bdta-public-notice-visible { padding-bottom: var(--bdta-public-notice-height, 0px); }",
    ".bdta-public-notice { position: fixed; right: 0; bottom: 0; left: 0; z-index: 1080; box-shadow: 0 -0.5rem 1rem rgba(0, 0, 0, 0.15); }",
    ".bdta-public-notice__content { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }",
    ".bdta-public-notice__message { flex: 1 1 auto; }",
    ".bdta-public-notice__dismiss { flex: 0 0 auto; padding: 0.25rem; box-shadow: none; }",
    "@media (max-width: 575.98px) { .bdta-public-notice__content { gap: 0.75rem; } }",
    "</style>",
    '<div class="bdta-public-notice bg-dark text-white border-top border-secondary-subtle" data-public-notice role="status">',
    '<div class="container py-2 small bdta-public-notice__content">',
    `<div class="bdta-public-notice__message">${message}</div>`,
    '<button type="button" class="btn-close btn-close-white bdta-public-notice__dismiss" data-public-notice-dismiss aria-label="Dismiss notice"></button>',
    "</div>",
    "</div>",
    "<script>",
    "(function () {",
    "    function initPublicNotice() {",
    "        var notice = document.querySelector('[data-public-notice]');",
    "        if (!notice || notice.dataset.initialized === '1') {",
    "            return;",
    "        }",
    "        notice.dataset.initialized = '1';",
    "        var dismissButton = notice.querySelector('[data-public-notice-dismiss]');",
    "        var body = document.body;",
    "        var root = document.documentElement;",
    "        var dismissed = false;",
    "        var resizeFrame = null;",
    "        function syncNoticeHeight() {",
    "            if (dismissed || !notice.isConnected || notice.hidden) {",
    "                return;",
    "            }",
    "            root.style.setProperty('--bdta-public-notice-height', notice.offsetHeight + 'px');",
    "            body.classList.add('bdta-public-notice-visible');",
    "        }",
    "        function dismissNotice() {",
    "            dismissed = true;",
    "            window.removeEventListener('resize', scheduleNoticeHeightSync);",
    "            if (resizeFrame !== null) {",
    "                window.cancelAnimationFrame(resizeFrame);",
    "                resizeFrame = null;",
    "            }",
    "            notice.hidden = true;",
    "            body.classList.remove('bdta-public-notice-visible');",
    "            root.style.removeProperty('--bdta-public-notice-height');",
    "        }",
    "        function scheduleNoticeHeightSync() {",
    "            if (dismissed || resizeFrame !== null) {",
    "                return;",
    "            }",
    "            resizeFrame = window.requestAnimationFrame(function () {",
    "                resizeFrame = null;",
    "                syncNoticeHeight();",
    "            });",
    "        }",
    "        if (dismissButton) {",
    "            dismissButton.addEventListener('click', dismissNotice);",
    "        }",
    "        syncNoticeHeight();",
    "        window.addEventListener('resize', scheduleNoticeHeightSync);",
    "    }",
    "    if (document.readyState === 'loading') {",
    "        document.addEventListener('DOMContentLoaded', initPublicNotice);",
    "    } else {",
    "        initPublicNotice();",
    "    }",
    "}());",
    "</script>"
  ].join("\n");
}

function injectPublicNoticeMarkup(html: string, markup: string): string {
  if (markup.trim() === "" || html.includes("data-public-notice")) {
    return html;
  }

  const htmlWithNotice = html.replace(/<\/body>/i, `${markup}\n</body>`);
  if (htmlWithNotice !== html) {
    return htmlWithNotice;
  }

  return `${html.trimEnd()}\n${markup}`;
}

function sanitizePublicSocialUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function getCustomSocialLinkLabel(label: string, url: string, index: number): string {
  const trimmedLabel = label.trim();
  if (trimmedLabel !== "") {
    return trimmedLabel;
  }

  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host === "" ? `Custom Link ${index}` : host;
  } catch {
    return `Custom Link ${index}`;
  }
}

function collectPublicSocialLinks(settings: readonly Setting[]): PublicSocialLink[] {
  const links: PublicSocialLink[] = [];

  for (const socialLink of PUBLIC_SOCIAL_LINK_SETTINGS) {
    const url = sanitizePublicSocialUrl(resolveSettingValue(settings, socialLink.key));
    if (url === "") {
      continue;
    }

    links.push({
      name: socialLink.label,
      url,
      icon: socialLink.icon
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const url = sanitizePublicSocialUrl(resolveSettingValue(settings, `custom_social_link_${index}_url`));
    if (url === "") {
      continue;
    }

    links.push({
      name: getCustomSocialLinkLabel(resolveSettingValue(settings, `custom_social_link_${index}_label`), url, index),
      url,
      icon: "link"
    });
  }

  return links;
}

function renderPublicSocialLinkIcon(link: PublicSocialLink): string {
  if (link.icon === "custom:bluesky-butterfly") {
    return '<span class="public-social-link__icon bdta-social-icon-bluesky" aria-hidden="true">B</span>';
  }

  const glyph = (link.name.trim().charAt(0) || "L").toUpperCase();
  return `<span class="public-social-link__icon" aria-hidden="true">${escapeHtml(glyph)}</span>`;
}

function renderPublicSocialLinks(links: readonly PublicSocialLink[]): string {
  return `<div class="public-social-links">${links.map((link) => {
    const ariaLabel = `Visit us on ${link.name} (opens in new tab)`;

    return [
      `<a href="${escapeAttribute(link.url)}" target="_blank" rel="noopener noreferrer" class="public-social-link" aria-label="${escapeAttribute(ariaLabel)}">`,
      renderPublicSocialLinkIcon(link),
      `<span class="public-social-link__label">${escapeHtml(link.name)}</span>`,
      "</a>"
    ].join("");
  }).join("")}</div>`;
}

function renderPublicSocialLinksBlock(slot: string, links: readonly PublicSocialLink[]): string {
  if (links.length === 0) {
    return "";
  }

  if (slot === "events") {
    return [
      '<div class="public-social-slot public-social-slot--events">',
      '<p class="section-copy">Follow us on social media for event updates and training tips.</p>',
      renderPublicSocialLinks(links),
      "</div>"
    ].join("");
  }

  if (slot === "contact") {
    return [
      '<div class="public-social-slot public-social-slot--contact">',
      "<h3>Follow Us</h3>",
      renderPublicSocialLinks(links),
      "</div>"
    ].join("");
  }

  if (slot === "footer") {
    return [
      '<div class="public-social-slot public-social-slot--footer">',
      renderPublicSocialLinks(links),
      "</div>"
    ].join("");
  }

  return "";
}

function replacePublicSocialLinksSlot(html: string, slot: string, replacement: string): string {
  const startMarker = `<!-- BDTA_SOCIAL_LINKS:${slot} -->`;
  const endMarker = `<!-- /BDTA_SOCIAL_LINKS:${slot} -->`;
  const rendered = `${startMarker}\n${replacement}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "s");

  return html.replace(pattern, rendered);
}

function applyPublicSocialLinks(html: string, links: readonly PublicSocialLink[]): string {
  let updatedHtml = html;

  for (const slot of ["events", "contact", "footer"] as const) {
    updatedHtml = replacePublicSocialLinksSlot(updatedHtml, slot, renderPublicSocialLinksBlock(slot, links));
  }

  return updatedHtml;
}

function getPublicThemeToggleButtonHtml(extraClasses = ""): string {
  const classNames = ["btn", "public-theme-toggle", extraClasses]
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

  return [
    `<button type="button" data-theme-toggle class="${escapeAttribute(classNames)}" title="Toggle dark mode" aria-label="Toggle dark mode">`,
    '<span class="public-theme-toggle__icon" data-theme-icon aria-hidden="true">*</span>',
    '<span class="public-theme-toggle__label" data-theme-label>Dark Mode</span>',
    "</button>"
  ].join("");
}

function parsePublicRequestUrl(requestPath: string | undefined): URL | null {
  if (requestPath == null || requestPath.trim() === "") {
    return null;
  }

  try {
    return new URL(requestPath, "https://bdta.local");
  } catch {
    return null;
  }
}

function resolveCurrentPublicNavContext(requestPath: string | undefined): "home" | "blog" | "directory" | "services" | "" {
  const requestUrl = parsePublicRequestUrl(requestPath);
  if (requestUrl == null) {
    return "";
  }

  if (requestUrl.pathname === "/services") {
    return "services";
  }

  if (requestUrl.pathname === "/page.php" && requestUrl.searchParams.get("slug")?.trim() === "services") {
    return "services";
  }

  if (requestUrl.pathname === "/directory") {
    return "directory";
  }

  if (requestUrl.pathname === "/page.php" && requestUrl.searchParams.get("slug")?.trim() === "directory") {
    return "directory";
  }

  if (requestUrl.pathname === "/blog" || requestUrl.pathname === "/blog/index.php" || requestUrl.pathname === "/blog/post.php") {
    return "blog";
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.php" || requestUrl.pathname === "/index.html") {
    return "home";
  }

  return "";
}

function normalizePublicHomepageSectionHref(href: string): string | null {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return null;
  }

  const pathPart = href.slice(0, hashIndex).replaceAll("\\", "/");
  const fragment = href.slice(hashIndex + 1).trim().toLowerCase();
  if (fragment === "" || !PUBLIC_HOMEPAGE_SECTION_IDS.has(fragment)) {
    return null;
  }

  if (pathPart.includes("?")) {
    return null;
  }

  if (pathPart !== "" && pathPart !== "/" && /^(?:(?:\.\.?\/)*)?index\.(?:php|html)$/i.test(pathPart) === false) {
    return null;
  }

  return `/#${fragment}`;
}

function normalizePublicHomepageSectionLinks(html: string): string {
  return html.replace(/href=(["'])([^"']+)\1/gi, (match, quote: string, href: string) => {
    const normalizedHref = normalizePublicHomepageSectionHref(href);
    if (normalizedHref == null || normalizedHref === href) {
      return match;
    }

    return `href=${quote}${normalizedHref}${quote}`;
  });
}

function syncPublicNavigationLinks(html: string, requestPath: string | undefined): string {
  let updatedHtml = normalizePublicHomepageSectionLinks(html);

  if (!updatedHtml.includes('href="/directory"') && !updatedHtml.includes('href="/page.php?slug=directory"')) {
    updatedHtml = updatedHtml.replace(
      /<li class="nav-item">\s*<a class="nav-link(?: active)?" href="(?:\/)?(?:blog\/index\.php|blog)">Blog<\/a>\s*<\/li>\s*/i,
      `<li class="nav-item">
                        <a class="nav-link" href="/directory">Directory</a>
                    </li>
                    $&`
    );
  }

  updatedHtml = updatedHtml.replace(
    /<li class="nav-item">\s*<a class="nav-link(?: active)?" href="(?:\/)?(?:page\.php\?slug=dog-training-fact-sheet|facts\/?(?:index\.php)?)">Dog Training Fact Sheet<\/a>\s*<\/li>\s*/gi,
    ""
  );

  const currentContext = resolveCurrentPublicNavContext(requestPath);
  return updatedHtml.replace(
    /<a class="([^"]*\bnav-link\b[^"]*)" href="([^"]+)">(Home|Services|Blog|Directory|Book)<\/a>/gi,
    (match, classValue: string, href: string, label: string) => {
      const classes = classValue
        .split(/\s+/)
        .filter((value) => value !== "" && value !== "active");

      const isActive = (
        (label === "Home" && currentContext === "home") ||
        (label === "Services" && currentContext === "services") ||
        (label === "Blog" && currentContext === "blog") ||
        (label === "Directory" && currentContext === "directory")
      );

      if (isActive) {
        classes.push("active");
      }

      return `<a class="${classes.join(" ")}" href="${href}"${isActive ? ' aria-current="page"' : ""}>${label}</a>`;
    }
  );
}

function hasImportedPageRoot(html: string): boolean {
  const importedRootPattern = PUBLIC_IMPORTED_PAGE_ROOT_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bid\\s*=\\s*(?:"${importedRootPattern}"|'${importedRootPattern}')`, "i").test(html);
}

function getImportedPageRuntimeCss(): string {
  return [
    ":is(.bdta-imported-page, body > #wb_root) {",
    "    width: 100%;",
    "    max-width: 100%;",
    "    overflow-x: clip;",
    "}",
    "[data-bs-theme=\"dark\"] :is(.bdta-imported-page, body > #wb_root) {",
    "    background-color: #ffffff;",
    "    color: #333333;",
    "}",
    ".bdta-imported-page > .bdta-import-layout {",
    "    margin-left: auto !important;",
    "    margin-right: auto !important;",
    "}",
    ".bdta-imported-page > .root,",
    ".bdta-imported-page #wb_root,",
    "body > #wb_root {",
    "    width: 100%;",
    "    max-width: 100%;",
    "    margin-left: auto;",
    "    margin-right: auto;",
    "    overflow-x: clip;",
    "}",
    ".bdta-imported-page .bdta-import-layout,",
    ".bdta-imported-page .bdta-import-block {",
    "    box-sizing: border-box;",
    "}",
    ":is(.bdta-imported-page, body > #wb_root) > :is(header, nav, .navbar, .collapse.navbar-collapse, .navbar-nav),",
    ":is(.bdta-imported-page, body > #wb_root) :is([id^=\"wb_header_\"], .navbar-toggler, .collapse.navbar-collapse, .navbar-nav.ms-auto) {",
    "    display: none !important;",
    "}",
    "@media (max-width: 767.98px) {",
    "    :is(.bdta-imported-page, body > #wb_root) .bdta-import-stack-phone,",
    "    :is(.bdta-imported-page, body > #wb_root) .bdta-import-layout,",
    "    :is(.bdta-imported-page, body > #wb_root) .bdta-import-block {",
    "        width: 100% !important;",
    "        min-width: 0 !important;",
    "        max-width: 100% !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) .bdta-import-block {",
    "        margin-left: auto !important;",
    "        margin-right: auto !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) .bdta-import-image {",
    "        width: 100%;",
    "        height: auto;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) a,",
    "    :is(.bdta-imported-page, body > #wb_root) p,",
    "    :is(.bdta-imported-page, body > #wb_root) h1,",
    "    :is(.bdta-imported-page, body > #wb_root) h2,",
    "    :is(.bdta-imported-page, body > #wb_root) h3,",
    "    :is(.bdta-imported-page, body > #wb_root) h4,",
    "    :is(.bdta-imported-page, body > #wb_root) h5,",
    "    :is(.bdta-imported-page, body > #wb_root) h6,",
    "    :is(.bdta-imported-page, body > #wb_root) span {",
    "        overflow-wrap: break-word;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] > .wb_content,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] .wb_content.wb-layout-horizontal {",
    "        flex-wrap: wrap !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"],",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] > .wb_content,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-horizontal,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-vertical {",
    "        width: 100% !important;",
    "        min-width: 0 !important;",
    "        max-width: 100% !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-horizontal {",
    "        flex-wrap: wrap !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-horizontal > .wb_element,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-horizontal > .wb-layout-element,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content.wb-layout-vertical > .wb-layout-element {",
    "        width: 100% !important;",
    "        min-width: 0 !important;",
    "        max-width: 100% !important;",
    "        margin-left: 0 !important;",
    "        margin-right: 0 !important;",
    "        flex: 1 1 100% !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_content,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] .wb_element {",
    "        min-width: 0 !important;",
    "        max-width: 100% !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] img,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] svg,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] video,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_main_\"] iframe {",
    "        max-width: 100% !important;",
    "        height: auto !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] .wb_content.wb-layout-horizontal > .wb_element {",
    "        min-width: 0 !important;",
    "        max-width: 100% !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] [data-plugin=\"TextArea\"] {",
    "        flex: 1 1 12rem !important;",
    "        width: auto !important;",
    "        margin-right: auto !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] [data-plugin=\"TextArea\"] a,",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] [data-plugin=\"TextArea\"] span {",
    "        white-space: normal !important;",
    "        overflow-wrap: anywhere !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] [data-plugin=\"tawkto\"] {",
    "        width: 0 !important;",
    "        height: 0 !important;",
    "        min-width: 0 !important;",
    "        min-height: 0 !important;",
    "        margin: 0 !important;",
    "        flex: 0 0 0 !important;",
    "        overflow: hidden !important;",
    "    }",
    "    :is(.bdta-imported-page, body > #wb_root) [id^=\"wb_header_\"] .wb-menu-mobile {",
    "        margin-left: auto !important;",
    "    }",
    "}"
  ].join("\n");
}

function injectImportedPageRuntimeCss(html: string): string {
  if (!hasImportedPageRoot(html)) {
    return html;
  }

  const styleTag = `<style>\n${getImportedPageRuntimeCss()}\n</style>`;
  if (html.includes(styleTag)) {
    return html;
  }

  const htmlWithRuntimeCss = html.replace(/<\/head>/i, `${styleTag}\n</head>`);
  if (htmlWithRuntimeCss !== html) {
    return htmlWithRuntimeCss;
  }

  return `${styleTag}${html}`;
}

function wrapImportedPageHtml(html: string): string {
  const trimmedHtml = html.trim();
  if (trimmedHtml === "" || /^<div class=(["'])bdta-imported-page\1/i.test(trimmedHtml)) {
    return html;
  }

  if (!hasImportedPageRoot(html)) {
    return html;
  }

  return `<div class="bdta-imported-page">${html}</div>`;
}

function stripLegacyPublicPageNavigation(html: string): string {
  return html
    .replace(/<header\b[\s\S]*?<\/header>/gi, (segment) =>
      /(?:navbar-nav|navbar-toggler|navbar-collapse|wb_header_|nav-link)/i.test(segment) ? "" : segment
    )
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, (segment) =>
      /(?:navbar-nav|navbar-toggler|navbar-collapse|wb_header_|nav-link)/i.test(segment) ? "" : segment
    )
    .replace(/<ul\b[^>]*class=(["'])[^"']*\bnavbar-nav\b[^"']*\1[\s\S]*?<\/ul>/gi, "");
}

function normalizePublicContentAssetUrl(urlValue: string): string | null {
  const trimmed = urlValue.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    trimmed.startsWith("//")
  ) {
    return trimmed === "" ? null : trimmed;
  }

  const normalized = trimmed
    .replaceAll("\\", "/")
    .replace(/^(?:\.\.?\/)+/g, "");

  if (/^(?:assets|backend\/uploads|images|uploads)\/[\w./%-]+$/i.test(normalized)) {
    return `/${normalized}`;
  }

  return null;
}

function normalizePublicContentAssetMarkup(html: string): string {
  return html.replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (match, attributeName: string, quote: string, value: string) => {
    const normalizedUrl = normalizePublicContentAssetUrl(value);
    if (normalizedUrl == null || normalizedUrl === value.trim()) {
      return match;
    }
    return `${attributeName}=${quote}${escapeAttribute(normalizedUrl)}${quote}`;
  });
}

function normalizeSavedPublicPageHtml(html: string): string {
  return normalizePublicContentAssetMarkup(stripLegacyPublicPageNavigation(html));
}

function extractMailjetEmbedFrameUrl(embedMarkup: string): string | null {
  const match = /<iframe[^>]+src=(["'])(https?:\/\/[^"']+\.mjt\.lu\/wgt\/[^"']+\/form\?[^"']+)\1/i.exec(embedMarkup);
  return match?.[2]?.trim() === "" ? null : match?.[2] ?? null;
}

function sanitizeInlineMailjetNewsletterMarkup(markup: string): string {
  return markup
    .replace(/<section\b[\s\S]*?mailjet\.com[\s\S]*?<\/section>/gi, "")
    .replace(/<a\b[^>]*href=(["'])https?:\/\/(?:www\.)?mailjet\.com[^"']*\1[\s\S]*?<\/a>/gi, "")
    .replace(/<img\b[^>]*(?:src|alt|title)=(["'])[^"']*mailjet[^"']*\1[^>]*>/gi, "")
    .trim();
}

async function loadInlineMailjetNewsletterMarkup(frameUrl: string): Promise<string> {
  const cachedMarkup = NEWSLETTER_EMBED_MARKUP_CACHE.get(frameUrl);
  if (cachedMarkup != null) {
    return cachedMarkup;
  }

  const renderPromise = (async () => {
    const response = await fetch(frameUrl);
    if (!response.ok) {
      throw new Error(`Mailjet newsletter form request failed with status ${response.status}.`);
    }

    const documentHtml = await response.text();
    const bodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body>/i.exec(documentHtml);
    if (bodyMatch == null) {
      return "";
    }

    const styles = Array.from(documentHtml.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi))
      .map((match) => match[0])
      .join("");
    const bodyAttributes = bodyMatch[1] ?? "";
    const bodyClasses = /class=(["'])([^"']*)\1/i.exec(bodyAttributes)?.[2]?.trim() ?? "";
    const bodyStyle = /style=(["'])([^"']*)\1/i.exec(bodyAttributes)?.[2]?.trim() ?? "";
    const sanitizedBodyMarkup = sanitizeInlineMailjetNewsletterMarkup(bodyMatch[2] ?? "");
    if (sanitizedBodyMarkup === "") {
      return "";
    }

    const wrapperClasses = bodyClasses === "" ? "bdta-newsletter-mailjet" : `bdta-newsletter-mailjet ${bodyClasses}`;
    return [
      '<div class="bdta-newsletter-embed-body bdta-newsletter-embed-body--mailjet">',
      styles,
      `<div class="${escapeAttribute(wrapperClasses)}"${bodyStyle === "" ? "" : ` style="${escapeAttribute(bodyStyle)}"`}>`,
      sanitizedBodyMarkup,
      "</div>",
      "</div>"
    ].join("");
  })().catch(() => "");

  NEWSLETTER_EMBED_MARKUP_CACHE.set(frameUrl, renderPromise);
  return renderPromise;
}

async function resolveNewsletterEmbedMarkup(embedMarkup: string): Promise<string> {
  const trimmedEmbedMarkup = embedMarkup.trim();
  if (trimmedEmbedMarkup === "") {
    return "";
  }

  const mailjetFrameUrl = extractMailjetEmbedFrameUrl(trimmedEmbedMarkup);
  if (mailjetFrameUrl == null) {
    return trimmedEmbedMarkup;
  }

  const inlineMarkup = await loadInlineMailjetNewsletterMarkup(mailjetFrameUrl);
  return inlineMarkup === "" ? trimmedEmbedMarkup : inlineMarkup;
}

async function buildNewsletterEmbedWrappedMarkup(embedMarkup: string): Promise<string> {
  const resolvedEmbedMarkup = await resolveNewsletterEmbedMarkup(embedMarkup);
  if (resolvedEmbedMarkup.trim() === "") {
    return "";
  }

  return [
    '<section class="bdta-newsletter-embed-section" aria-label="Newsletter signup">',
    '<div class="public-shell">',
    '<div class="bdta-newsletter-embed-copy"><p class="eyebrow">Newsletter</p><h2>Get training updates from Brook&apos;s Dog Training Academy</h2><p class="section-copy">Join the list for training notes, academy news, and upcoming opportunities.</p></div>',
    '<div class="bdta-newsletter-embed-card">',
    resolvedEmbedMarkup,
    "</div>",
    "</div>",
    "</section>"
  ].join("");
}

function injectMarkupBeforeFooterOrBody(html: string, markup: string): string {
  if (markup.trim() === "") {
    return html;
  }

  const htmlWithFooterMarkup = html.replace(/(<footer\b[^>]*>)/i, `${markup}\n$1`);
  if (htmlWithFooterMarkup !== html) {
    return htmlWithFooterMarkup;
  }

  const htmlWithBodyMarkup = html.replace(/<\/body>/i, `${markup}\n</body>`);
  if (htmlWithBodyMarkup !== html) {
    return htmlWithBodyMarkup;
  }

  return `${html.trimEnd()}\n${markup}`;
}

function injectNewsletterEmbedMarkup(html: string, wrappedMarkup: string): string {
  if (wrappedMarkup.trim() === "" || html.includes('<section class="bdta-newsletter-embed-section"')) {
    return html;
  }

  return injectMarkupBeforeFooterOrBody(html, wrappedMarkup);
}

function isLegacyAdminAreaTawkRequestPath(pathname: string): boolean {
  if (!pathname.startsWith("/client/")) {
    return false;
  }

  return pathname !== "/client/package_detail.php";
}

function buildTawkWidgetScript(input: {
  enabled: boolean;
  propertyId: string;
  widgetId: string;
  pathname: string;
  session: StoredSessionSnapshot | null;
}): string {
  if (!input.enabled) {
    return "";
  }

  if (isLegacyAdminAreaTawkRequestPath(input.pathname)) {
    return "";
  }

  if (input.session?.actorType === "admin_user") {
    return "";
  }

  const propertyId = input.propertyId.trim();
  if (propertyId === "" || /^[A-Za-z0-9]+$/.test(propertyId) === false) {
    return "";
  }

  const widgetId = input.widgetId.trim() === "" ? "default" : input.widgetId.trim();
  if (/^[A-Za-z0-9_-]+$/.test(widgetId) === false) {
    return "";
  }

  const embedUrl = `https://embed.tawk.to/${encodeURIComponent(propertyId)}/${encodeURIComponent(widgetId)}`;

  return [
    "<script>",
    "var Tawk_API = Tawk_API || {};",
    "var Tawk_LoadStart = new Date();",
    "(function () {",
    "  'use strict';",
    "  var s1 = document.createElement('script');",
    "  var s0 = document.getElementsByTagName('script')[0];",
    "  s1.async = true;",
    `  s1.src = '${embedUrl}';`,
    "  s1.charset = 'UTF-8';",
    "  s1.setAttribute('crossorigin', '*');",
    "  if (s0 && s0.parentNode) {",
    "    s0.parentNode.insertBefore(s1, s0);",
    "  } else {",
    "    document.head.appendChild(s1);",
    "  }",
    "}());",
    "</script>"
  ].join("\n");
}

function renderStatsGrid(items: Array<{
  label: string;
  value: string | number;
  meta?: string;
  accent?: "primary" | "secondary" | "success" | "warning";
}>): string {
  return `<div class="summary-grid">${items.map((item) => [
    `<section class="summary-card${item.accent != null ? ` is-${item.accent}` : ""}">`,
    `<div class="summary-card__value">${escapeHtml(String(item.value))}</div>`,
    `<div class="summary-card__label">${escapeHtml(item.label)}</div>`,
    item.meta == null || item.meta.trim() === "" ? "" : `<div class="summary-card__meta">${escapeHtml(item.meta)}</div>`,
    "</section>"
  ].join("")).join("")}</div>`;
}

function renderQuickLinksGrid(items: Array<{
  href: string;
  label: string;
  description?: string;
}>): string {
  return `<div class="quick-links-grid">${items.map((item) => [
    `<a class="quick-link-card" href="${escapeHtml(item.href)}">`,
    `<span class="quick-link-card__label">${escapeHtml(item.label)}</span>`,
    item.description == null || item.description.trim() === "" ? "" : `<span class="quick-link-card__meta">${escapeHtml(item.description)}</span>`,
    "</a>"
  ].join("")).join("")}</div>`;
}

function renderInlineLinkList(items: Array<{
  href: string;
  label: string;
}>): string {
  return `<div class="inline-link-list">${items.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join("")}</div>`;
}

function renderDataTable(input: {
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}): string {
  if (input.rows.length === 0) {
    return `<p>${escapeHtml(input.emptyMessage)}</p>`;
  }

  return [
    '<div class="data-table">',
    `<div class="data-table__surface" data-enhanced-table data-empty-message="${escapeAttribute(input.emptyMessage)}">`,
    '<div class="data-table__toolbar" data-enhanced-table-toolbar hidden>',
    '<label class="data-table__search">',
    '<span class="data-table__search-label">Search this list</span>',
    '<input type="search" data-enhanced-table-search placeholder="Search this table" autocomplete="off" inputmode="search">',
    "</label>",
    '<div class="data-table__status">',
    '<span class="data-table__summary" data-enhanced-table-summary aria-live="polite"></span>',
    '<label class="data-table__page-size-label">',
    '<span>Rows per page</span>',
    '<select data-enhanced-table-page-size>',
    '<option value="5">5</option>',
    '<option value="10" selected>10</option>',
    '<option value="20">20</option>',
    '<option value="50">50</option>',
    "</select>",
    "</label>",
    "</div>",
    "</div>",
    '<div class="data-table__viewport">',
    "<table>",
    "<thead><tr>",
    input.headers.map((header, index) => [
      `<th scope="col" data-enhanced-table-header data-column-index="${index}">`,
      `<button type="button" class="data-table__sort-button" data-enhanced-table-sort data-column-index="${index}" aria-sort="none">`,
      `<span>${escapeHtml(header)}</span>`,
      '<span class="data-table__sort-indicator" aria-hidden="true">-</span>',
      "</button>",
      "</th>"
    ].join("")).join(""),
    "</tr></thead>",
    "<tbody>",
    input.rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeAttribute(input.headers[index] ?? `Column ${index + 1}`)}">${cell}</td>`).join("")}</tr>`).join(""),
    "</tbody>",
    "</table>",
    "</div>",
    '<div class="data-table__pagination" data-enhanced-table-pagination hidden>',
    '<span class="data-table__page-count" data-enhanced-table-page-count aria-live="polite"></span>',
    '<div class="data-table__pagination-buttons">',
    '<button type="button" data-enhanced-table-prev>Previous</button>',
    '<button type="button" data-enhanced-table-next>Next</button>',
    "</div>",
    "</div>",
    '<p class="meta data-table__empty-state" data-enhanced-table-empty hidden>No results match this view.</p>',
    "</div>",
    "</div>"
  ].join("");
}

function renderEnhancedCollection(input: {
  collectionClassName: string;
  items: Array<{
    content: string;
    searchText: string;
  }>;
  emptyMessage: string;
  searchLabel: string;
  searchPlaceholder: string;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
}): string {
  if (input.items.length === 0) {
    return `<p>${escapeHtml(input.emptyMessage)}</p>`;
  }

  const pageSizeOptions = input.pageSizeOptions == null || input.pageSizeOptions.length === 0
    ? [6, 12, 24]
    : input.pageSizeOptions;
  const defaultPageSize = pageSizeOptions.includes(input.defaultPageSize ?? 0)
    ? input.defaultPageSize ?? pageSizeOptions[0] ?? 6
    : pageSizeOptions[0] ?? 6;

  return [
    `<div class="enhanced-collection" data-enhanced-collection data-empty-message="${escapeAttribute(input.emptyMessage)}" data-default-page-size="${escapeAttribute(String(defaultPageSize))}">`,
    '<div class="enhanced-collection__toolbar" data-enhanced-collection-toolbar hidden>',
    `<label class="enhanced-collection__search"><span>${escapeHtml(input.searchLabel)}</span><input type="search" data-enhanced-collection-search placeholder="${escapeAttribute(input.searchPlaceholder)}" autocomplete="off" inputmode="search"></label>`,
    '<div class="enhanced-collection__status">',
    '<span class="enhanced-collection__summary" data-enhanced-collection-summary aria-live="polite"></span>',
    '<label class="enhanced-collection__page-size-label"><span>Cards per page</span><select data-enhanced-collection-page-size>',
    pageSizeOptions.map((size) => `<option value="${size}"${size === defaultPageSize ? " selected" : ""}>${size}</option>`).join(""),
    "</select></label>",
    "</div>",
    "</div>",
    `<div class="${escapeAttribute(input.collectionClassName)}" data-enhanced-collection-grid>`,
    input.items.map((item) => `<div data-enhanced-collection-item data-search="${escapeAttribute(item.searchText)}">${item.content}</div>`).join(""),
    "</div>",
    '<div class="enhanced-collection__pagination" data-enhanced-collection-pagination hidden><span class="enhanced-collection__page-count" data-enhanced-collection-page-count aria-live="polite"></span><div class="enhanced-collection__pagination-buttons"><button type="button" data-enhanced-collection-prev>Previous</button><button type="button" data-enhanced-collection-next>Next</button></div></div>',
    '<p class="meta enhanced-collection__empty-state" data-enhanced-collection-empty hidden>No matching items.</p>',
    "</div>"
  ].join("");
}

function renderSectionIntro(input: {
  eyebrow: string;
  title: string;
  description?: string;
}): string {
  return [
    `<p class="eyebrow">${escapeHtml(input.eyebrow)}</p>`,
    `<h1>${escapeHtml(input.title)}</h1>`,
    input.description == null || input.description.trim() === "" ? "" : `<p class="section-copy">${escapeHtml(input.description)}</p>`
  ].join("");
}

function renderDetailGrid(items: Array<{
  label: string;
  value: string;
}>): string {
  return `<div class="detail-grid">${items.map((item) => [
    '<section class="detail-card">',
    `<div class="detail-card__label">${escapeHtml(item.label)}</div>`,
    `<div class="detail-card__value">${item.value}</div>`,
    "</section>"
  ].join("")).join("")}</div>`;
}

function renderStatusPill(
  label: string,
  tone: "default" | "success" | "warning" | "danger" | "info" = "default"
): string {
  return `<span class="status-pill is-${tone}">${escapeHtml(label)}</span>`;
}

function renderBookingStatusPill(status: Booking["status"]): string {
  switch (status) {
    case "confirmed":
      return renderStatusPill("Confirmed", "success");
    case "pending":
      return renderStatusPill("Pending", "warning");
    case "completed":
      return renderStatusPill("Completed", "info");
    case "cancelled":
      return renderStatusPill("Cancelled", "default");
    default:
      return renderStatusPill(toTitleCase(status), "default");
  }
}

function renderInvoiceStatusPill(status: Invoice["status"]): string {
  switch (status) {
    case "paid":
      return renderStatusPill("Paid", "success");
    case "overdue":
      return renderStatusPill("Overdue", "danger");
    case "sent":
      return renderStatusPill("Sent", "warning");
    case "partially_paid":
      return renderStatusPill("Partially Paid", "info");
    case "void":
      return renderStatusPill("Void", "default");
    case "draft":
    default:
      return renderStatusPill(toTitleCase(status.replaceAll("_", " ")), "default");
  }
}

function renderQuoteStatusPill(status: Quote["status"]): string {
  switch (status) {
    case "accepted":
      return renderStatusPill("Accepted", "success");
    case "declined":
      return renderStatusPill("Declined", "danger");
    case "expired":
      return renderStatusPill("Expired", "warning");
    case "sent":
      return renderStatusPill("Sent", "info");
    case "draft":
    default:
      return renderStatusPill(toTitleCase(status), "default");
  }
}

function renderContractStatusPill(status: Contract["status"]): string {
  switch (status) {
    case "signed":
      return renderStatusPill("Signed", "success");
    case "sent":
      return renderStatusPill("Sent", "warning");
    case "void":
      return renderStatusPill("Void", "danger");
    case "draft":
    default:
      return renderStatusPill(toTitleCase(status), "default");
  }
}

function renderAchievementStatusPill(status: ClientAchievement["status"]): string {
  switch (status) {
    case "awarded":
      return renderStatusPill("Awarded", "success");
    case "revoked":
      return renderStatusPill("Revoked", "danger");
    default:
      return renderStatusPill(toTitleCase(status), "default");
  }
}

function toSortableTime(value: string | null | undefined): number {
  const normalized = value?.trim() ?? "";
  if (normalized === "") {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function sortByTimeAsc<T>(items: T[], getValue: (item: T) => string | null | undefined): T[] {
  return [...items].sort((left, right) => toSortableTime(getValue(left)) - toSortableTime(getValue(right)));
}

function sortByTimeDesc<T>(items: T[], getValue: (item: T) => string | null | undefined): T[] {
  return [...items].sort((left, right) => toSortableTime(getValue(right)) - toSortableTime(getValue(left)));
}

function isBookingUpcoming(booking: Booking, referenceTime = new Date().toISOString()): boolean {
  return booking.status !== "completed"
    && booking.status !== "cancelled"
    && toSortableTime(booking.startsAt) >= toSortableTime(referenceTime);
}

function normalizeSearchQuery(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesSearchQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  if (query === "") {
    return true;
  }

  return values.some((value) => normalizeSearchQuery(value).includes(query));
}

function buildAdminBookingsPath(filters: { q?: string | null } = {}): string {
  const params = new URLSearchParams();
  const q = filters.q?.trim() ?? "";
  if (q !== "") {
    params.set("q", q);
  }

  const query = params.toString();
  return query === "" ? "/admin/bookings" : `/admin/bookings?${query}`;
}

function buildAdminExpensesPath(filters: { clientId?: string | null } = {}): string {
  const params = new URLSearchParams();
  const clientId = filters.clientId?.trim() ?? "";
  if (clientId !== "") {
    params.set("client_id", clientId);
  }

  const query = params.toString();
  return query === "" ? "/admin/expenses" : `/admin/expenses?${query}`;
}

function buildAdminInvoicesPath(filters: { clientId?: string | null } = {}): string {
  const params = new URLSearchParams();
  const clientId = filters.clientId?.trim() ?? "";
  if (clientId !== "") {
    params.set("client_id", clientId);
  }

  const query = params.toString();
  return query === "" ? "/admin/invoices" : `/admin/invoices?${query}`;
}

function summarizePackageItems(items: Package["items"] | undefined): string {
  if ((items ?? []).length === 0) {
    return "No appointment credits configured";
  }

  return (items ?? []).map((item) => `${item.quantity} x ${item.appointmentTypeName}`).join(", ");
}

function truncateText(value: string | null | undefined, maxLength = 88): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") {
    return "Not provided";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function renderLongTextBlock(value: string | null | undefined, emptyMessage: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") {
    return `<p class="section-copy">${escapeHtml(emptyMessage)}</p>`;
  }

  return `<div class="settings-current-value-panel"><div class="meta">${escapeHtml(normalized).replace(/\n/g, "<br>")}</div></div>`;
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderAdminClientDisplayName(client: Client): string {
  const fullName = `${client.firstName} ${client.lastName}`.trim();
  return fullName === "" ? client.email : fullName;
}

function renderTableActionLinks(actions: Array<{ href: string; label: string }>): string {
  return `<div class="table-actions">${actions.map((action) => `<a href="${action.href}">${escapeHtml(action.label)}</a>`).join("")}</div>`;
}

function renderAdminClientCreateModal(): string {
  return [
    "<style>",
    ".admin-client-modal { width: min(720px, calc(100vw - 2rem)); padding: 0; border: none; border-radius: 1.2rem; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35); }",
    ".admin-client-modal::backdrop { background: rgba(15, 23, 42, 0.72); }",
    ".admin-client-modal__card { display: grid; gap: 1rem; padding: 1.5rem; }",
    ".admin-client-modal__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }",
    ".admin-client-modal__header h2 { margin-bottom: 0.35rem; }",
    ".admin-client-modal__close { white-space: nowrap; }",
    "</style>",
    '<section class="surface-block">',
    "<h2>Create Client</h2>",
    '<p class="section-copy">Start a new client record without leaving the directory. Detailed editing remains on the client profile after creation.</p>',
    '<div class="form-actions"><button type="button" id="admin-client-create-open">New Client</button></div>',
    "</section>",
    '<dialog id="admin-client-create-dialog" class="admin-client-modal" aria-labelledby="admin-client-create-title">',
    '<div class="admin-client-modal__card">',
    '<div class="admin-client-modal__header">',
    '<div><p class="eyebrow">Clients</p><h2 id="admin-client-create-title">Create Client</h2><p class="section-copy">Add the household record, then use the client profile to manage notes, contacts, and training history.</p></div>',
    '<button type="button" class="admin-client-modal__close" id="admin-client-create-close" aria-label="Close create client modal">Close</button>',
    "</div>",
    '<form class="form-grid" method="post" action="/admin/clients">',
    '<div class="form-grid form-grid--two">',
    '<label>Name<input type="text" name="name" required></label>',
    '<label>Email<input type="email" name="email" required></label>',
    '<label>Phone<input type="text" name="phone"></label>',
    '<label><span>Admin Access</span><input type="checkbox" name="isAdmin"></label>',
    "</div>",
    '<label>Address<textarea name="address"></textarea></label>',
    '<label>Notes<textarea name="notes"></textarea></label>',
    '<div class="form-actions"><button type="submit">Create Client</button><button type="button" id="admin-client-create-cancel">Cancel</button></div>',
    "</form>",
    "</div>",
    "</dialog>",
    "<script>",
    "(function () {",
    " const dialog = document.getElementById('admin-client-create-dialog');",
    " if (!(dialog instanceof HTMLDialogElement)) return;",
    " const openButton = document.getElementById('admin-client-create-open');",
    " const closeButtons = [document.getElementById('admin-client-create-close'), document.getElementById('admin-client-create-cancel')];",
    " const closeDialog = () => { if (dialog.open) dialog.close(); };",
    " openButton?.addEventListener('click', () => dialog.showModal());",
    " for (const button of closeButtons) button?.addEventListener('click', closeDialog);",
    " dialog.addEventListener('click', (event) => { const rect = dialog.getBoundingClientRect(); const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom; if (!inside) closeDialog(); });",
    "})();",
    "</script>"
  ].join("");
}

function renderAdminClientDirectoryTable(clients: Client[]): string {
  return renderDataTable({
    headers: ["ID", "Client", "Email", "Status", "Actions"],
    rows: clients.map((client) => [
      `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(client.id)}</a>`,
      `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`,
      escapeHtml(client.email),
      renderStatusPill(client.archived ? "Archived" : "Active", client.archived ? "warning" : "success"),
      renderTableActionLinks([
        { href: `/admin/clients/${encodeURIComponent(client.id)}/profile`, label: "Manage" },
        { href: `/admin/clients/${encodeURIComponent(client.id)}/contacts`, label: "Contacts" },
        { href: `/admin/clients/${encodeURIComponent(client.id)}/achievements`, label: "Achievements" }
      ])
    ]),
    emptyMessage: "No clients."
  });
}

function renderContactsPreviewTable(
  contacts: ClientContact[],
  detailPath: (contact: ClientContact) => string
): string {
  return renderDataTable({
    headers: ["Contact", "Email", "Phone", "Role", "Actions"],
    rows: contacts.map((contact) => [
      `<a href="${detailPath(contact)}">${escapeHtml(contact.name)}</a>`,
      escapeHtml(contact.email),
      escapeHtml(contact.phone),
      renderStatusPill(contact.isPrimary ? "Primary" : "Secondary", contact.isPrimary ? "success" : "default"),
      `<div class="table-actions"><a href="${detailPath(contact)}">Open</a></div>`
    ]),
    emptyMessage: "No contacts have been added yet."
  });
}

function renderPetsPreviewTable(
  pets: Pet[],
  options: {
    detailPath: (pet: Pet) => string;
    filePath: (pet: Pet) => string;
  }
): string {
  return renderDataTable({
    headers: ["Pet", "Species", "Status", "Care Notes", "Actions"],
    rows: pets.map((pet) => [
      `<a href="${options.detailPath(pet)}">${escapeHtml(pet.name)}</a>`,
      escapeHtml(pet.species),
      renderStatusPill(pet.archived ? "Archived" : "Active", pet.archived ? "warning" : "success"),
      escapeHtml(truncateText(pet.petSittingNotes, 72)),
      `<div class="table-actions"><a href="${options.filePath(pet)}">Files</a><a href="${options.detailPath(pet)}">Profile</a></div>`
    ]),
    emptyMessage: "No pets are linked yet."
  });
}

function renderBookingsPreviewTable(
  bookings: Booking[],
  detailPath: (booking: Booking) => string
): string {
  return renderDataTable({
    headers: ["Appointment", "Status", "Starts", "Pets", "Actions"],
    rows: bookings.map((booking) => [
      `<a href="${detailPath(booking)}">${escapeHtml(booking.id)}</a>`,
      renderBookingStatusPill(booking.status),
      escapeHtml(formatAdminDateTime(booking.startsAt)),
      escapeHtml(formatCountLabel(booking.petIds.length, "pet")),
      `<div class="table-actions"><a href="${detailPath(booking)}">Open</a></div>`
    ]),
    emptyMessage: "No appointments match this profile yet."
  });
}

function renderFormsPreviewTable(
  forms: FormSubmission[],
  detailPath: (form: FormSubmission) => string
): string {
  return renderDataTable({
    headers: ["Form", "Status", "Submitted", "Pet", "Actions"],
    rows: forms.map((form) => [
      `<a href="${detailPath(form)}">${escapeHtml(getAdminFormSubmissionTitle(form))}</a>`,
      renderAdminFormSubmissionStatusPill(form),
      escapeHtml(formatAdminDateTime(form.submittedAt)),
      escapeHtml(form.petName ?? "Not linked"),
      `<div class="table-actions"><a href="${detailPath(form)}">Open</a></div>`
    ]),
    emptyMessage: "No linked forms yet."
  });
}

function renderAchievementsPreviewTable(
  achievements: ClientAchievement[],
  detailPath: (achievement: ClientAchievement) => string
): string {
  return renderDataTable({
    headers: ["Achievement", "Status", "Awarded", "Dog", "Actions"],
    rows: achievements.map((achievement) => [
      `<a href="${detailPath(achievement)}">${escapeHtml(achievement.title)}</a>`,
      renderAchievementStatusPill(achievement.status),
      escapeHtml(formatAdminDate(achievement.awardedOn)),
      escapeHtml(achievement.dogName ?? "Client-wide"),
      `<div class="table-actions"><a href="${detailPath(achievement)}">Open</a></div>`
    ]),
    emptyMessage: "No achievements recorded yet."
  });
}

function renderPetFilesPreviewTable(
  files: PetFile[],
  contentPath: (file: PetFile) => string
): string {
  return renderDataTable({
    headers: ["File", "Type", "Uploaded", "Description", "Actions"],
    rows: files.map((file) => [
      `<a href="${contentPath(file)}">${escapeHtml(file.originalName)}</a>`,
      renderStatusPill(toTitleCase(file.fileType), file.fileType === "photo" ? "info" : "default"),
      escapeHtml(formatAdminDateTime(file.uploadedAt)),
      escapeHtml(truncateText(file.description, 64)),
      `<div class="table-actions"><a href="${contentPath(file)}">Open</a></div>`
    ]),
    emptyMessage: "No files have been uploaded yet."
  });
}

function petMatchesAchievement(pet: Pet, achievement: ClientAchievement): boolean {
  return (achievement.dogName?.trim().toLowerCase() ?? "") === pet.name.trim().toLowerCase();
}

function renderExpenseStatusPill(expense: {
  billable: boolean;
  invoiced: boolean;
}): string {
  if (expense.invoiced) {
    return renderStatusPill("Invoiced");
  }
  if (expense.billable) {
    return renderStatusPill("Billable", "success");
  }
  return renderStatusPill("Non-Billable", "info");
}

function toTitleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getSettingConsoleMetadata(setting: Setting): SettingConsoleMetadata {
  return SETTINGS_CONSOLE_METADATA.get(setting.key) ?? {
    launchCritical: false,
    usage: [
      SETTINGS_CATEGORY_DESCRIPTIONS.get(setting.category)
        ?? `Used within the ${formatSettingCategoryLabel(setting.category).toLowerCase()} area of the business.`
    ],
    multiline: setting.value.includes("\n")
  };
}

function formatSettingCategoryLabel(category: string): string {
  return SETTINGS_CATEGORY_LABELS.get(category) ?? toTitleCase(category);
}

function formatSettingTypeLabel(type: string): string {
  switch (type) {
    case "password":
      return "Secret";
    case "checkbox":
      return "Toggle";
    case "textarea":
      return "Multiline";
    default:
      return toTitleCase(type);
  }
}

function getSettingCategoryDescription(category: string): string {
  return SETTINGS_CATEGORY_DESCRIPTIONS.get(category)
    ?? "Additional configuration for this area of the business.";
}

function isTruthySettingValue(value: string): boolean {
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

function getNormalizedSettingType(type: string): string {
  return type.trim().toLowerCase();
}

function isBooleanSettingType(type: string): boolean {
  const normalized = getNormalizedSettingType(type);
  return normalized === "boolean" || normalized === "checkbox";
}

function isSettingConfigured(setting: Setting): boolean {
  if (isBooleanSettingType(setting.type)) {
    return true;
  }

  return setting.value.trim() !== "";
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

function getSettingSelectOptions(setting: Setting, metadata: SettingConsoleMetadata): Array<{
  value: string;
  label: string;
}> | null {
  if (metadata.options != null) {
    return metadata.options;
  }

  if (getNormalizedSettingType(setting.type) === "boolean") {
    return [
      { value: "1", label: "Enabled" },
      { value: "0", label: "Disabled" }
    ];
  }

  return null;
}

function renderSettingCurrentValue(setting: Setting): string {
  if (setting.secret) {
    return '<span class="settings-value-preview settings-value-preview--masked">Stored securely</span>';
  }

  if (isBooleanSettingType(setting.type)) {
    return renderStatusPill(isTruthySettingValue(setting.value) ? "Enabled" : "Disabled", isTruthySettingValue(setting.value) ? "success" : "warning");
  }

  if (setting.value.trim() === "") {
    return '<span class="settings-value-preview settings-value-preview--empty">Not configured</span>';
  }

  const preview = setting.value.length > 64
    ? `${setting.value.slice(0, 61)}...`
    : setting.value;

  return `<span class="settings-value-preview">${escapeHtml(preview)}</span>`;
}

function renderSettingBadges(setting: Setting): string {
  const metadata = getSettingConsoleMetadata(setting);
  const badges = [
    renderStatusPill(formatSettingCategoryLabel(setting.category), "info"),
    renderStatusPill(formatSettingTypeLabel(setting.type), "default"),
    metadata.launchCritical ? renderStatusPill("Launch Critical", "warning") : "",
    setting.secret ? renderStatusPill("Secret", "danger") : "",
    isSettingConfigured(setting) ? renderStatusPill("Configured", "success") : renderStatusPill("Needs Value", "warning")
  ].filter((badge) => badge !== "");

  return `<div class="settings-badge-row">${badges.join("")}</div>`;
}

function renderSettingsSummaryCards(settings: Setting[]): string {
  const launchCritical = settings.filter((setting) => getSettingConsoleMetadata(setting).launchCritical);
  const configuredCount = settings.filter(isSettingConfigured).length;
  const secretCount = settings.filter((setting) => setting.secret).length;
  const integrationCount = settings.filter((setting) => (
    setting.category === "integrations"
    || setting.category === "communications"
    || setting.category === "email"
    || setting.category === "calendar"
    || setting.category === "advanced"
  )).length;
  const launchReadyCount = launchCritical.filter(isSettingConfigured).length;

  return [
    '<div class="settings-summary-grid">',
    renderStatsGrid([
      {
        label: "Launch Controls Ready",
        value: `${launchReadyCount}/${launchCritical.length}`,
        meta: "Prioritized production settings",
        accent: launchReadyCount === launchCritical.length ? "success" : "warning"
      },
      {
        label: "Configured Settings",
        value: `${configuredCount}/${settings.length}`,
        meta: "Values currently stored in the catalog",
        accent: "primary"
      },
      {
        label: "Secret Entries",
        value: secretCount,
        meta: "Credentials and hidden values",
        accent: "secondary"
      },
      {
        label: "Integration Surface",
        value: integrationCount,
        meta: "Email and third-party connection settings",
        accent: "warning"
      }
    ]),
    "</div>"
  ].join("");
}

function renderSettingsCard(setting: Setting): string {
  const metadata = getSettingConsoleMetadata(setting);
  const searchText = [
    setting.label,
    setting.key,
    setting.category,
    formatSettingCategoryLabel(setting.category),
    setting.description,
    ...metadata.usage
  ].join(" ").toLowerCase();

  return [
    `<article class="settings-card" data-setting-card data-search="${escapeAttribute(searchText)}" data-launch-critical="${metadata.launchCritical ? "true" : "false"}" data-secret="${setting.secret ? "true" : "false"}">`,
    '<div class="settings-card__header">',
    '<div class="settings-card__header-copy">',
    `<p class="eyebrow">${escapeHtml(formatSettingCategoryLabel(setting.category))}</p>`,
    `<h3><a href="/admin/settings/${encodeURIComponent(setting.key)}">${escapeHtml(setting.label)}</a></h3>`,
    `<p class="section-copy">${escapeHtml(setting.description)}</p>`,
    "</div>",
    renderSettingBadges(setting),
    "</div>",
    '<div class="settings-card__meta-grid">',
    `<div><span>Key</span><strong>${escapeHtml(setting.key)}</strong></div>`,
    `<div><span>Current Value</span><strong>${renderSettingCurrentValue(setting)}</strong></div>`,
    `<div><span>Updated</span><strong>${escapeHtml(setting.updatedAt.slice(0, 10))}</strong></div>`,
    "</div>",
    '<div class="settings-card__footer">',
    `<div class="settings-card__usage">${metadata.usage.slice(0, 2).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`,
    `<a class="settings-card__action" href="/admin/settings/${encodeURIComponent(setting.key)}">Edit Setting</a>`,
    "</div>",
    "</article>"
  ].join("");
}

const settingsDefaultCategory = "overview";

function normalizeSettingsCategory(category: string | null | undefined): string {
  const normalized = category?.trim().toLowerCase() ?? "";
  return normalized === "" ? settingsDefaultCategory : normalized;
}

function buildSettingsCategoryHref(basePath: string, category: string): string {
  const normalizedCategory = normalizeSettingsCategory(category);
  if (normalizedCategory === settingsDefaultCategory) {
    return basePath;
  }

  return `${basePath}?category=${encodeURIComponent(normalizedCategory)}`;
}

function renderSettingsNotice(notice?: SettingsConsoleViewModel["notice"]): string {
  if (notice == null) {
    return "";
  }

  return [
    `<section class="surface-block settings-notice settings-notice--${notice.tone}">`,
    `<p class="eyebrow">${escapeHtml(notice.title)}</p>`,
    `<p class="section-copy">${escapeHtml(notice.message)}</p>`,
    "</section>"
  ].join("");
}

function resolveSettingsNotice(url: URL): SettingsConsoleViewModel["notice"] | undefined {
  const errorMessage = url.searchParams.get("error");
  if (errorMessage != null && errorMessage.trim() !== "") {
    return {
      tone: "danger",
      title: "Settings Action Failed",
      message: errorMessage
    };
  }

  switch (url.searchParams.get("notice")) {
    case "google-calendar-connected":
      return {
        tone: "success",
        title: "Google Calendar Connected",
        message: "Google Calendar authorization completed and the latest token was saved."
      };
    case "admin-user-created":
      return {
        tone: "success",
        title: "Admin Added",
        message: "The admin user was created successfully."
      };
    case "admin-permissions-updated":
      return {
        tone: "success",
        title: "Permissions Saved",
        message: "Admin permissions were updated successfully."
      };
    case "admin-user-deleted":
      return {
        tone: "success",
        title: "Admin Deleted",
        message: "The admin user was deleted and their assignments were cleared."
      };
    case "runtime-environment-saved":
      return {
        tone: "success",
        title: "Environment Saved",
        message: "The runtime environment file was updated. Restart the Plesk Node.js app for changes to take effect."
      };
    default:
      return undefined;
  }
}

function hasConfiguredSettingValue(settings: Setting[], key: string): boolean {
  const setting = settings.find((candidate) => candidate.key === key);
  return setting != null && setting.value.trim() !== "";
}

function isCalendarOAuthConfigured(settings: Setting[]): boolean {
  return ["google_oauth_client_id", "google_oauth_client_secret", "google_oauth_redirect_uri"].every((key) =>
    hasConfiguredSettingValue(settings, key)
  );
}

function renderCalendarOAuthActionPanel(model: CalendarOAuthActionsViewModel): string {
  const oauthConfigured = isCalendarOAuthConfigured(model.settings);
  const calendarSettingsHref = buildSettingsCategoryHref(model.basePath, "calendar");
  const legacyCalendarHref = buildSettingsCategoryHref("/client/settings.php", "calendar");

  return [
    '<section class="surface-block">',
    '<p class="eyebrow">Calendar OAuth</p>',
    "<h2>Google Calendar Connection</h2>",
    '<p class="section-copy">Start Google Calendar authorization from the current admin console. The legacy callback path still works, so an existing Google redirect URI can stay in place.</p>',
    `<div class="settings-badge-row">${renderStatusPill(oauthConfigured ? "OAuth Ready" : "OAuth Needs Setup", oauthConfigured ? "success" : "warning")}${renderStatusPill("Legacy Callback Supported", "info")}</div>`,
    '<div class="form-actions">',
    `<a href="${adminGoogleCalendarOAuthConnectPath}">${oauthConfigured ? "Connect Google Calendar" : "Review Calendar OAuth Settings"}</a>`,
    model.basePath === "/client/settings.php"
      ? ""
      : `<a href="${legacyCalendarHref}">Legacy Calendar Screen</a>`,
    "</div>",
    oauthConfigured
      ? '<p class="meta">The connect button now runs through the Node admin route and saves into the existing Google OAuth token table.</p>'
      : `<p class="meta">Save the OAuth Client ID and Client Secret in <a href="${calendarSettingsHref}">Calendar settings</a>. The redirect URI can continue using ${escapeHtml(legacyGoogleCalendarOAuthCallbackPath)}.</p>`,
    "</section>"
  ].join("");
}

function canAccessRuntimeEnvironmentSettings(currentAdmin: AdminSettingsUserView): boolean {
  return currentAdmin.isMainAccount || currentAdmin.canManageApiKeys;
}

function resolveRuntimeEnvironmentFilePath(options: HttpWebServerOptions): {
  filePath: string;
  templateFilePath: string;
} {
  const filePath = options.runtimeEnvironmentFilePath ?? join(process.cwd(), ".env.production");
  const templateFilePath = options.runtimeEnvironmentTemplateFilePath ?? join(process.cwd(), ".env.production.example");
  return { filePath, templateFilePath };
}

function resolveRuntimeEnvironmentProcessEnv(options: HttpWebServerOptions): Record<string, string | undefined> {
  return options.runtimeEnvironmentProcessEnv ?? process.env;
}

async function loadEffectiveRuntimeEnvironment(options: {
  filePath: string;
  processEnv: Record<string, string | undefined>;
}): Promise<{
  fields: RuntimeEnvironmentFieldView[];
  values: Record<string, string | undefined>;
}> {
  const fileValues = await loadEnvFileIfPresent(options.filePath);
  const values: Record<string, string | undefined> = {
    ...fileValues,
    ...options.processEnv
  };

  return {
    values,
    fields: runtimeEnvironmentFieldDefinitions.map((definition) => {
      const sourcedFromProcessEnv = Object.prototype.hasOwnProperty.call(options.processEnv, definition.key);
      const sourcedFromFile = Object.prototype.hasOwnProperty.call(fileValues, definition.key);
      return {
        ...definition,
        value: values[definition.key] ?? "",
        source: sourcedFromProcessEnv
          ? "process-env"
          : sourcedFromFile
            ? "env-file"
            : "unset"
      };
    })
  };
}

async function loadSettingsLaunchReadiness(options: {
  environment: Record<string, string | undefined>;
  settings: Setting[];
  enabled: boolean;
}): Promise<LaunchReadinessAssessment | undefined> {
  if (!options.enabled) {
    return undefined;
  }

  return buildLaunchReadinessAssessment({
    environment: options.environment,
    settings: indexSettingValues(options.settings),
    workspaceRoot: process.cwd()
  });
}

function renderRuntimeEnvironmentSettingsPanel(input: {
  currentAdmin: AdminSettingsUserView;
  fields: RuntimeEnvironmentFieldView[];
}): string {
  if (!canAccessRuntimeEnvironmentSettings(input.currentAdmin)) {
    return [
      '<section class="surface-block">',
      '<p class="eyebrow">Database</p>',
      '<h2>Runtime Environment</h2>',
      '<p class="section-copy">This environment category is restricted to admins with API-key and integration access.</p>',
      "</section>"
    ].join("");
  }

  return [
    '<section class="surface-block">',
    '<p class="eyebrow">Database</p>',
    '<h2>Runtime Environment</h2>',
    '<p class="section-copy">Edit the live environment values stored in <code>.env.production</code>. The values shown below reflect what this site is using right now, including any Plesk overrides that differ from the file.</p>',
    "</section>",
    '<section class="surface-block">',
    '<p class="eyebrow">Environment File</p>',
    '<h3>Database and Runtime Settings</h3>',
    '<form class="form-grid form-grid--two" method="post" action="/admin/settings/runtime-environment">',
    input.fields.map((field) => {
      const control = `<input type="${field.secret ? "password" : "text"}" name="${escapeAttribute(field.key)}" value="${escapeAttribute(field.value)}" placeholder="${escapeAttribute(field.placeholder ?? "")}"${field.secret ? ' autocomplete="off"' : ""}>`;
      const sourceLabel = field.source === "process-env"
        ? renderStatusPill("Plesk App Env", "warning")
        : field.source === "env-file"
          ? renderStatusPill(".env.production", "info")
          : renderStatusPill("Not Configured", "default");
      return [
        `<label>${escapeHtml(field.label)}`,
        control,
        `</label><p class="meta">${escapeHtml(field.description)}${field.required ? " Required for a shell-based startup without a direct DATABASE_URL." : ""} Current source: ${sourceLabel}${field.source === "process-env" ? " Process-level overrides take precedence over the file until they are changed in Plesk and the app is restarted." : ""}</p>`
      ].join("");
    }).join(""),
    '<div class="form-actions"><button type="submit">Save Environment Settings</button></div>',
    "</form>",
    "</section>",
    '<section class="surface-block">',
    '<p class="eyebrow">Restart Required</p>',
    '<h3>Operational Notes</h3>',
    '<p class="section-copy">After saving database or runtime environment values, rebuild if needed and restart the Node.js app from Plesk. The unified runtime reads <code>.env.production</code> during startup first, then applies process-level overrides from the Plesk Node.js panel.</p>',
    "</section>"
  ].join("");
}

function renderAdminSettingsSidebar(model: SettingsConsoleViewModel): string {
  const categoryLinks = [
    { key: settingsDefaultCategory, label: "Overview", description: "All visible settings and launch readiness." },
    ...model.categories
      .filter((category) => {
        const normalizedCategory = normalizeSettingsCategory(category);
        return normalizedCategory !== settingsDefaultCategory && normalizedCategory !== "admins";
      })
      .map((category) => ({
        key: normalizeSettingsCategory(category),
        label: formatSettingCategoryLabel(category),
        description: getSettingCategoryDescription(category)
      })),
    { key: "admins", label: "Admins", description: "Admin users and permission controls." }
  ];

  return [
'<aside class="settings-sidebar">',
'<section class="surface-block settings-sidebar__panel">',
    '<p class="eyebrow">Settings Navigation</p>',
    '<h3>Configuration Areas</h3>',
    '<div class="settings-sidebar__nav">',
    categoryLinks.map((item) => [
      `<a class="settings-sidebar__link${model.currentCategory === item.key ? " is-active" : ""}" href="${escapeHtml(buildSettingsCategoryHref(model.basePath, item.key))}"${model.currentCategory === item.key ? ' aria-current="page"' : ""}>`,
      `<span class="settings-sidebar__link-label">${escapeHtml(item.label)}</span>`,
      `<span class="settings-sidebar__link-meta">${escapeHtml(item.description)}</span>`,
      "</a>"
    ].join("")).join(""),
"</div>",
"</section>",
'<section class="surface-block settings-sidebar__panel settings-sidebar__panel--meta">',
    '<p class="eyebrow">Current Admin</p>',
    `<h4>${escapeHtml(model.currentAdmin.username)}</h4>`,
    `<p class="meta">${escapeHtml(model.currentAdmin.email)}</p>`,
    `<div class="settings-badge-row">${[
      renderStatusPill(model.currentAdmin.isMainAccount ? "Main Account" : formatSettingCategoryLabel(model.currentAdmin.accountType), model.currentAdmin.isMainAccount ? "success" : "info"),
      renderStatusPill(model.currentAdmin.canManageAdminUsers ? "Manages Admins" : "No Admin Control", model.currentAdmin.canManageAdminUsers ? "success" : "default"),
      renderStatusPill(model.currentAdmin.canManageApiKeys ? "API-Key Access" : "Restricted Keys", model.currentAdmin.canManageApiKeys ? "success" : "warning")
    ].join("")}</div>`,
"</section>",
"</aside>"
  ].join("");
}

function renderAdminSettingsUsersSection(model: SettingsConsoleViewModel): string {
  const canManageAdminUsers = model.currentAdmin.isMainAccount || model.currentAdmin.canManageAdminUsers;

  return [
    '<section class="surface-block">',
    '<p class="eyebrow">Admin Users</p>',
    '<h2>Admin User Management</h2>',
    '<p class="section-copy">Manage who can sign in, who can grant staff access, and who can view sensitive API-key and integration settings.</p>',
    "</section>",
    canManageAdminUsers ? [
      '<section class="surface-block settings-admin-form">',
      '<p class="eyebrow">New Admin</p>',
      '<h3>Add Admin User</h3>',
      '<form class="form-grid form-grid--two" method="post" action="/admin/settings/admin-users">',
      '<label>Username<input type="text" name="username" minlength="3" maxlength="64" required></label>',
      '<label>Email<input type="email" name="email" required></label>',
      '<label>Temporary Password<input type="password" name="password" minlength="8" required></label>',
      '<label>Account Type<select name="accountType"><option value="standard">Standard</option><option value="accountant">Accountant</option></select></label>',
      '<div class="form-actions"><button type="submit">Add Admin User</button></div>',
      "</form>",
      "</section>"
    ].join("") : "",
    '<section class="surface-block">',
    '<p class="eyebrow">Access Matrix</p>',
    '<h3>Existing Admin Accounts</h3>',
    renderDataTable({
      headers: ["Admin User", "Account Type", "Permissions", "Actions"],
      rows: model.adminUsers.map((user) => {
        const canEditPermissions = model.currentAdmin.isMainAccount && !user.isMainAccount && user.accountType !== "accountant";
        const canDeleteUser = canManageAdminUsers && !user.isMainAccount && user.actorId !== model.currentAdmin.actorId;

        return [
          `<strong>${escapeHtml(user.username)}</strong><div class="meta">${escapeHtml(user.email)}</div>`,
          [
            user.isMainAccount ? renderStatusPill("Main Account", "success") : "",
            renderStatusPill(formatSettingCategoryLabel(user.accountType), user.accountType === "accountant" ? "info" : "default")
          ].join(""),
          user.isMainAccount
            ? '<div class="settings-badge-row">' + renderStatusPill("Manage Admin Users", "success") + renderStatusPill("API-Key Access", "success") + "</div>"
            : user.accountType === "accountant"
              ? '<div class="settings-badge-row">' + renderStatusPill("Read-only Accounting", "info") + renderStatusPill("Fixed Access", "default") + "</div>"
              : canEditPermissions
                ? `<form class="settings-inline-permissions" method="post" action="/admin/settings/admin-users/${encodeURIComponent(user.actorId)}/permissions"><label><input type="checkbox" name="canManageAdminUsers" value="1"${user.canManageAdminUsers ? " checked" : ""}> Manage Admin Users</label><label><input type="checkbox" name="canManageApiKeys" value="1"${user.canManageApiKeys ? " checked" : ""}> API-Key Access</label><button type="submit">Save Permissions</button></form>`
                : '<div class="settings-badge-row">' + renderStatusPill(user.canManageAdminUsers ? "Manages Admins" : "No Admin Control", user.canManageAdminUsers ? "success" : "default") + renderStatusPill(user.canManageApiKeys ? "API-Key Access" : "Restricted Keys", user.canManageApiKeys ? "success" : "warning") + "</div>",
          canDeleteUser
            ? `<form method="post" action="/admin/settings/admin-users/${encodeURIComponent(user.actorId)}/delete" onsubmit="return confirm('Delete admin user? Existing booking and appointment assignments will be cleared.');"><button type="submit">Delete</button></form>`
            : '<span class="meta">No changes available</span>'
        ];
      }),
      emptyMessage: "No admin users are configured yet."
    }),
    "</section>"
  ].join("");
}

function formatLaunchReadinessProviderLabel(provider: LaunchReadinessAssessment["providerAudits"][number]["provider"]): string {
  switch (provider) {
    case "google_oauth":
      return "Google OAuth";
    default:
      return toTitleCase(provider);
  }
}

function formatLaunchReadinessOperationalAreaLabel(area: LaunchReadinessAssessment["operationalAudits"][number]["area"]): string {
  switch (area) {
    case "error_logging":
      return "Error Logging";
    default:
      return toTitleCase(area);
  }
}

function renderSettingsReadinessNotice(input: {
  title: string;
  tone: "danger" | "info";
  items: string[];
}): string {
  if (input.items.length === 0) {
    return "";
  }

  return [
    `<section class="surface-block settings-notice settings-notice--${input.tone}">`,
    `<p class="eyebrow">${escapeHtml(input.title)}</p>`,
    `<ul class="settings-readiness-list">${input.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    "</section>"
  ].join("");
}

function renderSettingsLaunchReadinessPanel(launchReadiness?: LaunchReadinessAssessment): string {
  if (launchReadiness == null) {
    return [
      '<section class="surface-block settings-readiness-panel">',
      '<div class="section-heading">',
      '<p class="eyebrow">Launch Readiness</p>',
      '<h3>Validation and Live Launch Status</h3>',
      '<p class="section-copy">Detailed provider and runtime readiness is restricted to admins who can access API-key and integration settings.</p>',
      "</div>",
      "</section>"
    ].join("");
  }

  return [
    '<section class="surface-block settings-readiness-panel">',
    '<div class="section-heading">',
    '<p class="eyebrow">Launch Readiness</p>',
    '<h3>Validation and Live Launch Status</h3>',
    '<p class="section-copy">This audit evaluates <code>.env.production</code>, launch-critical settings, and operational runbooks so deployment blockers are visible before cutover.</p>',
    "</div>",
    renderStatsGrid([
      {
        label: "Release Validation",
        value: launchReadiness.readyForValidation ? "Ready" : "Blocked",
        meta: launchReadiness.readyForValidation
          ? "No validation-blocking runtime or provider issues."
          : `${launchReadiness.validationBlockingIssues.length} blocking issue${launchReadiness.validationBlockingIssues.length === 1 ? "" : "s"}`,
        accent: launchReadiness.readyForValidation ? "success" : "warning"
      },
      {
        label: "Live Launch",
        value: !launchReadiness.liveLaunchEvaluated
          ? "N/A"
          : launchReadiness.readyForLiveLaunch
            ? "Ready"
            : "Blocked",
        meta: !launchReadiness.liveLaunchEvaluated
          ? "Deferred while synthetic validation settings are active."
          : launchReadiness.readyForLiveLaunch
            ? "Production launch requirements are satisfied."
            : `${launchReadiness.liveLaunchBlockingIssues.length} blocking issue${launchReadiness.liveLaunchBlockingIssues.length === 1 ? "" : "s"}`,
        accent: !launchReadiness.liveLaunchEvaluated
          ? "secondary"
          : launchReadiness.readyForLiveLaunch
            ? "success"
            : "warning"
      },
      {
        label: "Synthetic Providers",
        value: launchReadiness.syntheticProviders.length,
        meta: launchReadiness.syntheticProviders.length === 0
          ? "Live providers or real test services are in place."
          : launchReadiness.syntheticProviders.map((provider) => formatLaunchReadinessProviderLabel(provider)).join(", "),
        accent: launchReadiness.syntheticProviders.length === 0 ? "secondary" : "warning"
      },
      {
        label: "Operational Checks",
        value: `${launchReadiness.operationalAudits.filter((audit) => audit.ready).length}/${launchReadiness.operationalAudits.length}`,
        meta: "Backups, monitoring, and error logging runbooks",
        accent: launchReadiness.operationalAudits.every((audit) => audit.ready) ? "success" : "warning"
      }
    ]),
    renderSettingsReadinessNotice({
      title: "Validation Warnings",
      tone: "info",
      items: launchReadiness.validationWarnings
    }),
    renderSettingsReadinessNotice({
      title: "Live Launch Deferred",
      tone: "info",
      items: launchReadiness.liveLaunchEvaluationNotes
    }),
    renderSettingsReadinessNotice({
      title: "Validation Blocking Issues",
      tone: "danger",
      items: launchReadiness.validationBlockingIssues
    }),
    renderSettingsReadinessNotice({
      title: "Live Launch Blocking Issues",
      tone: "danger",
      items: launchReadiness.liveLaunchEvaluated ? launchReadiness.liveLaunchBlockingIssues : []
    }),
    '<div class="settings-readiness-grid">',
    '<section>',
    '<div class="section-heading"><p class="eyebrow">Runtime</p><h3>Node Runtime Checks</h3><p class="section-copy">Database resolution, public URLs, and worker process settings.</p></div>',
    renderDataTable({
      headers: ["Runtime", "Status", "Details"],
      rows: launchReadiness.runtimeConfigAudits.map((audit) => [
        escapeHtml(toTitleCase(audit.runtime)),
        renderStatusPill(audit.valid ? "Ready" : "Blocked", audit.valid ? "success" : "danger"),
        audit.issues.length === 0
          ? '<span class="meta">Configuration looks valid for this runtime.</span>'
          : audit.issues.map((issue) => `<div>${escapeHtml(issue)}</div>`).join("")
      ]),
      emptyMessage: "No runtime readiness checks were generated."
    }),
    '</section>',
    '<section>',
    '<div class="section-heading"><p class="eyebrow">Providers</p><h3>Integration Readiness</h3><p class="section-copy">Payments, anti-spam, inbound mail, outbound mail, and Google OAuth.</p></div>',
    renderDataTable({
      headers: ["Provider", "State", "Details"],
      rows: launchReadiness.providerAudits.map((audit) => [
        escapeHtml(formatLaunchReadinessProviderLabel(audit.provider)),
        [
          renderStatusPill(audit.configured ? "Configured" : "Missing", audit.configured ? "success" : "danger"),
          renderStatusPill(`Mode: ${audit.mode === "n/a" ? "N/A" : toTitleCase(audit.mode)}`, audit.mode === "live" ? "success" : audit.mode === "synthetic" || audit.mode === "test" ? "warning" : audit.mode === "unknown" ? "danger" : "info"),
          renderStatusPill(audit.liveModeReady ? "Live Ready" : "Not Live Ready", audit.liveModeReady ? "success" : "warning")
        ].join(" "),
        audit.issues.length === 0
          ? '<span class="meta">Provider checks passed.</span>'
          : audit.issues.map((issue) => `<div>${escapeHtml(issue)}</div>`).join("")
      ]),
      emptyMessage: "No provider readiness checks were generated."
    }),
    '</section>',
    '<section>',
    '<div class="section-heading"><p class="eyebrow">Operations</p><h3>Runbook Coverage</h3><p class="section-copy">Pre-launch backup, monitoring, and error logging documentation.</p></div>',
    renderDataTable({
      headers: ["Area", "Status", "Details"],
      rows: launchReadiness.operationalAudits.map((audit) => [
        escapeHtml(formatLaunchReadinessOperationalAreaLabel(audit.area)),
        renderStatusPill(audit.ready ? "Documented" : "Missing", audit.ready ? "success" : "danger"),
        audit.issues.length === 0
          ? '<span class="meta">Required runbook evidence is present.</span>'
          : audit.issues.map((issue) => `<div>${escapeHtml(issue)}</div>`).join("")
      ]),
      emptyMessage: "No operational readiness checks were generated."
    }),
    "</section>",
    "</div>",
    "</section>"
  ].join("");
}

function renderSettingsOverview(model: Pick<SettingsConsoleViewModel, "basePath" | "settings" | "launchReadiness">): string {
  const settings = model.settings;
  const orderedSettings = [...settings].sort((left, right) => left.label.localeCompare(right.label));
  const categoryOrder = [...SETTINGS_CATEGORY_ORDER];
  const remainingCategories = [...new Set(orderedSettings.map((setting) => setting.category))]
    .filter((category) => !categoryOrder.includes(category as typeof SETTINGS_CATEGORY_ORDER[number]))
    .sort((left, right) => left.localeCompare(right));
  const categories = [...categoryOrder, ...remainingCategories];
  const launchCriticalSettings = orderedSettings.filter((setting) => getSettingConsoleMetadata(setting).launchCritical);

  return [
    '<section class="surface-block settings-console" data-settings-console>',
    '<div class="settings-console__hero">',
    '<div>',
    '<p class="eyebrow">Launch Controls</p>',
    '<h2>Launch-Critical Settings</h2>',
    '<p class="section-copy">Treat this console as the operational control room for URLs, payments, anti-spam, email, and integrations. The highest-risk settings are highlighted first so operators can finish release setup without spelunking through raw keys.</p>',
    "</div>",
    '<div class="settings-console__hero-meta">',
    '<div><span>Mode</span><strong>Admin Console</strong></div>',
    `<div><span>Visible Categories</span><strong>${escapeHtml(categories.map((category) => formatSettingCategoryLabel(category)).join(", "))}</strong></div>`,
    "</div>",
    "</div>",
    renderSettingsSummaryCards(orderedSettings),
    renderCalendarOAuthActionPanel(model),
    renderSettingsLaunchReadinessPanel(model.launchReadiness),
    '<div class="settings-console-toolbar">',
    '<label class="settings-console-search">',
    '<span>Search settings</span>',
    '<input type="search" placeholder="Search by label, key, category, or usage" data-settings-search>',
    "</label>",
    '<div class="settings-console-filters">',
    '<label class="settings-filter-pill"><input type="checkbox" data-settings-launch-only> Launch Critical</label>',
    '<label class="settings-filter-pill"><input type="checkbox" data-settings-secret-only> Secrets Only</label>',
    "</div>",
    "</div>",
    '<section class="settings-launch-strip">',
    '<div class="section-heading">',
    "<p class=\"eyebrow\">Priority Queue</p>",
    "<h3>Launch-Critical Settings</h3>",
    "<p class=\"section-copy\">These entries directly affect booking, checkout, verification, mail, and calendar authorization.</p>",
    "</div>",
    `<div class="settings-launch-grid">${launchCriticalSettings.map(renderSettingsCard).join("")}</div>`,
    "</section>",
    '<div class="settings-empty-state" data-settings-empty hidden>',
    "<h3>No settings match the current filters.</h3>",
    "<p>Try clearing the search or broadening the filter set to see more configuration entries.</p>",
    "</div>",
    categories.map((category) => {
      const categorySettings = orderedSettings.filter((setting) => setting.category === category);
      if (categorySettings.length === 0) {
        return "";
      }

      return [
        `<section class="settings-category-section" data-settings-section data-category="${escapeAttribute(category)}">`,
        '<div class="section-heading">',
        `<p class="eyebrow">${escapeHtml(formatSettingCategoryLabel(category))}</p>`,
        `<h3>${escapeHtml(formatSettingCategoryLabel(category))}</h3>`,
        `<p class="section-copy">${escapeHtml(getSettingCategoryDescription(category))}</p>`,
        "</div>",
        `<div class="settings-card-grid">${categorySettings.map(renderSettingsCard).join("")}</div>`,
        "</section>"
      ].join("");
    }).join(""),
    "<script>",
    "(() => {",
    "  const root = document.querySelector('[data-settings-console]');",
    "  if (!(root instanceof HTMLElement)) { return; }",
    "  const searchInput = root.querySelector('[data-settings-search]');",
    "  const launchOnly = root.querySelector('[data-settings-launch-only]');",
    "  const secretOnly = root.querySelector('[data-settings-secret-only]');",
    "  const emptyState = root.querySelector('[data-settings-empty]');",
    "  const cards = Array.from(root.querySelectorAll('[data-setting-card]'));",
    "  const sections = Array.from(root.querySelectorAll('[data-settings-section]'));",
    "  const applyFilters = () => {",
    "    const query = searchInput instanceof HTMLInputElement ? searchInput.value.trim().toLowerCase() : '';",
    "    const onlyLaunch = launchOnly instanceof HTMLInputElement ? launchOnly.checked : false;",
    "    const onlySecret = secretOnly instanceof HTMLInputElement ? secretOnly.checked : false;",
    "    let visibleCards = 0;",
    "    for (const card of cards) {",
    "      if (!(card instanceof HTMLElement)) { continue; }",
    "      const searchText = (card.dataset.search ?? '').toLowerCase();",
    "      const launchMatch = !onlyLaunch || card.dataset.launchCritical === 'true';",
    "      const secretMatch = !onlySecret || card.dataset.secret === 'true';",
    "      const queryMatch = query === '' || searchText.includes(query);",
    "      const visible = launchMatch && secretMatch && queryMatch;",
    "      card.hidden = !visible;",
    "      if (visible) { visibleCards += 1; }",
    "    }",
    "    for (const section of sections) {",
    "      if (!(section instanceof HTMLElement)) { continue; }",
    "      const hasVisibleCards = section.querySelector('[data-setting-card]:not([hidden])') != null;",
    "      section.hidden = !hasVisibleCards;",
    "    }",
    "    if (emptyState instanceof HTMLElement) {",
    "      emptyState.hidden = visibleCards !== 0;",
    "    }",
    "  };",
    "  searchInput?.addEventListener('input', applyFilters);",
    "  launchOnly?.addEventListener('change', applyFilters);",
    "  secretOnly?.addEventListener('change', applyFilters);",
    "  applyFilters();",
    "})();",
    "</script>",
    "</section>"
  ].join("");
}

function renderSettingsConsole(model: SettingsConsoleViewModel): string {
  const validCategories = new Set([
    settingsDefaultCategory,
    "admins",
    ...model.categories.map((category) => normalizeSettingsCategory(category))
  ]);
  const selectedCategory = normalizeSettingsCategory(model.currentCategory);
  const resolvedCategory = validCategories.has(selectedCategory) ? selectedCategory : settingsDefaultCategory;
  const selectedSettings = resolvedCategory === settingsDefaultCategory
    ? model.settings
    : model.settings.filter((setting) => normalizeSettingsCategory(setting.category) === resolvedCategory);

  return [
    '<div class="settings-shell" data-no-reveal>',
    renderAdminSettingsSidebar({
      ...model,
      currentCategory: resolvedCategory
    }),
    '<div class="settings-shell__content">',
    renderSettingsNotice(model.notice),
    resolvedCategory === "admins"
      ? renderAdminSettingsUsersSection(model)
      : resolvedCategory === "database"
        ? renderRuntimeEnvironmentSettingsPanel({
            currentAdmin: model.currentAdmin,
            fields: model.runtimeEnvironmentFields ?? []
          })
        : resolvedCategory === settingsDefaultCategory
          ? renderSettingsOverview(model)
        : [
            '<section class="surface-block">',
            `<p class="eyebrow">${escapeHtml(formatSettingCategoryLabel(resolvedCategory))}</p>`,
            `<h2>${escapeHtml(formatSettingCategoryLabel(resolvedCategory))} Settings</h2>`,
            `<p class="section-copy">${escapeHtml(getSettingCategoryDescription(resolvedCategory))}</p>`,
            "</section>",
            resolvedCategory === "calendar" ? renderCalendarOAuthActionPanel(model) : "",
            selectedSettings.length === 0
              ? '<section class="surface-block"><p>No visible settings are available in this category.</p></section>'
              : `<section class="settings-category-section"><div class="settings-card-grid">${selectedSettings.map(renderSettingsCard).join("")}</div></section>`
          ].join(""),
    "</div>",
    "</div>"
  ].join("");
}

function renderSettingEditorControl(setting: Setting): string {
  const metadata = getSettingConsoleMetadata(setting);
  const options = getSettingSelectOptions(setting, metadata);
  const normalizedType = getNormalizedSettingType(setting.type);

  if (options != null) {
    return [
      `<label>${escapeHtml(setting.secret ? "Replace Value" : "Value")}`,
      '<select name="value">',
      options.map((option) => `<option value="${escapeAttribute(option.value)}"${option.value === setting.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join(""),
      "</select>",
      "</label>"
    ].join("");
  }

  if (metadata.multiline || normalizedType === "textarea" || setting.value.includes("\n") || setting.value.length > 160) {
    return `<label>Value<textarea name="value" placeholder="${escapeAttribute(metadata.placeholder ?? "")}">${escapeHtml(setting.value)}</textarea></label>`;
  }

  switch (normalizedType) {
    case "checkbox":
    case "boolean":
      return [
        '<input type="hidden" name="value" value="0">',
        `<label><input type="checkbox" name="value" value="1"${isTruthySettingValue(setting.value) ? " checked" : ""}> Enabled</label>`
      ].join("");
    case "color":
      return `<label>Value<input type="color" name="value" value="${escapeAttribute(setting.value.trim() === "" ? "#000000" : setting.value)}"></label>`;
    case "email":
    case "number":
    case "time":
    case "url":
      return `<label>Value<input type="${normalizedType}" name="value" value="${escapeAttribute(setting.value)}" placeholder="${escapeAttribute(metadata.placeholder ?? "")}"></label>`;
    default:
      return `<label>Value<input type="${setting.secret ? "password" : "text"}" name="value" value="${escapeAttribute(setting.value)}" placeholder="${escapeAttribute(metadata.placeholder ?? "")}"${setting.secret ? ' autocomplete="off"' : ""}></label>`;
  }
}

function renderSettingDetail(setting: Setting): string {
  const metadata = getSettingConsoleMetadata(setting);
  const categoryLabel = formatSettingCategoryLabel(setting.category);
  const currentValue = renderSettingCurrentValue(setting);

  return [
    '<div class="settings-detail-shell">',
    '<section class="surface-block settings-detail-hero">',
    '<div class="settings-detail-hero__copy">',
    `<p class="eyebrow">${escapeHtml(categoryLabel)}</p>`,
    "<h2>Settings Detail</h2>",
    `<h1>${escapeHtml(setting.label)}</h1>`,
    `<p class="section-copy">${escapeHtml(setting.description)}</p>`,
    "</div>",
    renderSettingBadges(setting),
    "</section>",
    renderDetailGrid([
      { label: "Key", value: escapeHtml(setting.key) },
      { label: "Type", value: escapeHtml(formatSettingTypeLabel(setting.type)) },
      { label: "Category", value: escapeHtml(categoryLabel) },
      { label: "Current Value", value: currentValue }
    ]),
    '<div class="settings-detail-grid">',
    '<section class="surface-block">',
    "<p class=\"eyebrow\">Usage</p>",
    "<h3>Where this is used</h3>",
    `<p class="section-copy">${escapeHtml(getSettingCategoryDescription(setting.category))}</p>`,
    `<ul class="settings-usage-list">${metadata.usage.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    "</section>",
    '<section class="surface-block">',
    "<p class=\"eyebrow\">Current Value</p>",
    "<h3>Current Value</h3>",
    `<div class="settings-current-value-panel">${currentValue}</div>`,
    `<p class="meta">${escapeHtml(setting.secret ? "This entry is marked secret and should be handled with care." : "This value is visible to operators with settings access.")}</p>`,
    "</section>",
    "</div>",
    '<section class="surface-block settings-editor-shell">',
    "<p class=\"eyebrow\">Edit</p>",
    `<h3>${metadata.launchCritical ? "Launch Critical" : "Standard Setting"}</h3>`,
    `<p class="section-copy">${escapeHtml(metadata.launchCritical
      ? "Saving this value changes release-critical behavior immediately for the live site."
      : "Save changes here to update the live setting used by the business.")}</p>`,
    `<form class="form-grid" method="post" action="/admin/settings/${encodeURIComponent(setting.key)}">`,
    renderSettingEditorControl(setting),
    '<div class="form-actions"><button type="submit">Save Setting</button><a class="quick-link-card quick-link-card--inline" href="/admin/settings"><span class="quick-link-card__label">Back to Settings</span><span class="quick-link-card__meta">Return to the full console</span></a></div>',
    "</form>",
    "</section>",
    "</div>"
  ].join("");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function buildRequestOrigin(request: IncomingMessage): string {
  const hostHeader = request.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (host == null || host.trim() === "") {
    return "";
  }

  const forwardedProtoHeader = request.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader?.split(",")[0]?.trim();

  return `${forwardedProto && forwardedProto !== "" ? forwardedProto : "http"}://${host}`;
}

async function listLegacyPublicServices(
  api: ApiDependencies | null,
  request: IncomingMessage
): Promise<Array<{
  id: string;
  name: string;
  description: string;
  bullet_points: string[];
  price: number;
  duration_minutes: number;
  location: string;
  type_label: string;
  booking_url: string;
}>> {
  if (api == null) {
    return [];
  }

  const origin = buildRequestOrigin(request);
  const appointmentTypes = await api.adminConfiguration.listAdminAppointmentTypes();

  return appointmentTypes
    .filter((item) => item.active && item.publicAvailable && !item.isGroupClass && !item.isMiniSession)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => {
      const bookingPath = item.uniqueLink.trim() !== ""
        ? `/backend/public/book.php?link=${encodeURIComponent(item.uniqueLink)}`
        : `/backend/public/book.php?type=${encodeURIComponent(item.id)}`;

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        bullet_points: item.bulletPoints,
        price: item.defaultAmount,
        duration_minutes: item.durationMinutes,
        location: item.isFieldRental ? item.fieldRentalLocation : "",
        type_label: item.isFieldRental ? "Field Rental" : "",
        booking_url: origin === "" ? bookingPath : `${origin}${bookingPath}`
      };
    });
}

function formatMinutesAsTimeOfDay(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function parseTimeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(":");
  return Number.parseInt(hours ?? "0", 10) * 60 + Number.parseInt(minutes ?? "0", 10);
}

function buildEventCandidateMinutes(
  appointmentType: AppointmentType,
  dateEntry: AppointmentType["specificDates"][number]
): number[] {
  const interval = Math.max(appointmentType.timeSlotInterval, 1);
  if (dateEntry.timeslots.length > 0) {
    const values = new Set<number>();
    for (const timeslot of dateEntry.timeslots) {
      if (timeslot.type === "point") {
        values.add(parseTimeOfDayToMinutes(timeslot.time));
        continue;
      }

      const startMinutes = parseTimeOfDayToMinutes(timeslot.start);
      const endMinutes = parseTimeOfDayToMinutes(timeslot.end);
      for (let minute = startMinutes; minute < endMinutes; minute += interval) {
        values.add(minute);
      }
    }

    return [...values].sort((left, right) => left - right);
  }

  const startMinutes = parseTimeOfDayToMinutes(appointmentType.availableStartTime);
  const endMinutes = parseTimeOfDayToMinutes(appointmentType.availableEndTime);
  const values: number[] = [];
  for (let minute = startMinutes; minute < endMinutes; minute += interval) {
    values.push(minute);
  }

  return values;
}

async function listLegacyPublicEvents(
  api: ApiDependencies | null,
  request: IncomingMessage
): Promise<Array<{
  id: string;
  name: string;
  description: string;
  bullet_points: string[];
  price: number;
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  fully_booked: boolean;
  booking_url: string | null;
  type: "group_class" | "mini_session";
  location: string;
  max_participants?: number;
  topic?: string;
}>> {
  if (api == null) {
    return [];
  }

  const origin = buildRequestOrigin(request);
  const today = api.publicBooking.now().slice(0, 10);
  const appointmentTypes = await api.adminConfiguration.listAdminAppointmentTypes();
  const bookings = await api.adminResources.listAdminBookings();
  const events: Array<{
    id: string;
    name: string;
    description: string;
    bullet_points: string[];
    price: number;
    date: string;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    fully_booked: boolean;
    booking_url: string | null;
    type: "group_class" | "mini_session";
    location: string;
    max_participants?: number;
    topic?: string;
  }> = [];

  for (const appointmentType of appointmentTypes) {
    if (!appointmentType.active || appointmentType.scheduleType !== "specific_date" || (!appointmentType.isGroupClass && !appointmentType.isMiniSession)) {
      continue;
    }

    const dateEntries = appointmentType.specificDates
      .filter((entry) => entry.date >= today);
    if (dateEntries.length === 0 && appointmentType.specificDate != null && appointmentType.specificDate >= today) {
      dateEntries.push({
        date: appointmentType.specificDate,
        timeslots: []
      });
    }

    const bookingPath = appointmentType.uniqueLink.trim() === ""
      ? null
      : `/backend/public/book.php?link=${encodeURIComponent(appointmentType.uniqueLink)}`;
    const bookingUrl = bookingPath == null
      ? null
      : origin === ""
        ? bookingPath
        : `${origin}${bookingPath}`;
    const duration = Math.max(appointmentType.durationMinutes, 1);
    const capacity = appointmentType.isGroupClass ? Math.max(appointmentType.maxParticipants, 1) : 1;

    for (const dateEntry of dateEntries) {
      const candidateMinutes = buildEventCandidateMinutes(appointmentType, dateEntry);
      const slotCounts = new Map<string, number>();
      for (const booking of bookings) {
        if (booking.status === "cancelled" || booking.serviceId !== appointmentType.id || booking.startsAt.slice(0, 10) !== dateEntry.date) {
          continue;
        }

        const slotKey = booking.startsAt.slice(11, 16);
        slotCounts.set(slotKey, (slotCounts.get(slotKey) ?? 0) + 1);
      }

      const anyAvailable = candidateMinutes.some((minute) => (
        (slotCounts.get(formatMinutesAsTimeOfDay(minute)) ?? 0) < capacity
      ));
      const customTimeslots = dateEntry.timeslots.length > 0 && candidateMinutes.length > 0;
      const startTime = customTimeslots
        ? formatMinutesAsTimeOfDay(candidateMinutes[0] ?? 0)
        : appointmentType.availableStartTime;
      const endTime = customTimeslots
        ? formatMinutesAsTimeOfDay(Math.min((candidateMinutes[candidateMinutes.length - 1] ?? 0) + duration, 23 * 60 + 59))
        : appointmentType.availableEndTime;

      if (appointmentType.isGroupClass) {
        events.push({
          id: appointmentType.id,
          name: appointmentType.name,
          description: appointmentType.description,
          bullet_points: appointmentType.bulletPoints,
          price: appointmentType.defaultAmount,
          date: dateEntry.date,
          start_time: startTime,
          end_time: endTime,
          duration_minutes: duration,
          fully_booked: candidateMinutes.length > 0 && !anyAvailable,
          booking_url: bookingUrl,
          type: "group_class",
          max_participants: capacity,
          location: appointmentType.groupClassLocation
        });
        continue;
      }

      events.push({
        id: appointmentType.id,
        name: appointmentType.name,
        description: appointmentType.description,
        bullet_points: appointmentType.bulletPoints,
        price: appointmentType.defaultAmount,
        date: dateEntry.date,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: duration,
        fully_booked: candidateMinutes.length > 0 && !anyAvailable,
        booking_url: bookingUrl,
        type: "mini_session",
        location: appointmentType.miniSessionLocation,
        topic: appointmentType.miniSessionTopic
      });
    }
  }

  return events.sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.start_time.localeCompare(right.start_time)
    || left.name.localeCompare(right.name)
  ));
}

async function listLegacyPublicPackages(
  api: ApiDependencies | null,
  request: IncomingMessage
): Promise<Array<{
  id: string;
  name: string;
  description: string;
  bullet_points: string[];
  price: number;
  expiration_days: number | null;
  items: Array<{
    apt_type_name: string;
    quantity: number;
  }>;
  purchase_url: string;
}>> {
  if (api == null) {
    return [];
  }

  const origin = buildRequestOrigin(request);
  const packages = await api.adminResources.listAdminPackages();

  return packages
    .filter((item) => item.active && item.shareToken != null && item.shareToken.trim() !== "")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      bullet_points: item.bulletPoints ?? [],
      price: item.price,
      expiration_days: item.expirationDays ?? null,
      items: (item.items ?? []).map((packageItem) => ({
        apt_type_name: packageItem.appointmentTypeName,
        quantity: packageItem.quantity
      })),
      purchase_url: `${origin === "" ? "" : origin}/client/package_detail.php?token=${encodeURIComponent(item.shareToken ?? "")}`
    }));
}

async function resolveLegacyPublicPackage(
  api: ApiDependencies | null,
  url: URL
): Promise<Package | null> {
  if (api == null) {
    return null;
  }

  const token = url.searchParams.get("token")?.trim() ?? "";
  if (token === "") {
    return null;
  }

  return api.publicPackages.findPublicPackageByToken(token);
}

function sanitizeLocalReturnPath(value: string | null): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "" || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return null;
    }

    const pathSegments = parsed.pathname.split("/").filter((segment) => segment !== "");
    if (pathSegments.includes("..")) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

type PublicDocumentResourceKind = "quote" | "contract" | "form" | "booking";

function normalizeLegacyPortalReturnPath(path: string, resourceKind: PublicDocumentResourceKind): string {
  const parsed = new URL(path, "http://localhost");

  switch (parsed.pathname) {
    case "/portal/login.php":
      parsed.pathname = "/portal/login";
      break;
    case "/portal/quotes.php":
      parsed.pathname = "/portal/quotes";
      break;
    case "/portal/appointments.php": {
      const bookingId = parsed.searchParams.get("booking_id")?.trim() ?? "";
      if (bookingId !== "") {
        parsed.pathname = `/portal/bookings/${encodeURIComponent(bookingId)}`;
        parsed.searchParams.delete("booking_id");
      } else {
        parsed.pathname = "/portal/bookings";
      }
      break;
    }
    case "/portal/agreements.php":
      parsed.pathname = resourceKind === "form" ? "/portal/forms" : "/portal/contracts";
      break;
    default:
      break;
  }

  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query === "" ? "" : `?${query}`}${parsed.hash}`;
}

function sanitizePortalReturnPath(value: string | null, resourceKind: PublicDocumentResourceKind): string | null {
  const sanitized = sanitizeLocalReturnPath(value);
  if (sanitized == null || sanitized.startsWith("/portal") === false) {
    return null;
  }

  return normalizeLegacyPortalReturnPath(sanitized, resourceKind);
}

function buildPortalLoginPath(returnPath: string | null): string {
  return returnPath == null
    ? "/portal/login"
    : `/portal/login?return_to=${encodeURIComponent(returnPath)}`;
}

function sanitizeAdminReturnPath(value: string | null): string | null {
  const sanitized = sanitizeLocalReturnPath(value);
  if (sanitized == null || (!sanitized.startsWith("/admin") && !sanitized.startsWith("/client"))) {
    return null;
  }

  return sanitized;
}

function buildAdminLoginPath(returnPath: string | null): string {
  return returnPath == null
    ? "/admin/login"
    : `/admin/login?return_to=${encodeURIComponent(returnPath)}`;
}

function resultAdminLandingPath(role: unknown): string {
  return role === "accountant" ? "/client/invoices_list.php" : "/admin";
}

function getCurrentRequestPath(request: IncomingMessage): string {
  const url = new URL(request.url ?? "/", "http://localhost");
  return `${url.pathname}${url.search}`;
}

function buildPortalLoginRedirectPath(request: IncomingMessage): string {
  return buildPortalLoginPath(sanitizePortalReturnPath(getCurrentRequestPath(request), "form"));
}

function buildAdminLoginRedirectPath(request: IncomingMessage): string {
  return buildAdminLoginPath(sanitizeAdminReturnPath(getCurrentRequestPath(request)));
}

function buildAbsoluteReturnUrl(request: IncomingMessage, returnPath: string | null): string | null {
  return returnPath == null ? null : `${getRequestOrigin(request)}${returnPath}`;
}

function renderAuthLoginPage(input: {
  title: string;
  eyebrow: string;
  introTitle: string;
  description: string;
  action: string;
  identifierFieldHtml: string;
  returnPath: string | null;
  errorMessage?: string | null;
  heroPoints: string[];
  supportLabel: string;
}): string {
  return renderLayout({
    title: input.title,
    variant: "auth",
    body: [
      '<section class="auth-shell">',
      '<div class="auth-shell__hero">',
      `<p class="eyebrow auth-shell__eyebrow">${escapeHtml(input.eyebrow)}</p>`,
      `<div class="auth-shell__hero-copy"><h1>${escapeHtml(input.introTitle)}</h1><p class="section-copy">${escapeHtml(input.description)}</p></div>`,
      input.returnPath == null
        ? '<p class="auth-shell__return">Secure access for existing clients and staff.</p>'
        : `<p class="auth-shell__return">After sign-in, you will continue to <strong>${escapeHtml(input.returnPath)}</strong>.</p>`,
      `<ul class="auth-benefits">${input.heroPoints.map((point) => `<li class="auth-benefit">${escapeHtml(point)}</li>`).join("")}</ul>`,
      `<p class="auth-shell__support">${escapeHtml(input.supportLabel)}</p>`,
      "</div>",
      '<div class="auth-shell__panel">',
      '<article class="auth-card">',
      '<div class="auth-card__copy">',
      '<p class="eyebrow">Secure Access</p>',
      `<h2>${escapeHtml(input.title)}</h2>`,
      '<p class="section-copy">Use your assigned credentials to continue.</p>',
      "</div>",
      input.errorMessage == null || input.errorMessage.trim() === ""
        ? ""
        : `<p class="auth-error" role="alert">${escapeHtml(input.errorMessage)}</p>`,
      `<form class="auth-form" method="post" action="${escapeAttribute(input.action)}">`,
      input.identifierFieldHtml,
      '<label>Password<input type="password" name="password" required autocomplete="current-password"></label>',
      '<button type="submit">Sign In</button>',
      "</form>",
      '<p class="meta">If you were given a direct link, sign in here and the next screen will open automatically.</p>',
      "</article>",
      "</div>",
      "</section>"
    ].join("")
  });
}

function renderPortalLoginPage(input: {
  action: string;
  errorMessage?: string | null;
  returnPath: string | null;
}): string {
  return renderAuthLoginPage({
    title: "Portal Login",
    eyebrow: "Brook's Dog Training Academy",
    introTitle: "Stay close to your dog's training plan.",
    description: input.returnPath == null
      ? "Review appointments, invoices, quotes, contracts, forms, and account details from one sign-in."
      : "Sign in to continue where you left off.",
    action: input.action,
    identifierFieldHtml: '<label>Email<input type="email" name="email" required autocomplete="username"></label>',
    returnPath: input.returnPath,
    errorMessage: input.errorMessage,
    heroPoints: [
      "Upcoming appointments and training records in one place.",
      "Invoices, quotes, contracts, and forms without extra navigation.",
      "Direct-link friendly sign-in for shared documents and actions."
    ],
    supportLabel: "Access is for active clients and invited household members."
  });
}

function renderAdminLoginPage(input: {
  action: string;
  errorMessage?: string | null;
  returnPath: string | null;
}): string {
  return renderAuthLoginPage({
    title: "Admin Login",
    eyebrow: "Brook's Dog Training Academy",
    introTitle: "Keep clients, bookings, and billing moving.",
    description: input.returnPath == null
      ? "Sign in to manage clients, bookings, billing, forms, and day-to-day operations."
      : "Sign in to return to the staff page you requested.",
    action: input.action,
    identifierFieldHtml: '<label>Username<input type="text" name="username" required autocomplete="username"></label>',
    returnPath: input.returnPath,
    errorMessage: input.errorMessage,
    heroPoints: [
      "See today's schedule, client records, billing, and open tasks.",
      "Handle forms, documents, and follow-up without extra clicks.",
      "Return directly to the requested staff page after sign-in."
    ],
    supportLabel: "Staff access is issued separately from client accounts."
  });
}

function renderLegacyPublicDocumentUnavailablePage(input: {
  title: string;
  eyebrow: string;
  heading: string;
  description: string;
  currentPath: string;
  publicRenderAssets: PublicRenderAssets;
}): string {
  return renderPublicPageLayout({
    title: input.title,
    publicRenderAssets: input.publicRenderAssets,
    requestPath: input.currentPath,
    body: [
      '<section class="marketing-hero marketing-hero--compact">',
      `<p class="eyebrow">${escapeHtml(input.eyebrow)}</p>`,
      `<h1>${escapeHtml(input.heading)}</h1>`,
      `<p class="section-copy">${escapeHtml(input.description)}</p>`,
      '<div class="form-actions"><a class="nav-cta" href="/portal/login"><span>Open Client Portal</span></a><a class="quick-link-card quick-link-card--inline" href="/services"><span class="quick-link-card__label">Explore Services</span><span class="quick-link-card__meta">Review training options and next steps</span></a></div>',
      "</section>"
    ].join("")
  });
}

function renderLegacyPublicDocumentActionPanel(input: {
  session: StoredSessionSnapshot | null;
  requestPath: string;
  resourceKind: Exclude<PublicDocumentResourceKind, "booking">;
  resourceId: string;
  complete: boolean;
}): {
  title: string;
  description: string;
  actionMarkup: string;
} {
  if (input.session?.actorType === "admin_user") {
    const adminHref = input.resourceKind === "quote"
      ? `/admin/quotes/${encodeURIComponent(input.resourceId)}`
      : input.resourceKind === "contract"
        ? `/admin/contracts/${encodeURIComponent(input.resourceId)}`
        : `/admin/forms/${encodeURIComponent(input.resourceId)}`;

    return {
      title: "Staff View",
      description: "This record is available from your signed-in staff account.",
      actionMarkup: `<div class="form-actions"><a class="nav-cta" href="${escapeAttribute(adminHref)}">Open Staff View</a></div>`
    };
  }

  if (input.session?.actorType === "portal_user") {
    if (input.resourceKind === "quote") {
      return {
        title: "Client Portal",
        description: "Continue quote actions through the authenticated client portal.",
        actionMarkup: input.complete
          ? `<div class="form-actions"><a class="nav-cta" href="/portal/quotes/${encodeURIComponent(input.resourceId)}">View in Client Portal</a></div>`
          : `<div class="form-actions"><form method="post" action="/portal/quotes/${encodeURIComponent(input.resourceId)}/accept"><button type="submit">Accept Quote</button></form><a class="quick-link-card quick-link-card--inline" href="/portal/quotes/${encodeURIComponent(input.resourceId)}"><span class="quick-link-card__label">Review Quote</span><span class="quick-link-card__meta">Open the portal detail view first</span></a></div>`
      };
    }

    if (input.resourceKind === "contract") {
      return {
        title: "Client Portal",
        description: "Continue contract review through the authenticated client portal.",
        actionMarkup: input.complete
          ? `<div class="form-actions"><a class="nav-cta" href="/portal/contracts/${encodeURIComponent(input.resourceId)}">View in Client Portal</a></div>`
          : `<div class="form-actions"><form method="post" action="/portal/contracts/${encodeURIComponent(input.resourceId)}/sign"><button type="submit">Sign Contract</button></form><a class="quick-link-card quick-link-card--inline" href="/portal/contracts/${encodeURIComponent(input.resourceId)}"><span class="quick-link-card__label">Review Contract</span><span class="quick-link-card__meta">Open the portal detail view first</span></a></div>`
      };
    }

    return {
      title: "Client Portal",
      description: "Continue form review through the authenticated client portal.",
      actionMarkup: input.complete
        ? `<div class="form-actions"><a class="nav-cta" href="/portal/forms/${encodeURIComponent(input.resourceId)}">Review Form</a></div>`
        : `<div class="form-actions"><form method="post" action="/portal/forms/${encodeURIComponent(input.resourceId)}/submit"><button type="submit">Submit Form</button></form><a class="quick-link-card quick-link-card--inline" href="/portal/forms/${encodeURIComponent(input.resourceId)}"><span class="quick-link-card__label">View Form</span><span class="quick-link-card__meta">Open the portal detail view first</span></a></div>`
    };
  }

  const portalLoginPath = buildPortalLoginPath(input.requestPath);
  return {
    title: "Client Portal",
    description: "Existing clients can sign in to continue authenticated actions for this record.",
    actionMarkup: `<div class="form-actions"><a class="nav-cta" href="${escapeAttribute(portalLoginPath)}">Open Client Portal</a><a class="quick-link-card quick-link-card--inline" href="/#contact"><span class="quick-link-card__label">Contact the Team</span><span class="quick-link-card__meta">Questions about this document or your account</span></a></div>`
  };
}

function renderLegacyPublicFeedback(
  tone: "success" | "info" | "error",
  message: string
): string {
  const palette = tone === "success"
    ? { border: "#15803d", background: "#f0fdf4" }
    : tone === "error"
      ? { border: "#b91c1c", background: "#fef2f2" }
      : { border: "#1d4ed8", background: "#eff6ff" };

  return `<div class="surface-block" style="border-color:${palette.border};background:${palette.background};"><p class="section-copy">${escapeHtml(message)}</p></div>`;
}

function getPublicDocumentMutationStatusCode(error: unknown): number {
  if (error instanceof PublicDocumentMutationError) {
    return error.code === "not_found" ? 404 : 400;
  }

  return error instanceof z.ZodError ? 400 : 500;
}

function renderLegacyQuoteItemsTable(items: Quote["items"] | undefined): string {
  if (items == null || items.length === 0) {
    return '<p class="section-copy">No quote line items are currently attached to this proposal.</p>';
  }

  return renderDataTable({
    headers: ["Description", "Qty", "Unit Price", "Amount"],
    rows: items.map((item) => [
      escapeHtml(item.description),
      escapeHtml(String(item.quantity)),
      escapeHtml(formatCurrency(item.unitPrice)),
      escapeHtml(formatCurrency(item.amount))
    ]),
    emptyMessage: "No quote line items are currently attached to this proposal."
  });
}

function renderLegacyPublicQuoteDetailPage(input: {
  quote: Quote;
  currentPath: string;
  publicRenderAssets: PublicRenderAssets;
  portalReturnPath: string | null;
  sidebarTitle: string;
  sidebarDescription: string;
  sidebarMarkup: string;
  feedbackMarkup?: string;
}): string {
  return renderPublicPageLayout({
    title: input.quote.title ?? input.quote.quoteNumber ?? `Quote ${input.quote.id}`,
    publicRenderAssets: input.publicRenderAssets,
    requestPath: input.currentPath,
    body: [
      '<div class="booking-shell">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Quote Access</p>',
      `<h1>${escapeHtml(input.quote.title ?? input.quote.quoteNumber ?? `Quote ${input.quote.id}`)}</h1>`,
      input.quote.description == null || input.quote.description.trim() === ""
        ? '<p class="section-copy">Review quote details, pricing, and the next action from this secure access link.</p>'
        : `<p class="section-copy">${escapeHtml(input.quote.description)}</p>`,
      input.portalReturnPath == null ? "" : `<div class="form-actions"><a class="quick-link-card quick-link-card--inline" href="${escapeAttribute(input.portalReturnPath)}"><span class="quick-link-card__label">Back to Client Portal</span><span class="quick-link-card__meta">Return to the originating portal page</span></a></div>`,
      "</section>",
      '<section class="booking-shell__grid">',
      '<article class="booking-form-card">',
      "<h2>Quote Summary</h2>",
      renderDetailGrid([
        { label: "Quote ID", value: escapeHtml(input.quote.id) },
        { label: "Quote Number", value: escapeHtml(input.quote.quoteNumber ?? input.quote.id) },
        { label: "Status", value: renderStatusPill(input.quote.status, input.quote.status === "accepted" ? "success" : input.quote.status === "declined" ? "danger" : "warning") },
        { label: "Total Amount", value: escapeHtml(formatCurrency(input.quote.totalAmount)) },
        input.quote.expiresAt == null ? null : { label: "Expires", value: escapeHtml(input.quote.expiresAt) }
      ].filter((item): item is { label: string; value: string } => item != null)),
      input.feedbackMarkup ?? "",
      '<section class="surface-block">',
      "<h3>Line Items</h3>",
      renderLegacyQuoteItemsTable(input.quote.items),
      "</section>",
      "</article>",
      '<aside class="booking-benefits">',
      `<h2>${escapeHtml(input.sidebarTitle)}</h2>`,
      `<p class="section-copy">${escapeHtml(input.sidebarDescription)}</p>`,
      input.sidebarMarkup,
      "</aside>",
      "</section>",
      "</div>"
    ].join("")
  });
}

function renderLegacyPublicContractDetailPage(input: {
  contract: Contract;
  currentPath: string;
  publicRenderAssets: PublicRenderAssets;
  portalReturnPath: string | null;
  sidebarTitle: string;
  sidebarDescription: string;
  sidebarMarkup: string;
  feedbackMarkup?: string;
}): string {
  return renderPublicPageLayout({
    title: input.contract.title ?? input.contract.contractNumber ?? `Contract ${input.contract.id}`,
    publicRenderAssets: input.publicRenderAssets,
    requestPath: input.currentPath,
    body: [
      '<div class="booking-shell">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Contract Access</p>',
      `<h1>${escapeHtml(input.contract.title ?? input.contract.contractNumber ?? `Contract ${input.contract.id}`)}</h1>`,
      input.contract.description == null || input.contract.description.trim() === ""
        ? '<p class="section-copy">Review this agreement and complete the remaining signature step when required.</p>'
        : `<p class="section-copy">${escapeHtml(input.contract.description)}</p>`,
      input.portalReturnPath == null ? "" : `<div class="form-actions"><a class="quick-link-card quick-link-card--inline" href="${escapeAttribute(input.portalReturnPath)}"><span class="quick-link-card__label">Back to Client Portal</span><span class="quick-link-card__meta">Return to the originating portal page</span></a></div>`,
      "</section>",
      '<section class="booking-shell__grid">',
      '<article class="booking-form-card">',
      "<h2>Contract Summary</h2>",
      renderDetailGrid([
        { label: "Contract ID", value: escapeHtml(input.contract.id) },
        { label: "Contract Number", value: escapeHtml(input.contract.contractNumber ?? input.contract.id) },
        { label: "Status", value: renderStatusPill(input.contract.status, input.contract.status === "signed" ? "success" : "warning") },
        input.contract.effectiveDate == null ? null : { label: "Effective Date", value: escapeHtml(input.contract.effectiveDate) },
        input.contract.signedAt == null ? null : { label: "Signed", value: escapeHtml(input.contract.signedAt) }
      ].filter((item): item is { label: string; value: string } => item != null)),
      input.feedbackMarkup ?? "",
      '<section class="surface-block">',
      "<h3>Agreement</h3>",
      input.contract.contractText == null || input.contract.contractText.trim() === ""
        ? '<p class="section-copy">No contract text is stored for this agreement.</p>'
        : `<div class="article-content">${input.contract.contractText}</div>`,
      "</section>",
      input.contract.signatureTypedName == null || input.contract.signatureTypedName.trim() === ""
        ? ""
        : `<section class="surface-block"><h3>Electronic Signature</h3><p class="${escapeAttribute(input.contract.signatureFont ?? "font-dancing")}" style="font-size:2rem;margin:0 0 0.5rem 0;">${escapeHtml(input.contract.signatureTypedName)}</p>${input.contract.signedAt == null ? "" : `<p class="meta">Signed on ${escapeHtml(input.contract.signedAt)}</p>`}</section>`,
      "</article>",
      '<aside class="booking-benefits">',
      `<h2>${escapeHtml(input.sidebarTitle)}</h2>`,
      `<p class="section-copy">${escapeHtml(input.sidebarDescription)}</p>`,
      input.sidebarMarkup,
      "</aside>",
      "</section>",
      "</div>"
    ].join("")
  });
}

function extractLegacyPublicFormValues(form: URLSearchParams): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [key, value] of form.entries()) {
    const match = /^field\[(\d+)\](?:\[\])?$/.exec(key);
    if (match == null) {
      continue;
    }

    const fieldIndex = match[1] ?? "";
    if (fieldIndex === "") {
      continue;
    }

    const existing = values[fieldIndex];
    if (existing == null) {
      values[fieldIndex] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values[fieldIndex] = [existing, value];
    }
  }

  return values;
}

function getLegacyPublicFormFieldOptions(rawField: Record<string, unknown>): string[] {
  if (!Array.isArray(rawField.options)) {
    return [];
  }

  return rawField.options
    .map((option) => typeof option === "string"
      ? option
      : typeof option?.label === "string"
        ? option.label
        : "")
    .map((option) => option.trim())
    .filter((option) => option !== "");
}

function isLegacyPublicDisplayOnlyField(type: string): boolean {
  return ["text_block", "heading", "paragraph", "html", "divider"].includes(type);
}

function formatLegacyPublicFormResponseValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<span class="meta">No response recorded.</span>';
    }

    if (value.every((item) => typeof item === "string")) {
      return escapeHtml(value.join(", "));
    }

    return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }

  if (typeof value === "string") {
    return value.trim() === "" ? '<span class="meta">No response recorded.</span>' : escapeHtml(value);
  }

  if (value == null) {
    return '<span class="meta">No response recorded.</span>';
  }

  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderLegacyPublicFormResponses(submission: FormSubmission): string {
  const fields = submission.templateFields ?? [];
  const responses = submission.responses ?? [];
  const rows = fields
    .map((rawField, index) => {
      const fieldType = typeof rawField.type === "string" ? rawField.type.trim().toLowerCase() : "text";
      if (isLegacyPublicDisplayOnlyField(fieldType)) {
        return "";
      }

      const label = typeof rawField.label === "string" && rawField.label.trim() !== ""
        ? rawField.label.trim()
        : `Field ${index + 1}`;
      return [
        '<section class="detail-card">',
        `<div class="detail-card__label">${escapeHtml(label)}</div>`,
        `<div class="detail-card__value">${formatLegacyPublicFormResponseValue(responses[index])}</div>`,
        "</section>"
      ].join("");
    })
    .filter((item) => item !== "");

  if (rows.length === 0) {
    return '<p class="section-copy">No submitted responses are stored for this form yet.</p>';
  }

  return `<div class="detail-grid">${rows.join("")}</div>`;
}

function formatAdminDate(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") {
    return "Not available";
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toLocaleDateString("en-US", {
    dateStyle: "medium",
    timeZone: "UTC"
  });
}

function formatAdminDateTime(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  if (normalized === "") {
    return "Not available";
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return `${parsed.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  })} UTC`;
}

function normalizeAdminFormSubmissionStatus(submission: FormSubmission): string {
  const normalized = submission.status?.trim().toLowerCase() ?? "";
  if (normalized !== "") {
    return normalized;
  }

  if (submission.reviewedAt != null) {
    return "reviewed";
  }

  return submission.submittedAt == null ? "pending" : "submitted";
}

function formatAdminFormSubmissionStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "reviewed":
      return "Reviewed";
    default:
      return toTitleCase(status.replaceAll("_", " "));
  }
}

function renderAdminFormSubmissionStatusPill(submission: FormSubmission): string {
  const status = normalizeAdminFormSubmissionStatus(submission);
  switch (status) {
    case "pending":
      return renderStatusPill("Pending", "warning");
    case "draft":
      return renderStatusPill("Draft", "default");
    case "submitted":
      return renderStatusPill("Submitted", "info");
    case "reviewed":
      return renderStatusPill("Reviewed", "success");
    default:
      return renderStatusPill(formatAdminFormSubmissionStatus(status), "default");
  }
}

function getAdminFormSubmissionClientLabel(submission: FormSubmission): string {
  return submission.clientName
    ?? submission.contactName
    ?? submission.clientId;
}

function getAdminFormSubmissionTitle(submission: FormSubmission): string {
  return submission.templateName
    ?? submission.templateId
    ?? submission.id;
}

function buildAdminFormSubmissionListPath(
  basePath: string,
  filters: {
    clientId?: string;
    templateId?: string;
    status?: string;
    query?: string;
  }
): string {
  const params = new URLSearchParams();
  if ((filters.clientId ?? "").trim() !== "") {
    params.set("client_id", filters.clientId?.trim() ?? "");
  }
  if ((filters.templateId ?? "").trim() !== "") {
    params.set("template_id", filters.templateId?.trim() ?? "");
  }
  if ((filters.status ?? "").trim() !== "") {
    params.set("status", filters.status?.trim() ?? "");
  }
  if ((filters.query ?? "").trim() !== "") {
    params.set("q", filters.query?.trim() ?? "");
  }

  const search = params.toString();
  return search === "" ? basePath : `${basePath}?${search}`;
}

function filterAdminFormSubmissions(
  submissions: FormSubmission[],
  filters: {
    clientId: string;
    templateId: string;
    status: string;
    query: string;
  }
): FormSubmission[] {
  const normalizedClientId = filters.clientId.trim();
  const normalizedTemplateId = filters.templateId.trim();
  const normalizedStatus = filters.status.trim().toLowerCase();
  const normalizedQuery = filters.query.trim().toLowerCase();

  return submissions.filter((submission) => {
    if (normalizedClientId !== "" && submission.clientId !== normalizedClientId) {
      return false;
    }

    if (normalizedTemplateId !== "" && submission.templateId !== normalizedTemplateId) {
      return false;
    }

    if (normalizedStatus !== "" && normalizeAdminFormSubmissionStatus(submission) !== normalizedStatus) {
      return false;
    }

    if (normalizedQuery === "") {
      return true;
    }

    return [
      getAdminFormSubmissionTitle(submission),
      getAdminFormSubmissionClientLabel(submission),
      submission.petName ?? "",
      submission.bookingSummary ?? "",
      submission.id
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

function renderAdminFormSubmissionActions(submission: FormSubmission, options: { legacy?: boolean } = {}): string {
  const detailPath = options.legacy === true
    ? `/client/form_submissions_view.php?id=${encodeURIComponent(submission.id)}`
    : `/admin/forms/${encodeURIComponent(submission.id)}`;
  const surveyPath = (submission.formType ?? "").trim().toLowerCase() === "survey_form"
    ? (
      options.legacy === true
        ? `/client/form_survey_results.php?template_id=${encodeURIComponent(submission.templateId)}`
        : `/admin/form-templates/${encodeURIComponent(submission.templateId)}/survey-results`
    )
    : null;

  return [
    '<div class="table-actions">',
    `<a href="${detailPath}">View</a>`,
    surveyPath == null ? "" : `<a href="${surveyPath}">Survey Results</a>`,
    "</div>"
  ].join("");
}

type AdminSurveyFieldSummary = {
  index: string;
  label: string;
  type: string;
  supportsVisualization: boolean;
  responseCount: number;
  options: Array<{
    label: string;
    count: number;
    percentage: number;
  }>;
  recentResponses: Array<{
    value: string;
    clientName: string | null;
    submittedAt: string | null;
  }>;
};

type AdminSurveyReport = {
  template: {
    id: string;
    name: string;
    description: string;
    fields: Array<Record<string, unknown>>;
  };
  totalSubmissions: number;
  visualizedFieldCount: number;
  latestSubmissionAt: string | null;
  fields: AdminSurveyFieldSummary[];
};

function buildAdminSurveyReport(
  template: {
    id: string;
    name: string;
    description?: string;
    fields?: Array<Record<string, unknown>>;
  },
  submissions: FormSubmission[]
): AdminSurveyReport {
  const templateFields = template.fields ?? [];
  const fieldSummaries: AdminSurveyFieldSummary[] = [];
  let visualizedFieldCount = 0;

  for (const [index, rawField] of templateFields.entries()) {
    const fieldType = typeof rawField.type === "string" ? rawField.type.trim().toLowerCase() : "text";
    if (isLegacyPublicDisplayOnlyField(fieldType)) {
      continue;
    }

    const supportsVisualization = ["select", "radio", "checkbox"].includes(fieldType);
    const optionCounts = new Map<string, number>();
    for (const option of getLegacyPublicFormFieldOptions(rawField)) {
      optionCounts.set(option, 0);
    }

    let responseCount = 0;
    const recentResponses: AdminSurveyFieldSummary["recentResponses"] = [];

    for (const submission of submissions) {
      const response = submission.responses?.[index];
      if (supportsVisualization) {
        const selectedValues = Array.isArray(response)
          ? response.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim())
          : typeof response === "string" && response.trim() !== ""
            ? [response.trim()]
            : [];
        if (selectedValues.length === 0) {
          continue;
        }

        responseCount += 1;
        for (const selectedValue of selectedValues) {
          optionCounts.set(selectedValue, (optionCounts.get(selectedValue) ?? 0) + 1);
        }
        continue;
      }

      const normalizedValue = Array.isArray(response)
        ? response.filter((value): value is string => typeof value === "string" && value.trim() !== "").join(", ")
        : typeof response === "string"
          ? response.trim()
          : response == null
            ? ""
            : JSON.stringify(response);
      if (normalizedValue === "") {
        continue;
      }

      responseCount += 1;
      if (recentResponses.length < 5) {
        recentResponses.push({
          value: normalizedValue,
          clientName: submission.clientName ?? submission.contactName ?? null,
          submittedAt: submission.submittedAt ?? null
        });
      }
    }

    if (supportsVisualization) {
      visualizedFieldCount += 1;
    }

    fieldSummaries.push({
      index: String(index),
      label: typeof rawField.label === "string" && rawField.label.trim() !== ""
        ? rawField.label.trim()
        : `Question ${index + 1}`,
      type: fieldType,
      supportsVisualization,
      responseCount,
      options: Array.from(optionCounts.entries()).map(([label, count]) => ({
        label,
        count,
        percentage: submissions.length === 0 ? 0 : Math.round((count / submissions.length) * 100)
      })),
      recentResponses
    });
  }

  return {
    template: {
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      fields: template.fields ?? []
    },
    totalSubmissions: submissions.length,
    visualizedFieldCount,
    latestSubmissionAt: submissions[0]?.submittedAt ?? null,
    fields: fieldSummaries
  };
}

function renderAdminSurveyFieldSummary(field: AdminSurveyFieldSummary): string {
  const fieldTypeLabel = field.type.trim() === ""
    ? "Question"
    : toTitleCase(field.type.replaceAll("_", " "));
  return [
    '<section class="surface-block">',
    `<div class="settings-detail-hero"><div class="settings-detail-hero__copy"><h2>${escapeHtml(field.label)}</h2><p class="section-copy">Question type: ${escapeHtml(fieldTypeLabel)}</p></div><div>${field.supportsVisualization ? renderStatusPill("Visualized", "info") : renderStatusPill("Open Response", "default")}</div></div>`,
    renderDetailGrid([
      { label: "Question Index", value: escapeHtml(field.index) },
      { label: "Responses Received", value: escapeHtml(String(field.responseCount)) }
    ]),
    field.supportsVisualization
      ? (
        field.options.length === 0
          ? '<p class="section-copy">No answer choices are configured for this survey question.</p>'
          : `<div class="content-stack">${field.options.map((option) => [
            '<div class="detail-card">',
            `<div class="detail-card__label" style="display:flex;justify-content:space-between;gap:1rem;"><span>${escapeHtml(option.label)}</span><span>${escapeHtml(`${option.count} responses | ${option.percentage}%`)}</span></div>`,
            '<div style="margin-top:0.7rem;height:0.8rem;border-radius:999px;background:#e2e8f0;overflow:hidden;">',
            `<div style="height:100%;width:${Math.max(0, Math.min(option.percentage, 100))}%;background:linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-secondary) 100%);"></div>`,
            "</div>",
            "</div>"
          ].join("")).join("")}</div>`
      )
      : (
        field.recentResponses.length === 0
          ? '<p class="section-copy">No open-ended responses have been collected yet.</p>'
          : `<div class="content-stack">${field.recentResponses.map((response) => [
            '<section class="detail-card">',
            `<div class="detail-card__value">${escapeHtml(response.value)}</div>`,
            `<div class="meta">${escapeHtml(response.clientName ?? "Unknown client")} - ${escapeHtml(formatAdminDateTime(response.submittedAt))}</div>`,
            "</section>"
          ].join("")).join("")}</div>`
      ),
    "</section>"
  ].join("");
}

function renderLegacyPublicFormFields(
  submission: FormSubmission,
  postedValues: Record<string, string | string[]>
): string {
  const fields = submission.templateFields ?? [];
  const fieldMarkup: string[] = [];

  for (const [index, rawField] of fields.entries()) {
    const fieldType = typeof rawField.type === "string" && rawField.type.trim() !== ""
      ? rawField.type.trim().toLowerCase()
      : "text";
    const fieldLabel = typeof rawField.label === "string" && rawField.label.trim() !== ""
      ? rawField.label.trim()
      : fieldType === "newsletter_opt_in"
        ? "Newsletter Opt-In"
        : `Field ${index + 1}`;
    const fieldDescription = typeof rawField.description === "string" ? rawField.description.trim() : "";
    const fieldPlaceholder = typeof rawField.placeholder === "string" ? rawField.placeholder : "";
    const isRequired = rawField.required === true;
    const fieldName = `field[${index}]`;
    const rawValue = postedValues[String(index)] ?? submission.responses?.[index] ?? "";

    if (isLegacyPublicDisplayOnlyField(fieldType)) {
      fieldMarkup.push([
        '<section class="surface-block">',
        `<div class="detail-card__label">${escapeHtml(fieldLabel)}</div>`,
        fieldDescription === ""
          ? ""
          : `<p class="section-copy">${escapeHtml(fieldDescription)}</p>`,
        "</section>"
      ].join(""));
      continue;
    }

    if (fieldType === "textarea" || fieldType === "pet_info_group") {
      const textValue = typeof rawValue === "string"
        ? rawValue
        : Array.isArray(rawValue)
          ? JSON.stringify(rawValue, null, 2)
          : rawValue == null
            ? ""
            : JSON.stringify(rawValue, null, 2);
      fieldMarkup.push([
        '<label>',
        `${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}`,
        fieldDescription === "" ? "" : `<span class="meta">${escapeHtml(fieldDescription)}</span>`,
        `<textarea name="${escapeAttribute(fieldName)}" rows="${fieldType === "pet_info_group" ? "6" : "4"}"${isRequired ? " required" : ""} placeholder="${escapeAttribute(fieldPlaceholder)}">${escapeHtml(textValue)}</textarea>`,
        "</label>"
      ].join(""));
      continue;
    }

    if (fieldType === "select") {
      const selectedValue = typeof rawValue === "string" ? rawValue : "";
      fieldMarkup.push([
        '<label>',
        `${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}`,
        fieldDescription === "" ? "" : `<span class="meta">${escapeHtml(fieldDescription)}</span>`,
        `<select name="${escapeAttribute(fieldName)}"${isRequired ? " required" : ""}>`,
        '<option value="">-- Select --</option>',
        getLegacyPublicFormFieldOptions(rawField).map((option) => `<option value="${escapeAttribute(option)}"${selectedValue === option ? " selected" : ""}>${escapeHtml(option)}</option>`).join(""),
        "</select>",
        "</label>"
      ].join(""));
      continue;
    }

    if (fieldType === "checkbox") {
      const selectedValues = Array.isArray(rawValue)
        ? rawValue.map((item) => item.trim()).filter((item) => item !== "")
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? [rawValue.trim()]
          : [];
      const options = getLegacyPublicFormFieldOptions(rawField);
      fieldMarkup.push([
        `<fieldset><legend>${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}</legend>`,
        fieldDescription === "" ? "" : `<p class="meta">${escapeHtml(fieldDescription)}</p>`,
        options.length === 0
          ? `<label><input type="checkbox" name="${escapeAttribute(fieldName)}[]" value="1"${selectedValues.includes("1") ? " checked" : ""}> ${escapeHtml(fieldLabel)}</label>`
          : options.map((option) => `<label><input type="checkbox" name="${escapeAttribute(fieldName)}[]" value="${escapeAttribute(option)}"${selectedValues.includes(option) ? " checked" : ""}> ${escapeHtml(option)}</label>`).join(""),
        "</fieldset>"
      ].join(""));
      continue;
    }

    if (fieldType === "newsletter_opt_in") {
      const checked = Array.isArray(rawValue)
        ? rawValue.some((item) => item.trim() !== "")
        : typeof rawValue === "string" && rawValue.trim() !== "";
      fieldMarkup.push([
        '<input type="hidden" name="field[' + index + ']" value="">',
        `<label><input type="checkbox" name="${escapeAttribute(fieldName)}" value="Yes, I'd like to receive newsletters and updates."${checked ? " checked" : ""}> ${escapeHtml(fieldLabel)}</label>`
      ].join(""));
      continue;
    }

    if (fieldType === "radio") {
      const selectedValue = typeof rawValue === "string" ? rawValue : "";
      fieldMarkup.push([
        `<fieldset><legend>${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}</legend>`,
        fieldDescription === "" ? "" : `<p class="meta">${escapeHtml(fieldDescription)}</p>`,
        getLegacyPublicFormFieldOptions(rawField).map((option) => `<label><input type="radio" name="${escapeAttribute(fieldName)}" value="${escapeAttribute(option)}"${selectedValue === option ? " checked" : ""}${isRequired ? " required" : ""}> ${escapeHtml(option)}</label>`).join(""),
        "</fieldset>"
      ].join(""));
      continue;
    }

    const inputType = fieldType === "email"
      ? "email"
      : fieldType === "phone"
        ? "tel"
        : fieldType === "date"
          ? "date"
          : fieldType === "number"
            ? "number"
            : "text";
    const textValue = typeof rawValue === "string" ? rawValue : "";
    fieldMarkup.push([
      '<label>',
      `${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}`,
      fieldDescription === "" ? "" : `<span class="meta">${escapeHtml(fieldDescription)}</span>`,
      `<input type="${escapeAttribute(inputType)}" name="${escapeAttribute(fieldName)}" value="${escapeAttribute(textValue)}" placeholder="${escapeAttribute(fieldPlaceholder)}"${isRequired ? " required" : ""}>`,
      "</label>"
    ].join(""));
  }

  return fieldMarkup.length === 0
    ? '<p class="section-copy">No editable fields are configured for this form.</p>'
    : fieldMarkup.join("");
}

function renderLegacyPublicFormSubmissionForm(input: {
  submission: FormSubmission;
  currentPath: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  turnstileToken?: string;
  postedValues: Record<string, string | string[]>;
}): string {
  return [
    '<section class="surface-block">',
    "<h3>Complete Form</h3>",
    '<form class="form-grid" method="post" action="' + escapeAttribute(input.currentPath) + '">',
    "<h4>Your Information</h4>",
    '<div class="form-grid form-grid--two">',
    `<label>Name *<input type="text" name="contact_name" value="${escapeAttribute(input.contactName)}" required></label>`,
    `<label>Email *<input type="email" name="contact_email" value="${escapeAttribute(input.contactEmail)}" required></label>`,
    "</div>",
    `<label>Phone<input type="tel" name="contact_phone" value="${escapeAttribute(input.contactPhone)}"></label>`,
    '<label>Turnstile Token<input type="text" name="turnstileToken" value="' + escapeAttribute(input.turnstileToken ?? "turnstile-ok") + '" required></label>',
    "<h4>Form Questions</h4>",
    renderLegacyPublicFormFields(input.submission, input.postedValues),
    '<div class="form-actions"><button type="submit">Submit Form</button></div>',
    "</form>",
    "</section>"
  ].join("");
}

function renderLegacyPublicFormDetailPage(input: {
  submission: FormSubmission;
  currentPath: string;
  publicRenderAssets: PublicRenderAssets;
  portalReturnPath: string | null;
  sidebarTitle: string;
  sidebarDescription: string;
  sidebarMarkup: string;
  feedbackMarkup?: string;
  contentMarkup: string;
}): string {
  return renderPublicPageLayout({
    title: input.submission.templateName ?? `Form ${input.submission.id}`,
    publicRenderAssets: input.publicRenderAssets,
    requestPath: input.currentPath,
    body: [
      '<div class="booking-shell">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Form Access</p>',
      `<h1>${escapeHtml(input.submission.templateName ?? `Form ${input.submission.id}`)}</h1>`,
      input.submission.templateDescription == null || input.submission.templateDescription.trim() === ""
        ? '<p class="section-copy">Review and complete this secure form request.</p>'
        : `<p class="section-copy">${escapeHtml(input.submission.templateDescription)}</p>`,
      input.portalReturnPath == null ? "" : `<div class="form-actions"><a class="quick-link-card quick-link-card--inline" href="${escapeAttribute(input.portalReturnPath)}"><span class="quick-link-card__label">Back to Client Portal</span><span class="quick-link-card__meta">Return to the originating portal page</span></a></div>`,
      "</section>",
      '<section class="booking-shell__grid">',
      '<article class="booking-form-card">',
      "<h2>Form Summary</h2>",
      renderDetailGrid([
        { label: "Form ID", value: escapeHtml(input.submission.id) },
        { label: "Template", value: escapeHtml(input.submission.templateName ?? input.submission.templateId) },
        { label: "Type", value: escapeHtml(input.submission.formType ?? "client_form") },
        { label: "Status", value: input.submission.submittedAt == null ? renderStatusPill("Pending", "warning") : renderStatusPill(`Submitted ${input.submission.submittedAt}`, "success") }
      ]),
      input.feedbackMarkup ?? "",
      input.contentMarkup,
      "</article>",
      '<aside class="booking-benefits">',
      `<h2>${escapeHtml(input.sidebarTitle)}</h2>`,
      `<p class="section-copy">${escapeHtml(input.sidebarDescription)}</p>`,
      input.sidebarMarkup,
      "</aside>",
      "</section>",
      "</div>"
    ].join("")
  });
}

async function resolveLegacyPublicPackageCheckoutForm(
  api: ApiDependencies | null,
  packageItem: Package | null
): Promise<PublicPackageCheckoutForm | null> {
  if (api == null || packageItem == null) {
    return null;
  }

  return loadPublicPackageCheckoutForm(packageItem, api.publicPackages);
}

function extractPackageFormValues(form: URLSearchParams): Record<string, Record<string, string | string[]>> {
  const values: Record<string, Record<string, string | string[]>> = {};
  for (const [key, value] of form.entries()) {
    const match = /^package_form\[([^\]]+)\]\[(\d+)\]$/.exec(key);
    if (match == null) {
      continue;
    }

    const templateId = match[1] ?? "";
    const fieldIndex = match[2] ?? "";
    if (templateId === "" || fieldIndex === "") {
      continue;
    }

    const templateValues = values[templateId] ?? {};
    const existing = templateValues[fieldIndex];
    if (existing == null) {
      templateValues[fieldIndex] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      templateValues[fieldIndex] = [existing, value];
    }
    values[templateId] = templateValues;
  }

  return values;
}

function renderLegacyPublicPackageCheckoutForm(
  checkoutForm: PublicPackageCheckoutForm,
  postedValues: Record<string, string | string[]>
): string {
  const fieldMarkup: string[] = [];
  for (const [index, rawField] of (checkoutForm.fields ?? []).entries()) {
    const fieldLabel = typeof rawField.label === "string" && rawField.label.trim() !== ""
      ? rawField.label.trim()
      : `Field ${index + 1}`;
    const fieldType = typeof rawField.type === "string" && rawField.type.trim() !== ""
      ? rawField.type.trim().toLowerCase()
      : "text";
    const isRequired = rawField.required === true;
    const fieldName = `package_form[${checkoutForm.id}][${index}]`;
    const rawValue = postedValues[String(index)];

    if (["text_block", "heading", "paragraph", "html", "divider"].includes(fieldType)) {
      continue;
    }

    if (fieldType === "textarea") {
      const textValue = typeof rawValue === "string" ? rawValue : "";
      fieldMarkup.push(
        `<label>${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}<textarea name="${escapeAttribute(fieldName)}" rows="4"${isRequired ? " required" : ""}>${escapeHtml(textValue)}</textarea></label>`
      );
      continue;
    }

    if (fieldType === "checkbox") {
      const selectedValues = Array.isArray(rawValue)
        ? rawValue.map((item) => item.trim()).filter((item) => item !== "")
        : typeof rawValue === "string" && rawValue.trim() !== ""
          ? [rawValue.trim()]
          : [];
      const options = Array.isArray(rawField.options)
        ? rawField.options
            .map((option) => typeof option === "string" ? option : (typeof option?.label === "string" ? option.label : ""))
            .filter((option) => option.trim() !== "")
        : [];
      fieldMarkup.push([
        `<fieldset><legend>${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}</legend>`,
        options.length === 0
          ? `<label><input type="checkbox" name="${escapeAttribute(fieldName)}" value="1"${selectedValues.includes("1") ? " checked" : ""}> ${escapeHtml(fieldLabel)}</label>`
          : options.map((option) => `<label><input type="checkbox" name="${escapeAttribute(fieldName)}" value="${escapeAttribute(option)}"${selectedValues.includes(option) ? " checked" : ""}> ${escapeHtml(option)}</label>`).join(""),
        "</fieldset>"
      ].join(""));
      continue;
    }

    const textValue = typeof rawValue === "string" ? rawValue : "";
    const inputType = fieldType === "email" || fieldType === "number" || fieldType === "date" ? fieldType : "text";
    fieldMarkup.push(
      `<label>${escapeHtml(fieldLabel)}${isRequired ? " *" : ""}<input type="${escapeAttribute(inputType)}" name="${escapeAttribute(fieldName)}" value="${escapeAttribute(textValue)}"${isRequired ? " required" : ""}></label>`
    );
  }

  if (fieldMarkup.length === 0) {
    return "";
  }

  return [
    '<section class="surface-block">',
    `<h3>${escapeHtml(checkoutForm.name)}</h3>`,
    checkoutForm.description == null || checkoutForm.description.trim() === ""
      ? '<p class="section-copy">Complete the required intake details before finishing this package purchase.</p>'
      : `<p class="section-copy">${escapeHtml(checkoutForm.description)}</p>`,
    fieldMarkup.join(""),
    "</section>"
  ].join("");
}

function renderLegacyPublicPackageDetailPage(input: {
  packageItem: Package | null;
  checkoutForm: PublicPackageCheckoutForm | null;
  currentPath: string;
  publicRenderAssets: PublicRenderAssets;
  purchaseState?: {
    status: "idle" | "success" | "error" | "info";
    errorMessage?: string | null;
    infoMessage?: string | null;
    values?: {
      buyerName: string;
      buyerEmail: string;
      buyerPhone: string;
      notes: string;
    };
    packageFormValues?: Record<string, string | string[]>;
  };
}): { status: number; html: string } {
  if (input.packageItem == null) {
    return {
      status: 404,
      html: renderPublicPageLayout({
        title: "Package Not Found",
        publicRenderAssets: input.publicRenderAssets,
        requestPath: input.currentPath,
        body: [
          '<section class="marketing-hero marketing-hero--compact">',
          '<p class="eyebrow">Package Unavailable</p>',
          "<h1>Package not found</h1>",
      '<p class="section-copy">The link you followed may be invalid, unavailable, or no longer active.</p>',
      '<div class="form-actions"><a class="nav-cta" href="/services">Explore Services</a><a class="quick-link-card quick-link-card--inline" href="/contact"><span class="quick-link-card__label">Talk With Brook</span><span class="quick-link-card__meta">Get matched with the right next step</span></a></div>',
          "</section>"
        ].join("")
      })
    };
  }

  const priceText = formatCurrency(input.packageItem.price);
  const expirationText = input.packageItem.expirationDays == null
    ? "Never"
    : `${input.packageItem.expirationDays} days`;
  const bulletPoints = (input.packageItem.bulletPoints ?? []).length === 0
    ? ""
    : `<ul class="detail-list">${(input.packageItem.bulletPoints ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const packageItems = (input.packageItem.items ?? []).length === 0
      ? '<p class="section-copy">No appointment credits are currently attached to this package.</p>'
    : `<div class="summary-grid">${(input.packageItem.items ?? []).map((item) => [
      '<section class="summary-card is-primary">',
      `<div class="summary-card__value">${escapeHtml(String(item.quantity))}</div>`,
      `<div class="summary-card__label">${escapeHtml(item.appointmentTypeName)}</div>`,
      `<div class="summary-card__meta">${escapeHtml(item.quantity === 1 ? "1 credit included" : `${item.quantity} credits included`)}</div>`,
      "</section>"
    ].join("")).join("")}</div>`;
  const packagePath = input.packageItem.shareToken == null
    ? input.currentPath
    : `/client/package_detail.php?token=${encodeURIComponent(input.packageItem.shareToken)}`;
  const portalLoginPath = buildPortalLoginPath(packagePath);
  const purchaseValues = input.purchaseState?.values ?? {
    buyerName: "",
    buyerEmail: "",
    buyerPhone: "",
    notes: ""
  };
  const packageFormValues = input.purchaseState?.packageFormValues ?? {};
  const purchaseFeedback = input.purchaseState?.status === "success"
        ? '<div class="surface-block" style="border-color:#15803d;background:#f0fdf4;"><strong>Package purchase complete</strong><p class="section-copy">Credits were added to the matching client record. If the client already has a password, they can sign in to review everything there.</p></div>'
    : input.purchaseState?.status === "error"
      ? `<div class="surface-block" style="border-color:#b91c1c;background:#fef2f2;"><strong>Purchase could not be completed</strong><p class="section-copy">${escapeHtml(input.purchaseState.errorMessage ?? "Review the form and try again.")}</p></div>`
      : input.purchaseState?.status === "info"
        ? `<div class="surface-block" style="border-color:#1d4ed8;background:#eff6ff;"><strong>Checkout update</strong><p class="section-copy">${escapeHtml(input.purchaseState.infoMessage ?? "Review the package details below.")}</p></div>`
      : "";
  const purchaseButtonLabel = input.packageItem.price > 0
    ? "Continue to Secure Checkout"
    : "Complete Package Purchase";

  return {
    status: 200,
    html: renderPublicPageLayout({
      title: `${input.packageItem.name} Package Details`,
      publicRenderAssets: input.publicRenderAssets,
      requestPath: input.currentPath,
      body: [
        '<div class="booking-shell">',
        '<section class="marketing-hero marketing-hero--compact">',
        '<p class="eyebrow">Training Package</p>',
        `<h1>${escapeHtml(input.packageItem.name)}</h1>`,
        input.packageItem.description == null || input.packageItem.description.trim() === ""
          ? '<p class="section-copy">Review the package contents, pricing, and account access details below.</p>'
          : `<p class="section-copy">${escapeHtml(input.packageItem.description)}</p>`,
        "</section>",
        '<section class="booking-shell__grid">',
        '<article class="booking-form-card">',
        "<h2>What's Included</h2>",
        renderDetailGrid([
          { label: "Package Price", value: escapeHtml(priceText) },
          { label: "Credits Expire", value: escapeHtml(expirationText) },
          { label: "Package ID", value: escapeHtml(input.packageItem.id) }
        ]),
        purchaseFeedback,
        bulletPoints === "" ? "" : `<section class="surface-block"><h3>Highlights</h3>${bulletPoints}</section>`,
        '<section class="surface-block">',
        "<h3>Included Credits</h3>",
        packageItems,
        "</section>",
        '<section class="surface-block">',
        "<h3>Purchase This Package</h3>",
        input.packageItem.price > 0
          ? '<p class="section-copy">Complete the checkout details below to continue to secure card payment. Credits are issued only after the payment session is verified.</p>'
          : '<p class="section-copy">Complete the short checkout form below to attach this package to the buyer&apos;s client record and issue the included credits.</p>',
        `<form class="form-grid" method="post" action="${escapeAttribute(packagePath)}">`,
        `<label>Buyer Name<input type="text" name="buyer_name" value="${escapeAttribute(purchaseValues.buyerName)}" required></label>`,
        `<label>Buyer Email<input type="email" name="buyer_email" value="${escapeAttribute(purchaseValues.buyerEmail)}" required></label>`,
        '<div class="form-grid form-grid--two">',
        `<label>Buyer Phone<input type="text" name="buyer_phone" value="${escapeAttribute(purchaseValues.buyerPhone)}"></label>`,
        `<label>Package Price<input type="text" value="${escapeAttribute(priceText)}" readonly></label>`,
        "</div>",
        `<label>Purchase Notes<textarea name="notes" rows="4">${escapeHtml(purchaseValues.notes)}</textarea></label>`,
        input.checkoutForm == null ? "" : renderLegacyPublicPackageCheckoutForm(input.checkoutForm, packageFormValues),
        `<div class="form-actions"><button type="submit">${escapeHtml(purchaseButtonLabel)}</button></div>`,
        "</form>",
        "</section>",
        "</article>",
        '<aside class="booking-benefits">',
        "<h2>Package Access</h2>",
        '<div class="benefit-list">',
      '<section class="benefit-item"><strong>Client Account</strong><p>Existing clients can sign in to review active packages, credits, and upcoming appointments.</p></section>',
        '<section class="benefit-item"><strong>Purchase Support</strong><p>Need help completing or reviewing a package purchase? Contact the team directly from the public site.</p></section>',
        '<section class="benefit-item"><strong>Booking Follow-Through</strong><p>After package credits are active, appointments continue through the authenticated portal experience.</p></section>',
        "</div>",
        `<div class="form-actions"><a class="nav-cta" href="${escapeAttribute(portalLoginPath)}">Go to Client Portal</a><a class="quick-link-card quick-link-card--inline" href="/#contact"><span class="quick-link-card__label">Contact the Team</span><span class="quick-link-card__meta">Questions about this package or account access</span></a></div>`,
        "</aside>",
        "</section>",
        "</div>"
      ].join("")
    })
  };
}

async function resolveLegacyBookingAppointmentType(
  api: ApiDependencies | null,
  url: URL
): Promise<AppointmentType | null> {
  if (api == null) {
    return null;
  }

  const uniqueLink = url.searchParams.get("link")?.trim() ?? "";
  const appointmentTypeId = url.searchParams.get("type")?.trim() ?? "";
  if (uniqueLink === "" && appointmentTypeId === "") {
    return null;
  }

  const appointmentTypes = await api.adminConfiguration.listAdminAppointmentTypes();
  if (uniqueLink !== "") {
    return appointmentTypes.find((item) => item.active && item.uniqueLink === uniqueLink) ?? null;
  }

  return appointmentTypes.find((item) => item.active && item.id === appointmentTypeId) ?? null;
}

function renderLegacyBookingPage(
  appointmentType: AppointmentType | null,
  formAction: string,
  publicRenderAssets: PublicRenderAssets
): string {
  if (appointmentType == null) {
    return renderPublicPageLayout({
      title: "Invalid Booking Link",
      publicRenderAssets,
      requestPath: formAction,
      body: [
        '<section class="marketing-hero marketing-hero--compact">',
        '<p class="eyebrow">Booking Unavailable</p>',
        "<h1>Invalid Booking Link</h1>",
        '<p class="section-copy">This booking page is not available. Use the services page or request a new link from the team.</p>',
        '<div class="form-actions"><a class="nav-cta" href="/services">View Services</a><a class="quick-link-card quick-link-card--inline" href="/book"><span class="quick-link-card__label">Open Booking Form</span><span class="quick-link-card__meta">Use the standard request flow instead</span></a></div>',
        "</section>"
      ].join("")
    });
  }

  const bulletPoints = appointmentType.bulletPoints.length === 0
    ? ""
    : `<ul class="detail-list">${appointmentType.bulletPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const location = appointmentType.isFieldRental
    ? appointmentType.fieldRentalLocation
    : appointmentType.isGroupClass
      ? appointmentType.groupClassLocation
      : appointmentType.isMiniSession
        ? appointmentType.miniSessionLocation
        : "";
  const priceText = appointmentType.defaultAmount > 0
    ? formatCurrency(appointmentType.defaultAmount)
    : "Contact for pricing";

  return renderPublicPageLayout({
    title: `Book ${appointmentType.name}`,
    publicRenderAssets,
    requestPath: formAction,
    body: [
      '<div class="booking-shell">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Schedule Training</p>',
      `<h1>Book ${escapeHtml(appointmentType.name)}</h1>`,
      appointmentType.description.trim() === ""
        ? '<p class="section-copy">Complete the booking request below and we will confirm the details.</p>'
        : `<p class="section-copy">${escapeHtml(appointmentType.description)}</p>`,
      "</section>",
      '<section class="booking-shell__grid">',
      '<article class="booking-form-card">',
      "<h2>Request Booking</h2>",
      renderDetailGrid([
        { label: "Service", value: escapeHtml(appointmentType.name) },
        { label: "Duration", value: escapeHtml(`${appointmentType.durationMinutes} minutes`) },
        { label: "Price", value: escapeHtml(priceText) },
        { label: "Location", value: escapeHtml(location === "" ? "To be confirmed" : location) }
      ]),
      bulletPoints === "" ? "" : `<section class="surface-block"><h3>What's Included</h3>${bulletPoints}</section>`,
      `<form class="form-grid" method="post" action="${escapeAttribute(formAction)}">`,
      `<input type="hidden" name="serviceId" value="${escapeAttribute(appointmentType.id)}">`,
      `<label>Selected Service<input type="text" value="${escapeAttribute(appointmentType.name)}" disabled></label>`,
      '<label>Email<input type="email" name="clientEmail" required></label>',
      '<div class="form-grid form-grid--two">',
      '<label>Requested Start<input type="datetime-local" name="requestedStart" required></label>',
      '<label>Requested End<input type="datetime-local" name="requestedEnd" required></label>',
      "</div>",
      '<label>Turnstile Token<input type="text" name="turnstileToken" value="turnstile-ok" required></label>',
      '<div class="form-actions"><button type="submit">Request Booking</button></div>',
      "</form>",
      "</article>",
      '<aside class="booking-benefits">',
      "<h2>What happens next</h2>",
      '<div class="benefit-list">',
      '<section class="benefit-item"><strong>Request Review</strong><p>Your request is reviewed against the appointment type and current availability.</p></section>',
      '<section class="benefit-item"><strong>Confirmation Email</strong><p>You receive confirmation after the booking request is accepted.</p></section>',
      appointmentType.portalAvailable
        ? '<section class="benefit-item"><strong>Progress Stays Organized</strong><p>Your next steps, documents, and scheduling details stay in one place after booking is approved.</p></section>'
      : '<section class="benefit-item"><strong>Follow-Up</strong><p>The team follows up directly with any remaining intake details.</p></section>',
      "</div>",
      "</aside>",
      "</section>",
      "</div>"
    ].join("")
  });
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstTagText(html: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(html);
  if (match == null) {
    return null;
  }

  const text = stripHtmlTags(match[1] ?? "");
  return text === "" ? null : text;
}

function shouldRenderSavedPublicPageContent(htmlContent: string): boolean {
  const trimmed = htmlContent.trim();
  if (trimmed === "") {
    return false;
  }

  if (/^<section>\s*<h1[\s\S]*?<\/h1>(?:\s*<p[\s\S]*?<\/p>)?\s*<\/section>$/i.test(trimmed)) {
    return false;
  }

  return /(?:bdta-|data-gjs|<(?:div|section|article|aside|main|nav)[^>]+class=)/i.test(trimmed);
}

function renderSavedPublicPageContent(htmlContent: string): string {
  const normalizedHtmlContent = normalizeSavedPublicPageHtml(htmlContent);
  if (hasImportedPageRoot(normalizedHtmlContent)) {
    return wrapImportedPageHtml(normalizedHtmlContent);
  }

  return [
    '<div class="marketing-stack">',
    `<section class="public-rich-copy public-rich-copy--page">${normalizedHtmlContent}</section>`,
    "</div>"
  ].join("");
}

function resolveLegacyPublicAssetPath(pathname: string): string | null {
  if (!pathname.startsWith(PUBLIC_ASSET_PREFIX)) {
    return null;
  }

  const relativePath = pathname.slice(PUBLIC_ASSET_PREFIX.length);
  if (relativePath === "") {
    return null;
  }

  const resolvedPath = resolve(PUBLIC_ASSET_ROOT, relativePath);
  const rootPrefix = `${PUBLIC_ASSET_ROOT}${sep}`;
  if (resolvedPath !== PUBLIC_ASSET_ROOT && !resolvedPath.startsWith(rootPrefix)) {
    return null;
  }

  return resolvedPath;
}

function getStaticAssetContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function renderPublicPageContent(page: {
  slug: string;
  title: string;
  htmlContent: string;
  metaDescription: string;
}): string {
  const normalizedHtmlContent = normalizeSavedPublicPageHtml(page.htmlContent);
  const heroTitle = extractFirstTagText(normalizedHtmlContent, "h1") ?? page.title;
  const heroBody = extractFirstTagText(normalizedHtmlContent, "p") ?? page.metaDescription;

  if (shouldRenderSavedPublicPageContent(normalizedHtmlContent)) {
    return renderSavedPublicPageContent(normalizedHtmlContent);
  }

  if (page.slug === "home") {
    return [
      '<div class="marketing-stack">',
      '<section class="marketing-hero marketing-hero--home">',
      '<div class="marketing-hero__grid marketing-hero__grid--media">',
      '<div class="marketing-hero__content">',
      '<p class="eyebrow">Balanced Training For Real Family Life</p>',
      `<h1>${escapeHtml(heroTitle)}</h1>`,
      `<p class="section-copy">${escapeHtml(heroBody)}</p>`,
      '<div class="form-actions">',
      '<a class="nav-cta" href="/book">Book Training</a>',
      '<a class="quick-link-card quick-link-card--inline" href="/services"><span class="quick-link-card__label">Explore Services</span><span class="quick-link-card__meta">Private lessons, board-and-train, and workshops</span></a>',
      "</div>",
      "</div>",
      '<aside class="hero-media-frame">',
      '<img class="hero-media-frame__image" src="/assets/images/hero-dog-real.jpg" alt="Happy trained dog">',
      '<div class="hero-media-frame__badge">Certified &amp; Insured | Highlands County, Florida</div>',
      "</aside>",
      "</div>",
      '<div class="hero-stat-row">',
      renderStatsGrid([
        { label: "Founded", value: "2018", meta: "Brook Lefkowitz", accent: "primary" },
        { label: "Method", value: "Positive", meta: "Reward-based handling", accent: "secondary" },
        { label: "Programs", value: "Private + Group", meta: "Support that fits the home", accent: "success" }
      ]),
      "</div>",
      "</div>",
      "</section>",
      '<section class="public-section about-panel">',
      '<div class="about-panel__grid">',
      '<div class="about-panel__media"><img src="/assets/images/about-brook.jpg" alt="Brook Lefkowitz with a dog"></div>',
      '<div class="about-panel__content">',
      '<p class="eyebrow">About Brook&apos;s Dog Training Academy</p>',
      '<h2>Teaching humans to speak dog without making the process feel clinical.</h2>',
      '<p class="section-copy">Founded in 2018, BDTA focuses on practical household training, calm handling, and follow-through that works after the session ends.</p>',
      '<div class="feature-list">',
      '<section class="detail-card"><div class="detail-card__label">Certified Trainers</div><div class="detail-card__value">Professionally certified and experienced.</div></section>',
      '<section class="detail-card"><div class="detail-card__label">Positive Methods</div><div class="detail-card__value">Reward-based instruction with clear structure.</div></section>',
      '<section class="detail-card"><div class="detail-card__label">Personalized Programs</div><div class="detail-card__value">Plans shaped around the dog and the family.</div></section>',
      '<section class="detail-card"><div class="detail-card__label">Local Support</div><div class="detail-card__value">Highlands County service with portal follow-through.</div></section>',
      "</div>",
      "</div>",
      "</div>",
      "</section>",
      '<section class="public-section">',
      '<div class="section-heading">',
      "<p class=\"eyebrow\">Core Programs</p>",
      "<h2>Training paths built around the dog and the household.</h2>",
      "</div>",
      '<div class="program-grid">',
      '<article class="service-card"><div class="service-card__icon">01</div><h3>Private Coaching</h3><p>In-home or remote support with clear handling plans and practical session notes.</p></article>',
      '<article class="service-card"><div class="service-card__icon">02</div><h3>Board-and-Train</h3><p>Focused immersion for families that need a stronger reset and clear transfer sessions.</p></article>',
      '<article class="service-card"><div class="service-card__icon">03</div><h3>Puppy Foundations</h3><p>Household routines, early social skills, and confidence-building before problems compound.</p></article>',
      '<article class="service-card"><div class="service-card__icon">04</div><h3>Group Events &amp; Workshops</h3><p>Structured community sessions for practice, refreshers, and focused skill clinics.</p></article>',
      "</div>",
      "</section>",
      '<section class="public-section public-section--alt">',
      '<div class="section-heading">',
      "<p class=\"eyebrow\">How It Works</p>",
      "<h2>Fast intake, clear plan, repeatable follow-through.</h2>",
      "</div>",
      '<div class="process-grid">',
      '<article class="process-card"><strong>1. Intake</strong><p>We review the dog, the household, and the highest-friction moments first.</p></article>',
      '<article class="process-card"><strong>2. Plan</strong><p>You get a focused training path instead of a generic checklist.</p></article>',
      '<article class="process-card"><strong>3. Transfer</strong><p>We make sure the progress holds once it is back in everyday life.</p></article>',
      "</div>",
      "</section>",
      '<section class="public-section">',
      '<div class="section-heading"><p class="eyebrow">Testimonials</p><h2>Real stories from families working through real-life behavior.</h2></div>',
      '<div class="testimonial-grid">',
      '<article class="testimonial-card"><div class="featured-story__meta">Golden Retriever Owner</div><h3>Sarah Mitchell</h3><p>"BDTA turned our anxious rescue into a dog we can actually take places with confidence."</p></article>',
      '<article class="testimonial-card"><div class="featured-story__meta">Puppy Foundations</div><h3>David &amp; Elena Cruz</h3><p>"We stopped guessing. The homework was clear, and the follow-through in our own house made the difference."</p></article>',
      '<article class="testimonial-card"><div class="featured-story__meta">Board-and-Train</div><h3>Keisha Thompson</h3><p>"The transfer sessions made it stick. We were not left with a dog that only listened somewhere else."</p></article>',
      "</div>",
      "</section>",
      '<section class="public-section contact-panel">',
      '<div class="contact-panel__grid">',
      '<div>',
      '<p class="eyebrow">Contact</p>',
      '<h2>Start with booking, or reach out if you need help choosing the right service.</h2>',
      '<p class="section-copy">Use the portal if you are already a client. Otherwise, booking is the fastest path to an evaluation and a concrete plan.</p>',
      '<div class="form-actions"><a class="nav-cta" href="/book">Book Now</a><a class="quick-link-card quick-link-card--inline" href="/portal/login"><span class="quick-link-card__label">Client Area</span><span class="quick-link-card__meta">Invoices, forms, and next steps</span></a></div>',
      "</div>",
      '<div class="feature-list">',
      '<section class="detail-card"><div class="detail-card__label">Private Training</div><div class="detail-card__value">Flexible one-on-one sessions and follow-up planning.</div></section>',
      '<section class="detail-card"><div class="detail-card__label">Group Events</div><div class="detail-card__value">Workshops and community training opportunities.</div></section>',
      '<section class="detail-card"><div class="detail-card__label">Client Portal</div><div class="detail-card__value">Quotes, invoices, contracts, and scheduling in one place.</div></section>',
      "</div>",
      "</div>",
      "</section>",
      '<section class="public-cta-banner">',
      "<div><p class=\"eyebrow\">Ready To Start</p><h2>Book the first session and get a real plan.</h2></div>",
      '<div class="form-actions"><a class="nav-cta" href="/book">Request Booking</a><a class="quick-link-card quick-link-card--inline" href="/blog"><span class="quick-link-card__label">Read the journal</span><span class="quick-link-card__meta">Training notes and practical tips</span></a></div>',
      "</section>",
      "</div>"
    ].join("");
  }

  if (page.slug === "services") {
    return [
      '<div class="marketing-stack">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Programs</p>',
      `<h1>${escapeHtml(heroTitle)}</h1>`,
      `<p class="section-copy">${escapeHtml(heroBody)}</p>`,
      "</section>",
      '<section class="public-section">',
      '<div class="section-heading"><p class="eyebrow">Service Menu</p><h2>Choose the level of support that matches the home and the problem.</h2></div>',
      '<div class="program-grid">',
      '<article class="service-card"><div class="service-card__icon">A</div><h3>Private Coaching</h3><p>Best for focused skill-building, handling changes, and follow-up after a larger program.</p></article>',
      '<article class="service-card"><div class="service-card__icon">B</div><h3>Board-and-Train</h3><p>Best for dogs that need a concentrated reset before the transfer work starts at home.</p></article>',
      '<article class="service-card"><div class="service-card__icon">C</div><h3>Puppy Foundations</h3><p>Best for families building routines, leash skills, calm greetings, and early confidence.</p></article>',
      '<article class="service-card"><div class="service-card__icon">D</div><h3>Behavior Tune-Ups</h3><p>Best for tightening recall, leash handling, threshold work, and family follow-through.</p></article>',
      "</div>",
      "</section>",
      '<section class="public-section service-overview-grid">',
      '<article class="detail-card"><div class="detail-card__label">Single Booking Services</div><div class="detail-card__value">Ideal for targeted private work when you already know the biggest friction point.</div></article>',
      '<article class="detail-card"><div class="detail-card__label">Bundled Programs</div><div class="detail-card__value">Ideal when the household needs more immersion, transfer sessions, or a stronger reset.</div></article>',
      '<article class="detail-card"><div class="detail-card__label">Group Events</div><div class="detail-card__value">Ideal for workshops, refreshers, and guided community practice.</div></article>',
      "</section>",
      '<section class="public-section public-section--alt">',
      '<div class="section-heading"><p class="eyebrow">Right Fit</p><h2>Not sure where to start?</h2></div>',
      renderQuickLinksGrid([
        { href: "/book", label: "Request a booking", description: "Start with an intake conversation" },
        { href: "/directory", label: "Browse resources", description: "Prep notes and local referrals" },
        { href: "/blog", label: "Read the journal", description: "See how the training approach works" }
      ]),
      "</section>",
      "</div>"
    ].join("");
  }

  if (page.slug === "directory") {
    return [
      '<div class="marketing-stack">',
      '<section class="marketing-hero marketing-hero--compact">',
      '<p class="eyebrow">Directory</p>',
      `<h1>${escapeHtml(heroTitle)}</h1>`,
      `<p class="section-copy">${escapeHtml(heroBody)}</p>`,
      "</section>",
      '<section class="public-section">',
      '<div class="resource-grid">',
      '<article class="resource-card"><h3>Training Prep</h3><p>Session-ready notes for gear, household setup, and what to bring to an evaluation.</p></article>',
      '<article class="resource-card"><h3>Trusted Referrals</h3><p>Directory pages highlight recommended local partners for complementary services.</p></article>',
      '<article class="resource-card"><h3>Follow-Through Support</h3><p>Helpful articles, booking guidance, and practical next steps for families moving forward.</p></article>',
      "</div>",
      "</section>",
      '<section class="public-cta-banner"><div><p class="eyebrow">Need Direct Help</p><h2>Book training or reach out if you want a plan tailored to your dog.</h2></div><div class="form-actions"><a class="nav-cta" href="/book">Book Training</a><a class="quick-link-card quick-link-card--inline" href="/contact"><span class="quick-link-card__label">Ask a Question</span><span class="quick-link-card__meta">Get help choosing the right service</span></a></div></section>',
      "</div>"
    ].join("");
  }

  return [
    '<div class="marketing-stack">',
    '<section class="marketing-hero marketing-hero--compact">',
    `<p class="eyebrow">${escapeHtml(page.title)}</p>`,
    `<h1>${escapeHtml(heroTitle)}</h1>`,
    `<p class="section-copy">${escapeHtml(heroBody)}</p>`,
    "</section>",
    `<section class="public-rich-copy public-rich-copy--page">${normalizedHtmlContent}</section>`,
    "</div>"
  ].join("");
}

function renderPublicBlogIndexPage(posts: Array<{
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverPhoto?: string | null;
  author: string;
  publishDate: string | null;
}>): string {
  const featured = posts[0] ?? null;
  const featuredImage = normalizeNullableBlogCoverPhotoPath(featured?.coverPhoto ?? null)
    ?? "/assets/images/hero-dog-real.jpg";

  return [
    '<div class="marketing-stack">',
    '<section class="marketing-hero marketing-hero--compact">',
    '<p class="eyebrow">BDTA Journal</p>',
    "<h1>Latest Training Notes</h1>",
    "<p class=\"section-copy\">Short, practical writing on leash handling, follow-through, and training that survives real family life.</p>",
    "</section>",
    featured == null
      ? '<section class="public-section"><p>No published posts yet.</p></section>'
      : [
          '<section class="featured-story">',
          '<div class="featured-story__layout">',
          '<div class="featured-story__content">',
          `<div class="featured-story__meta">${escapeHtml(featured.author)}${featured.publishDate ? ` | ${escapeHtml(featured.publishDate.slice(0, 10))}` : ""}</div>`,
          `<h2><a href="/blog/${encodeURIComponent(featured.slug)}">${escapeHtml(featured.title)}</a></h2>`,
          `<p>${escapeHtml(featured.excerpt)}</p>`,
          '<div class="form-actions"><a class="nav-cta" href="/blog/' + encodeURIComponent(featured.slug) + '">Read Article</a></div>',
          "</div>",
          `<div class="featured-story__media"><img src="${escapeHtml(featuredImage)}" alt="${escapeHtml(featured.title)}"></div>`,
          "</div>",
          "</section>"
        ].join(""),
    '<section class="public-section">',
    '<div class="section-heading"><p class="eyebrow">Recent Posts</p><h2>Keep the approach consistent between sessions.</h2></div>',
    renderEnhancedCollection({
      collectionClassName: "story-grid",
      items: posts.map((post) => ({
        content: [
          '<article class="blog-card story-card">',
          `<p class="meta">${escapeHtml(post.author)}${post.publishDate ? ` | ${escapeHtml(post.publishDate.slice(0, 10))}` : ""}</p>`,
          `<h3><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h3>`,
          `<p>${escapeHtml(post.excerpt)}</p>`,
          "</article>"
        ].join(""),
        searchText: [
          post.title,
          post.author,
          post.excerpt,
          post.publishDate == null ? "" : post.publishDate.slice(0, 10)
        ].filter((value) => value.trim() !== "").join(" ")
      })),
      emptyMessage: "Blog posts are on the way.",
      searchLabel: "Search posts",
      searchPlaceholder: "Search posts by title, topic, or trainer",
      defaultPageSize: 6,
      pageSizeOptions: [3, 6, 9, 12]
    }),
    "</section>",
    "</div>"
  ].join("");
}

function renderPublicBlogPostPage(post: {
  title: string;
  slug: string;
  excerpt: string;
  author: string;
  publishDate: string | null;
  content: string;
  coverPhoto?: string | null;
}): string {
  const normalizedCoverPhoto = post.coverPhoto == null
    ? null
    : normalizePublicContentAssetUrl(post.coverPhoto) ?? post.coverPhoto;
  const coverPhoto = normalizeNullableBlogCoverPhotoPath(normalizedCoverPhoto);
  const normalizedContent = normalizePublicContentAssetMarkup(post.content);
  return [
    '<div class="marketing-stack">',
    '<section class="marketing-hero marketing-hero--compact">',
    '<p class="eyebrow">BDTA Journal</p>',
    `<h1>${escapeHtml(post.title)}</h1>`,
    `<p class="section-copy">${escapeHtml(post.excerpt)}</p>`,
    `<div class="meta">${escapeHtml(post.author)}${post.publishDate ? ` | ${escapeHtml(post.publishDate.slice(0, 10))}` : ""}</div>`,
    coverPhoto == null ? "" : `<div class="featured-story__media"><img src="${escapeHtml(coverPhoto)}" alt="${escapeHtml(post.title)}"></div>`,
    "</section>",
    '<section class="article-shell">',
    `<article class="article-content public-rich-copy">${normalizedContent}</article>`,
    '<aside class="article-sidebar">',
    '<section class="surface-block">',
    "<p class=\"eyebrow\">Need Help Applying This?</p>",
    "<h2>Make the next session specific.</h2>",
    "<p>Use booking for direct support, or log into the portal if you already have an active account.</p>",
    '<div class="form-actions"><a class="nav-cta" href="/book">Book Training</a><a class="quick-link-card quick-link-card--inline" href="/portal/login"><span class="quick-link-card__label">Client Portal</span><span class="quick-link-card__meta">Access documents and next steps</span></a></div>',
    "</section>",
    "</aside>",
    "</section>",
    "</div>"
  ].join("");
}

function buildBuiltInPublicPageFallback(slug: string): Pick<SitePage, "slug" | "title" | "htmlContent" | "cssContent" | "metaDescription"> | null {
  if (!BUILT_IN_PUBLIC_PAGE_SLUGS.has(slug)) {
    return null;
  }

  if (slug === "services") {
    return {
      slug,
      title: "Services",
      htmlContent: "<section><h1>Training programs built around your dog and your home.</h1><p>Private lessons, board-and-train support, and puppy foundations tailored to real-life handling.</p></section>",
      cssContent: "",
      metaDescription: "Private lessons, board-and-train support, and puppy foundations tailored to real-life handling."
    };
  }

  return {
    slug,
    title: "Directory",
    htmlContent: "<section><h1>Training resources and trusted next steps.</h1><p>Prep guidance, referrals, and follow-through support for dogs and their people.</p></section>",
    cssContent: "",
    metaDescription: "Prep guidance, referrals, and follow-through support for dogs and their people."
  };
}

async function getPublicSitePageForRender(
  slug: string,
  content: ContentManagementDependencies
): Promise<Pick<SitePage, "slug" | "title" | "htmlContent" | "cssContent" | "metaDescription">> {
  try {
    const page = await getPublicSitePage(slug, content);
    return page.item;
  } catch (error) {
    if (error instanceof ContentError && error.code === "not_found") {
      const fallbackPage = buildBuiltInPublicPageFallback(slug);
      if (fallbackPage != null) {
        return fallbackPage;
      }
    }

    throw error;
  }
}

function toSafeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("</script", "<\\/script")
    .replaceAll("<!--", "<\\!--")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function getSitePageViewPath(page: SitePage): string {
  return page.isHomepage ? "/" : `/${page.slug}`;
}

function renderSitePageAdminActions(page: SitePage): string {
  const pageId = encodeURIComponent(page.id);
  const viewPath = getSitePageViewPath(page);
  const actions = [
    `<a href="/admin/site-pages/${pageId}/editor">Open Editor</a>`,
    page.published
      ? `<a href="${escapeHtml(viewPath)}" target="_blank" rel="noopener noreferrer">View Live</a>`
      : "",
    `<form method="post" action="/admin/site-pages/${pageId}/toggle-publish"><button type="submit">${page.published ? "Unpublish" : "Publish"}</button></form>`,
    page.isHomepage
      ? '<span class="meta">Homepage locked</span>'
      : `<form method="post" action="/admin/site-pages/${pageId}/delete" onsubmit="return confirm('Delete this site page?');"><button type="submit">Delete</button></form>`
  ].filter((item) => item !== "");

  return `<div class="table-actions">${actions.join("")}</div>`;
}

function renderBlogPostAdminActions(
  post: { id: string; slug: string; published: boolean },
  options: { legacy?: boolean } = {}
): string {
  const postId = encodeURIComponent(post.id);
  const legacy = options.legacy === true;
  const actions = [
    legacy
      ? `<a href="/client/blog_edit.php?id=${postId}">Edit</a>`
      : `<a href="/admin/blog-posts/${postId}">Edit</a>`,
    post.published
      ? `<a href="/blog/${encodeURIComponent(post.slug)}" target="_blank" rel="noopener noreferrer">View Live</a>`
      : "",
    legacy
      ? `<form method="post" action="/client/blog_delete.php" onsubmit="return confirm('Delete this blog post?');"><input type="hidden" name="id" value="${escapeAttribute(post.id)}"><button type="submit">Delete</button></form>`
      : `<form method="post" action="/admin/blog-posts/${postId}/delete" onsubmit="return confirm('Delete this blog post?');"><button type="submit">Delete</button></form>`
  ].filter((item) => item !== "");

  return `<div class="table-actions">${actions.join("")}</div>`;
}

function renderAdminBlogPostEditor(post: {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverPhoto: string | null;
  author: string;
  published: boolean;
  publishDate: string | null;
} | null, action: string): string {
  const item = post ?? {
    id: "",
    title: "",
    slug: "",
    content: "",
    excerpt: "",
    coverPhoto: null,
    author: "",
    published: false,
    publishDate: null
  };

  return [
    '<section class="surface-block">',
    `<h2>${post == null ? "Create Blog Post" : "Edit Blog Post"}</h2>`,
    `<form class="form-grid" method="post" action="${escapeAttribute(action)}">`,
    '<div class="form-grid form-grid--two">',
    `<label>Title<input type="text" name="title" value="${escapeHtml(item.title)}" required></label>`,
    `<label>Slug<input type="text" name="slug" value="${escapeHtml(item.slug)}" required></label>`,
    `<label>Author<input type="text" name="author" value="${escapeHtml(item.author)}" required></label>`,
    `<label>Cover Photo<input type="text" name="coverPhoto" value="${escapeHtml(item.coverPhoto ?? "")}"></label>`,
    "</div>",
    `<label>Excerpt<textarea name="excerpt">${escapeHtml(item.excerpt)}</textarea></label>`,
    `<label>Content<textarea name="content">${escapeHtml(item.content)}</textarea></label>`,
    `<label>Publish Date<input type="text" name="publishDate" value="${escapeHtml(item.publishDate ?? "")}" placeholder="2026-05-30T10:00:00.000Z"></label>`,
    `<label><input type="checkbox" name="published"${item.published ? " checked" : ""}> Published</label>`,
    `<div class="form-actions"><button type="submit">${post == null ? "Create Blog Post" : "Save Blog Post"}</button></div>`,
    "</form>",
    "</section>"
  ].join("");
}

function buildDuplicateDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "Untitled Copy";
  }

  return trimmed.includes("(Copy)") ? `${trimmed} Copy` : `${trimmed} (Copy)`;
}

function buildDuplicateMachineKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
  return `${normalized}-copy-${Date.now().toString(36).slice(-6)}`;
}

function renderAppointmentTypeAdminActions(
  appointmentTypeId: string,
  options: { legacy?: boolean } = {}
): string {
  const encodedAppointmentTypeId = encodeURIComponent(appointmentTypeId);
  const legacy = options.legacy === true;
  return [
    '<div class="table-actions">',
    legacy
      ? `<a href="/client/appointment_types_edit.php?id=${encodedAppointmentTypeId}">Edit</a>`
      : `<a href="/admin/appointment-types/${encodedAppointmentTypeId}">Edit</a>`,
    legacy
      ? `<form method="post" action="/client/appointment_types_duplicate.php" onsubmit="return confirm('Duplicate this appointment type?');"><input type="hidden" name="id" value="${escapeAttribute(appointmentTypeId)}"><button type="submit">Duplicate</button></form>`
      : `<form method="post" action="/admin/appointment-types/${encodedAppointmentTypeId}/duplicate" onsubmit="return confirm('Duplicate this appointment type?');"><button type="submit">Duplicate</button></form>`,
    legacy
      ? `<form method="post" action="/client/appointment_types_delete.php" onsubmit="return confirm('Delete this appointment type?');"><input type="hidden" name="id" value="${escapeAttribute(appointmentTypeId)}"><button type="submit">Delete</button></form>`
      : `<form method="post" action="/admin/appointment-types/${encodedAppointmentTypeId}/delete" onsubmit="return confirm('Delete this appointment type?');"><button type="submit">Delete</button></form>`,
    "</div>"
  ].join("");
}

function renderEmailTemplateAdminActions(
  templateId: string,
  options: { legacy?: boolean } = {}
): string {
  const encodedTemplateId = encodeURIComponent(templateId);
  const legacy = options.legacy === true;
  return [
    '<div class="table-actions">',
    legacy
      ? `<a href="/client/email_templates_edit.php?id=${encodedTemplateId}">Edit</a>`
      : `<a href="/admin/email-templates/${encodedTemplateId}">Edit</a>`,
    legacy
      ? `<form method="post" action="/client/email_templates_duplicate.php" onsubmit="return confirm('Duplicate this email template?');"><input type="hidden" name="id" value="${escapeAttribute(templateId)}"><button type="submit">Duplicate</button></form>`
      : `<form method="post" action="/admin/email-templates/${encodedTemplateId}/duplicate" onsubmit="return confirm('Duplicate this email template?');"><button type="submit">Duplicate</button></form>`,
    "</div>"
  ].join("");
}

function renderFormTemplateAdminActions(
  templateId: string,
  options: { legacy?: boolean; formType?: string | null } = {}
): string {
  const encodedTemplateId = encodeURIComponent(templateId);
  const legacy = options.legacy === true;
  const surveyResultsPath = (options.formType ?? "").trim().toLowerCase() === "survey_form"
    ? (
      legacy
        ? `/client/form_survey_results.php?template_id=${encodedTemplateId}`
        : `/admin/form-templates/${encodedTemplateId}/survey-results`
    )
    : null;
  return [
    '<div class="table-actions">',
    legacy
      ? `<a href="/client/form_templates_edit.php?id=${encodedTemplateId}">Edit</a>`
      : `<a href="/admin/form-templates/${encodedTemplateId}">Edit</a>`,
    surveyResultsPath == null ? "" : `<a href="${surveyResultsPath}">Survey Results</a>`,
    legacy
      ? `<form method="post" action="/client/form_templates_duplicate.php" onsubmit="return confirm('Duplicate this form template?');"><input type="hidden" name="id" value="${escapeAttribute(templateId)}"><button type="submit">Duplicate</button></form>`
      : `<form method="post" action="/admin/form-templates/${encodedTemplateId}/duplicate" onsubmit="return confirm('Duplicate this form template?');"><button type="submit">Duplicate</button></form>`,
    legacy
      ? `<form method="post" action="/client/form_templates_delete.php" onsubmit="return confirm('Delete this form template?');"><input type="hidden" name="id" value="${escapeAttribute(templateId)}"><button type="submit">Delete</button></form>`
      : `<form method="post" action="/admin/form-templates/${encodedTemplateId}/delete" onsubmit="return confirm('Delete this form template?');"><button type="submit">Delete</button></form>`,
    "</div>"
  ].join("");
}

const WORKFLOW_TRIGGER_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "scheduled", label: "Scheduled" },
  { value: "appointment_booking", label: "Appointment Booking" },
  { value: "booking_created", label: "Booking Created" },
  { value: "form_submission", label: "Form Submission" },
  { value: "invoice_overdue", label: "Invoice Overdue" }
] as const;

function formatWorkflowTriggerLabel(trigger: string): string {
  const option = WORKFLOW_TRIGGER_OPTIONS.find((candidate) => candidate.value === trigger);
  return option?.label ?? toTitleCase(trigger);
}

function renderWorkflowTriggerOptions(selectedTrigger = "manual"): string {
  return WORKFLOW_TRIGGER_OPTIONS
    .map((option) => `<option value="${option.value}"${option.value === selectedTrigger ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
}

function renderWorkflowAdminActions(workflowId: string, active: boolean, legacyPaths = false): string {
  const encodedWorkflowId = encodeURIComponent(workflowId);
  const workflowDetailPath = legacyPaths
    ? `/client/workflows_edit.php?id=${encodedWorkflowId}`
    : `/admin/workflows/${encodedWorkflowId}`;
  const workflowStepsPath = legacyPaths
    ? `/client/workflows_steps.php?workflow_id=${encodedWorkflowId}`
    : `/admin/workflows/${encodedWorkflowId}/steps`;
  const workflowEnrollmentsPath = legacyPaths
    ? `/client/workflows_enrollments.php?workflow_id=${encodedWorkflowId}`
    : `/admin/workflows/${encodedWorkflowId}/enrollments`;
  const workflowEnrollPath = legacyPaths
    ? `/client/workflows_enroll.php?workflow_id=${encodedWorkflowId}`
    : `/admin/workflows/${encodedWorkflowId}/enroll`;
  return [
    '<div class="table-actions">',
    `<a href="${workflowDetailPath}">Edit Workflow</a>`,
    `<a href="${workflowStepsPath}">Workflow Steps</a>`,
    `<a href="${workflowEnrollmentsPath}">Enrollments</a>`,
    `<a href="${workflowEnrollPath}">Enroll Clients</a>`,
    `<span class="meta">${escapeHtml(active ? "Active" : "Paused")}</span>`,
    "</div>"
  ].join("");
}

function renderWorkflowEnrollmentActions(
  workflowId: string,
  enrollmentId: string,
  status: string,
  legacyPaths = false
): string {
  if (status !== "active") {
    return `<div class="table-actions">${renderStatusPill(toTitleCase(status), status === "cancelled" ? "warning" : "default")}</div>`;
  }

  const cancelAction = legacyPaths
    ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(workflowId)}&cancel=1&enrollment_id=${encodeURIComponent(enrollmentId)}`
    : `/admin/workflows/${encodeURIComponent(workflowId)}/enrollments/${encodeURIComponent(enrollmentId)}/cancel`;
  return [
    '<div class="table-actions">',
    legacyPaths
      ? `<a href="${cancelAction}">Cancel Enrollment</a>`
      : `<form method="post" action="${cancelAction}"><button type="submit">Cancel Enrollment</button></form>`,
    "</div>"
  ].join("");
}

function formatWorkflowStepDelayLabel(delayType: string): string {
  switch (delayType) {
    case "immediate":
      return "Immediate";
    case "after_enrollment":
      return "After Enrollment";
    case "after_previous":
      return "After Previous";
    case "specific_date":
      return "Specific Date";
    default:
      return toTitleCase(delayType);
  }
}

function renderWorkflowStepOptionOptions(
  options: Array<{
    id: string;
    label: string;
  }>,
  selectedId: string | null
): string {
  return [
    '<option value="">None</option>',
    ...options.map((option) => (
      `<option value="${escapeAttribute(option.id)}"${option.id === selectedId ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    ))
  ].join("");
}

function renderSitePageEditorLegacyShell(page: SitePage): string {
  const viewPath = getSitePageViewPath(page);
  const pagePayload = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    htmlContent: page.htmlContent,
    cssContent: page.cssContent,
    metaDescription: page.metaDescription,
    metaKeywords: page.metaKeywords,
    ogTitle: page.ogTitle ?? "",
    ogDescription: page.ogDescription ?? "",
    ogImage: page.ogImage ?? "",
    isHomepage: page.isHomepage,
    published: page.published,
    sortOrder: page.sortOrder
  };

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)} | Visual Site Editor</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">',
    '<link rel="stylesheet" href="https://unpkg.com/grapesjs@0.21.9/dist/css/grapes.min.css">',
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">',
    "<style>",
    "body { margin: 0; font-family: 'Poppins', sans-serif; background: #0f172a; color: #fff; overflow: hidden; }",
    ".site-pages-editor { min-height: 100vh; background: radial-gradient(circle at top left, rgba(154, 0, 115, 0.22), transparent 34%), radial-gradient(circle at top right, rgba(10, 154, 156, 0.18), transparent 32%), #0f172a; }",
    ".site-pages-editor__topbar { position: fixed; inset: 0 0 auto 0; z-index: 9999; height: 64px; display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.94); border-bottom: 1px solid rgba(148, 163, 184, 0.18); backdrop-filter: blur(18px); }",
    ".site-pages-editor__back { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.95rem; border-radius: 999px; background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 600; }",
    ".site-pages-editor__brand { display: grid; gap: 0.1rem; min-width: 0; }",
    ".site-pages-editor__brand span { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.65); }",
    ".site-pages-editor__title-row { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }",
    ".site-pages-editor__title-display { font-family: 'Montserrat', sans-serif; font-size: 1.05rem; font-weight: 700; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; border-bottom: 1px dashed rgba(255,255,255,0.3); }",
    ".site-pages-editor__title-input { display: none; width: min(360px, 42vw); padding: 0.4rem 0.7rem; border-radius: 0.7rem; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; }",
    ".site-pages-editor__title-input.is-open { display: inline-block; }",
    ".site-pages-editor__status { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.75rem; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; }",
    ".site-pages-editor__status.is-published { background: rgba(22, 163, 74, 0.22); color: #dcfce7; }",
    ".site-pages-editor__spacer { flex: 1; }",
    ".site-pages-editor__actions { display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap; }",
    ".site-pages-editor__button { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.65rem 0.9rem; border-radius: 0.85rem; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.08); color: #fff; font-weight: 600; cursor: pointer; }",
    ".site-pages-editor__button:hover { background: rgba(255,255,255,0.16); }",
    ".site-pages-editor__button--publish { background: linear-gradient(135deg, rgba(22, 163, 74, 0.95) 0%, rgba(21, 128, 61, 0.95) 100%); border-color: rgba(34,197,94,0.4); }",
    ".site-pages-editor__button--draft { background: linear-gradient(135deg, rgba(100, 116, 139, 0.92) 0%, rgba(71, 85, 105, 0.92) 100%); border-color: rgba(148,163,184,0.36); }",
    "#gjs { position: fixed; inset: 64px 0 0 0; }",
    ".site-pages-editor__modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 2rem; z-index: 10010; background: rgba(15, 23, 42, 0.72); }",
    ".site-pages-editor__modal.is-open { display: flex; }",
    ".site-pages-editor__modal-card { width: min(1100px, 100%); max-height: 88vh; overflow: auto; padding: 1.5rem; border-radius: 1.2rem; border: 1px solid rgba(148, 163, 184, 0.18); background: #fff; color: #1f2937; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35); }",
    ".site-pages-editor__modal-card h2 { font-family: 'Montserrat', sans-serif; margin-bottom: 1rem; }",
    ".site-pages-editor__modal-grid { display: grid; gap: 1rem; }",
    ".site-pages-editor__modal-grid label { display: grid; gap: 0.45rem; font-weight: 700; }",
    ".site-pages-editor__modal-grid textarea { min-height: 220px; font: 0.95rem/1.5 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }",
    ".site-pages-editor__modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }",
    ".site-pages-editor__toast-wrap { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 10030; display: grid; gap: 0.65rem; }",
    ".site-pages-editor__toast { padding: 0.9rem 1rem; border-radius: 0.95rem; background: #111827; color: #fff; box-shadow: 0 16px 34px rgba(15,23,42,0.3); }",
    ".site-pages-editor__toast.is-success { border-left: 4px solid #16a34a; }",
    ".site-pages-editor__toast.is-error { border-left: 4px solid #dc2626; }",
    "@media (max-width: 960px) { .site-pages-editor__topbar { height: auto; align-items: start; flex-wrap: wrap; } .site-pages-editor__spacer { display: none; } #gjs { inset: 132px 0 0 0; } .site-pages-editor__title-display { max-width: 220px; } .site-pages-editor__actions { width: 100%; } }",
    "</style>",
    "</head>",
    `<body data-editor="site_pages_editor">`,
    '<div class="site-pages-editor">',
    '<div class="site-pages-editor__topbar">',
    '<a class="site-pages-editor__back" href="/admin/site-pages"><span aria-hidden="true">←</span><span>Back to pages</span></a>',
    '<div class="site-pages-editor__brand">',
    "<span>Visual Site Editor</span>",
    '<div class="site-pages-editor__title-row">',
    `<div class="site-pages-editor__title-display" id="editor-title-display" title="Click to rename">${escapeHtml(page.title)}</div>`,
    `<input class="site-pages-editor__title-input" id="editor-title-input" type="text" value="${escapeAttribute(page.title)}">`,
    "</div>",
    "</div>",
    `<div class="site-pages-editor__status${page.published ? " is-published" : ""}" id="editor-status">${page.published ? "Published" : "Draft"}</div>`,
    '<div class="site-pages-editor__spacer"></div>',
    '<div class="site-pages-editor__actions">',
    `<a class="site-pages-editor__button" href="/admin/site-pages/${encodeURIComponent(page.id)}">Page Details</a>`,
    '<button class="site-pages-editor__button" id="editor-preview-button" type="button">Toggle Preview</button>',
    '<button class="site-pages-editor__button" id="editor-code-button" type="button">Edit HTML / CSS</button>',
    `<a class="site-pages-editor__button" href="${escapeHtml(viewPath)}" target="_blank" rel="noopener noreferrer">View Live</a>`,
    '<button class="site-pages-editor__button" id="editor-save-button" type="button">Save draft</button>',
    `<button class="site-pages-editor__button ${page.published ? "site-pages-editor__button--draft" : "site-pages-editor__button--publish"}" id="editor-publish-button" type="button">${page.published ? "Unpublish" : "Save and publish"}</button>`,
    "</div>",
    "</div>",
    '<div id="gjs"></div>',
    '<div class="site-pages-editor__modal" id="editor-code-modal" aria-hidden="true">',
    '<div class="site-pages-editor__modal-card" role="dialog" aria-modal="true" aria-labelledby="editor-code-modal-title">',
    '<h2 id="editor-code-modal-title">Edit HTML / CSS</h2>',
    '<div class="site-pages-editor__modal-grid">',
    '<label>HTML<textarea id="editor-html-input" spellcheck="false"></textarea></label>',
    '<label>CSS<textarea id="editor-css-input" spellcheck="false"></textarea></label>',
    "</div>",
    '<div class="site-pages-editor__modal-actions">',
    '<button class="site-pages-editor__button" id="editor-cancel-code-button" type="button">Cancel</button>',
    '<button class="site-pages-editor__button site-pages-editor__button--publish" id="editor-apply-code-button" type="button">Apply Changes</button>',
    "</div>",
    "</div>",
    "</div>",
    '<div class="site-pages-editor__toast-wrap" id="editor-toast-wrap"></div>',
    "</div>",
    '<script src="https://unpkg.com/grapesjs@0.21.9/dist/grapes.min.js"></script>',
    '<script src="https://unpkg.com/grapesjs-blocks-basic@1.0.1/dist/index.js"></script>',
    '<script src="https://unpkg.com/grapesjs-preset-webpage@1.0.3/dist/index.js"></script>',
    "<script>",
    `const sitePageEditorInitial = ${toSafeInlineJson(pagePayload)};`,
    "(() => {",
    "  const page = { ...sitePageEditorInitial };",
    "  const statusEl = document.getElementById('editor-status');",
    "  const titleDisplay = document.getElementById('editor-title-display');",
    "  const titleInput = document.getElementById('editor-title-input');",
    "  const codeModal = document.getElementById('editor-code-modal');",
    "  const htmlInput = document.getElementById('editor-html-input');",
    "  const cssInput = document.getElementById('editor-css-input');",
    "  const toastWrap = document.getElementById('editor-toast-wrap');",
    "  let previewing = false;",
    "  const toast = (message, tone = 'success') => {",
    "    if (!(toastWrap instanceof HTMLElement)) return;",
    "    const item = document.createElement('div');",
    "    item.className = `site-pages-editor__toast is-${tone}`;",
    "    item.textContent = message;",
    "    toastWrap.appendChild(item);",
    "    window.setTimeout(() => item.remove(), 3200);",
    "  };",
    "  const setStatus = (published) => {",
    "    page.published = published;",
    "    if (!(statusEl instanceof HTMLElement)) return;",
    "    statusEl.textContent = published ? 'Published' : 'Draft';",
    "    statusEl.classList.toggle('is-published', published);",
    "    const publishButton = document.getElementById('editor-publish-button');",
    "    if (publishButton instanceof HTMLButtonElement) {",
    "      publishButton.textContent = published ? 'Unpublish' : 'Save and publish';",
    "      publishButton.classList.toggle('site-pages-editor__button--draft', published);",
    "      publishButton.classList.toggle('site-pages-editor__button--publish', !published);",
    "    }",
    "  };",
    "  const readPageTitle = () => {",
    "    if (titleInput instanceof HTMLInputElement && titleInput.classList.contains('is-open')) {",
    "      return titleInput.value.trim() || page.title;",
    "    }",
    "    return page.title;",
    "  };",
    "  const syncTitle = (commit) => {",
    "    if (!(titleInput instanceof HTMLInputElement) || !(titleDisplay instanceof HTMLElement)) return;",
    "    if (commit) {",
    "      page.title = titleInput.value.trim() || page.title;",
    "    }",
    "    titleDisplay.textContent = page.title;",
    "    titleDisplay.hidden = false;",
    "    titleInput.classList.remove('is-open');",
    "  };",
    "  titleDisplay?.addEventListener('click', () => {",
    "    if (!(titleInput instanceof HTMLInputElement) || !(titleDisplay instanceof HTMLElement)) return;",
    "    titleInput.value = page.title;",
    "    titleDisplay.hidden = true;",
    "    titleInput.classList.add('is-open');",
    "    titleInput.focus();",
    "    titleInput.select();",
    "  });",
    "  titleInput?.addEventListener('blur', () => syncTitle(true));",
    "  titleInput?.addEventListener('keydown', (event) => {",
    "    if (event.key === 'Enter') { event.preventDefault(); syncTitle(true); }",
    "    if (event.key === 'Escape') { event.preventDefault(); titleInput.value = page.title; syncTitle(false); }",
    "  });",
    "  const resolveGrapesPlugin = (globalKeys) => {",
    "    for (const globalKey of globalKeys) {",
    "      const candidate = globalThis[globalKey];",
    "      if (typeof candidate === 'function') { return candidate; }",
    "      if (candidate != null && typeof candidate.default === 'function') { return candidate.default; }",
    "    }",
    "    return null;",
    "  };",
    "  const createGrapesPlugin = (globalKeys, pluginOptions) => {",
    "    const pluginFactory = resolveGrapesPlugin(globalKeys);",
    "    if (pluginFactory == null) {",
    "      console.warn(`Missing GrapesJS plugin bundle: ${globalKeys.join(', ')}`);",
    "      return null;",
    "    }",
    "    return (editorInstance) => pluginFactory(editorInstance, pluginOptions);",
    "  };",
    "  const editorPlugins = [",
    "    createGrapesPlugin(['gjs-blocks-basic'], { flexGrid: true }),",
    "    createGrapesPlugin(['gjs-preset-webpage', 'grapesjs-preset-webpage'], {})",
    "  ].filter((plugin) => plugin != null);",
    "  const editor = grapesjs.init({",
    "    container: '#gjs',",
    "    height: '100%',",
    "    width: 'auto',",
    "    storageManager: false,",
    "    plugins: editorPlugins,",
    "    canvas: {",
    "      styles: [",
    "        'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',",
    "        'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap',",
    "        '/assets/css/public/site.css'",
    "      ],",
    "      scripts: [",
    "        'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',",
    "        '/assets/js/public/site.js',",
    "        '/assets/js/public/modules.js'",
    "      ]",
    "    }",
    "  });",
    "  editor.setComponents(page.htmlContent || '');",
    "  editor.setStyle(page.cssContent || '');",
    "  const savePage = async (publishedOverride) => {",
    "    const payload = new URLSearchParams();",
    "    payload.set('slug', page.slug);",
    "    payload.set('title', readPageTitle());",
    "    payload.set('htmlContent', editor.getHtml());",
    "    payload.set('cssContent', editor.getCss());",
    "    payload.set('metaDescription', page.metaDescription || '');",
    "    payload.set('metaKeywords', page.metaKeywords || '');",
    "    payload.set('ogTitle', page.ogTitle || '');",
    "    payload.set('ogDescription', page.ogDescription || '');",
    "    payload.set('ogImage', page.ogImage || '');",
    "    payload.set('sortOrder', String(page.sortOrder));",
    "    if (page.isHomepage) payload.set('isHomepage', 'on');",
    "    const nextPublished = typeof publishedOverride === 'boolean' ? publishedOverride : page.published;",
    "    if (nextPublished) payload.set('published', 'on');",
    "    try {",
    "      const response = await fetch(`/admin/site-pages/${encodeURIComponent(page.id)}`, {",
    "        method: 'POST',",
    "        headers: { 'content-type': 'application/x-www-form-urlencoded' },",
    "        body: payload.toString()",
    "      });",
    "      const finalPath = new URL(response.url || window.location.href, window.location.origin).pathname;",
    "      if (!response.ok || finalPath === '/admin/login') throw new Error(finalPath === '/admin/login' ? 'Your session expired. Sign in again.' : 'Save request failed.');",
    "      page.title = readPageTitle();",
    "      syncTitle(true);",
    "      setStatus(nextPublished);",
    "      toast(nextPublished ? 'Page saved and published.' : 'Draft saved.', 'success');",
    "    } catch (error) {",
    "      toast(error instanceof Error ? error.message : 'Unable to save the page.', 'error');",
    "    }",
    "  };",
    "  document.getElementById('editor-save-button')?.addEventListener('click', () => { void savePage(false); });",
    "  document.getElementById('editor-publish-button')?.addEventListener('click', () => { void savePage(!page.published); });",
    "  document.getElementById('editor-preview-button')?.addEventListener('click', (event) => {",
    "    previewing = !previewing;",
    "    if (previewing) { editor.runCommand('core:preview'); } else { editor.stopCommand('core:preview'); }",
    "    if (event.currentTarget instanceof HTMLButtonElement) { event.currentTarget.textContent = previewing ? 'Exit Preview' : 'Toggle Preview'; }",
    "  });",
    "  const openCodeModal = () => {",
    "    if (!(codeModal instanceof HTMLElement) || !(htmlInput instanceof HTMLTextAreaElement) || !(cssInput instanceof HTMLTextAreaElement)) return;",
    "    htmlInput.value = editor.getHtml();",
    "    cssInput.value = editor.getCss();",
    "    codeModal.classList.add('is-open');",
    "    codeModal.setAttribute('aria-hidden', 'false');",
    "  };",
    "  const closeCodeModal = () => {",
    "    if (!(codeModal instanceof HTMLElement)) return;",
    "    codeModal.classList.remove('is-open');",
    "    codeModal.setAttribute('aria-hidden', 'true');",
    "  };",
    "  document.getElementById('editor-code-button')?.addEventListener('click', openCodeModal);",
    "  document.getElementById('editor-cancel-code-button')?.addEventListener('click', closeCodeModal);",
    "  document.getElementById('editor-apply-code-button')?.addEventListener('click', () => {",
    "    if (!(htmlInput instanceof HTMLTextAreaElement) || !(cssInput instanceof HTMLTextAreaElement)) return;",
    "    editor.setComponents(htmlInput.value || '');",
    "    editor.setStyle(cssInput.value || '');",
    "    closeCodeModal();",
    "    toast('Editor markup updated. Save draft to persist changes.', 'success');",
    "  });",
    "  codeModal?.addEventListener('click', (event) => { if (event.target === codeModal) closeCodeModal(); });",
    "  document.addEventListener('keydown', (event) => {",
    "    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void savePage(page.published); }",
    "    if (event.key === 'Escape' && codeModal instanceof HTMLElement && codeModal.classList.contains('is-open')) { closeCodeModal(); }",
    "  });",
    "  setStatus(page.published);",
    "})();",
    "</script>",
    "</body>",
    "</html>"
  ].join("");
}

function renderSitePageEditor(page: SitePage): string {
  const viewPath = getSitePageViewPath(page);
  const pagePayload = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    htmlContent: page.htmlContent,
    cssContent: page.cssContent,
    metaDescription: page.metaDescription,
    metaKeywords: page.metaKeywords,
    ogTitle: page.ogTitle ?? "",
    ogDescription: page.ogDescription ?? "",
    ogImage: page.ogImage ?? "",
    isHomepage: page.isHomepage,
    published: page.published,
    sortOrder: page.sortOrder
  };
  const editorBlocks = {
    hero: `
<section class="bdta-section-hero text-white text-center py-5">
  <div class="container py-4 py-md-5">
    <h1 class="display-5 fw-bold mb-3">Teaching Humans to Speak Dog</h1>
    <p class="lead mb-4 mx-auto bdta-content-narrow">Professional dog training in Highlands County, Florida.</p>
    <a href="/contact" class="btn btn-light btn-lg px-4 bdta-hero-button">Book Now</a>
  </div>
</section>`.trim(),
    cta: `
<section class="bg-light text-center py-5">
  <div class="container py-4">
    <h2 class="fw-bold mb-3">Ready to get started?</h2>
    <p class="text-muted mb-4">Book a session with Brook today.</p>
    <a href="/contact" class="btn btn-primary btn-lg px-4 bdta-cta-button">Book Now</a>
  </div>
</section>`.trim(),
    cards: `
<section class="py-5 bg-light">
  <div class="container">
    <div class="row g-4 justify-content-center">
      <div class="col-12 col-md-6 col-xl-4">
        <div class="card bdta-feature-card h-100 text-center">
          <div class="card-body p-4">
            <div class="bdta-feature-icon mb-3"><i class="fas fa-paw"></i></div>
            <h4 class="mb-2">Feature One</h4>
            <p class="text-muted mb-0">Short description of this feature or service.</p>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-xl-4">
        <div class="card bdta-feature-card h-100 text-center">
          <div class="card-body p-4">
            <div class="bdta-feature-icon mb-3"><i class="fas fa-star"></i></div>
            <h4 class="mb-2">Feature Two</h4>
            <p class="text-muted mb-0">Short description of this feature or service.</p>
          </div>
        </div>
      </div>
      <div class="col-12 col-md-6 col-xl-4">
        <div class="card bdta-feature-card h-100 text-center">
          <div class="card-body p-4">
            <div class="bdta-feature-icon mb-3"><i class="fas fa-heart"></i></div>
            <h4 class="mb-2">Feature Three</h4>
            <p class="text-muted mb-0">Short description of this feature or service.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>`.trim(),
    testimonial: `
<section class="py-4">
  <div class="container">
    <blockquote class="bdta-testimonial bg-white p-4 p-md-5 mb-0">
      <p class="fs-5 fst-italic mb-3">"This training academy completely transformed our dog's behaviour. Highly recommended!"</p>
      <cite class="fw-semibold">- Happy Client, Golden Retriever Owner</cite>
    </blockquote>
  </div>
</section>`.trim(),
    contact: `
<div class="bdta-contact-bar text-white py-3">
  <div class="container">
    <div class="d-flex flex-column flex-md-row justify-content-center align-items-center gap-2 text-center small">
      <span><i class="fas fa-location-dot me-1" aria-hidden="true"></i>Highlands County, FL</span>
      <span class="d-none d-md-inline text-white-50">|</span>
      <span><i class="fas fa-envelope me-1" aria-hidden="true"></i>bookings@brooksdogtrainingacademy.com</span>
      <span class="d-none d-md-inline text-white-50">|</span>
      <div class="d-flex gap-2">
        <a href="https://www.facebook.com/BrooksDogTrainingAcademy" class="bdta-contact-link" target="_blank" rel="noopener noreferrer">Facebook</a>
        <span class="text-white-50">|</span>
        <a href="https://www.instagram.com/brooksdogtrainingacademy" class="bdta-contact-link" target="_blank" rel="noopener noreferrer">Instagram</a>
      </div>
    </div>
  </div>
</div>`.trim(),
    services: `
<section class="bdta-services-module py-5">
  <div class="container py-5">
    <div class="text-center mb-5">
      <h2 class="display-5 fw-bold mb-3">Single Booking Services</h2>
      <p class="lead text-muted">Book one-on-one services and other standalone appointments online</p>
    </div>
    <div class="bdta-services-grid row g-4">
      <div class="bdta-services-loading col-12 text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading services...</span>
        </div>
        <p class="text-muted mt-3">Loading services...</p>
      </div>
    </div>
    <div class="bdta-services-empty text-center py-5 d-none">
      <i class="fas fa-dog display-4 text-muted mb-3"></i>
      <p class="lead text-muted">No single booking services are currently available. Check back soon!</p>
      <a href="#contact" class="btn btn-outline-primary">Contact Us</a>
    </div>
  </div>
</section>`.trim(),
    packages: `
<section class="bdta-packages-module py-5">
  <div class="container py-5">
    <div class="text-center mb-5">
      <h2 class="display-5 fw-bold mb-3">Our Training Packages</h2>
      <p class="lead text-muted">Bundled training programs designed to set your dog up for success</p>
    </div>
    <div class="bdta-packages-grid row g-4">
      <div class="bdta-packages-loading col-12 text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading packages...</span>
        </div>
        <p class="text-muted mt-3">Loading packages...</p>
      </div>
    </div>
    <div class="bdta-packages-empty text-center py-5 d-none">
      <i class="fas fa-box-open display-4 text-muted mb-3"></i>
      <p class="lead text-muted">No packages are currently available. Check back soon!</p>
      <a href="#contact" class="btn btn-outline-primary">Contact Us</a>
    </div>
  </div>
</section>`.trim(),
    events: `
<section class="bdta-events-module py-5 bg-light">
  <div class="container py-5">
    <div class="text-center mb-5">
      <h2 class="display-5 fw-bold mb-3">Group Events and Workshops</h2>
      <p class="lead text-muted">Join our upcoming in-person workshops and community events</p>
    </div>
    <div class="bdta-events-grid row g-4">
      <div class="bdta-events-loading col-12 text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading events...</span>
        </div>
        <p class="text-muted mt-3">Loading events...</p>
      </div>
    </div>
    <div class="bdta-events-empty text-center py-5 d-none">
      <i class="fas fa-calendar-xmark display-4 text-muted mb-3"></i>
      <p class="lead text-muted">No upcoming events are scheduled right now. Follow us on social media for announcements!</p>
    </div>
  </div>
</section>`.trim()
  };

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)} | Visual Site Editor</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">',
    '<link rel="stylesheet" href="/assets/vendor/editor/grapesjs/css/grapes.min.css">',
    '<link rel="stylesheet" href="/assets/vendor/editor/bootstrap/css/bootstrap.min.css">',
    '<link rel="stylesheet" href="/assets/vendor/editor/fontawesome/css/all.min.css">',
    "<style>",
    "body { margin: 0; font-family: 'Poppins', sans-serif; background: #0f172a; color: #fff; overflow: hidden; }",
    ".site-pages-editor { min-height: 100vh; background: radial-gradient(circle at top left, rgba(154, 0, 115, 0.22), transparent 34%), radial-gradient(circle at top right, rgba(10, 154, 156, 0.18), transparent 32%), #0f172a; }",
    ".site-pages-editor__topbar { position: fixed; inset: 0 0 auto 0; z-index: 9999; min-height: 64px; display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.94); border-bottom: 1px solid rgba(148, 163, 184, 0.18); backdrop-filter: blur(18px); }",
    ".site-pages-editor__back { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.95rem; border-radius: 999px; background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 600; }",
    ".site-pages-editor__brand { display: grid; gap: 0.1rem; min-width: 0; }",
    ".site-pages-editor__brand span { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.65); }",
    ".site-pages-editor__title-row { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }",
    ".site-pages-editor__title-display { font-family: 'Montserrat', sans-serif; font-size: 1.05rem; font-weight: 700; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; border-bottom: 1px dashed rgba(255,255,255,0.3); }",
    ".site-pages-editor__title-input { display: none; width: min(360px, 42vw); padding: 0.4rem 0.7rem; border-radius: 0.7rem; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; }",
    ".site-pages-editor__title-input.is-open { display: inline-block; }",
    ".site-pages-editor__status { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.75rem; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; }",
    ".site-pages-editor__status.is-published { background: rgba(22, 163, 74, 0.22); color: #dcfce7; }",
    ".site-pages-editor__spacer { flex: 1; }",
    ".site-pages-editor__actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.65rem; flex-wrap: wrap; flex: 1; }",
    ".site-pages-editor__button-group { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }",
    ".site-pages-editor__button { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.65rem 0.9rem; border-radius: 0.85rem; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.08); color: #fff; font-weight: 600; cursor: pointer; }",
    ".site-pages-editor__button:hover { background: rgba(255,255,255,0.16); }",
    ".site-pages-editor__button.is-active { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.32); }",
    ".site-pages-editor__button.is-disabled { opacity: 0.48; pointer-events: none; }",
    ".site-pages-editor__button--publish { background: linear-gradient(135deg, rgba(22, 163, 74, 0.95) 0%, rgba(21, 128, 61, 0.95) 100%); border-color: rgba(34,197,94,0.4); }",
    ".site-pages-editor__button--draft { background: linear-gradient(135deg, rgba(100, 116, 139, 0.92) 0%, rgba(71, 85, 105, 0.92) 100%); border-color: rgba(148,163,184,0.36); }",
    ".gjs-cv-canvas { background: #f8fafc; }",
    ".gjs-one-bg { background: #1f2937; }",
    ".gjs-two-color, .gjs-four-color, .gjs-four-color-h:hover { color: #ec4899 !important; }",
    "#gjs { position: fixed; inset: 64px 0 0 0; }",
    ".site-pages-editor__modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; padding: 2rem; z-index: 10010; background: rgba(15, 23, 42, 0.72); }",
    ".site-pages-editor__modal.is-open { display: flex; }",
    ".site-pages-editor__modal-card { width: min(1100px, 100%); max-height: 88vh; overflow: auto; padding: 1.5rem; border-radius: 1.2rem; border: 1px solid rgba(148, 163, 184, 0.18); background: #fff; color: #1f2937; box-shadow: 0 30px 80px rgba(15, 23, 42, 0.35); }",
    ".site-pages-editor__modal-card--narrow { width: min(760px, 100%); }",
    ".site-pages-editor__modal-card h2 { font-family: 'Montserrat', sans-serif; margin-bottom: 1rem; }",
    ".site-pages-editor__modal-grid { display: grid; gap: 1rem; }",
    ".site-pages-editor__modal-grid label { display: grid; gap: 0.45rem; font-weight: 700; }",
    ".site-pages-editor__modal-grid input, .site-pages-editor__modal-grid textarea { width: 100%; padding: 0.7rem 0.8rem; border-radius: 0.8rem; border: 1px solid rgba(148, 163, 184, 0.35); background: #fff; color: #111827; }",
    ".site-pages-editor__modal-grid textarea { min-height: 140px; resize: vertical; }",
    ".site-pages-editor__modal-grid textarea.site-pages-editor__code-field { min-height: 220px; font: 0.95rem/1.5 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }",
    ".site-pages-editor__checkbox { display: flex; align-items: center; gap: 0.7rem; font-weight: 600; }",
    ".site-pages-editor__checkbox input { width: 1rem; height: 1rem; margin: 0; }",
    ".site-pages-editor__hint { margin: 0; color: #64748b; font-size: 0.92rem; }",
    ".site-pages-editor__modal-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; }",
    ".site-pages-editor__toast-wrap { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 10030; display: grid; gap: 0.65rem; }",
    ".site-pages-editor__toast { padding: 0.9rem 1rem; border-radius: 0.95rem; background: #111827; color: #fff; box-shadow: 0 16px 34px rgba(15,23,42,0.3); }",
    ".site-pages-editor__toast.is-success { border-left: 4px solid #16a34a; }",
    ".site-pages-editor__toast.is-error { border-left: 4px solid #dc2626; }",
    "@media (max-width: 1200px) { .site-pages-editor__topbar { align-items: start; flex-wrap: wrap; } .site-pages-editor__spacer { display: none; } .site-pages-editor__actions { width: 100%; justify-content: start; } #gjs { inset: 132px 0 0 0; } }",
    "@media (max-width: 720px) { .site-pages-editor__title-display { max-width: 220px; } .site-pages-editor__button-group { width: 100%; } .site-pages-editor__modal { padding: 1rem; } }",
    "</style>",
    "</head>",
    `<body data-editor="site_pages_editor">`,
    '<div class="site-pages-editor">',
    '<div class="site-pages-editor__topbar">',
    '<a class="site-pages-editor__back" href="/admin/site-pages"><span aria-hidden="true">&larr;</span><span>Back to pages</span></a>',
    '<div class="site-pages-editor__brand">',
    "<span>Visual Site Editor</span>",
    '<div class="site-pages-editor__title-row">',
    `<div class="site-pages-editor__title-display" id="editor-title-display" title="Click to rename">${escapeHtml(page.title)}</div>`,
    `<input class="site-pages-editor__title-input" id="editor-title-input" type="text" value="${escapeAttribute(page.title)}">`,
    "</div>",
    "</div>",
    `<div class="site-pages-editor__status${page.published ? " is-published" : ""}" id="editor-status">${page.published ? "Published" : "Draft"}</div>`,
    '<div class="site-pages-editor__spacer"></div>',
    '<div class="site-pages-editor__actions">',
    '<div class="site-pages-editor__button-group">',
    '<button class="site-pages-editor__button" id="editor-undo-button" type="button">Undo</button>',
    '<button class="site-pages-editor__button" id="editor-redo-button" type="button">Redo</button>',
    "</div>",
    '<div class="site-pages-editor__button-group">',
    '<button class="site-pages-editor__button is-active" id="editor-device-desktop" type="button">Desktop</button>',
    '<button class="site-pages-editor__button" id="editor-device-tablet" type="button">Tablet</button>',
    '<button class="site-pages-editor__button" id="editor-device-mobile" type="button">Mobile</button>',
    "</div>",
    '<div class="site-pages-editor__button-group">',
    `<a class="site-pages-editor__button" href="/admin/site-pages/${encodeURIComponent(page.id)}">Page Details</a>`,
    '<button class="site-pages-editor__button" id="editor-preview-button" type="button">Toggle Preview</button>',
    '<button class="site-pages-editor__button" id="editor-code-button" type="button">Edit HTML / CSS</button>',
    '<button class="site-pages-editor__button" id="editor-settings-button" type="button">Page Settings</button>',
    "</div>",
    '<div class="site-pages-editor__button-group">',
    `<a class="site-pages-editor__button${page.published ? "" : " is-disabled"}" id="editor-view-live-link" href="${escapeHtml(viewPath)}" target="_blank" rel="noopener noreferrer">View Live</a>`,
    `<button class="site-pages-editor__button" id="editor-save-button" type="button">${page.published ? "Save changes" : "Save draft"}</button>`,
    `<button class="site-pages-editor__button ${page.published ? "site-pages-editor__button--draft" : "site-pages-editor__button--publish"}" id="editor-publish-button" type="button">${page.published ? "Unpublish" : "Save and publish"}</button>`,
    "</div>",
    "</div>",
    "</div>",
    '<div id="gjs"></div>',
    '<div class="site-pages-editor__modal" id="editor-code-modal" aria-hidden="true">',
    '<div class="site-pages-editor__modal-card" role="dialog" aria-modal="true" aria-labelledby="editor-code-modal-title">',
    '<h2 id="editor-code-modal-title">Edit HTML / CSS</h2>',
    '<div class="site-pages-editor__modal-grid">',
    '<label>HTML<textarea class="site-pages-editor__code-field" id="editor-html-input" spellcheck="false"></textarea></label>',
    '<label>CSS<textarea class="site-pages-editor__code-field" id="editor-css-input" spellcheck="false"></textarea></label>',
    "</div>",
    '<div class="site-pages-editor__modal-actions">',
    '<button class="site-pages-editor__button" id="editor-cancel-code-button" type="button">Cancel</button>',
    '<button class="site-pages-editor__button site-pages-editor__button--publish" id="editor-apply-code-button" type="button">Apply Changes</button>',
    "</div>",
    "</div>",
    "</div>",
    '<div class="site-pages-editor__modal" id="editor-seo-modal" aria-hidden="true">',
    '<div class="site-pages-editor__modal-card site-pages-editor__modal-card--narrow" role="dialog" aria-modal="true" aria-labelledby="editor-seo-modal-title">',
    '<h2 id="editor-seo-modal-title">Page Settings</h2>',
    '<div class="site-pages-editor__modal-grid">',
    '<label>Slug<input id="editor-settings-slug" name="slug" type="text" spellcheck="false"></label>',
    '<label>Meta Description<textarea id="editor-settings-metaDescription" name="metaDescription" spellcheck="false"></textarea></label>',
    '<label>Meta Keywords<textarea id="editor-settings-metaKeywords" name="metaKeywords" spellcheck="false"></textarea></label>',
    '<label>Open Graph Title<input id="editor-settings-ogTitle" name="ogTitle" type="text" spellcheck="false"></label>',
    '<label>Open Graph Description<textarea id="editor-settings-ogDescription" name="ogDescription" spellcheck="false"></textarea></label>',
    '<label>Open Graph Image URL<input id="editor-settings-ogImage" name="ogImage" type="text" spellcheck="false"></label>',
    '<label>Sort Order<input id="editor-settings-sortOrder" name="sortOrder" type="number" step="1"></label>',
    '<label class="site-pages-editor__checkbox"><input id="editor-settings-isHomepage" name="isHomepage" type="checkbox"><span>Set as homepage</span></label>',
    '<p class="site-pages-editor__hint">Settings are staged locally until you save.</p>',
    "</div>",
    '<div class="site-pages-editor__modal-actions">',
    '<button class="site-pages-editor__button" id="editor-cancel-settings-button" type="button">Cancel</button>',
    '<button class="site-pages-editor__button site-pages-editor__button--publish" id="editor-apply-settings-button" type="button">Apply Settings</button>',
    "</div>",
    "</div>",
    "</div>",
    '<div class="site-pages-editor__toast-wrap" id="editor-toast-wrap"></div>',
    "</div>",
    '<script src="/assets/vendor/editor/grapesjs/grapes.min.js"></script>',
    '<script src="/assets/vendor/editor/grapesjs-blocks-basic/index.js"></script>',
    '<script src="/assets/vendor/editor/grapesjs-preset-webpage/index.js"></script>',
    "<script>",
    `const sitePageEditorInitial = ${toSafeInlineJson(pagePayload)};`,
    `const sitePageEditorBlocks = ${toSafeInlineJson(editorBlocks)};`,
    "(() => {",
    "  const page = { ...sitePageEditorInitial };",
    "  const blocks = { ...sitePageEditorBlocks };",
    "  const statusEl = document.getElementById('editor-status');",
    "  const titleDisplay = document.getElementById('editor-title-display');",
    "  const titleInput = document.getElementById('editor-title-input');",
    "  const codeModal = document.getElementById('editor-code-modal');",
    "  const settingsModal = document.getElementById('editor-seo-modal');",
    "  const viewLiveLink = document.getElementById('editor-view-live-link');",
    "  const htmlInput = document.getElementById('editor-html-input');",
    "  const cssInput = document.getElementById('editor-css-input');",
    "  const slugInput = document.getElementById('editor-settings-slug');",
    "  const metaDescriptionInput = document.getElementById('editor-settings-metaDescription');",
    "  const metaKeywordsInput = document.getElementById('editor-settings-metaKeywords');",
    "  const ogTitleInput = document.getElementById('editor-settings-ogTitle');",
    "  const ogDescriptionInput = document.getElementById('editor-settings-ogDescription');",
    "  const ogImageInput = document.getElementById('editor-settings-ogImage');",
    "  const sortOrderInput = document.getElementById('editor-settings-sortOrder');",
    "  const isHomepageInput = document.getElementById('editor-settings-isHomepage');",
    "  const toastWrap = document.getElementById('editor-toast-wrap');",
    "  let previewing = false;",
    "  const toast = (message, tone = 'success') => {",
    "    if (!(toastWrap instanceof HTMLElement)) return;",
    "    const item = document.createElement('div');",
    "    item.className = `site-pages-editor__toast is-${tone}`;",
    "    item.textContent = message;",
    "    toastWrap.appendChild(item);",
    "    window.setTimeout(() => item.remove(), 3200);",
    "  };",
    "  const slugifyValue = (value) => {",
    "    const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
    "    return normalized === '' ? 'page' : normalized;",
    "  };",
    "  const getViewPath = () => page.isHomepage ? '/' : `/${encodeURIComponent(page.slug)}`;",
    "  const syncViewLiveLink = () => {",
    "    if (!(viewLiveLink instanceof HTMLAnchorElement)) return;",
    "    viewLiveLink.href = getViewPath();",
    "    viewLiveLink.classList.toggle('is-disabled', !page.published);",
    "    viewLiveLink.setAttribute('aria-disabled', page.published ? 'false' : 'true');",
    "    viewLiveLink.tabIndex = page.published ? 0 : -1;",
    "  };",
    "  const updateSaveButtonLabel = () => {",
    "    const saveButton = document.getElementById('editor-save-button');",
    "    if (saveButton instanceof HTMLButtonElement) {",
    "      saveButton.textContent = page.published ? 'Save changes' : 'Save draft';",
    "    }",
    "  };",
    "  const setStatus = (published) => {",
    "    page.published = published;",
    "    if (statusEl instanceof HTMLElement) {",
    "      statusEl.textContent = published ? 'Published' : 'Draft';",
    "      statusEl.classList.toggle('is-published', published);",
    "    }",
    "    const publishButton = document.getElementById('editor-publish-button');",
    "    if (publishButton instanceof HTMLButtonElement) {",
    "      publishButton.textContent = published ? 'Unpublish' : 'Save and publish';",
    "      publishButton.classList.toggle('site-pages-editor__button--draft', published);",
    "      publishButton.classList.toggle('site-pages-editor__button--publish', !published);",
    "    }",
    "    updateSaveButtonLabel();",
    "    syncViewLiveLink();",
    "  };",
    "  const readPageTitle = () => {",
    "    if (titleInput instanceof HTMLInputElement && titleInput.classList.contains('is-open')) {",
    "      return titleInput.value.trim() || page.title;",
    "    }",
    "    return page.title;",
    "  };",
    "  const syncTitle = (commit) => {",
    "    if (!(titleInput instanceof HTMLInputElement) || !(titleDisplay instanceof HTMLElement)) return;",
    "    if (commit) {",
    "      page.title = titleInput.value.trim() || page.title;",
    "    }",
    "    titleDisplay.textContent = page.title;",
    "    titleDisplay.hidden = false;",
    "    titleInput.classList.remove('is-open');",
    "  };",
    "  const populateSettingsForm = () => {",
    "    if (slugInput instanceof HTMLInputElement) slugInput.value = page.slug;",
    "    if (metaDescriptionInput instanceof HTMLTextAreaElement) metaDescriptionInput.value = page.metaDescription || '';",
    "    if (metaKeywordsInput instanceof HTMLTextAreaElement) metaKeywordsInput.value = page.metaKeywords || '';",
    "    if (ogTitleInput instanceof HTMLInputElement) ogTitleInput.value = page.ogTitle || '';",
    "    if (ogDescriptionInput instanceof HTMLTextAreaElement) ogDescriptionInput.value = page.ogDescription || '';",
    "    if (ogImageInput instanceof HTMLInputElement) ogImageInput.value = page.ogImage || '';",
    "    if (sortOrderInput instanceof HTMLInputElement) sortOrderInput.value = String(page.sortOrder);",
    "    if (isHomepageInput instanceof HTMLInputElement) isHomepageInput.checked = page.isHomepage;",
    "  };",
    "  titleDisplay?.addEventListener('click', () => {",
    "    if (!(titleInput instanceof HTMLInputElement) || !(titleDisplay instanceof HTMLElement)) return;",
    "    titleInput.value = page.title;",
    "    titleDisplay.hidden = true;",
    "    titleInput.classList.add('is-open');",
    "    titleInput.focus();",
    "    titleInput.select();",
    "  });",
    "  titleInput?.addEventListener('blur', () => syncTitle(true));",
    "  titleInput?.addEventListener('keydown', (event) => {",
    "    if (event.key === 'Enter') { event.preventDefault(); syncTitle(true); }",
    "    if (event.key === 'Escape') { event.preventDefault(); titleInput.value = page.title; syncTitle(false); }",
    "  });",
    "  const resolveGrapesPlugin = (globalKeys) => {",
    "    for (const globalKey of globalKeys) {",
    "      const candidate = globalThis[globalKey];",
    "      if (typeof candidate === 'function') { return candidate; }",
    "      if (candidate != null && typeof candidate.default === 'function') { return candidate.default; }",
    "    }",
    "    return null;",
    "  };",
    "  const createGrapesPlugin = (globalKeys, pluginOptions) => {",
    "    const pluginFactory = resolveGrapesPlugin(globalKeys);",
    "    if (pluginFactory == null) {",
    "      console.warn(`Missing GrapesJS plugin bundle: ${globalKeys.join(', ')}`);",
    "      return null;",
    "    }",
    "    return (editorInstance) => pluginFactory(editorInstance, pluginOptions);",
    "  };",
    "  const editorPlugins = [",
    "    createGrapesPlugin(['gjs-blocks-basic'], { flexGrid: true }),",
    "    createGrapesPlugin(['gjs-preset-webpage', 'grapesjs-preset-webpage'], {})",
    "  ].filter((plugin) => plugin != null);",
    "  const editor = grapesjs.init({",
    "    container: '#gjs',",
    "    height: '100%',",
    "    width: 'auto',",
    "    storageManager: false,",
    "    deviceManager: {",
    "      devices: [",
    "        { name: 'Desktop', width: '' },",
    "        { name: 'Tablet', width: '768px', widthMedia: '992px' },",
    "        { name: 'Mobile', width: '375px', widthMedia: '480px' }",
    "      ]",
    "    },",
    "    plugins: editorPlugins,",
    "    canvas: {",
    "      styles: [",
    "        '/assets/vendor/editor/bootstrap/css/bootstrap.min.css',",
    "        '/assets/vendor/editor/fontawesome/css/all.min.css',",
    "        'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap',",
    "        '/assets/css/public/site.css'",
    "      ],",
    "      scripts: [",
    "        '/assets/vendor/editor/bootstrap/js/bootstrap.bundle.min.js',",
    "        '/assets/js/public/site.js',",
    "        '/assets/js/public/modules.js'",
    "      ]",
    "    }",
    "  });",
    "  (() => {",
    "    const rte = editor.RichTextEditor;",
    "    if (rte == null || typeof rte.add !== 'function') return;",
    "    const addAction = (name, icon, title, handler) => {",
    "      rte.add(name, { icon, attributes: { title }, result: handler });",
    "    };",
    "    addAction('bdta-heading1', '<b>H1</b>', 'Heading 1', (activeRte) => activeRte.exec('formatBlock', '<h1>'));",
    "    addAction('bdta-heading2', '<b>H2</b>', 'Heading 2', (activeRte) => activeRte.exec('formatBlock', '<h2>'));",
    "    addAction('bdta-heading3', '<b>H3</b>', 'Heading 3', (activeRte) => activeRte.exec('formatBlock', '<h3>'));",
    "    addAction('bdta-paragraph', '<b>P</b>', 'Paragraph', (activeRte) => activeRte.exec('formatBlock', '<p>'));",
    "    addAction('bdta-ul', '<i class=\"fas fa-list-ul\"></i>', 'Bulleted list', (activeRte) => activeRte.exec('insertUnorderedList'));",
    "    addAction('bdta-ol', '<i class=\"fas fa-list-ol\"></i>', 'Numbered list', (activeRte) => activeRte.exec('insertOrderedList'));",
    "  })();",
    "  editor.setComponents(page.htmlContent || '');",
    "  editor.setStyle(page.cssContent || '');",
    "  const blockManager = editor.BlockManager;",
    "  blockManager.add('bdta-hero', { label: 'Hero Section', category: 'BDTA', content: blocks.hero });",
    "  blockManager.add('bdta-cta', { label: 'Call to Action', category: 'BDTA', content: blocks.cta });",
    "  blockManager.add('bdta-cards-row', { label: '3-Column Cards', category: 'BDTA', content: blocks.cards });",
    "  blockManager.add('bdta-testimonial', { label: 'Testimonial', category: 'BDTA', content: blocks.testimonial });",
    "  blockManager.add('bdta-contact', { label: 'Contact Bar', category: 'BDTA', content: blocks.contact });",
    "  blockManager.add('bdta-services', { label: 'Single Booking Services', category: 'BDTA', content: blocks.services });",
    "  blockManager.add('bdta-packages', { label: 'Training Packages', category: 'BDTA', content: blocks.packages });",
    "  blockManager.add('bdta-events', { label: 'Group Events and Workshops', category: 'BDTA', content: blocks.events });",
    "  const injectBaseTag = () => {",
    "    try {",
    "      const frameEl = editor.Canvas.getFrameEl ? editor.Canvas.getFrameEl() : null;",
    "      const frameDocument = frameEl && frameEl.contentDocument ? frameEl.contentDocument : null;",
    "      if (frameDocument != null && frameDocument.head != null && frameDocument.head.querySelector('base') == null) {",
    "        const base = frameDocument.createElement('base');",
    "        base.href = `${window.location.origin}/`;",
    "        frameDocument.head.insertBefore(base, frameDocument.head.firstChild);",
    "      }",
    "    } catch (error) {",
    "      return;",
    "    }",
    "  };",
    "  editor.on('load', injectBaseTag);",
    "  window.setTimeout(injectBaseTag, 800);",
    "  const savePage = async (publishedOverride) => {",
    "    const payload = new URLSearchParams();",
    "    const nextTitle = readPageTitle();",
    "    const nextSlug = page.slug.trim() === '' ? slugifyValue(nextTitle) : page.slug;",
    "    payload.set('slug', nextSlug);",
    "    payload.set('title', nextTitle);",
    "    payload.set('htmlContent', editor.getHtml());",
    "    payload.set('cssContent', editor.getCss());",
    "    payload.set('metaDescription', page.metaDescription || '');",
    "    payload.set('metaKeywords', page.metaKeywords || '');",
    "    payload.set('ogTitle', page.ogTitle || '');",
    "    payload.set('ogDescription', page.ogDescription || '');",
    "    payload.set('ogImage', page.ogImage || '');",
    "    payload.set('sortOrder', String(page.sortOrder));",
    "    if (page.isHomepage) payload.set('isHomepage', 'on');",
    "    const nextPublished = typeof publishedOverride === 'boolean' ? publishedOverride : page.published;",
    "    if (nextPublished) payload.set('published', 'on');",
    "    try {",
    "      const response = await fetch(`/admin/site-pages/${encodeURIComponent(page.id)}`, {",
    "        method: 'POST',",
    "        headers: { 'content-type': 'application/x-www-form-urlencoded' },",
    "        body: payload.toString()",
    "      });",
    "      const finalPath = new URL(response.url || window.location.href, window.location.origin).pathname;",
    "      if (!response.ok || finalPath === '/admin/login') throw new Error(finalPath === '/admin/login' ? 'Your session expired. Sign in again.' : 'Save request failed.');",
    "      page.slug = nextSlug;",
    "      page.title = nextTitle;",
    "      syncTitle(true);",
    "      setStatus(nextPublished);",
    "      toast(",
    "        typeof publishedOverride === 'boolean'",
    "          ? nextPublished ? 'Page saved and published.' : 'Page unpublished.'",
    "          : nextPublished ? 'Page saved.' : 'Draft saved.',",
    "        'success'",
    "      );",
    "    } catch (error) {",
    "      toast(error instanceof Error ? error.message : 'Unable to save the page.', 'error');",
    "    }",
    "  };",
    "  const setDevice = (deviceName) => {",
    "    editor.setDevice(deviceName);",
    "    document.getElementById('editor-device-desktop')?.classList.toggle('is-active', deviceName === 'Desktop');",
    "    document.getElementById('editor-device-tablet')?.classList.toggle('is-active', deviceName === 'Tablet');",
    "    document.getElementById('editor-device-mobile')?.classList.toggle('is-active', deviceName === 'Mobile');",
    "  };",
    "  const openCodeModal = () => {",
    "    if (!(codeModal instanceof HTMLElement) || !(htmlInput instanceof HTMLTextAreaElement) || !(cssInput instanceof HTMLTextAreaElement)) return;",
    "    htmlInput.value = editor.getHtml();",
    "    cssInput.value = editor.getCss();",
    "    codeModal.classList.add('is-open');",
    "    codeModal.setAttribute('aria-hidden', 'false');",
    "  };",
    "  const closeCodeModal = () => {",
    "    if (!(codeModal instanceof HTMLElement)) return;",
    "    codeModal.classList.remove('is-open');",
    "    codeModal.setAttribute('aria-hidden', 'true');",
    "  };",
    "  const openSettingsModal = () => {",
    "    if (!(settingsModal instanceof HTMLElement)) return;",
    "    populateSettingsForm();",
    "    settingsModal.classList.add('is-open');",
    "    settingsModal.setAttribute('aria-hidden', 'false');",
    "  };",
    "  const closeSettingsModal = () => {",
    "    if (!(settingsModal instanceof HTMLElement)) return;",
    "    settingsModal.classList.remove('is-open');",
    "    settingsModal.setAttribute('aria-hidden', 'true');",
    "  };",
    "  const applySettings = () => {",
    "    const nextSlug = slugInput instanceof HTMLInputElement",
    "      ? slugifyValue(slugInput.value || readPageTitle())",
    "      : slugifyValue(readPageTitle());",
    "    page.slug = nextSlug;",
    "    page.metaDescription = metaDescriptionInput instanceof HTMLTextAreaElement ? metaDescriptionInput.value.trim() : page.metaDescription;",
    "    page.metaKeywords = metaKeywordsInput instanceof HTMLTextAreaElement ? metaKeywordsInput.value.trim() : page.metaKeywords;",
    "    page.ogTitle = ogTitleInput instanceof HTMLInputElement ? ogTitleInput.value.trim() : page.ogTitle;",
    "    page.ogDescription = ogDescriptionInput instanceof HTMLTextAreaElement ? ogDescriptionInput.value.trim() : page.ogDescription;",
    "    page.ogImage = ogImageInput instanceof HTMLInputElement ? ogImageInput.value.trim() : page.ogImage;",
    "    if (sortOrderInput instanceof HTMLInputElement) {",
    "      const parsedSortOrder = Number.parseInt(sortOrderInput.value, 10);",
    "      if (Number.isFinite(parsedSortOrder)) page.sortOrder = parsedSortOrder;",
    "    }",
    "    page.isHomepage = isHomepageInput instanceof HTMLInputElement ? isHomepageInput.checked : page.isHomepage;",
    "    syncViewLiveLink();",
    "    closeSettingsModal();",
    "    toast('Page settings updated. Save changes to persist them.', 'success');",
    "  };",
    "  document.getElementById('editor-save-button')?.addEventListener('click', () => { void savePage(); });",
    "  document.getElementById('editor-publish-button')?.addEventListener('click', () => { void savePage(!page.published); });",
    "  document.getElementById('editor-undo-button')?.addEventListener('click', () => { editor.UndoManager.undo(); });",
    "  document.getElementById('editor-redo-button')?.addEventListener('click', () => { editor.UndoManager.redo(); });",
    "  document.getElementById('editor-device-desktop')?.addEventListener('click', () => { setDevice('Desktop'); });",
    "  document.getElementById('editor-device-tablet')?.addEventListener('click', () => { setDevice('Tablet'); });",
    "  document.getElementById('editor-device-mobile')?.addEventListener('click', () => { setDevice('Mobile'); });",
    "  document.getElementById('editor-preview-button')?.addEventListener('click', (event) => {",
    "    previewing = !previewing;",
    "    if (previewing) { editor.runCommand('core:preview'); } else { editor.stopCommand('core:preview'); }",
    "    if (event.currentTarget instanceof HTMLButtonElement) {",
    "      event.currentTarget.textContent = previewing ? 'Exit Preview' : 'Toggle Preview';",
    "      event.currentTarget.classList.toggle('is-active', previewing);",
    "    }",
    "  });",
    "  document.getElementById('editor-code-button')?.addEventListener('click', openCodeModal);",
    "  document.getElementById('editor-settings-button')?.addEventListener('click', openSettingsModal);",
    "  document.getElementById('editor-cancel-code-button')?.addEventListener('click', closeCodeModal);",
    "  document.getElementById('editor-cancel-settings-button')?.addEventListener('click', closeSettingsModal);",
    "  document.getElementById('editor-apply-code-button')?.addEventListener('click', () => {",
    "    if (!(htmlInput instanceof HTMLTextAreaElement) || !(cssInput instanceof HTMLTextAreaElement)) return;",
    "    editor.setComponents(htmlInput.value || '');",
    "    editor.setStyle(cssInput.value || '');",
    "    closeCodeModal();",
    "    toast('Editor markup updated. Save changes to persist them.', 'success');",
    "  });",
    "  document.getElementById('editor-apply-settings-button')?.addEventListener('click', applySettings);",
    "  codeModal?.addEventListener('click', (event) => { if (event.target === codeModal) closeCodeModal(); });",
    "  settingsModal?.addEventListener('click', (event) => { if (event.target === settingsModal) closeSettingsModal(); });",
    "  viewLiveLink?.addEventListener('click', (event) => { if (!page.published) event.preventDefault(); });",
    "  document.addEventListener('keydown', (event) => {",
    "    const lowerKey = event.key.toLowerCase();",
    "    if ((event.ctrlKey || event.metaKey) && lowerKey === 's') { event.preventDefault(); void savePage(); }",
    "    if ((event.ctrlKey || event.metaKey) && event.shiftKey && lowerKey === 'p') { event.preventDefault(); void savePage(!page.published); }",
    "    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && lowerKey === 'z') { event.preventDefault(); editor.UndoManager.undo(); }",
    "    if ((event.ctrlKey || event.metaKey) && (lowerKey === 'y' || (event.shiftKey && lowerKey === 'z'))) { event.preventDefault(); editor.UndoManager.redo(); }",
    "    if (event.key === 'Escape') {",
    "      if (settingsModal instanceof HTMLElement && settingsModal.classList.contains('is-open')) { closeSettingsModal(); return; }",
    "      if (codeModal instanceof HTMLElement && codeModal.classList.contains('is-open')) { closeCodeModal(); }",
    "    }",
    "  });",
    "  setStatus(page.published);",
    "  syncViewLiveLink();",
    "  setDevice('Desktop');",
    "})();",
    "</script>",
    "</body>",
    "</html>"
  ].join("");
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
  variant?: LayoutVariant;
  body: string;
  publicRenderAssets?: PublicRenderAssets;
  publicRenderFeatures?: PublicRenderFeatures;
  publicRenderContext?: PublicRenderContext;
}): string {
  const description = input.description == null || input.description.trim() === ""
    ? "Brook's Dog Training Academy"
    : input.description;
  const lowerTitle = input.title.toLowerCase();
  const lowerBody = input.body.toLowerCase();
  const variant: LayoutVariant = input.variant ?? (
    lowerTitle.includes("login")
      ? "auth"
      : lowerTitle.includes("admin") || lowerBody.includes("/admin/")
      ? "admin"
      : lowerTitle.includes("portal") || lowerBody.includes("/portal/")
        ? "portal"
        : "public"
  );
  const publicRequestUrl = parsePublicRequestUrl(input.publicRenderContext?.requestPath);
  const publicPathname = publicRequestUrl?.pathname ?? "";
  const publicNavContext = resolveCurrentPublicNavContext(input.publicRenderContext?.requestPath);
  const isServicesPath = publicNavContext === "services";
  const isBookPath = publicPathname === "/book" || publicPathname === "/book/confirmation";
  const isPortalPath = publicPathname.startsWith("/portal");
  const homeNavClass = publicNavContext === "home" ? "nav-link active" : "nav-link";
  const servicesNavClass = isServicesPath ? "nav-link active" : "nav-link";
  const directoryNavClass = publicNavContext === "directory" ? "nav-link active" : "nav-link";
  const blogNavClass = publicNavContext === "blog" ? "nav-link active" : "nav-link";
  const portalNavClass = isPortalPath ? "nav-link active" : "nav-link";
  const bookNavClass = isBookPath ? "nav-link nav-cta active" : "nav-link nav-cta";

  const publicChrome = [
    '<header class="site-header">',
    '<nav class="navbar public-navbar">',
    '<a class="navbar-brand" href="/"><img class="navbar-brand__mark" src="/assets/images/bdta-logo.png" alt="Brook&apos;s Dog Training Academy logo"><span>Brook&apos;s Dog Training Academy</span></a>',
    '<div class="navbar-links">',
    `<a class="${homeNavClass}" href="/"${publicNavContext === "home" ? ' aria-current="page"' : ""}>Home</a>`,
    `<a class="${servicesNavClass}" href="/services"${publicNavContext === "services" ? ' aria-current="page"' : ""}>Services</a>`,
    `<a class="${directoryNavClass}" href="/directory"${publicNavContext === "directory" ? ' aria-current="page"' : ""}>Directory</a>`,
    `<a class="${blogNavClass}" href="/blog"${publicNavContext === "blog" ? ' aria-current="page"' : ""}>Blog</a>`,
    `<a class="${bookNavClass}" href="/book"${isBookPath ? ' aria-current="page"' : ""}>Book</a>`,
    `<a class="${portalNavClass}" href="/portal/login"${isPortalPath ? ' aria-current="page"' : ""}>Portal</a>`,
    "</div>",
    "</nav>",
    "</header>",
    `<main class="public-main"><section class="hero-section"><div class="public-shell">${input.body}</div></section></main>`,
    '<footer class="public-site-footer">',
    '<div class="public-shell public-site-footer__inner">',
    '<div class="public-site-footer__brand">',
    '<strong>Brook&apos;s Dog Training Academy</strong>',
    '<span>Practical training support for real family life.</span>',
    "</div>",
    '<div class="public-site-footer__links">',
    '<a href="/">Home</a>',
    '<a href="/services">Services</a>',
    '<a href="/directory">Directory</a>',
    '<a href="/blog">Blog</a>',
    "</div>",
    "<!-- BDTA_SOCIAL_LINKS:footer -->",
    "<!-- /BDTA_SOCIAL_LINKS:footer -->",
    "</div>",
    "</footer>",
    getPublicThemeToggleButtonHtml()
  ].join("");

  const portalSidebar = [
    '<nav id="app-sidebar" class="app-sidebar sidebar" data-app-sidebar>',
    '<div class="app-sidebar__brand">Brook\'s Dog Training Academy</div>',
    '<div class="app-sidebar__subtitle">Client access and self-service</div>',
    '<a class="app-sidebar__link" href="/portal">Home</a>',
    '<a class="app-sidebar__link" href="/portal/appointments">Appointments</a>',
    '<a class="app-sidebar__link" href="/portal/invoices">Invoices</a>',
    '<a class="app-sidebar__link" href="/portal/quotes">Quotes</a>',
    '<a class="app-sidebar__link" href="/portal/contracts">Contracts</a>',
    '<a class="app-sidebar__link" href="/portal/forms">Agreements &amp; Forms</a>',
    '<a class="app-sidebar__link" href="/portal/notifications">Notifications</a>',
    '<a class="app-sidebar__link" href="/portal/profile">Profile</a>',
    '<a class="app-sidebar__link" href="/portal/pets">Pets</a>',
    '<a class="app-sidebar__link" href="/portal/achievements">Achievements</a>',
    '<a class="app-sidebar__link" href="/portal/logout">Logout</a>',
    "</nav>"
  ].join("");

  const adminSidebar = [
    '<nav id="app-sidebar" class="app-sidebar sidebar" data-app-sidebar>',
    '<div class="app-sidebar__brand">Brook\'s Dog Training Academy</div>',
    '<div class="app-sidebar__subtitle">Clients, bookings, and billing</div>',
    '<a class="app-sidebar__link" href="/client/index.php">Dashboard</a>',
 '<a class="app-sidebar__link" href="/admin/clients">Clients</a>',
 '<a class="app-sidebar__link" href="/admin/bookings">Bookings</a>',
 '<a class="app-sidebar__link" href="/admin/expenses">Expenses</a>',
 '<a class="app-sidebar__link" href="/admin/invoices">Invoices</a>',
 '<a class="app-sidebar__link" href="/admin/quotes">Quotes</a>',
    '<a class="app-sidebar__link" href="/admin/contracts">Contracts</a>',
    '<a class="app-sidebar__link" href="/admin/forms">Forms</a>',
    '<a class="app-sidebar__link" href="/admin/pets">Pets</a>',
    '<a class="app-sidebar__link" href="/admin/workflows">Workflows</a>',
    '<a class="app-sidebar__link" href="/admin/appointment-types">Appointment Types</a>',
    '<a class="app-sidebar__link" href="/admin/packages">Packages</a>',
    '<a class="app-sidebar__link" href="/admin/credits">Credits</a>',
    '<a class="app-sidebar__link" href="/admin/form-templates">Form Templates</a>',
    '<a class="app-sidebar__link" href="/admin/email-templates">Email Templates</a>',
    '<a class="app-sidebar__link" href="/admin/scheduled-tasks">Scheduled Tasks</a>',
    '<a class="app-sidebar__link" href="/admin/blog-posts">Blog Posts</a>',
    '<a class="app-sidebar__link" href="/admin/site-pages">Site Pages</a>',
    '<a class="app-sidebar__link" href="/admin/settings">Settings</a>',
    '<a class="app-sidebar__link" href="/admin/operations/jobs">Job Logs</a>',
    '<a class="app-sidebar__link" href="/admin/logout">Logout</a>',
    "</nav>"
  ].join("");

  const appChrome = (brand: string, sidebar: string) => [
    '<div class="app-layout" data-app-layout>',
    '<div class="app-mobile-navbar">',
    `<div class="app-mobile-navbar__brand">${escapeHtml(brand)}</div>`,
    '<button class="app-shell-toggle" type="button" data-app-shell-toggle aria-controls="app-sidebar" aria-expanded="false">Menu</button>',
    "</div>",
    sidebar,
    '<div class="app-main-shell">',
    '<div class="app-main-toolbar">',
    '<button class="app-shell-toolbar-toggle" type="button" data-app-desktop-shell-toggle aria-controls="app-sidebar" aria-expanded="true">Hide Menu</button>',
    "</div>",
    `<main class="app-main-content" data-layout-main><div class="app-surface">${input.body}</div></main>`,
    "</div>",
    "</div>"
  ].join("");

  const authChrome = [
    '<main class="auth-main">',
    '<div class="auth-main__inner">',
    input.body,
    "</div>",
    "</main>"
  ].join("");

  const body = variant === "public"
    ? publicChrome
    : variant === "auth"
      ? authChrome
    : variant === "portal"
      ? appChrome("Brook's Dog Training Academy", portalSidebar)
      : appChrome("Brook's Dog Training Academy", adminSidebar);
  const publicHeadScripts = variant === "public"
    ? '<script src="/assets/js/theme-init.js"></script>'
    : "";
  const publicRuntimeScripts = variant === "public"
    ? [
      '<script defer src="/assets/js/theme-toggle.js"></script>',
      '<script defer src="/assets/js/public/site.js"></script>',
      '<script defer src="/assets/js/public/modules.js"></script>'
    ].join("")
    : "";

  let html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">',
    publicHeadScripts,
    "<style>",
    ":root { --theme-primary: #9a0073; --theme-primary-dark: #7a005a; --theme-secondary: #0a9a9c; --theme-surface: #ffffff; --theme-surface-alt: #f8fafc; --theme-border: rgba(148, 163, 184, 0.26); --theme-shadow-sm: 0 12px 30px rgba(15, 23, 42, 0.08); --theme-shadow-lg: 0 24px 50px rgba(15, 23, 42, 0.12); --theme-radius: 1rem; }",
    "html[data-bs-theme='dark'] { color-scheme: dark; }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; font-family: 'Poppins', sans-serif; color: #374151; background: #f8fafc; }",
    "h1, h2, h3, h4, h5, h6 { margin-top: 0; font-family: 'Montserrat', sans-serif; color: #1f2937; line-height: 1.2; }",
    "a { color: var(--theme-primary); text-decoration: none; transition: 180ms ease; }",
    "a:hover { color: var(--theme-primary-dark); }",
    "label { display: block; font-weight: 600; color: #1f2937; }",
    "input, textarea, select { display: block; width: 100%; padding: 0.9rem 1rem; margin-top: 0.4rem; border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 0.85rem; box-sizing: border-box; font: inherit; background: #fff; }",
    "input::placeholder, textarea::placeholder { color: #94a3b8; }",
    "textarea { min-height: 160px; resize: vertical; }",
    "button { padding: 0.85rem 1.25rem; background: var(--theme-primary); color: #fff; border: none; border-radius: 0.85rem; cursor: pointer; font: inherit; font-weight: 600; box-shadow: 0 10px 24px rgba(154, 0, 115, 0.16); }",
    "button:hover { background: var(--theme-primary-dark); }",
    ".eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.78rem; color: #64748b; }",
    ".meta { color: #64748b; font-size: 0.92rem; }",
    ".blog-list, .portal-list { display: grid; gap: 1rem; }",
    ".blog-card, .portal-card { background: var(--theme-surface); border: 1px solid var(--theme-border); border-radius: var(--theme-radius); padding: 1.25rem; box-shadow: var(--theme-shadow-sm); }",
    ".section-copy { max-width: 58rem; margin: 0 0 1.5rem; color: #475569; }",
    ".summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1.25rem 0 2rem; }",
    ".summary-card { padding: 1.15rem 1.2rem; border-radius: 1rem; background: #fff; border: 1px solid var(--theme-border); box-shadow: var(--theme-shadow-sm); }",
    ".summary-card.is-primary { background: linear-gradient(135deg, rgba(154, 0, 115, 0.96) 0%, rgba(122, 0, 90, 0.96) 100%); color: #fff; }",
    ".summary-card.is-secondary { background: linear-gradient(135deg, rgba(10, 154, 156, 0.95) 0%, rgba(8, 118, 119, 0.95) 100%); color: #fff; }",
    ".summary-card.is-success { background: linear-gradient(135deg, rgba(22, 163, 74, 0.95) 0%, rgba(21, 128, 61, 0.95) 100%); color: #fff; }",
    ".summary-card.is-warning { background: linear-gradient(135deg, rgba(245, 158, 11, 0.94) 0%, rgba(217, 119, 6, 0.94) 100%); color: #fff; }",
    ".summary-card__value { font-family: 'Montserrat', sans-serif; font-size: 2rem; font-weight: 700; line-height: 1; }",
    ".summary-card__label { margin-top: 0.55rem; font-weight: 600; }",
    ".summary-card__meta { margin-top: 0.4rem; font-size: 0.9rem; opacity: 0.85; }",
    ".quick-links-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.9rem; margin: 0 0 2rem; }",
    ".quick-link-card { display: flex; flex-direction: column; gap: 0.35rem; padding: 1rem 1.05rem; border-radius: 1rem; border: 1px solid var(--theme-border); background: #fff; box-shadow: var(--theme-shadow-sm); color: var(--theme-primary); }",
    ".quick-link-card:hover { transform: translateY(-1px); box-shadow: 0 18px 34px rgba(15, 23, 42, 0.1); }",
    ".quick-link-card__label { font-weight: 700; }",
    ".quick-link-card__meta { color: #64748b; font-size: 0.88rem; }",
    ".content-stack { display: grid; gap: 1.5rem; min-width: 0; }",
    ".surface-block { min-width: 0; max-width: 100%; padding: 1.25rem; border: 1px solid var(--theme-border); border-radius: 1rem; background: #fff; box-shadow: var(--theme-shadow-sm); }",
    ".surface-block h2 { margin-bottom: 1rem; }",
    ".surface-block, .summary-card, .quick-link-card, .detail-card, .data-table, .portal-card, .blog-card { transition: transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease, opacity 220ms ease; }",
    ".reveal-on-scroll { opacity: 0; transform: translateY(18px); transition: opacity 320ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1); transition-delay: var(--reveal-delay, 0ms); }",
    ".reveal-on-scroll.is-visible { opacity: 1; transform: translateY(0); }",
    ".data-table { width: 100%; max-width: 100%; overflow: hidden; border: 1px solid var(--theme-border); border-radius: 1rem; background: #fff; box-shadow: var(--theme-shadow-sm); }",
    ".data-table__surface { display: grid; gap: 1rem; }",
    ".data-table__toolbar { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end; justify-content: space-between; padding: 1rem 1rem 0; }",
    ".data-table__status { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; justify-content: flex-end; color: #64748b; font-size: 0.9rem; }",
    ".data-table__summary, .data-table__page-count { font-weight: 600; }",
    ".data-table__search, .data-table__page-size-label { display: grid; gap: 0.45rem; color: #475569; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }",
    ".data-table__search { flex: 1 1 260px; min-width: min(100%, 280px); }",
    ".data-table__page-size-label { min-width: 8.5rem; }",
    ".data-table__search input, .data-table__page-size-label select { margin-top: 0; }",
".data-table__viewport { overflow-x: auto; }",
".data-table table { width: 100%; border-collapse: collapse; }",
".data-table th, .data-table td { padding: 0.9rem 1rem; text-align: left; vertical-align: top; border-bottom: 1px solid rgba(148, 163, 184, 0.18); word-break: break-word; }",
".data-table th { position: sticky; top: 0; z-index: 1; font-size: 0.84rem; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; background: #f8fafc; }",
".data-table__sort-button { width: 100%; display: inline-flex; align-items: center; justify-content: space-between; gap: 0.65rem; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; box-shadow: none; cursor: pointer; }",
".data-table__sort-button:hover { background: transparent; color: #334155; }",
".data-table__sort-button:focus-visible { outline: 2px solid rgba(154, 0, 115, 0.34); outline-offset: 0.25rem; border-radius: 0.35rem; }",
".data-table__sort-indicator { font-size: 0.8rem; color: #94a3b8; }",
".data-table__sort-button[aria-sort='ascending'] .data-table__sort-indicator { color: var(--theme-primary-dark); }",
".data-table__sort-button[aria-sort='descending'] .data-table__sort-indicator { color: var(--theme-primary-dark); }",
".data-table tbody tr:last-child td { border-bottom: 0; }",
    ".data-table tbody tr:hover { background: rgba(248, 250, 252, 0.9); }",
    ".data-table tbody tr[hidden] { display: none; }",
    ".data-table__pagination { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; justify-content: space-between; padding: 0 1rem 1rem; }",
    ".data-table__pagination-buttons { display: flex; flex-wrap: wrap; gap: 0.65rem; }",
    ".data-table__pagination button { box-shadow: none; padding: 0.7rem 1rem; }",
    ".data-table__pagination button[disabled] { opacity: 0.45; cursor: not-allowed; }",
    ".data-table__empty-state { margin: 0; padding: 0 1rem 1rem; }",
    ".enhanced-collection { display: grid; gap: 1rem; }",
    ".enhanced-collection__toolbar { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end; justify-content: space-between; }",
    ".enhanced-collection__search, .enhanced-collection__page-size-label { display: grid; gap: 0.45rem; color: #475569; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }",
    ".enhanced-collection__search { flex: 1 1 260px; min-width: min(100%, 280px); }",
    ".enhanced-collection__status { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; justify-content: flex-end; color: #64748b; font-size: 0.9rem; }",
    ".enhanced-collection__summary, .enhanced-collection__page-count { font-weight: 600; }",
    ".enhanced-collection__search input, .enhanced-collection__page-size-label select { margin-top: 0; }",
    ".enhanced-collection [data-enhanced-collection-item][hidden] { display: none; }",
    ".enhanced-collection__pagination { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; justify-content: space-between; }",
    ".enhanced-collection__pagination-buttons { display: flex; flex-wrap: wrap; gap: 0.65rem; }",
    ".enhanced-collection__pagination button { box-shadow: none; padding: 0.7rem 1rem; }",
    ".enhanced-collection__pagination button[disabled] { opacity: 0.45; cursor: not-allowed; }",
    ".enhanced-collection__empty-state { margin: 0; }",
    ".debug-error-pre { margin: 1rem 0 0; padding: 1rem; overflow-x: auto; border-radius: 1rem; background: #0f172a; color: #e2e8f0; font: 0.88rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }",
    ".surface-block details > summary, details.surface-block > summary { cursor: pointer; }",
    ".inline-link-list { display: flex; flex-wrap: wrap; gap: 0.7rem 1rem; margin: 0 0 1.25rem; color: #64748b; }",
    ".inline-link-list a { font-weight: 500; }",
    ".detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 0 0 1.5rem; }",
    ".detail-card { padding: 1rem 1.1rem; border-radius: 1rem; border: 1px solid rgba(148, 163, 184, 0.2); background: #f8fafc; }",
    ".detail-card__label { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }",
    ".detail-card__value { margin-top: 0.4rem; font-weight: 600; color: #1f2937; word-break: break-word; }",
    ".status-pill { display: inline-flex; align-items: center; padding: 0.38rem 0.72rem; border-radius: 999px; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.03em; background: #e2e8f0; color: #334155; }",
    ".status-pill.is-success { background: #dcfce7; color: #166534; }",
    ".status-pill.is-warning { background: #fef3c7; color: #92400e; }",
    ".status-pill.is-danger { background: #fee2e2; color: #991b1b; }",
    ".status-pill.is-info { background: #dbeafe; color: #1d4ed8; }",
    ".form-grid { display: grid; gap: 1rem; }",
    ".form-grid--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
    ".form-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }",
    ".table-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }",
    ".table-actions form { margin: 0; }",
    ".table-actions button { box-shadow: none; padding: 0.65rem 0.95rem; }",
    ".site-header { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid rgba(148, 163, 184, 0.18); background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(12px); }",
    ".navbar { max-width: 1180px; margin: 0 auto; padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }",
    ".navbar-brand { display: inline-flex; align-items: center; gap: 0.75rem; font-family: 'Montserrat', sans-serif; font-size: 1.05rem; font-weight: 700; color: #1f2937; }",
    ".navbar-brand__mark { width: 2.5rem; height: 2.5rem; object-fit: contain; border-radius: 999px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08); background: #fff; }",
    ".navbar-links { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }",
    ".nav-link { position: relative; display: inline-flex; align-items: center; justify-content: center; padding: 0.55rem 0.85rem; border-radius: 999px; font-weight: 500; color: #374151; }",
    ".nav-link:hover { color: var(--theme-primary); background: rgba(154, 0, 115, 0.08); }",
    ".nav-link.active { color: var(--theme-primary-dark); background: rgba(154, 0, 115, 0.12); box-shadow: inset 0 0 0 1px rgba(154, 0, 115, 0.14); }",
    ".nav-cta { padding: 0.7rem 1rem; border-radius: 999px; background: rgba(154, 0, 115, 0.12); color: var(--theme-primary-dark); box-shadow: inset 0 0 0 1px rgba(154, 0, 115, 0.22); }",
    ".nav-cta:hover { color: #fff; background: var(--theme-primary-dark); box-shadow: none; }",
    ".nav-cta.active { background: var(--theme-primary); color: #fff; box-shadow: 0 12px 28px rgba(154, 0, 115, 0.22); }",
    ".public-main { min-height: calc(100vh - 76px); background: linear-gradient(135deg, #f0f9ff 0%, #ffffff 60%, #f8fafc 100%); }",
    ".hero-section { padding: 3rem 1.25rem 4rem; }",
    ".public-shell { max-width: 1180px; margin: 0 auto; }",
    ".public-shell > article, .public-shell > section, .public-shell > div > article, .public-shell > div > section { background: #fff; border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 1.5rem; padding: 2rem; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08); }",
    ".public-site-footer { padding: 2rem 1.25rem 3rem; background: #111827; color: #e2e8f0; }",
    ".public-site-footer a { color: #f8fafc; }",
    ".public-site-footer__inner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }",
    ".public-site-footer__brand { display: grid; gap: 0.35rem; max-width: 28rem; }",
    ".public-site-footer__links { display: flex; gap: 0.85rem; flex-wrap: wrap; }",
    ".public-social-slot { display: grid; gap: 0.8rem; }",
    ".public-social-slot--footer { justify-items: end; }",
    ".public-social-links { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }",
    ".public-social-link { display: inline-flex; align-items: center; gap: 0.55rem; padding: 0.7rem 0.95rem; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 600; }",
    ".public-social-link:hover { color: #fff; background: rgba(255, 255, 255, 0.16); }",
    ".public-social-link__icon { width: 1.6rem; height: 1.6rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(255, 255, 255, 0.18); font-size: 0.78rem; font-weight: 700; }",
    ".bdta-social-icon-bluesky { letter-spacing: -0.04em; }",
    ".btn.public-theme-toggle { position: fixed; z-index: 1100; top: auto; right: auto; bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); left: 1rem; margin: 0; display: inline-flex; align-items: center; gap: 0.55rem; border: 1px solid rgba(148, 163, 184, 0.32); background: rgba(255, 255, 255, 0.95); color: #1f2937; box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.15); }",
    ".public-theme-toggle__icon { display: inline-flex; align-items: center; justify-content: center; width: 1.2rem; height: 1.2rem; font-weight: 700; }",
    ".public-theme-toggle__label { font-size: 0.88rem; }",
    "@media (hover: hover) and (pointer: fine) { .surface-block:hover, .summary-card:hover, .quick-link-card:hover, .detail-card:hover, .data-table:hover, .portal-card:hover, .blog-card:hover { transform: translateY(-2px); box-shadow: var(--theme-shadow-lg); border-color: rgba(148, 163, 184, 0.34); } }",
"html[data-bs-theme='dark'] .data-table { background: rgba(15, 23, 42, 0.92); border-color: rgba(148, 163, 184, 0.2); }",
"html[data-bs-theme='dark'] .data-table th { background: rgba(30, 41, 59, 0.94); color: #94a3b8; }",
"html[data-bs-theme='dark'] .data-table__sort-button:hover { color: #e2e8f0; }",
"html[data-bs-theme='dark'] .data-table__sort-indicator { color: #64748b; }",
"html[data-bs-theme='dark'] .data-table th, html[data-bs-theme='dark'] .data-table td { border-bottom-color: rgba(148, 163, 184, 0.14); }",
    "html[data-bs-theme='dark'] .data-table tbody tr { background: rgba(15, 23, 42, 0.88); }",
    "html[data-bs-theme='dark'] .data-table tbody tr:hover { background: rgba(30, 41, 59, 0.78); }",
    "html[data-bs-theme='dark'] .data-table__search, html[data-bs-theme='dark'] .data-table__page-size-label, html[data-bs-theme='dark'] .data-table__status, html[data-bs-theme='dark'] .data-table__empty-state { color: #cbd5e1; }",
    "html[data-bs-theme='dark'] .enhanced-collection__search, html[data-bs-theme='dark'] .enhanced-collection__page-size-label, html[data-bs-theme='dark'] .enhanced-collection__status, html[data-bs-theme='dark'] .enhanced-collection__empty-state { color: #cbd5e1; }",
    "html[data-bs-theme='dark'] body { color: #e5e7eb; background: #0f172a; }",
    "html[data-bs-theme='dark'] h1, html[data-bs-theme='dark'] h2, html[data-bs-theme='dark'] h3, html[data-bs-theme='dark'] h4, html[data-bs-theme='dark'] h5, html[data-bs-theme='dark'] h6 { color: #f8fafc; }",
    "html[data-bs-theme='dark'] label { color: #e2e8f0; }",
    "html[data-bs-theme='dark'] input, html[data-bs-theme='dark'] textarea, html[data-bs-theme='dark'] select { background: rgba(15, 23, 42, 0.92); color: #f8fafc; border-color: rgba(148, 163, 184, 0.26); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03); }",
    "html[data-bs-theme='dark'] input::placeholder, html[data-bs-theme='dark'] textarea::placeholder { color: #94a3b8; }",
    "html[data-bs-theme='dark'] input:disabled, html[data-bs-theme='dark'] textarea:disabled, html[data-bs-theme='dark'] select:disabled { background: rgba(30, 41, 59, 0.94); color: #cbd5e1; -webkit-text-fill-color: #cbd5e1; opacity: 1; }",
    "html[data-bs-theme='dark'] .detail-card { background: rgba(30, 41, 59, 0.76); border-color: rgba(148, 163, 184, 0.18); }",
    "html[data-bs-theme='dark'] .detail-card__label { color: #94a3b8; }",
    "html[data-bs-theme='dark'] .detail-card__value { color: #f8fafc; }",
    "html[data-bs-theme='dark'] .site-header { background: rgba(15, 23, 42, 0.94); border-bottom-color: rgba(148, 163, 184, 0.18); }",
    "html[data-bs-theme='dark'] .navbar-brand, html[data-bs-theme='dark'] .nav-link { color: #e2e8f0; }",
    "html[data-bs-theme='dark'] .nav-link:hover { background: rgba(154, 0, 115, 0.22); color: #f8fafc; }",
    "html[data-bs-theme='dark'] .nav-link.active { background: rgba(154, 0, 115, 0.28); color: #f8fafc; box-shadow: inset 0 0 0 1px rgba(244, 114, 182, 0.26); }",
    "html[data-bs-theme='dark'] .nav-cta { background: rgba(154, 0, 115, 0.22); color: #f8fafc; box-shadow: inset 0 0 0 1px rgba(244, 114, 182, 0.24); }",
    "html[data-bs-theme='dark'] .nav-cta.active { background: var(--theme-primary); box-shadow: 0 12px 28px rgba(154, 0, 115, 0.32); }",
    "html[data-bs-theme='dark'] .public-main { background: linear-gradient(135deg, #0f172a 0%, #111827 55%, #1e293b 100%); }",
    "html[data-bs-theme='dark'] .public-shell > article, html[data-bs-theme='dark'] .public-shell > section, html[data-bs-theme='dark'] .public-shell > div > article, html[data-bs-theme='dark'] .public-shell > div > section, html[data-bs-theme='dark'] .marketing-hero, html[data-bs-theme='dark'] .public-section, html[data-bs-theme='dark'] .article-content, html[data-bs-theme='dark'] .article-sidebar, html[data-bs-theme='dark'] .booking-form-card, html[data-bs-theme='dark'] .booking-benefits, html[data-bs-theme='dark'] .surface-block, html[data-bs-theme='dark'] .service-card, html[data-bs-theme='dark'] .resource-card, html[data-bs-theme='dark'] .process-card, html[data-bs-theme='dark'] .story-card, html[data-bs-theme='dark'] .testimonial-card, html[data-bs-theme='dark'] .summary-card, html[data-bs-theme='dark'] .detail-card, html[data-bs-theme='dark'] .marketing-aside-card, html[data-bs-theme='dark'] .quick-link-card { background: rgba(15, 23, 42, 0.92); color: #e5e7eb; border-color: rgba(148, 163, 184, 0.2); }",
    "html[data-bs-theme='dark'] .section-copy, html[data-bs-theme='dark'] .meta, html[data-bs-theme='dark'] .quick-link-card__meta, html[data-bs-theme='dark'] .detail-card__label, html[data-bs-theme='dark'] .summary-card__meta { color: #cbd5e1; }",
    "html[data-bs-theme='dark'] .btn.public-theme-toggle { background: rgba(15, 23, 42, 0.94); color: #f8fafc; }",
    ".marketing-stack { display: grid; gap: 1.6rem; }",
    ".marketing-hero { padding: 2.25rem; border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 1.6rem; background: linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.96) 100%); box-shadow: 0 28px 60px rgba(15, 23, 42, 0.08); }",
    ".marketing-hero--home { position: relative; overflow: hidden; }",
    ".marketing-hero--compact { padding: 2rem 2.15rem; }",
    ".marketing-hero__grid { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr); gap: 1.5rem; align-items: start; }",
    ".marketing-hero__grid--media { align-items: center; }",
    ".marketing-hero__content h1 { font-size: clamp(2.4rem, 4vw, 4.25rem); margin-bottom: 1rem; color: #5f194c; }",
    ".marketing-hero__content .section-copy { font-size: 1.08rem; max-width: 44rem; }",
    ".marketing-aside-card { padding: 1.35rem; border-radius: 1.25rem; background: linear-gradient(135deg, rgba(154, 0, 115, 0.08) 0%, rgba(10, 154, 156, 0.08) 100%); border: 1px solid rgba(148, 163, 184, 0.2); }",
    ".marketing-aside-card h2 { margin-bottom: 0.65rem; }",
    ".hero-media-frame { position: relative; min-height: 420px; border-radius: 1.5rem; overflow: hidden; background: linear-gradient(135deg, rgba(154, 0, 115, 0.12) 0%, rgba(10, 154, 156, 0.1) 100%); box-shadow: 0 28px 60px rgba(15, 23, 42, 0.12); }",
    ".hero-media-frame::after { content: ''; position: absolute; inset: auto 0 0; height: 40%; background: linear-gradient(180deg, rgba(15, 23, 42, 0) 0%, rgba(15, 23, 42, 0.42) 100%); }",
    ".hero-media-frame__image { width: 100%; height: 100%; display: block; object-fit: cover; }",
    ".hero-media-frame__badge { position: absolute; left: 1rem; right: 1rem; bottom: 1rem; z-index: 1; padding: 0.8rem 1rem; border-radius: 999px; background: rgba(255, 255, 255, 0.92); color: #1f2937; font-weight: 600; text-align: center; box-shadow: 0 14px 26px rgba(15, 23, 42, 0.12); }",
    ".hero-stat-row .summary-grid { margin: 1.4rem 0 0; }",
    ".about-panel__grid, .contact-panel__grid { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr); gap: 1.5rem; align-items: center; }",
    ".about-panel__media img { width: 100%; min-height: 360px; display: block; object-fit: cover; border-radius: 1.35rem; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12); }",
    ".feature-list { display: grid; gap: 0.9rem; }",
    ".quick-link-card--inline { min-width: 240px; max-width: 320px; }",
    ".public-section { padding: 2rem; border-radius: 1.5rem; background: rgba(255, 255, 255, 0.92); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 20px 44px rgba(15, 23, 42, 0.06); }",
    ".public-section--alt { background: linear-gradient(135deg, rgba(154, 0, 115, 0.04) 0%, rgba(10, 154, 156, 0.05) 100%); }",
    ".bdta-newsletter-embed-section { padding: 0 1.25rem 4rem; }",
    ".bdta-newsletter-embed-copy { width: min(100%, 46rem); margin: 0 auto 1rem; }",
    ".bdta-newsletter-embed-copy .section-copy { margin-bottom: 0; }",
    ".bdta-newsletter-embed-card { width: min(100%, 46rem); margin: 0 auto; padding: 1.5rem; border-radius: 1.5rem; background: linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 249, 255, 0.98) 100%); border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: 0 24px 54px rgba(15, 23, 42, 0.08); }",
    ".bdta-newsletter-embed-body--mailjet .bdta-newsletter-mailjet { width: 100%; }",
    ".bdta-newsletter-embed-body--mailjet .pas-form { padding: 0 !important; background: transparent !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-text, .bdta-newsletter-embed-body--mailjet .pas-input, .bdta-newsletter-embed-body--mailjet .pas-optin, .bdta-newsletter-embed-body--mailjet .pas-submit { padding-left: 0 !important; padding-right: 0 !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-text { color: inherit !important; font-family: 'Poppins', sans-serif !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-text-container h1, .bdta-newsletter-embed-body--mailjet .pas-text-container h2, .bdta-newsletter-embed-body--mailjet .pas-text-container h3 { font-family: 'Montserrat', sans-serif !important; color: #1f2937 !important; text-align: left !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-input-text span, .bdta-newsletter-embed-body--mailjet .pas-optin-text span { color: #475569 !important; font-family: 'Poppins', sans-serif !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-input-input { height: auto !important; min-height: 3rem !important; border-radius: 0.9rem !important; border: 1px solid rgba(148, 163, 184, 0.35) !important; padding: 0.9rem 1rem !important; background: #fff !important; color: #1f2937 !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-optin { display: grid !important; grid-template-columns: auto 1fr; gap: 0.85rem; align-items: start; }",
    ".bdta-newsletter-embed-body--mailjet input[type='checkbox'] { margin-top: 0.2rem; }",
    ".bdta-newsletter-embed-body--mailjet .pas-submit button { width: 100%; margin: 0 !important; border-radius: 0.9rem !important; background: var(--theme-primary) !important; color: #fff !important; font: 600 1rem 'Poppins', sans-serif !important; }",
    ".bdta-newsletter-embed-body--mailjet .pas-submit button:hover { background: var(--theme-primary-dark) !important; }",
    "html[data-bs-theme='dark'] .bdta-newsletter-embed-card, html[data-bs-theme='dark'] .bdta-newsletter-embed-copy { color: #e5e7eb; }",
    "html[data-bs-theme='dark'] .bdta-newsletter-embed-card { background: linear-gradient(145deg, rgba(15, 23, 42, 0.92) 0%, rgba(30, 41, 59, 0.96) 100%); border-color: rgba(148, 163, 184, 0.18); }",
    "html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-text-container h1, html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-text-container h2, html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-text-container h3 { color: #f8fafc !important; }",
    "html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-input-text span, html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-optin-text span { color: #cbd5e1 !important; }",
    "html[data-bs-theme='dark'] .bdta-newsletter-embed-body--mailjet .pas-input-input { border-color: rgba(148, 163, 184, 0.26) !important; background: rgba(15, 23, 42, 0.92) !important; color: #f8fafc !important; }",
    ".service-overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }",
    ".section-heading { margin-bottom: 1.4rem; }",
    ".section-heading h2 { margin-bottom: 0.35rem; }",
    ".program-grid, .resource-grid, .process-grid, .story-grid, .testimonial-grid { display: grid; gap: 1rem; }",
    ".program-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    ".resource-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    ".process-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    ".story-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    ".testimonial-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }",
    ".service-card, .resource-card, .process-card, .story-card, .testimonial-card { padding: 1.35rem; border-radius: 1.2rem; background: #fff; border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: var(--theme-shadow-sm); }",
    ".testimonial-card p { margin-bottom: 0; }",
    ".service-card__icon { width: 2.35rem; height: 2.35rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(154, 0, 115, 0.12); color: var(--theme-primary); font-weight: 700; margin-bottom: 0.8rem; }",
    ".public-shell .featured-story { padding: 2rem; border-radius: 1.5rem; background: linear-gradient(135deg, rgba(95, 25, 76, 0.98) 0%, rgba(122, 0, 90, 0.94) 55%, rgba(10, 154, 156, 0.82) 100%); color: #fff; box-shadow: 0 28px 60px rgba(95, 25, 76, 0.2); }",
    ".featured-story__layout { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(260px, 0.95fr); gap: 1.35rem; align-items: center; }",
    ".featured-story__content { display: grid; gap: 0.8rem; }",
    ".featured-story h2 { color: #fff; font-size: clamp(1.8rem, 3vw, 3rem); margin: 0.45rem 0 0.8rem; }",
    ".featured-story a { color: #fff; }",
    ".featured-story__meta { color: rgba(255, 255, 255, 0.82); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.8rem; }",
    ".featured-story__media { min-height: 260px; border-radius: 1.35rem; overflow: hidden; box-shadow: 0 22px 40px rgba(15, 23, 42, 0.22); }",
    ".featured-story__media img { width: 100%; height: 100%; display: block; object-fit: cover; }",
    ".article-shell { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr); gap: 1.5rem; align-items: start; }",
    ".article-content, .article-sidebar { min-width: 0; }",
    ".article-content { padding: 2rem; border-radius: 1.5rem; background: #fff; border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: var(--theme-shadow-sm); }",
    ".public-rich-copy { line-height: 1.8; }",
    ".public-rich-copy img, .public-rich-copy iframe, .public-rich-copy video { max-width: 100%; height: auto; }",
    ".public-rich-copy p { margin: 0 0 1rem; }",
    ".public-rich-copy h2 { margin: 1.6rem 0 0.8rem; }",
    ".public-cta-banner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.6rem 1.8rem; border-radius: 1.5rem; background: linear-gradient(135deg, rgba(31, 41, 55, 0.96) 0%, rgba(95, 25, 76, 0.96) 100%); color: #fff; box-shadow: 0 28px 50px rgba(15, 23, 42, 0.18); }",
    ".public-cta-banner h2 { color: #fff; margin-bottom: 0.2rem; }",
    ".booking-shell { display: grid; gap: 1.6rem; }",
    ".booking-shell__grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.8fr); gap: 1.4rem; align-items: start; }",
    ".booking-form-card, .booking-benefits { padding: 1.8rem; border-radius: 1.5rem; background: #fff; border: 1px solid rgba(148, 163, 184, 0.18); box-shadow: var(--theme-shadow-sm); }",
    ".booking-benefits { background: linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(240,249,255,0.98) 100%); }",
    ".benefit-list { display: grid; gap: 0.9rem; margin-top: 1rem; }",
    ".benefit-item { padding: 1rem 1.05rem; border-radius: 1rem; background: rgba(255,255,255,0.85); border: 1px solid rgba(148, 163, 184, 0.16); }",
    ".benefit-item p { margin: 0.45rem 0 0; color: #475569; }",
    "html[data-bs-theme='dark'] .booking-benefits { background: linear-gradient(145deg, rgba(15, 23, 42, 0.96) 0%, rgba(17, 24, 39, 0.96) 100%); }",
    "html[data-bs-theme='dark'] .benefit-item { background: rgba(30, 41, 59, 0.82); border-color: rgba(148, 163, 184, 0.18); color: #e5e7eb; }",
    "html[data-bs-theme='dark'] .benefit-item strong { color: #f8fafc; }",
    "html[data-bs-theme='dark'] .benefit-item p { color: #cbd5e1; }",
    ".auth-main { min-height: 100vh; padding: 1.5rem; background: radial-gradient(circle at top left, rgba(154, 0, 115, 0.16), transparent 32%), radial-gradient(circle at bottom right, rgba(10, 154, 156, 0.18), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%); display: flex; align-items: center; justify-content: center; }",
    ".auth-main__inner { width: min(1100px, 100%); }",
    ".auth-shell { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(360px, 0.88fr); border-radius: 1.75rem; overflow: hidden; border: 1px solid rgba(148, 163, 184, 0.2); background: rgba(255, 255, 255, 0.9); box-shadow: 0 30px 80px rgba(15, 23, 42, 0.12); }",
    ".auth-shell__hero { display: grid; gap: 1.25rem; padding: 2.5rem; background: linear-gradient(145deg, rgba(95, 25, 76, 0.98) 0%, rgba(154, 0, 115, 0.94) 55%, rgba(10, 154, 156, 0.86) 100%); color: #fff; }",
    ".auth-shell__eyebrow, .auth-shell__hero .eyebrow { color: rgba(255, 255, 255, 0.74); }",
    ".auth-shell__hero-copy h1 { margin-bottom: 0.85rem; color: #fff; font-size: clamp(2.2rem, 4vw, 3.6rem); }",
    ".auth-shell__hero .section-copy { margin-bottom: 0; color: rgba(255, 255, 255, 0.88); max-width: 32rem; font-size: 1rem; }",
    ".auth-shell__return { margin: 0; padding: 0.95rem 1rem; border-radius: 1rem; background: rgba(255, 255, 255, 0.14); border: 1px solid rgba(255, 255, 255, 0.18); color: #fff; }",
    ".auth-shell__return strong { color: #fff; word-break: break-word; }",
    ".auth-benefits { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.85rem; }",
    ".auth-benefit { padding: 0.95rem 1rem; border-radius: 1rem; background: rgba(15, 23, 42, 0.18); border: 1px solid rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.92); }",
    ".auth-shell__support { margin: 0; color: rgba(255, 255, 255, 0.74); font-size: 0.94rem; }",
    ".auth-shell__panel { display: flex; align-items: center; justify-content: center; padding: 2rem; background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%); }",
    ".auth-card { width: min(100%, 28rem); display: grid; gap: 1.2rem; }",
    ".auth-card__copy .section-copy { margin-bottom: 0; }",
    ".auth-error { margin: 0; padding: 0.9rem 1rem; border-radius: 1rem; border: 1px solid rgba(220, 38, 38, 0.2); background: #fef2f2; color: #b91c1c; font-weight: 600; }",
    ".auth-form { display: grid; gap: 1rem; }",
    ".auth-form button { width: 100%; margin-top: 0.35rem; }",
    ".app-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; background: linear-gradient(180deg, rgba(148, 163, 184, 0.08), transparent 260px), #f8fafc; }",
    ".app-layout.is-sidebar-collapsed { grid-template-columns: minmax(0, 1fr); }",
    ".app-layout.is-sidebar-collapsed .app-sidebar { display: none; }",
    ".app-mobile-navbar { display: none; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.25rem; background: linear-gradient(135deg, var(--theme-primary) 0%, var(--theme-primary-dark) 100%); color: #fff; }",
    ".app-mobile-navbar__brand { font-family: 'Montserrat', sans-serif; font-weight: 700; }",
    ".app-shell-toggle { padding: 0.65rem 0.95rem; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 0.92rem; box-shadow: none; }",
    ".app-shell-toggle:hover { background: rgba(255, 255, 255, 0.22); }",
    ".app-sidebar { padding: 1.5rem 1rem; background: linear-gradient(180deg, var(--theme-primary) 0%, var(--theme-primary-dark) 100%); color: #fff; box-shadow: var(--theme-shadow-lg); }",
    ".app-sidebar__brand { font-family: 'Montserrat', sans-serif; font-size: 1.1rem; font-weight: 700; }",
    ".app-sidebar__subtitle { margin: 0.35rem 0 1.4rem; font-size: 0.92rem; color: rgba(255, 255, 255, 0.78); }",
    ".app-sidebar__link { display: block; padding: 0.72rem 0.9rem; border-radius: 0.9rem; color: rgba(255, 255, 255, 0.95); font-weight: 500; }",
    ".app-sidebar__link:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }",
    ".app-main-shell { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; }",
    ".app-main-toolbar { display: flex; justify-content: flex-start; padding: 1rem 2rem 0; }",
    ".app-shell-toolbar-toggle { padding: 0.65rem 0.95rem; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.26); background: rgba(255, 255, 255, 0.9); color: #334155; font-size: 0.92rem; box-shadow: none; }",
    ".app-shell-toolbar-toggle:hover { background: #fff; }",
    ".app-main-content { padding: 2rem; min-width: 0; }",
    ".app-surface { background: #fff; border: 1px solid var(--theme-border); border-radius: 1.25rem; padding: 1.75rem; box-shadow: var(--theme-shadow-sm); }",
    ".app-surface > article:first-child { background: transparent; border: 0; border-radius: 0; padding: 0; box-shadow: none; }",
  ".settings-shell { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 1.5rem; align-items: start; min-height: 0; }",
  ".settings-shell__content { display: grid; gap: 1.25rem; min-width: 0; }",
  ".settings-sidebar { position: sticky; top: 1.5rem; display: grid; gap: 1rem; align-self: start; min-width: 0; }",
  ".settings-sidebar__panel { display: grid; gap: 1rem; min-width: 0; }",
  ".settings-sidebar__nav { display: grid; gap: 0.7rem; min-width: 0; min-height: 0; max-height: calc(100vh - 12rem); overflow-y: auto; overscroll-behavior: contain; padding-right: 0.2rem; }",
  ".settings-sidebar__link { display: grid; gap: 0.2rem; min-width: 0; padding: 0.95rem 1rem; border-radius: 1rem; border: 1px solid rgba(148, 163, 184, 0.2); background: #f8fafc; color: #1f2937; }",
    ".settings-sidebar__link:hover { border-color: rgba(154, 0, 115, 0.22); background: rgba(154, 0, 115, 0.05); }",
    ".settings-sidebar__link.is-active { border-color: rgba(154, 0, 115, 0.35); background: linear-gradient(135deg, rgba(154, 0, 115, 0.08) 0%, rgba(10, 154, 156, 0.06) 100%); }",
  ".settings-sidebar__link-label { font-weight: 700; overflow-wrap: anywhere; }",
  ".settings-sidebar__link-meta { color: #64748b; font-size: 0.88rem; overflow-wrap: anywhere; }",
  ".settings-sidebar__panel--meta { gap: 0.6rem; }",
    ".settings-notice { border-left: 4px solid transparent; }",
    ".settings-notice--success { border-left-color: #16a34a; background: linear-gradient(135deg, rgba(22, 163, 74, 0.07) 0%, #fff 55%); }",
    ".settings-notice--danger { border-left-color: #dc2626; background: linear-gradient(135deg, rgba(220, 38, 38, 0.07) 0%, #fff 55%); }",
    ".settings-notice--info { border-left-color: #2563eb; background: linear-gradient(135deg, rgba(37, 99, 235, 0.07) 0%, #fff 55%); }",
    ".settings-console { display: grid; gap: 1.5rem; }",
    ".settings-console__hero { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr); gap: 1.25rem; align-items: start; }",
    ".settings-console__hero-meta { display: grid; gap: 0.85rem; }",
    ".settings-console__hero-meta > div { padding: 1rem 1.05rem; border-radius: 1rem; border: 1px solid rgba(148, 163, 184, 0.2); background: linear-gradient(135deg, rgba(154, 0, 115, 0.06) 0%, rgba(10, 154, 156, 0.05) 100%); }",
    ".settings-console__hero-meta span { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }",
    ".settings-console__hero-meta strong { display: block; margin-top: 0.35rem; color: #1f2937; }",
    ".settings-summary-grid .summary-grid { margin: 0; }",
    ".settings-console-toolbar { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: end; }",
    ".settings-console-search { min-width: min(100%, 420px); flex: 1 1 320px; }",
    ".settings-console-search span { display: block; margin-bottom: 0.2rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }",
    ".settings-console-filters { display: flex; gap: 0.75rem; flex-wrap: wrap; }",
    ".settings-filter-pill { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0.95rem; border-radius: 999px; background: #f8fafc; border: 1px solid rgba(148, 163, 184, 0.22); font-weight: 600; color: #374151; }",
    ".settings-filter-pill input { width: auto; margin: 0; }",
    ".settings-readiness-panel { display: grid; gap: 1.25rem; }",
    ".settings-readiness-panel .summary-grid { margin: 0; }",
    ".settings-readiness-grid { display: grid; gap: 1.25rem; }",
    ".settings-readiness-list { margin: 0.5rem 0 0 1.1rem; display: grid; gap: 0.45rem; }",
    ".settings-launch-strip { display: grid; gap: 1rem; padding: 1.4rem; border-radius: 1.25rem; border: 1px solid rgba(245, 158, 11, 0.26); background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(255, 255, 255, 0.96) 55%, rgba(154, 0, 115, 0.04) 100%); }",
    ".settings-launch-grid, .settings-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }",
    ".settings-card { display: grid; gap: 1rem; padding: 1.25rem; border-radius: 1.1rem; border: 1px solid rgba(148, 163, 184, 0.22); background: #fff; box-shadow: var(--theme-shadow-sm); }",
    ".settings-card__header { display: grid; gap: 0.9rem; }",
    ".settings-card__header h3 { margin-bottom: 0.35rem; }",
    ".settings-card__header .section-copy { margin-bottom: 0; font-size: 0.95rem; }",
    ".settings-badge-row { display: flex; flex-wrap: wrap; gap: 0.45rem; }",
    ".settings-card__meta-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.8rem; }",
    ".settings-card__meta-grid span { display: block; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }",
    ".settings-card__meta-grid strong { display: block; margin-top: 0.35rem; color: #1f2937; font-weight: 600; }",
    ".settings-value-preview { color: #1f2937; font-weight: 600; word-break: break-word; }",
    ".settings-value-preview--masked { color: #7c2d12; }",
    ".settings-value-preview--empty { color: #92400e; }",
    ".settings-card__footer { display: flex; justify-content: space-between; gap: 1rem; align-items: end; flex-wrap: wrap; }",
    ".settings-card__usage { display: flex; flex-direction: column; gap: 0.35rem; color: #64748b; font-size: 0.9rem; }",
    ".settings-card__action { font-weight: 700; }",
    ".settings-category-section { display: grid; gap: 1rem; }",
    ".settings-empty-state { padding: 1.4rem; border-radius: 1.15rem; border: 1px dashed rgba(148, 163, 184, 0.45); background: #f8fafc; }",
    ".settings-inline-form { display: grid; gap: 0.65rem; }",
    ".settings-inline-form label { font-size: 0.92rem; font-weight: 500; color: #475569; }",
    ".settings-inline-form input { display: inline-block; width: auto; margin-right: 0.45rem; }",
    ".settings-inline-form button { width: fit-content; box-shadow: none; padding: 0.7rem 0.95rem; }",
    ".settings-admin-form .form-actions { grid-column: 1 / -1; }",
    ".settings-detail-shell { display: grid; gap: 1.5rem; }",
    ".settings-detail-hero { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: start; }",
    ".settings-detail-hero__copy h1 { margin-bottom: 0.6rem; }",
    ".settings-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }",
    ".settings-usage-list { display: grid; gap: 0.75rem; padding-left: 1.1rem; margin: 0; color: #475569; }",
    ".settings-current-value-panel { padding: 1rem 1.05rem; border-radius: 1rem; border: 1px solid rgba(148, 163, 184, 0.2); background: #f8fafc; margin-bottom: 0.8rem; }",
    ".settings-editor-shell .quick-link-card { box-shadow: none; }",
  "@media (max-width: 960px) { .app-layout, .app-layout.is-sidebar-collapsed, .auth-shell { grid-template-columns: 1fr; } .app-mobile-navbar { display: flex; } .app-sidebar { display: none; padding-top: 1rem; } .app-layout.is-sidebar-open .app-sidebar { display: block; } .app-main-shell { display: block; } .app-main-toolbar { display: none; } .app-main-content, .auth-main, .auth-shell__hero, .auth-shell__panel { padding: 1rem; } .navbar { flex-direction: column; align-items: flex-start; } .form-grid--two, .settings-shell, .settings-console__hero, .settings-detail-grid, .settings-card__meta-grid { grid-template-columns: 1fr; } .settings-sidebar { position: static; } .settings-sidebar__nav { max-height: none; overflow: visible; padding-right: 0; } .marketing-hero__grid, .about-panel__grid, .contact-panel__grid, .booking-shell__grid, .article-shell, .program-grid, .resource-grid, .process-grid, .story-grid, .testimonial-grid, .service-overview-grid, .featured-story__layout { grid-template-columns: 1fr; } .settings-console-toolbar, .settings-card__footer, .settings-detail-hero { align-items: stretch; } .public-cta-banner { flex-direction: column; align-items: flex-start; } .hero-media-frame { min-height: 280px; } .public-site-footer__inner { align-items: flex-start; } .public-social-slot--footer { justify-items: start; } }",
    "@media (max-width: 767.98px) { .data-table__toolbar, .data-table__pagination { padding-left: 0.85rem; padding-right: 0.85rem; } .data-table__status, .enhanced-collection__status { justify-content: flex-start; } .enhanced-collection__toolbar { align-items: stretch; } .data-table thead { display: none; } .data-table table, .data-table tbody, .data-table tr, .data-table td { display: block; width: 100%; } .data-table tbody { display: grid; gap: 0.75rem; padding: 0.85rem; } .data-table tbody tr { overflow: hidden; border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 0.95rem; background: #fff; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); } .data-table tbody tr td { display: grid; grid-template-columns: minmax(0, 8rem) minmax(0, 1fr); gap: 0.75rem; align-items: start; } .data-table td::before { content: attr(data-label); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; } .data-table td:last-child { border-bottom: 0; } }",
    "@media (max-width: 767.98px) { .btn.public-theme-toggle { right: 1rem; left: auto; bottom: calc(5rem + env(safe-area-inset-bottom, 0px)); } }",
    `${input.css ?? ""}`,
    "</style>",
    "</head>",
    "<body>",
    body,
    publicRuntimeScripts,
    "<script>",
    "(() => {",
    "  const desktopStorageKey = 'bdta-app-sidebar-collapsed';",
    "  const layout = document.querySelector('[data-app-layout]');",
    "  const mobileToggle = document.querySelector('[data-app-shell-toggle]');",
    "  const desktopToggle = document.querySelector('[data-app-desktop-shell-toggle]');",
    "  const sidebar = document.querySelector('[data-app-sidebar]');",
    "  if (!(layout instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) {",
    "    return;",
    "  }",
    "  const media = window.matchMedia('(max-width: 960px)');",
    "  let desktopCollapsed = false;",
    "  const setMobileExpanded = (expanded) => {",
    "    layout.classList.toggle('is-sidebar-open', expanded);",
    "    if (mobileToggle instanceof HTMLButtonElement) {",
    "      mobileToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');",
    "      mobileToggle.textContent = expanded ? 'Close' : 'Menu';",
    "    }",
    "  };",
    "  const readDesktopCollapsed = () => {",
    "    try {",
    "      return window.localStorage.getItem(desktopStorageKey) === 'true';",
    "    } catch {",
    "      return false;",
    "    }",
    "  };",
    "  const writeDesktopCollapsed = (value) => {",
    "    try {",
    "      window.localStorage.setItem(desktopStorageKey, value ? 'true' : 'false');",
    "    } catch {",
    "      return;",
    "    }",
    "  };",
    "  const applyDesktopCollapsed = () => {",
    "    const collapsed = media.matches ? false : desktopCollapsed;",
    "    layout.classList.toggle('is-sidebar-collapsed', collapsed);",
    "    if (desktopToggle instanceof HTMLButtonElement) {",
    "      desktopToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');",
    "      desktopToggle.textContent = collapsed ? 'Show Menu' : 'Hide Menu';",
    "    }",
    "  };",
    "  desktopCollapsed = readDesktopCollapsed();",
    "  setMobileExpanded(false);",
    "  applyDesktopCollapsed();",
    "  if (mobileToggle instanceof HTMLButtonElement) {",
    "    mobileToggle.addEventListener('click', () => {",
    "      setMobileExpanded(!layout.classList.contains('is-sidebar-open'));",
    "    });",
    "  }",
    "  if (desktopToggle instanceof HTMLButtonElement) {",
    "    desktopToggle.addEventListener('click', () => {",
    "      desktopCollapsed = !desktopCollapsed;",
    "      writeDesktopCollapsed(desktopCollapsed);",
    "      applyDesktopCollapsed();",
    "    });",
    "  }",
    "  for (const link of sidebar.querySelectorAll('a')) {",
    "    link.addEventListener('click', () => {",
    "      if (media.matches) {",
    "        setMobileExpanded(false);",
    "      }",
    "    });",
    "  }",
    "  const syncLayout = () => {",
    "    if (!media.matches) {",
    "      setMobileExpanded(false);",
    "    }",
    "    applyDesktopCollapsed();",
    "  };",
    "  if (typeof media.addEventListener === 'function') {",
    "    media.addEventListener('change', syncLayout);",
    "  } else if (typeof media.addListener === 'function') {",
    "    media.addListener(syncLayout);",
    "  }",
" const enhanceDynamicContent = (root = document) => {",
" const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');",
" const revealElements = Array.from(root.querySelectorAll('.surface-block, .summary-card, .quick-link-card, .detail-card, .data-table, .portal-card, .blog-card')).filter((element) => element instanceof HTMLElement && element.closest('[data-no-reveal]') == null);",
" if (prefersReducedMotion.matches || !('IntersectionObserver' in window)) {",
" for (const [index, element] of revealElements.entries()) {",
" element.classList.add('is-visible');",
" element.style.setProperty('--reveal-delay', `${(index % 6) * 35}ms`);",
" }",
" } else {",
" const observer = new IntersectionObserver((entries) => {",
" for (const entry of entries) {",
" if (entry.target instanceof HTMLElement && entry.isIntersecting) {",
" entry.target.classList.add('is-visible');",
" observer.unobserve(entry.target);",
" }",
" }",
" }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });",
" for (const [index, element] of revealElements.entries()) {",
" element.classList.add('reveal-on-scroll');",
" element.style.setProperty('--reveal-delay', `${(index % 6) * 35}ms`);",
" observer.observe(element);",
" }",
" }",
" for (const container of root.querySelectorAll('[data-enhanced-table]')) {",
" if (!(container instanceof HTMLElement) || container.dataset.enhancedTable === 'true') {",
" continue;",
" }",
" container.dataset.enhancedTable = 'true';",
" const table = container.querySelector('table');",
" const tbody = table?.tBodies.item(0) ?? null;",
" if (!(table instanceof HTMLTableElement) || !(tbody instanceof HTMLTableSectionElement)) {",
" continue;",
" }",
" const rows = Array.from(tbody.rows);",
" if (rows.length === 0) {",
" continue;",
" }",
" const toolbar = container.querySelector('[data-enhanced-table-toolbar]');",
" const searchInput = container.querySelector('[data-enhanced-table-search]');",
" const pageSizeSelect = container.querySelector('[data-enhanced-table-page-size]');",
" const summary = container.querySelector('[data-enhanced-table-summary]');",
" const pagination = container.querySelector('[data-enhanced-table-pagination]');",
" const pageCount = container.querySelector('[data-enhanced-table-page-count]');",
" const prevButton = container.querySelector('[data-enhanced-table-prev]');",
" const nextButton = container.querySelector('[data-enhanced-table-next]');",
" const emptyState = container.querySelector('[data-enhanced-table-empty]');",
" const headers = Array.from(table.querySelectorAll('thead th')).map((header) => {",
" const label = header.querySelector('.data-table__sort-button span')?.textContent ?? header.textContent ?? '';",
" return label.replace(/\\s+/g, ' ').trim();",
" }).filter((header) => header !== '');",
" if (toolbar instanceof HTMLElement) {",
" toolbar.hidden = false;",
" }",
" if (searchInput instanceof HTMLInputElement) {",
" searchInput.placeholder = headers.length === 0 ? 'Search this table' : `Search ${headers.slice(0, 3).join(', ').toLowerCase()}`;",
" }",
" const sortButtons = Array.from(container.querySelectorAll('[data-enhanced-table-sort]'));",
" const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });",
" const parseSortableValue = (value) => {",
" const normalized = (value ?? '').replace(/\\s+/g, ' ').trim();",
" const lowered = normalized.toLowerCase();",
" if (normalized === '') {",
" return { kind: 'empty', text: '', number: null };",
" }",
" const looksLikeDate = normalized.endsWith(' UTC') || /\\b[A-Za-z]{3,9} \\d{1,2}, \\d{4}\\b/.test(normalized) || /^\\d{4}-\\d{2}-\\d{2}(?:[t\\s].*)?$/i.test(normalized) || /^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}(?:, \\d{1,2}:\\d{2}(?::\\d{2})? ?(?:AM|PM))?(?: UTC)?$/i.test(normalized);",
" if (looksLikeDate) {",
" const timestamp = Date.parse(normalized);",
" if (Number.isFinite(timestamp)) {",
" return { kind: 'date', text: lowered, number: timestamp };",
" }",
" }",
" const numericCandidate = normalized.replace(/[$,%]/g, '').replace(/,/g, '');",
" if (/^-?\\d+(?:\\.\\d+)?$/.test(numericCandidate)) {",
" return { kind: 'number', text: lowered, number: Number.parseFloat(numericCandidate) };",
" }",
" return { kind: 'text', text: lowered, number: null };",
" };",
" const indexedRows = rows.map((row, index) => ({",
" row,",
" originalIndex: index,",
" text: Array.from(row.cells).map((cell) => (cell.textContent ?? '').replace(/\\s+/g, ' ').trim().toLowerCase()).join(' '),",
" sortValues: Array.from(row.cells).map((cell) => parseSortableValue(cell.dataset.sortValue ?? cell.textContent ?? ''))",
" }));",
" let query = '';",
" let currentPage = 1;",
" let pageSize = pageSizeSelect instanceof HTMLSelectElement ? Number.parseInt(pageSizeSelect.value, 10) || 10 : 10;",
" let sortColumn = -1;",
" let sortDirection = 'ascending';",
" const updateSortIndicators = () => {",
" for (const button of sortButtons) {",
" if (!(button instanceof HTMLButtonElement)) {",
" continue;",
" }",
" const buttonColumn = Number.parseInt(button.dataset.columnIndex ?? '-1', 10);",
" const direction = buttonColumn === sortColumn ? sortDirection : 'none';",
" button.setAttribute('aria-sort', direction);",
" const indicator = button.querySelector('.data-table__sort-indicator');",
" if (indicator instanceof HTMLElement) {",
" indicator.textContent = direction === 'ascending' ? '^' : direction === 'descending' ? 'v' : '-';",
" }",
" }",
" };",
" const render = () => {",
" const filtered = query === '' ? indexedRows : indexedRows.filter((entry) => entry.text.includes(query));",
" const ordered = sortColumn === -1",
" ? filtered",
" : [...filtered].sort((left, right) => {",
" const leftValue = left.sortValues[sortColumn] ?? { kind: 'empty', text: '', number: null };",
" const rightValue = right.sortValues[sortColumn] ?? { kind: 'empty', text: '', number: null };",
" const comparison = leftValue.number != null && rightValue.number != null",
" ? leftValue.number - rightValue.number",
" : collator.compare(leftValue.text ?? '', rightValue.text ?? '');",
" if (comparison !== 0) {",
" return sortDirection === 'ascending' ? comparison : -comparison;",
" }",
" return left.originalIndex - right.originalIndex;",
" });",
" const hiddenRows = indexedRows.filter((entry) => !filtered.includes(entry));",
" const total = ordered.length;",
" const totalPages = total === 0 ? 0 : Math.max(1, Math.ceil(total / pageSize));",
" currentPage = totalPages === 0 ? 1 : Math.min(currentPage, totalPages);",
" const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize;",
" const pageItems = ordered.slice(pageStart, pageStart + pageSize);",
" const filteredRows = new Set(filtered.map((entry) => entry.row));",
" const visibleRows = new Set(pageItems.map((entry) => entry.row));",
" for (const entry of [...ordered, ...hiddenRows]) {",
" tbody.appendChild(entry.row);",
" }",
" for (const { row } of indexedRows) {",
" row.hidden = !visibleRows.has(row);",
" row.classList.toggle('is-filtered-out', query !== '' && !filteredRows.has(row));",
" }",
" updateSortIndicators();",
" if (summary instanceof HTMLElement) {",
" summary.textContent = total === 0 ? (query === '' ? 'No rows available' : `No results for \"${query}\"`) : `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, total)} of ${total} rows`;",
" }",
" if (pageCount instanceof HTMLElement) {",
" pageCount.textContent = total === 0 ? 'Page 0 of 0' : `Page ${currentPage} of ${totalPages}`;",
" }",
" if (pagination instanceof HTMLElement) {",
" pagination.hidden = total <= pageSize;",
" }",
" if (prevButton instanceof HTMLButtonElement) {",
" prevButton.disabled = total === 0 || currentPage <= 1;",
" }",
" if (nextButton instanceof HTMLButtonElement) {",
" nextButton.disabled = total === 0 || currentPage >= totalPages;",
" }",
" if (emptyState instanceof HTMLElement) {",
" emptyState.hidden = total !== 0;",
" emptyState.textContent = query === '' ? (container.dataset.emptyMessage || 'No rows available.') : `No results match \"${query}\".`;",
" }",
" };",
" if (searchInput instanceof HTMLInputElement) {",
" searchInput.addEventListener('input', () => {",
" query = searchInput.value.trim().toLowerCase();",
" currentPage = 1;",
" render();",
" });",
" }",
" if (pageSizeSelect instanceof HTMLSelectElement) {",
" pageSizeSelect.addEventListener('change', () => {",
" pageSize = Number.parseInt(pageSizeSelect.value, 10) || 10;",
" currentPage = 1;",
" render();",
" });",
" }",
" for (const button of sortButtons) {",
" if (!(button instanceof HTMLButtonElement)) {",
" continue;",
" }",
" button.addEventListener('click', () => {",
" const nextColumn = Number.parseInt(button.dataset.columnIndex ?? '-1', 10);",
" if (nextColumn < 0) {",
" return;",
" }",
" if (sortColumn === nextColumn) {",
" sortDirection = sortDirection === 'ascending' ? 'descending' : 'ascending';",
" } else {",
" sortColumn = nextColumn;",
" sortDirection = 'ascending';",
" }",
" currentPage = 1;",
" render();",
" });",
" }",
" if (prevButton instanceof HTMLButtonElement) {",
" prevButton.addEventListener('click', () => {",
" currentPage = Math.max(1, currentPage - 1);",
" render();",
" });",
" }",
" if (nextButton instanceof HTMLButtonElement) {",
" nextButton.addEventListener('click', () => {",
" currentPage += 1;",
" render();",
" });",
" }",
" render();",
" }",
" for (const container of root.querySelectorAll('[data-enhanced-collection]')) {",
" if (!(container instanceof HTMLElement) || container.dataset.enhancedCollection === 'true') {",
" continue;",
" }",
" container.dataset.enhancedCollection = 'true';",
" const grid = container.querySelector('[data-enhanced-collection-grid]');",
" if (!(grid instanceof HTMLElement)) {",
" continue;",
" }",
" const items = Array.from(container.querySelectorAll('[data-enhanced-collection-item]')).filter((item) => item instanceof HTMLElement);",
" if (items.length === 0) {",
" continue;",
" }",
" const toolbar = container.querySelector('[data-enhanced-collection-toolbar]');",
" const searchInput = container.querySelector('[data-enhanced-collection-search]');",
" const pageSizeSelect = container.querySelector('[data-enhanced-collection-page-size]');",
" const summary = container.querySelector('[data-enhanced-collection-summary]');",
" const pagination = container.querySelector('[data-enhanced-collection-pagination]');",
" const pageCount = container.querySelector('[data-enhanced-collection-page-count]');",
" const prevButton = container.querySelector('[data-enhanced-collection-prev]');",
" const nextButton = container.querySelector('[data-enhanced-collection-next]');",
" const emptyState = container.querySelector('[data-enhanced-collection-empty]');",
" if (toolbar instanceof HTMLElement) {",
" toolbar.hidden = false;",
" }",
" const indexedItems = items.map((item) => ({",
" item,",
" text: (item.dataset.search || item.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase()",
" }));",
" let query = '';",
" let currentPage = 1;",
" let pageSize = pageSizeSelect instanceof HTMLSelectElement ? Number.parseInt(pageSizeSelect.value, 10) || Number.parseInt(container.dataset.defaultPageSize || '', 10) || 6 : Number.parseInt(container.dataset.defaultPageSize || '', 10) || 6;",
" const render = () => {",
" const filtered = query === '' ? indexedItems : indexedItems.filter((entry) => entry.text.includes(query));",
" const total = filtered.length;",
" const totalPages = total === 0 ? 0 : Math.max(1, Math.ceil(total / pageSize));",
" currentPage = totalPages === 0 ? 1 : Math.min(currentPage, totalPages);",
" const pageStart = total === 0 ? 0 : (currentPage - 1) * pageSize;",
" const pageItems = filtered.slice(pageStart, pageStart + pageSize);",
" const filteredItems = new Set(filtered.map((entry) => entry.item));",
" const visibleItems = new Set(pageItems.map((entry) => entry.item));",
" for (const { item } of indexedItems) {",
" item.hidden = !visibleItems.has(item);",
" item.classList.toggle('is-filtered-out', query !== '' && !filteredItems.has(item));",
" }",
" if (summary instanceof HTMLElement) {",
" summary.textContent = total === 0 ? (query === '' ? 'No items available' : `No results for \"${query}\"`) : `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, total)} of ${total} items`;",
" }",
" if (pageCount instanceof HTMLElement) {",
" pageCount.textContent = total === 0 ? 'Page 0 of 0' : `Page ${currentPage} of ${totalPages}`;",
" }",
" if (pagination instanceof HTMLElement) {",
" pagination.hidden = total <= pageSize;",
" }",
" if (prevButton instanceof HTMLButtonElement) {",
" prevButton.disabled = total === 0 || currentPage <= 1;",
" }",
" if (nextButton instanceof HTMLButtonElement) {",
" nextButton.disabled = total === 0 || currentPage >= totalPages;",
" }",
" if (emptyState instanceof HTMLElement) {",
" emptyState.hidden = total !== 0;",
" emptyState.textContent = query === '' ? (container.dataset.emptyMessage || 'No items available.') : `No results match \"${query}\".`;",
" }",
" };",
" if (searchInput instanceof HTMLInputElement) {",
" searchInput.addEventListener('input', () => {",
" query = searchInput.value.trim().toLowerCase();",
" currentPage = 1;",
" render();",
" });",
" }",
" if (pageSizeSelect instanceof HTMLSelectElement) {",
" pageSizeSelect.addEventListener('change', () => {",
" pageSize = Number.parseInt(pageSizeSelect.value, 10) || Number.parseInt(container.dataset.defaultPageSize || '', 10) || 6;",
" currentPage = 1;",
" render();",
" });",
" }",
" if (prevButton instanceof HTMLButtonElement) {",
" prevButton.addEventListener('click', () => {",
" currentPage = Math.max(1, currentPage - 1);",
" render();",
" });",
" }",
" if (nextButton instanceof HTMLButtonElement) {",
" nextButton.addEventListener('click', () => {",
" currentPage += 1;",
" render();",
" });",
" }",
" render();",
" }",
" };",
" window.__bdtaEnhanceDynamicContent = enhanceDynamicContent;",
" enhanceDynamicContent(document);",
" const resolveRefreshRoot = (scope) => scope.querySelector('[data-layout-main]') || scope.querySelector('main');",
" const replaceMainContent = (nextDocument, nextUrl) => {",
" const currentMain = resolveRefreshRoot(document);",
" const nextMain = resolveRefreshRoot(nextDocument);",
" if (!(currentMain instanceof HTMLElement) || !(nextMain instanceof HTMLElement)) {",
" window.location.assign(nextUrl);",
" return;",
" }",
" currentMain.innerHTML = nextMain.innerHTML;",
" if (typeof nextDocument.title === 'string' && nextDocument.title.trim() !== '') {",
" document.title = nextDocument.title;",
" }",
" if (nextUrl !== window.location.href) {",
" window.history.pushState({}, '', nextUrl);",
" }",
" window.scrollTo({ top: 0, behavior: 'auto' });",
" if (typeof window.__bdtaEnhanceDynamicContent === 'function') {",
" window.__bdtaEnhanceDynamicContent(currentMain);",
" }",
" };",
" const shouldEnhanceForm = (form) => {",
" if (!(form instanceof HTMLFormElement)) return false;",
" if (!(document.querySelector('[data-layout-main]') instanceof HTMLElement)) return false;",
" if ((form.method || 'get').toLowerCase() !== 'post') return false;",
" if (form.target && form.target !== '_self') return false;",
" if ((form.enctype || '').toLowerCase() === 'multipart/form-data') return false;",
" if (form.querySelector('input[type=\"file\"]')) return false;",
" const action = new URL(form.getAttribute('action') || window.location.href, window.location.origin);",
" if (action.origin !== window.location.origin) return false;",
" if (!action.pathname.startsWith('/admin') && !action.pathname.startsWith('/portal')) return false;",
" if (action.pathname.endsWith('/pay')) return false;",
" return !form.hasAttribute('data-no-async-refresh');",
" };",
" document.addEventListener('submit', (event) => {",
" if (event.defaultPrevented) return;",
" const form = event.target;",
" if (!shouldEnhanceForm(form)) return;",
" event.preventDefault();",
" const submitter = event.submitter instanceof HTMLButtonElement || event.submitter instanceof HTMLInputElement ? event.submitter : null;",
" const action = new URL(form.getAttribute('action') || window.location.href, window.location.origin);",
" const formData = new FormData(form);",
" if (submitter != null && submitter.name) {",
" formData.append(submitter.name, submitter.value);",
" }",
" const previousDisabled = submitter ? submitter.disabled : false;",
" if (submitter) {",
" submitter.disabled = true;",
" }",
" const body = new URLSearchParams();",
" for (const [key, value] of formData.entries()) {",
" body.append(key, String(value));",
" }",
" fetch(action.toString(), { method: 'POST', body, redirect: 'follow' })",
" .then(async (response) => {",
" const nextUrl = response.url || action.toString();",
" const nextPath = new URL(nextUrl, window.location.origin).pathname;",
" if (nextPath === '/admin/login' || nextPath === '/portal/login') {",
" window.location.assign(nextUrl);",
" return;",
" }",
" if (!response.ok) {",
" window.location.assign(nextUrl);",
" return;",
" }",
" const html = await response.text();",
" const nextDocument = new DOMParser().parseFromString(html, 'text/html');",
" replaceMainContent(nextDocument, nextUrl);",
" })",
" .catch(() => {",
" window.location.assign(action.toString());",
" })",
" .finally(() => {",
" if (submitter) {",
" submitter.disabled = previousDisabled;",
" }",
" });",
" });",
"})();",
    "</script>",
    "</body>",
    "</html>"
  ].join("");

  if (variant === "public" && input.publicRenderAssets != null) {
    if (input.publicRenderFeatures?.includeNewsletterEmbed === true) {
      html = injectNewsletterEmbedMarkup(html, input.publicRenderAssets.newsletterEmbedWrappedMarkup);
    }

    if (input.publicRenderFeatures?.includeTawkWidget === true) {
      html = injectMarkupBeforeFooterOrBody(html, input.publicRenderAssets.tawkWidgetScript);
    }

    html = applyPublicSocialLinks(html, input.publicRenderAssets.socialLinks);
    html = syncPublicNavigationLinks(html, input.publicRenderContext?.requestPath);
    html = injectImportedPageRuntimeCss(html);
    html = injectPublicNoticeMarkup(html, input.publicRenderAssets.publicNoticeMarkup);
  }

  return html;
}

function renderPublicPageLayout(input: {
  title: string;
  description?: string;
  css?: string;
  body: string;
  publicRenderAssets: PublicRenderAssets;
  includeNewsletterEmbed?: boolean;
  includeTawkWidget?: boolean;
  requestPath?: string;
}): string {
  return renderLayout({
    title: input.title,
    description: input.description,
    css: input.css,
    variant: "public",
    body: input.body,
    publicRenderAssets: input.publicRenderAssets,
    publicRenderFeatures: {
      includeNewsletterEmbed: input.includeNewsletterEmbed === true,
      includeTawkWidget: input.includeTawkWidget !== false
    },
    publicRenderContext: {
      requestPath: input.requestPath
    }
  });
}

function writeHtml(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body).toString(),
    ...headers
  });
  response.end(body);
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

function redirect(
  response: ServerResponse,
  location: string,
  headers: Record<string, string> = {},
  statusCode = 302
): void {
  response.writeHead(statusCode, {
    location,
    ...headers
  });
  response.end();
}

function readCookieValue(request: IncomingMessage, cookieName: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (cookieHeader == null || cookieHeader.trim() === "") {
    return null;
  }

  for (const fragment of cookieHeader.split(";")) {
    const [name, ...valueParts] = fragment.trim().split("=");
    if (name === cookieName) {
      const value = valueParts.join("=").trim();
      return value === "" ? null : value;
    }
  }

  return null;
}

function readSessionIdFromCookie(request: IncomingMessage): string | null {
  return readCookieValue(request, "bdta_session");
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = (await readRawBody(request)).toString("utf8").trim();
  if (raw === "") {
    return {};
  }

  return JSON.parse(raw);
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

function readRequiredFormValue(form: URLSearchParams, key: string): string {
  return form.get(key)?.trim() ?? "";
}

function readOptionalFormValue(form: URLSearchParams, key: string): string | null {
  const value = form.get(key)?.trim() ?? "";
  return value === "" ? null : value;
}

function readOptionalTimestampFormValue(form: URLSearchParams, key: string): string | null {
  const value = readOptionalFormValue(form, key);
  if (value == null) {
    return null;
  }

  if (value.endsWith("Z")) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readCheckedFormValue(form: URLSearchParams, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

function readIntegerFormValue(form: URLSearchParams, key: string, fallback: number): number {
  const value = form.get(key)?.trim() ?? "";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloatFormValue(form: URLSearchParams, key: string, fallback: number): number {
  const value = form.get(key)?.trim() ?? "";
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDelimitedFormValues(form: URLSearchParams, key: string): string[] {
  const values = form.getAll(key);
  if (values.length > 1) {
    return values.map((value) => value.trim()).filter((value) => value !== "");
  }

  return (form.get(key) ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function readIntegerListFormValues(form: URLSearchParams, key: string): number[] {
  return readDelimitedFormValues(form, key)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));
}

function readJsonArrayFormValue(form: URLSearchParams, key: string): Array<Record<string, unknown>> {
  const value = form.get(key)?.trim() ?? "";
  if (value === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item != null) : [];
  } catch {
    return [];
  }
}

function readJsonRecordFormValue(form: URLSearchParams, key: string): Record<string, { start: string; end: string }> {
  const value = form.get(key)?.trim() ?? "";
  if (value === "") {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed != null && !Array.isArray(parsed)
      ? parsed as Record<string, { start: string; end: string }>
      : {};
  } catch {
    return {};
  }
}

const APPOINTMENT_DAY_OPTIONS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" }
] as const;

const APPOINTMENT_LOCATION_OPTIONS = [
  "client_address",
  "custom_address",
  "phone_inbound",
  "phone_outbound",
  "webcall"
] as const;

const FORM_TEMPLATE_TYPE_OPTIONS = [
  {
    value: "booking_form",
    label: "Booking Form",
    description: "Completed during the booking flow and stored on the client profile."
  },
  {
    value: "follow_up_note",
    label: "Follow-up Note Form",
    description: "Completed by admin after an appointment and stored with the appointment."
  },
  {
    value: "client_form",
    label: "Client Form",
    description: "Sent to an existing client and stored on the client profile."
  },
  {
    value: "pet_form",
    label: "Pet Form",
    description: "Admin-only notes form intended for pet-specific documentation."
  },
  {
    value: "survey_form",
    label: "Survey Form",
    description: "Client-facing survey that can be shared by link or surfaced in the portal."
  }
] as const;

const FORM_TEMPLATE_REQUIRED_FREQUENCY_OPTIONS = [
  { value: "", label: "Optional" },
  { value: "once", label: "Once (ever)" },
  { value: "yearly", label: "Once per year" },
  { value: "per_appointment", label: "Per appointment type" },
  { value: "once_per_pet", label: "Once per pet" }
] as const;

function formatFormTemplateTypeLabel(formType: string | null | undefined): string {
  switch (formType) {
    case "booking_form":
      return "Booking Form";
    case "follow_up_note":
    case "session_note":
      return "Follow-up Note Form";
    case "client_form":
    case "behavior_assessment":
    case "training_plan":
      return "Client Form";
    case "pet_form":
      return "Pet Form";
    case "survey_form":
      return "Survey Form";
    default:
      return formType == null || formType.trim() === "" ? "Unspecified" : toTitleCase(formType.replaceAll("_", " "));
  }
}

type AdminFormRequestType = "booking_form" | "follow_up_note" | "client_form" | "pet_form" | "survey_form";

function normalizeAdminFormRequestType(formType: string | null | undefined): AdminFormRequestType {
  switch ((formType ?? "").trim().toLowerCase()) {
    case "booking_form":
      return "booking_form";
    case "follow_up_note":
    case "session_note":
      return "follow_up_note";
    case "pet_form":
      return "pet_form";
    case "survey_form":
      return "survey_form";
    case "behavior_assessment":
    case "training_plan":
    case "client_form":
    default:
      return "client_form";
  }
}

function getAdminFormRequestTypeDescription(formType: AdminFormRequestType): string {
  switch (formType) {
    case "booking_form":
      return "Completed by clients during the booking flow and stored on the client profile.";
    case "follow_up_note":
      return "Completed by admin after an appointment and stored with the appointment for reference.";
    case "client_form":
      return "Sent to an existing client to complete and stored on the client profile for both admin and client.";
    case "pet_form":
      return "Admin-only notes form intended for pet-specific documentation.";
    case "survey_form":
      return "Client-facing survey that can be shared by link or surfaced in the client portal.";
  }
}

function isAdminFormRequestInternalOnly(formType: AdminFormRequestType): boolean {
  return formType === "follow_up_note" || formType === "pet_form";
}

function getAdminFormRequestTemplateTypes(formType: AdminFormRequestType): string[] {
  switch (formType) {
    case "booking_form":
      return [];
    case "follow_up_note":
      return ["follow_up_note", "session_note"];
    case "client_form":
      return ["client_form", "behavior_assessment", "training_plan"];
    case "pet_form":
      return ["pet_form"];
    case "survey_form":
      return ["survey_form"];
  }
}

function matchesAdminFormRequestTemplateType(templateType: string | null | undefined, requestType: AdminFormRequestType): boolean {
  return getAdminFormRequestTemplateTypes(requestType).includes((templateType ?? "").trim().toLowerCase());
}

function formatAdminClientOptionLabel(client: { firstName: string; lastName: string; email: string }): string {
  const fullName = `${client.firstName} ${client.lastName}`.trim();
  if (fullName === "") {
    return client.email;
  }

  return client.email.trim() === "" ? fullName : `${fullName} (${client.email})`;
}

function buildLegacyPublicBookingRequestUrl(origin: string, uniqueLink: string): string {
  const path = `/backend/public/book.php?link=${encodeURIComponent(uniqueLink)}`;
  return origin === "" ? path : `${origin}${path}`;
}

function buildLegacyPublicFormRequestUrl(origin: string, submission: FormSubmission): string {
  const path = submission.publicAccess?.token != null && submission.publicAccess.token.trim() !== ""
    ? `/backend/public/form.php?token=${encodeURIComponent(submission.publicAccess.token)}`
    : `/backend/public/form.php?id=${encodeURIComponent(submission.id)}`;
  return origin === "" ? path : `${origin}${path}`;
}

function buildAdminFormRequestBackPath(input: {
  clientId?: string | null;
  petId?: string | null;
  appointmentTypeId?: string | null;
}): string {
  if (input.petId != null && input.petId.trim() !== "") {
    return `/admin/pets/${encodeURIComponent(input.petId)}`;
  }
  if (input.clientId != null && input.clientId.trim() !== "") {
    return `/admin/clients/${encodeURIComponent(input.clientId)}/profile`;
  }
  if (input.appointmentTypeId != null && input.appointmentTypeId.trim() !== "") {
    return `/client/appointment_types_edit.php?id=${encodeURIComponent(input.appointmentTypeId)}`;
  }

  return "/client/form_templates_list.php";
}

function formatFormTemplateRequiredFrequencyLabel(requiredFrequency: string | null | undefined): string {
  switch (requiredFrequency) {
    case "once":
      return "Once (ever)";
    case "yearly":
      return "Once per year";
    case "per_appointment":
      return "Per appointment type";
    case "once_per_pet":
      return "Once per pet";
    default:
      return "Optional";
  }
}

function filterAdminFormTemplates<T extends {
  formType?: string;
  templateIsInternal?: boolean | null;
}>(items: T[], typeFilter: string): T[] {
  switch (typeFilter) {
    case "all":
      return items;
    case "client":
      return items.filter((item) => item.templateIsInternal !== true);
    case "internal":
      return items.filter((item) => item.templateIsInternal === true);
    default:
      return items.filter((item) => item.formType === typeFilter);
  }
}

function buildFormTemplateFilterPath(basePath: string, typeFilter: string): string {
  return typeFilter === "all" ? basePath : `${basePath}?type=${encodeURIComponent(typeFilter)}`;
}

function renderCheckboxGroup(name: string, options: ReadonlyArray<{ value: string | number; label: string }>, selected: ReadonlyArray<string | number>): string {
  const selectedValues = new Set(selected.map((value) => String(value)));
  return options.map((option) => (
    `<label><input type="checkbox" name="${escapeAttribute(name)}" value="${escapeAttribute(String(option.value))}"${selectedValues.has(String(option.value)) ? " checked" : ""}> ${escapeHtml(option.label)}</label>`
  )).join("");
}

function renderAdminAppointmentTypeEditor(appointmentType: {
  id: string;
  name: string;
  description: string;
  bulletPoints: string[];
  adminUserId: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  useTravelTimeBuffer: boolean;
  travelTimeMinutes: number;
  advanceBookingMinDays: number;
  advanceBookingMaxDays: number;
  cancellationNoticeHours: number;
  requiresForms: boolean;
  formTemplateIds: string[];
  requiresContract: boolean;
  contractTemplateId: string | null;
  autoInvoice: boolean;
  invoiceDueDays: number;
  invoiceDueTiming: string;
  defaultAmount: number;
  consumesCredits: boolean;
  creditCount: number;
  isGroupClass: boolean;
  maxParticipants: number;
  publicAvailable: boolean;
  portalAvailable: boolean;
  scheduleType: string;
  specificDate: string | null;
  specificDates: Array<Record<string, unknown>>;
  availableDays: number[];
  availableStartTime: string;
  availableEndTime: string;
  timeSlotInterval: number;
  perDaySchedule: Record<string, { start: string; end: string }>;
  isMiniSession: boolean;
  miniSessionLocation: string;
  miniSessionTopic: string;
  isFieldRental: boolean;
  fieldRentalLocation: string;
  groupClassLocation: string;
  locationTypes: string[];
  confirmationTemplateId: string | null;
  bookingRequestTemplateId: string | null;
  invoiceTemplateId: string | null;
  reminderTemplateId: string | null;
  cancellationTemplateId: string | null;
  requiresAdminConfirmation: boolean;
  usesResource: boolean;
  resourceName: string;
  resourceCapacity: number;
  resourceAllocation: string;
  uniqueLink: string;
  active: boolean;
} | null, action: string): string {
  const item = appointmentType ?? {
    id: "",
    name: "",
    description: "",
    bulletPoints: [],
    adminUserId: null,
    durationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    useTravelTimeBuffer: false,
    travelTimeMinutes: 0,
    advanceBookingMinDays: 1,
    advanceBookingMaxDays: 90,
    cancellationNoticeHours: 0,
    requiresForms: false,
    formTemplateIds: [],
    requiresContract: false,
    contractTemplateId: null,
    autoInvoice: false,
    invoiceDueDays: 7,
    invoiceDueTiming: "after",
    defaultAmount: 0,
    consumesCredits: false,
    creditCount: 1,
    isGroupClass: false,
    maxParticipants: 1,
    publicAvailable: false,
    portalAvailable: false,
    scheduleType: "recurring",
    specificDate: null,
    specificDates: [],
    availableDays: [0, 1, 2, 3, 4, 5, 6],
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
    locationTypes: [],
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
    uniqueLink: "",
    active: true
  };

  return [
    '<section class="surface-block">',
    `<h2>${appointmentType == null ? "Create Appointment Type" : "Edit Appointment Type"}</h2>`,
    `<form class="form-grid" method="post" action="${escapeAttribute(action)}">`,
    '<div class="form-grid form-grid--two">',
    `<label>Name<input type="text" name="name" value="${escapeAttribute(item.name)}" required></label>`,
    `<label>Unique Link<input type="text" name="uniqueLink" value="${escapeAttribute(item.uniqueLink)}" required></label>`,
    `<label>Assigned Admin ID<input type="text" name="adminUserId" value="${escapeAttribute(item.adminUserId ?? "")}"></label>`,
    `<label>Schedule Type<select name="scheduleType"><option value="recurring"${item.scheduleType === "recurring" ? " selected" : ""}>Recurring</option><option value="specific_date"${item.scheduleType === "specific_date" ? " selected" : ""}>Specific Date</option></select></label>`,
    `<label>Duration Minutes<input type="number" name="durationMinutes" value="${item.durationMinutes}" min="1" required></label>`,
    `<label>Default Amount<input type="number" name="defaultAmount" value="${item.defaultAmount}" min="0" step="0.01"></label>`,
    `<label>Buffer Before<input type="number" name="bufferBeforeMinutes" value="${item.bufferBeforeMinutes}" min="0"></label>`,
    `<label>Buffer After<input type="number" name="bufferAfterMinutes" value="${item.bufferAfterMinutes}" min="0"></label>`,
    `<label>Travel Time Minutes<input type="number" name="travelTimeMinutes" value="${item.travelTimeMinutes}" min="0"></label>`,
    `<label>Advance Min Days<input type="number" name="advanceBookingMinDays" value="${item.advanceBookingMinDays}" min="0"></label>`,
    `<label>Advance Max Days<input type="number" name="advanceBookingMaxDays" value="${item.advanceBookingMaxDays}" min="0"></label>`,
    `<label>Cancellation Notice Hours<input type="number" name="cancellationNoticeHours" value="${item.cancellationNoticeHours}" min="0"></label>`,
    `<label>Invoice Due Days<input type="number" name="invoiceDueDays" value="${item.invoiceDueDays}" min="0"></label>`,
    `<label>Invoice Timing<select name="invoiceDueTiming"><option value="after"${item.invoiceDueTiming === "after" ? " selected" : ""}>After</option><option value="before"${item.invoiceDueTiming === "before" ? " selected" : ""}>Before</option></select></label>`,
    `<label>Credit Count<input type="number" name="creditCount" value="${item.creditCount}" min="1"></label>`,
    `<label>Max Participants<input type="number" name="maxParticipants" value="${item.maxParticipants}" min="1"></label>`,
    `<label>Specific Date<input type="date" name="specificDate" value="${escapeAttribute(item.specificDate ?? "")}"></label>`,
    `<label>Available Start<input type="time" name="availableStartTime" value="${escapeAttribute(item.availableStartTime)}"></label>`,
    `<label>Available End<input type="time" name="availableEndTime" value="${escapeAttribute(item.availableEndTime)}"></label>`,
    `<label>Time Slot Interval<input type="number" name="timeSlotInterval" value="${item.timeSlotInterval}" min="1"></label>`,
    `<label>Resource Capacity<input type="number" name="resourceCapacity" value="${item.resourceCapacity}" min="1"></label>`,
    `<label>Resource Allocation<select name="resourceAllocation"><option value="per_appointment"${item.resourceAllocation === "per_appointment" ? " selected" : ""}>Per Appointment</option><option value="per_pet"${item.resourceAllocation === "per_pet" ? " selected" : ""}>Per Pet</option></select></label>`,
    "</div>",
    `<label>Description<textarea name="description">${escapeHtml(item.description)}</textarea></label>`,
    `<label>Bullet Points<textarea name="bulletPoints">${escapeHtml(item.bulletPoints.join("\n"))}</textarea></label>`,
    `<label>Form Template IDs<textarea name="formTemplateIds">${escapeHtml(item.formTemplateIds.join("\n"))}</textarea></label>`,
    `<label>Specific Dates JSON<textarea name="specificDates">${escapeHtml(JSON.stringify(item.specificDates, null, 2))}</textarea></label>`,
    `<label>Per-Day Schedule JSON<textarea name="perDaySchedule">${escapeHtml(JSON.stringify(item.perDaySchedule, null, 2))}</textarea></label>`,
    '<div class="form-grid form-grid--two">',
    `<label>Contract Template ID<input type="text" name="contractTemplateId" value="${escapeAttribute(item.contractTemplateId ?? "")}"></label>`,
    `<label>Confirmation Template ID<input type="text" name="confirmationTemplateId" value="${escapeAttribute(item.confirmationTemplateId ?? "")}"></label>`,
    `<label>Booking Request Template ID<input type="text" name="bookingRequestTemplateId" value="${escapeAttribute(item.bookingRequestTemplateId ?? "")}"></label>`,
    `<label>Invoice Template ID<input type="text" name="invoiceTemplateId" value="${escapeAttribute(item.invoiceTemplateId ?? "")}"></label>`,
    `<label>Reminder Template ID<input type="text" name="reminderTemplateId" value="${escapeAttribute(item.reminderTemplateId ?? "")}"></label>`,
    `<label>Cancellation Template ID<input type="text" name="cancellationTemplateId" value="${escapeAttribute(item.cancellationTemplateId ?? "")}"></label>`,
    `<label>Mini Session Location<input type="text" name="miniSessionLocation" value="${escapeAttribute(item.miniSessionLocation)}"></label>`,
    `<label>Mini Session Topic<input type="text" name="miniSessionTopic" value="${escapeAttribute(item.miniSessionTopic)}"></label>`,
    `<label>Field Rental Location<input type="text" name="fieldRentalLocation" value="${escapeAttribute(item.fieldRentalLocation)}"></label>`,
    `<label>Group Class Location<input type="text" name="groupClassLocation" value="${escapeAttribute(item.groupClassLocation)}"></label>`,
    `<label>Resource Name<input type="text" name="resourceName" value="${escapeAttribute(item.resourceName)}"></label>`,
    "</div>",
    '<div class="form-grid form-grid--two">',
    `<fieldset><legend>Available Days</legend>${renderCheckboxGroup("availableDays", APPOINTMENT_DAY_OPTIONS, item.availableDays)}</fieldset>`,
    `<fieldset><legend>Location Types</legend>${renderCheckboxGroup("locationTypes", APPOINTMENT_LOCATION_OPTIONS.map((value) => ({ value, label: toTitleCase(value.replaceAll("_", " ")) })), item.locationTypes)}</fieldset>`,
    "</div>",
    `<label><input type="checkbox" name="active"${item.active ? " checked" : ""}> Active</label>`,
    `<label><input type="checkbox" name="publicAvailable"${item.publicAvailable ? " checked" : ""}> Public Available</label>`,
    `<label><input type="checkbox" name="portalAvailable"${item.portalAvailable ? " checked" : ""}> Portal Available</label>`,
    `<label><input type="checkbox" name="useTravelTimeBuffer"${item.useTravelTimeBuffer ? " checked" : ""}> Use Travel Time Buffer</label>`,
    `<label><input type="checkbox" name="requiresForms"${item.requiresForms ? " checked" : ""}> Requires Forms</label>`,
    `<label><input type="checkbox" name="requiresContract"${item.requiresContract ? " checked" : ""}> Requires Contract</label>`,
    `<label><input type="checkbox" name="autoInvoice"${item.autoInvoice ? " checked" : ""}> Auto Invoice</label>`,
    `<label><input type="checkbox" name="consumesCredits"${item.consumesCredits ? " checked" : ""}> Consumes Credits</label>`,
    `<label><input type="checkbox" name="isGroupClass"${item.isGroupClass ? " checked" : ""}> Group Class</label>`,
    `<label><input type="checkbox" name="isMiniSession"${item.isMiniSession ? " checked" : ""}> Mini Session</label>`,
    `<label><input type="checkbox" name="isFieldRental"${item.isFieldRental ? " checked" : ""}> Field Rental</label>`,
    `<label><input type="checkbox" name="requiresAdminConfirmation"${item.requiresAdminConfirmation ? " checked" : ""}> Requires Admin Confirmation</label>`,
    `<label><input type="checkbox" name="usesResource"${item.usesResource ? " checked" : ""}> Uses Resource</label>`,
    `<div class="form-actions"><button type="submit">${appointmentType == null ? "Create Appointment Type" : "Save Appointment Type"}</button></div>`,
    "</form>",
    "</section>"
  ].join("");
}

function readAdminAppointmentTypeFormInput(form: URLSearchParams) {
  const availableDays = readIntegerListFormValues(form, "availableDays");

  return {
    name: readRequiredFormValue(form, "name"),
    description: form.get("description") ?? "",
    bulletPoints: readDelimitedFormValues(form, "bulletPoints"),
    adminUserId: readOptionalFormValue(form, "adminUserId"),
    durationMinutes: readIntegerFormValue(form, "durationMinutes", 60),
    bufferBeforeMinutes: readIntegerFormValue(form, "bufferBeforeMinutes", 0),
    bufferAfterMinutes: readIntegerFormValue(form, "bufferAfterMinutes", 0),
    useTravelTimeBuffer: readCheckedFormValue(form, "useTravelTimeBuffer"),
    travelTimeMinutes: readIntegerFormValue(form, "travelTimeMinutes", 0),
    advanceBookingMinDays: readIntegerFormValue(form, "advanceBookingMinDays", 1),
    advanceBookingMaxDays: readIntegerFormValue(form, "advanceBookingMaxDays", 90),
    cancellationNoticeHours: readIntegerFormValue(form, "cancellationNoticeHours", 0),
    requiresForms: readCheckedFormValue(form, "requiresForms"),
    formTemplateIds: readDelimitedFormValues(form, "formTemplateIds"),
    requiresContract: readCheckedFormValue(form, "requiresContract"),
    contractTemplateId: readOptionalFormValue(form, "contractTemplateId"),
    autoInvoice: readCheckedFormValue(form, "autoInvoice"),
    invoiceDueDays: readIntegerFormValue(form, "invoiceDueDays", 7),
    invoiceDueTiming: readRequiredFormValue(form, "invoiceDueTiming") || "after",
    defaultAmount: readFloatFormValue(form, "defaultAmount", 0),
    consumesCredits: readCheckedFormValue(form, "consumesCredits"),
    creditCount: readIntegerFormValue(form, "creditCount", 1),
    isGroupClass: readCheckedFormValue(form, "isGroupClass"),
    maxParticipants: readIntegerFormValue(form, "maxParticipants", 1),
    publicAvailable: readCheckedFormValue(form, "publicAvailable"),
    portalAvailable: readCheckedFormValue(form, "portalAvailable"),
    scheduleType: readRequiredFormValue(form, "scheduleType") || "recurring",
    specificDate: readOptionalFormValue(form, "specificDate"),
    specificDates: readJsonArrayFormValue(form, "specificDates"),
    availableDays: availableDays.length > 0 ? availableDays : [0, 1, 2, 3, 4, 5, 6],
    availableStartTime: readRequiredFormValue(form, "availableStartTime") || "09:00",
    availableEndTime: readRequiredFormValue(form, "availableEndTime") || "17:00",
    timeSlotInterval: readIntegerFormValue(form, "timeSlotInterval", 30),
    perDaySchedule: readJsonRecordFormValue(form, "perDaySchedule"),
    isMiniSession: readCheckedFormValue(form, "isMiniSession"),
    miniSessionLocation: form.get("miniSessionLocation") ?? "",
    miniSessionTopic: form.get("miniSessionTopic") ?? "",
    isFieldRental: readCheckedFormValue(form, "isFieldRental"),
    fieldRentalLocation: form.get("fieldRentalLocation") ?? "",
    groupClassLocation: form.get("groupClassLocation") ?? "",
    locationTypes: readDelimitedFormValues(form, "locationTypes"),
    confirmationTemplateId: readOptionalFormValue(form, "confirmationTemplateId"),
    bookingRequestTemplateId: readOptionalFormValue(form, "bookingRequestTemplateId"),
    invoiceTemplateId: readOptionalFormValue(form, "invoiceTemplateId"),
    reminderTemplateId: readOptionalFormValue(form, "reminderTemplateId"),
    cancellationTemplateId: readOptionalFormValue(form, "cancellationTemplateId"),
    requiresAdminConfirmation: readCheckedFormValue(form, "requiresAdminConfirmation"),
    usesResource: readCheckedFormValue(form, "usesResource"),
    resourceName: form.get("resourceName") ?? "",
    resourceCapacity: readIntegerFormValue(form, "resourceCapacity", 1),
    resourceAllocation: readRequiredFormValue(form, "resourceAllocation") || "per_appointment",
    uniqueLink: readRequiredFormValue(form, "uniqueLink"),
    active: readCheckedFormValue(form, "active")
  };
}

function renderAdminFormTemplateEditor(template: {
  id: string;
  name: string;
  active: boolean;
  description?: string;
  fields?: Array<Record<string, unknown>>;
  formType?: string;
  requiredFrequency?: string | null;
  appointmentTypeId?: string | null;
  templateIsInternal?: boolean | null;
  templateShowInClientPortal?: boolean | null;
} | null, action: string, appointmentTypes: Array<{ id: string; name: string }>, options: {
  anchorId?: string;
  defaultInternal?: boolean;
} = {}): string {
  const item = template ?? {
    id: "",
    name: "",
    active: true,
    description: "",
    fields: [],
    formType: "client_form",
    requiredFrequency: null,
    appointmentTypeId: null,
    templateIsInternal: options.defaultInternal === true,
    templateShowInClientPortal: true
  };

  return [
    `<section class="surface-block"${options.anchorId == null ? "" : ` id="${escapeAttribute(options.anchorId)}"`}>`,
    `<h2>${template == null ? "Create Form Template" : "Edit Form Template"}</h2>`,
    `<form class="form-grid" method="post" action="${escapeAttribute(action)}">`,
    '<div class="form-grid form-grid--two">',
    `<label>Name<input type="text" name="name" value="${escapeAttribute(item.name)}" required></label>`,
    `<label>Form Type<select name="formType">${FORM_TEMPLATE_TYPE_OPTIONS.map((option) => (
      `<option value="${option.value}"${item.formType === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )).join("")}</select></label>`,
    `<label>Required Frequency<select name="requiredFrequency">${FORM_TEMPLATE_REQUIRED_FREQUENCY_OPTIONS.map((option) => (
      `<option value="${escapeAttribute(option.value)}"${(item.requiredFrequency ?? "") === option.value ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )).join("")}</select></label>`,
    `<label>Appointment Type<select name="appointmentTypeId"><option value="">All appointment types</option>${appointmentTypes.map((appointmentType) => (
      `<option value="${escapeAttribute(appointmentType.id)}"${appointmentType.id === item.appointmentTypeId ? " selected" : ""}>${escapeHtml(appointmentType.name)}</option>`
    )).join("")}</select></label>`,
    "</div>",
    `<label>Description<textarea name="description">${escapeHtml(item.description ?? "")}</textarea></label>`,
    `<label>Fields JSON<textarea name="fields" rows="16">${escapeHtml(JSON.stringify(item.fields ?? [], null, 2))}</textarea></label>`,
    '<p class="meta">Enter a JSON array of field definitions. Existing booking, survey, and public-form rendering uses this same payload.</p>',
    `<label><input type="checkbox" name="templateIsInternal"${item.templateIsInternal === true ? " checked" : ""}> Internal Use Only</label>`,
    `<label><input type="checkbox" name="templateShowInClientPortal"${item.templateShowInClientPortal !== false ? " checked" : ""}> Show Submissions In Client Portal</label>`,
    `<label><input type="checkbox" name="active"${item.active ? " checked" : ""}> Active</label>`,
    `<div class="form-actions"><button type="submit">${template == null ? "Create Form Template" : "Save Form Template"}</button></div>`,
    "</form>",
    "</section>"
  ].join("");
}

function readAdminFormTemplateFormInput(form: URLSearchParams) {
  return {
    name: readRequiredFormValue(form, "name"),
    active: readCheckedFormValue(form, "active"),
    description: form.get("description") ?? "",
    fields: readJsonArrayFormValue(form, "fields"),
    formType: readRequiredFormValue(form, "formType") || "client_form",
    requiredFrequency: readOptionalFormValue(form, "requiredFrequency"),
    appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId"),
    templateIsInternal: readCheckedFormValue(form, "templateIsInternal"),
    templateShowInClientPortal: readCheckedFormValue(form, "templateShowInClientPortal")
  };
}

function renderAdminEmailTemplateEditor(template: {
  id: string;
  name: string;
  templateType: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  active: boolean;
} | null, action: string): string {
  return [
    '<section class="surface-block">',
    `<h2>${template == null ? "Create Email Template" : "Edit Email Template"}</h2>`,
    `<form class="form-grid" method="post" action="${escapeAttribute(action)}">`,
    '<div class="form-grid form-grid--two">',
    `<label>Name<input type="text" name="name" value="${escapeAttribute(template?.name ?? "")}" required></label>`,
    `<label>Template Type<input type="text" name="templateType" value="${escapeAttribute(template?.templateType ?? "")}" required></label>`,
    "</div>",
    `<label>Subject<input type="text" name="subject" value="${escapeAttribute(template?.subject ?? "")}" required></label>`,
    `<label>HTML Body<textarea name="bodyHtml">${escapeHtml(template?.bodyHtml ?? "")}</textarea></label>`,
    `<label>Plain Text Body<textarea name="bodyText">${escapeHtml(template?.bodyText ?? "")}</textarea></label>`,
    `<label><input type="checkbox" name="active"${template == null || template.active ? " checked" : ""}> Active</label>`,
    `<div class="form-actions"><button type="submit">${template == null ? "Create Template" : "Save Template"}</button></div>`,
    "</form>",
    "</section>"
  ].join("");
}

function renderAdminScheduledTaskEditor(task: {
  id: string;
  name: string;
  taskType: string;
  scheduleType: string;
  scheduleValue: string;
  active: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
} | null, action: string): string {
  return [
    '<section class="surface-block">',
    `<h2>${task == null ? "Create Scheduled Task" : "Edit Scheduled Task"}</h2>`,
    `<form class="form-grid" method="post" action="${escapeAttribute(action)}">`,
    '<div class="form-grid form-grid--two">',
    `<label>Name<input type="text" name="name" value="${escapeAttribute(task?.name ?? "")}" required></label>`,
    `<label>Task Type<input type="text" name="taskType" value="${escapeAttribute(task?.taskType ?? "")}" required></label>`,
    `<label>Schedule Type<input type="text" name="scheduleType" value="${escapeAttribute(task?.scheduleType ?? "")}" required></label>`,
    `<label>Schedule Value<input type="text" name="scheduleValue" value="${escapeAttribute(task?.scheduleValue ?? "")}"></label>`,
    "</div>",
    `<label><input type="checkbox" name="active"${task == null || task.active ? " checked" : ""}> Active</label>`,
    task?.lastRunAt == null ? "" : `<p class="meta">Last Run: ${escapeHtml(task.lastRunAt)}</p>`,
    task?.nextRunAt == null ? "" : `<p class="meta">Next Run: ${escapeHtml(task.nextRunAt)}</p>`,
    `<div class="form-actions"><button type="submit">${task == null ? "Create Task" : "Save Task"}</button></div>`,
    "</form>",
    "</section>"
  ].join("");
}

async function loadPersistedSession(sessionStore: SessionStore, request: IncomingMessage): Promise<StoredSessionSnapshot | null> {
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

async function resolvePublicRenderAssets(
  dependencies: ContentManagementDependencies,
  pathname: string,
  request: IncomingMessage,
  sessionStore: SessionStore
): Promise<PublicRenderAssets> {
  const [settings, session] = await Promise.all([
    dependencies.listAdminSettings(),
    loadPersistedSession(sessionStore, request)
  ]);
  const newsletterEmbedWrappedMarkup = await buildNewsletterEmbedWrappedMarkup(resolveSettingValue(settings, "newsletter_embed_html"));

  return {
    newsletterEmbedWrappedMarkup,
    publicNoticeMarkup: buildPublicNoticeMarkup(
      readBooleanSettingValue(resolveSettingValue(settings, "public_notice_enabled")),
      resolveSettingValue(settings, "public_notice_text")
    ),
    socialLinks: collectPublicSocialLinks(settings),
    tawkWidgetScript: buildTawkWidgetScript({
      enabled: readBooleanSettingValue(resolveSettingValue(settings, "tawk_to_enabled")),
      propertyId: resolveSettingValue(settings, "tawk_to_property_id"),
      widgetId: resolveSettingValue(settings, "tawk_to_widget_id"),
      pathname,
      session
    })
  };
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

const expiredSessionCookie = "bdta_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

async function clearPersistedSession(
  sessionStore: SessionStore,
  request: IncomingMessage
): Promise<Record<string, string>> {
  const sessionId = readSessionIdFromCookie(request);
  if (sessionStore != null && sessionId != null) {
    await sessionStore.delete(sessionId);
  }

  return {
    "set-cookie": expiredSessionCookie
  };
}

type RouteErrorResult = {
  status: number;
  body: unknown;
};

function readRouteError(body: unknown): { code: string; message: string; details?: unknown } | null {
  if (typeof body !== "object" || body == null || !("error" in body)) {
    return null;
  }

  const error = body.error;
  if (typeof error !== "object" || error == null) {
    return null;
  }

  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  const message = "message" in error && typeof error.message === "string" ? error.message : null;
  if (code == null || message == null) {
    return null;
  }

  const details = "details" in error ? error.details : undefined;
  return { code, message, details };
}

function readRouteItem<T>(body: unknown): T | null {
  if (readRouteError(body) != null || typeof body !== "object" || body == null || !("item" in body)) {
    return null;
  }

  return (body as { item: T }).item ?? null;
}

function readRouteItems<T>(body: unknown): T[] {
  if (readRouteError(body) != null || typeof body !== "object" || body == null || !("items" in body)) {
    return [];
  }

  const items = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as T[]) : [];
}

async function loadSafeRouteItem<T>(load: () => Promise<{ body: unknown }>): Promise<T | null> {
  try {
    return readRouteItem<T>((await load()).body);
  } catch {
    return null;
  }
}

async function loadSafeRouteItems<T>(load: () => Promise<{ body: unknown }>): Promise<T[]> {
  try {
    return readRouteItems<T>((await load()).body);
  } catch {
    return [];
  }
}

function isAuthRouteErrorCode(code: string): boolean {
  return code === "unauthorized" || code === "actor_not_found";
}

function readResponseRequestId(response: ServerResponse): string | null {
  const value = response.getHeader("x-request-id");
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim() !== "");
    return first ?? null;
  }

  return null;
}

function readRequestPath(request: IncomingMessage): string {
  return request.url == null || request.url.trim() === "" ? "/" : request.url;
}

function formatDiagnosticValue(value: unknown, maxLength = 4000): string | null {
  if (value == null) {
    return null;
  }

  const text = typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })();

  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}\n…truncated`;
}

function describeUnexpectedError(error: unknown): { headline: string; message: string; details: string | null } {
  if (error instanceof Error) {
    return {
      headline: error.name.trim() === "" ? "Unexpected Server Failure" : error.name.trim(),
      message: error.message.trim() === "" ? "Unexpected server failure." : error.message.trim(),
      details: formatDiagnosticValue(error.stack ?? error.message)
    };
  }

  if (typeof error === "string") {
    const message = error.trim();
    return {
      headline: "Unexpected Server Failure",
      message: message === "" ? "Unexpected server failure." : message,
      details: message === "" ? null : message
    };
  }

  return {
    headline: "Unexpected Server Failure",
    message: "Unexpected server failure.",
    details: formatDiagnosticValue(error)
  };
}

function renderDebugErrorArticle(input: {
  title: string;
  headline: string;
  message: string;
  statusCode?: number;
  errorCode?: string | null;
  requestId?: string | null;
  requestPath?: string | null;
  details?: string | null;
}): string {
  const metadata = [
    input.statusCode == null ? null : { label: "HTTP Status", value: escapeHtml(String(input.statusCode)) },
    input.errorCode == null || input.errorCode.trim() === "" ? null : { label: "Error Code", value: escapeHtml(input.errorCode) },
    input.requestPath == null || input.requestPath.trim() === "" ? null : { label: "Route", value: escapeHtml(input.requestPath) },
    input.requestId == null || input.requestId.trim() === "" ? null : { label: "Request ID", value: escapeHtml(input.requestId) }
  ].filter((item): item is { label: string; value: string } => item != null);

  return [
    '<article class="content-stack">',
    renderSectionIntro({
      eyebrow: "Error",
      title: input.headline,
      description: input.message
    }),
    metadata.length === 0 ? "" : renderDetailGrid(metadata),
    '<section class="surface-block">',
    "<h2>Debugging Context</h2>",
    `<p class="section-copy">${escapeHtml(input.title)} could not be rendered. Use the route, request ID, and details below to trace the failure in logs or upstream handlers.</p>`,
    "</section>",
    input.details == null || input.details.trim() === ""
      ? ""
      : [
        '<details class="surface-block">',
        "<summary><strong>Error Details</strong></summary>",
        `<pre class="debug-error-pre">${escapeHtml(input.details)}</pre>`,
        "</details>"
      ].join(""),
    "</article>"
  ].join("");
}

async function handleProtectedRouteFailure(options: {
  response: ServerResponse;
  request: IncomingMessage;
  sessionStore: SessionStore;
  loginPath: string;
  title: string;
  result: RouteErrorResult;
}): Promise<void> {
  const routeError = readRouteError(options.result.body);
  if (routeError != null && isAuthRouteErrorCode(routeError.code)) {
    redirect(
      options.response,
      options.loginPath,
      await clearPersistedSession(options.sessionStore, options.request)
    );
    return;
  }

  const message = routeError?.message ?? "Unexpected server failure.";
  const details = routeError?.details != null
    ? formatDiagnosticValue(routeError.details)
    : formatDiagnosticValue(options.result.body);
  writeHtml(options.response, options.result.status, renderLayout({
    title: options.title,
    body: renderDebugErrorArticle({
      title: options.title,
      headline: `${options.title} failed to load`,
      message,
      statusCode: options.result.status,
      errorCode: routeError?.code ?? null,
      requestId: readResponseRequestId(options.response),
      requestPath: readRequestPath(options.request),
      details
    })
  }));
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

function readSettingValue(settings: Setting[], key: string): string {
  const setting = settings.find((candidate) => candidate.key === key);
  return setting?.value?.trim() ?? "";
}

function resolveGoogleCalendarOAuthRedirectUri(request: IncomingMessage, configuredRedirectUri: string): string {
  const trimmed = configuredRedirectUri.trim();
  if (trimmed === "") {
    return `${getRequestOrigin(request)}${legacyGoogleCalendarOAuthCallbackPath}`;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.startsWith("/")
    ? `${getRequestOrigin(request)}${trimmed}`
    : `${getRequestOrigin(request)}/${trimmed.replace(/^\/+/, "")}`;
}

function buildGoogleCalendarOAuthStateCookie(stateToken: string): string {
  return `${googleCalendarOAuthStateCookieName}=${stateToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
}

function buildAdminCalendarSettingsLocation(params: {
  notice?: string;
  error?: string;
} = {}): string {
  const target = new URL(buildSettingsCategoryHref("/admin/settings", "calendar"), "http://localhost");
  if (params.notice != null && params.notice.trim() !== "") {
    target.searchParams.set("notice", params.notice.trim());
  }
  if (params.error != null && params.error.trim() !== "") {
    target.searchParams.set("error", params.error.trim());
  }
  return `${target.pathname}${target.search}`;
}

async function readGoogleOAuthErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Record<string, unknown>;
    const errorPayload = payload.error;
    if (errorPayload != null && typeof errorPayload === "object" && "message" in errorPayload && typeof errorPayload.message === "string") {
      const message = errorPayload.message.trim();
      if (message !== "") {
        return message;
      }
    }
    if (typeof payload.error_description === "string" && payload.error_description.trim() !== "") {
      return payload.error_description.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim() !== "") {
      return payload.error.trim();
    }
  } catch {
  }

  return "Google OAuth exchange failed.";
}

async function readGoogleCalendarAuthorizedEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as Record<string, unknown>;
    return typeof payload.email === "string" && payload.email.trim() !== ""
      ? payload.email.trim()
      : null;
  } catch {
    return null;
  }
}

function getRequestClientIp(request: IncomingMessage): string | null {
  const cfConnectingIp = request.headers["cf-connecting-ip"];
  const forwardedFor = request.headers["x-forwarded-for"];
  const directValue = Array.isArray(cfConnectingIp)
    ? cfConnectingIp[0]
    : cfConnectingIp;
  if (directValue != null && directValue.trim() !== "") {
    return directValue.trim();
  }

  const forwardedValue = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;
  if (forwardedValue != null && forwardedValue.trim() !== "") {
    const first = forwardedValue.split(",")[0]?.trim() ?? "";
    if (first !== "") {
      return first;
    }
  }

  return request.socket.remoteAddress ?? null;
}

export function createHttpWebServer(options: HttpWebServerOptions): Server {
  const resolved = resolveDependencies(options);
  const handlers = resolved.api == null ? null : createApiHandlers(resolved.api);
  const runtimeEnvironmentPaths = resolveRuntimeEnvironmentFilePath(options);
  const runtimeEnvironmentProcessEnv = resolveRuntimeEnvironmentProcessEnv(options);

  return createServer(async (request, response) => {
    const requestId = options.requestIdFactory?.() ?? randomUUID();
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const requestPath = `${url.pathname}${url.search}`;
    const startedAt = Date.now();
    let publicRenderAssetsPromise: Promise<PublicRenderAssets> | null = null;
    const getPublicRenderAssets = () => {
      publicRenderAssetsPromise ??= resolvePublicRenderAssets(resolved.content, url.pathname, request, resolved.sessionStore);
      return publicRenderAssetsPromise;
    };
    const getSafePublicRenderAssets = async () => {
      try {
        return await getPublicRenderAssets();
      } catch {
        return {
          newsletterEmbedWrappedMarkup: "",
          publicNoticeMarkup: "",
          socialLinks: [],
          tawkWidgetScript: ""
        } satisfies PublicRenderAssets;
      }
    };
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
          writeHtml(response, 200, "ok", {
            "content-type": "text/plain; charset=utf-8"
          });
          return;
        }

        const report = await options.healthCheck();
        response.writeHead(report.status === "ok" ? 200 : 503, {
          "content-type": "application/json; charset=utf-8"
        });
        response.end(JSON.stringify(report));
        return;
      }

      if (method === "GET" && url.pathname === "/favicon.ico") {
        const faviconPath = resolveLegacyPublicAssetPath("/assets/favicon.svg");
        if (faviconPath != null) {
          try {
            const file = await readFile(faviconPath);
            response.writeHead(200, {
              "content-type": "image/svg+xml; charset=utf-8",
              "content-length": file.byteLength.toString(),
              "cache-control": "public, max-age=300"
            });
            response.end(file);
            return;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        }

        response.writeHead(204, {
          "cache-control": "public, max-age=300"
        });
        response.end();
        return;
      }

      const legacyAssetPath = method === "GET"
        ? resolveLegacyPublicAssetPath(url.pathname)
        : null;
      if (legacyAssetPath != null) {
        try {
          const file = await readFile(legacyAssetPath);
          response.writeHead(200, {
            "content-type": getStaticAssetContentType(legacyAssetPath),
            "content-length": file.byteLength.toString(),
            "cache-control": "public, max-age=300"
          });
          response.end(file);
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            writeHtml(response, 404, renderLayout({
              title: "Not Found",
              body: "<article><h1>Not Found</h1></article>"
            }));
            return;
          }

          throw error;
        }
      }

if (method === "GET" && url.pathname === "/admin/login") {
const returnPath = sanitizeAdminReturnPath(url.searchParams.get("return_to") ?? url.searchParams.get("returnTo"));
const session = await loadPersistedSession(resolved.sessionStore, request);
if (session?.actorType === "admin_user") {
if (handlers != null) {
const actor = await handlers.handleAdminActorProfile(session);
if ("error" in actor.body) {
writeHtml(response, 200, renderAdminLoginPage({
action: buildAdminLoginPath(returnPath),
returnPath
}), await clearPersistedSession(resolved.sessionStore, request));
return;
}
}

redirect(response, returnPath ?? toLocalLocation(resultAdminLandingPath(session.role)));
return;
}

if (session?.actorType === "portal_user") {
if (handlers != null) {
const actor = await handlers.handlePortalActorProfile(session);
if ("error" in actor.body) {
writeHtml(response, 200, renderAdminLoginPage({
action: buildAdminLoginPath(returnPath),
returnPath
}), await clearPersistedSession(resolved.sessionStore, request));
return;
}
}

redirect(response, "/portal");
return;
}

      writeHtml(response, 200, renderAdminLoginPage({
        action: buildAdminLoginPath(returnPath),
        returnPath
      }));
        return;
      }

    if (method === "POST" && url.pathname === "/admin/login" && handlers != null) {
      const form = await readFormBody(request);
      const returnPath = sanitizeAdminReturnPath(url.searchParams.get("return_to") ?? url.searchParams.get("returnTo"));
      const result = await handlers.handleAdminLogin({
        username: form.get("username"),
        password: form.get("password")
        });

        if ("error" in result.body) {
        writeHtml(response, result.status, renderAdminLoginPage({
          action: buildAdminLoginPath(returnPath),
          returnPath,
          errorMessage: result.body.error.message
        }));
          return;
        }

      redirect(
        response,
        returnPath ?? toLocalLocation(resultAdminLandingPath(result.body.session.role)),
        await persistSession(resolved.sessionStore, result.body)
      );
      return;
    }

if (method === "GET" && url.pathname === "/portal/login") {
const returnPath = sanitizeLocalReturnPath(url.searchParams.get("return_to") ?? url.searchParams.get("returnTo"));
const session = await loadPersistedSession(resolved.sessionStore, request);
if (session?.actorType === "portal_user") {
if (handlers != null) {
const actor = await handlers.handlePortalActorProfile(session);
if ("error" in actor.body) {
writeHtml(response, 200, renderPortalLoginPage({
action: buildPortalLoginPath(returnPath),
returnPath
}), await clearPersistedSession(resolved.sessionStore, request));
return;
}
}

redirect(response, returnPath ?? "/portal");
return;
}

if (session?.actorType === "admin_user") {
if (handlers != null) {
const actor = await handlers.handleAdminActorProfile(session);
if ("error" in actor.body) {
writeHtml(response, 200, renderPortalLoginPage({
action: buildPortalLoginPath(returnPath),
returnPath
}), await clearPersistedSession(resolved.sessionStore, request));
return;
}
}

redirect(response, "/admin");
return;
}

      writeHtml(response, 200, renderPortalLoginPage({
        action: buildPortalLoginPath(returnPath),
        returnPath
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/portal/login" && handlers != null) {
        const form = await readFormBody(request);
        const returnPath = sanitizeLocalReturnPath(url.searchParams.get("return_to") ?? url.searchParams.get("returnTo"));
        const result = await handlers.handlePortalLogin({
          email: form.get("email"),
          password: form.get("password"),
          returnTo: buildAbsoluteReturnUrl(request, returnPath)
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderPortalLoginPage({
            action: buildPortalLoginPath(returnPath),
            returnPath,
            errorMessage: result.body.error.message
          }));
          return;
        }

      redirect(response, returnPath ?? toLocalLocation(result.body.redirectTo), await persistSession(resolved.sessionStore, result.body));
      return;
    }

      if (method === "GET" && url.pathname === "/backend/public/api_services.php") {
        writeJson(response, 200, {
          services: await listLegacyPublicServices(resolved.api, request)
        }, {
          "cache-control": "public, max-age=60"
        });
        return;
      }

      if (method === "GET" && url.pathname === "/backend/public/api_events.php") {
        writeJson(response, 200, {
          events: await listLegacyPublicEvents(resolved.api, request)
        }, {
          "cache-control": "public, max-age=60"
        });
        return;
      }

      if (method === "GET" && url.pathname === "/backend/public/api_packages.php") {
        writeJson(response, 200, {
          packages: await listLegacyPublicPackages(resolved.api, request)
        }, {
          "cache-control": "public, max-age=120"
        });
        return;
      }

      if (method === "GET" && url.pathname === "/client/package_detail.php") {
        const packageItem = await resolveLegacyPublicPackage(resolved.api, url);
        const checkoutForm = await resolveLegacyPublicPackageCheckoutForm(resolved.api, packageItem);
        const sessionId = url.searchParams.get("session_id")?.trim() ?? "";
        if (sessionId !== "" && resolved.api != null && packageItem != null) {
          try {
            const resumedPurchase = await resumePublicPackagePurchase({
              token: packageItem.shareToken ?? "",
              sessionId
            }, resolved.api.publicPackages);

            if (resumedPurchase.status === "completed") {
              redirect(
                response,
                `/client/package_detail.php?token=${encodeURIComponent(packageItem.shareToken ?? "")}&purchase=success`,
                {},
                303
              );
              return;
            }

            const page = renderLegacyPublicPackageDetailPage({
              packageItem,
              checkoutForm,
              currentPath: `${url.pathname}${url.search}`,
              publicRenderAssets: await getPublicRenderAssets(),
              purchaseState: {
                status: "info",
                infoMessage: resumedPurchase.infoMessage
              }
            });
            writeHtml(response, page.status, page.html);
            return;
          } catch (error) {
            const errorMessage = error instanceof PublicPackagePurchaseError
              ? error.message
              : error instanceof z.ZodError
                ? "Package purchase could not be completed."
                : "Package purchase could not be completed.";
            const statusCode = error instanceof PublicPackagePurchaseError && error.code === "not_found" ? 404 : 400;
            const page = renderLegacyPublicPackageDetailPage({
              packageItem,
              checkoutForm,
              currentPath: `${url.pathname}${url.search}`,
              publicRenderAssets: await getPublicRenderAssets(),
              purchaseState: {
                status: "error",
                errorMessage
              }
            });
            writeHtml(response, statusCode, page.html);
            return;
          }
        }

        const page = renderLegacyPublicPackageDetailPage({
          packageItem,
          checkoutForm,
          currentPath: `${url.pathname}${url.search}`,
          publicRenderAssets: await getPublicRenderAssets(),
          purchaseState: {
            status: url.searchParams.get("purchase") === "success" ? "success" : "idle"
          }
        });
        writeHtml(response, page.status, page.html);
        return;
      }

      if (method === "GET" && url.pathname === "/backend/public/quote.php" && handlers != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const result = await handlers.handlePublicQuoteDetail({
          quoteId: url.searchParams.get("id"),
          token: url.searchParams.get("token"),
          session
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLegacyPublicDocumentUnavailablePage({
            title: "Quote Not Found",
            eyebrow: "Quote Access",
            heading: "Quote not found",
            description: "The quote link is invalid, unavailable, or no longer active.",
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets()
          }));
          return;
        }

        const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "quote");
        const actionPanel = renderLegacyPublicDocumentActionPanel({
          session,
          requestPath,
          resourceKind: "quote",
          resourceId: result.body.item.id,
          complete: result.body.item.status === "accepted"
        });
        const quoteActionParams = new URLSearchParams(url.searchParams);
        quoteActionParams.delete("result");
        const quoteActionPath = `${url.pathname}${quoteActionParams.size === 0 ? "" : `?${quoteActionParams.toString()}`}`;
        const token = url.searchParams.get("token")?.trim() ?? "";
        const directPublicActionEnabled = session == null && token !== "" && (result.body.item.status === "draft" || result.body.item.status === "sent");
        const quoteResult = url.searchParams.get("result")?.trim() ?? "";
        const feedbackMarkup = quoteResult === "accepted"
          ? renderLegacyPublicFeedback("success", "Quote accepted. We will contact you shortly.")
          : quoteResult === "declined"
            ? renderLegacyPublicFeedback("info", "Quote declined. Thank you for your response.")
            : undefined;
        const sidebarTitle = directPublicActionEnabled ? "Respond to Quote" : actionPanel.title;
        const sidebarDescription = directPublicActionEnabled
          ? "Use this secure tokenized link to accept or decline the quote without signing into the client portal."
          : actionPanel.description;
        const sidebarMarkup = directPublicActionEnabled
          ? [
            `<form class="form-grid" method="post" action="${escapeAttribute(quoteActionPath)}">`,
            '<label>Turnstile Token<input type="text" name="turnstileToken" value="turnstile-ok" required></label>',
            '<div class="form-actions"><button type="submit" name="action" value="accept">Accept Quote</button><button type="submit" name="action" value="decline">Decline Quote</button></div>',
            "</form>"
          ].join("")
          : actionPanel.actionMarkup;
        writeHtml(response, 200, renderLegacyPublicQuoteDetailPage({
          quote: result.body.item,
          currentPath: requestPath,
          publicRenderAssets: await getPublicRenderAssets(),
          portalReturnPath,
          sidebarTitle,
          sidebarDescription,
          sidebarMarkup,
          feedbackMarkup
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/backend/public/quote.php" && handlers != null && resolved.api != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const form = await readFormBody(request);

        try {
          const result = await respondPublicQuote({
            quoteId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session,
            action: String(form.get("action") ?? "accept") as "accept" | "decline",
            turnstileToken: form.get("turnstileToken")
          }, resolved.api.publicDocuments);
          const redirectParams = new URLSearchParams(url.searchParams);
          redirectParams.set("result", result.item.status);
          redirect(response, `${url.pathname}?${redirectParams.toString()}`, {}, 303);
          return;
        } catch (error) {
          const detail = await handlers.handlePublicQuoteDetail({
            quoteId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session
          });
          if ("error" in detail.body) {
            writeHtml(response, detail.status, renderLegacyPublicDocumentUnavailablePage({
              title: "Quote Not Found",
              eyebrow: "Quote Access",
              heading: "Quote not found",
              description: "The quote link is invalid, unavailable, or no longer active.",
              currentPath: requestPath,
              publicRenderAssets: await getPublicRenderAssets()
            }));
            return;
          }

          const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "quote");
          const quoteActionParams = new URLSearchParams(url.searchParams);
          quoteActionParams.delete("result");
          const quoteActionPath = `${url.pathname}${quoteActionParams.size === 0 ? "" : `?${quoteActionParams.toString()}`}`;
          const errorMessage = error instanceof PublicDocumentMutationError
            ? error.message
            : error instanceof z.ZodError
              ? "Review the quote response fields and try again."
              : "Quote could not be updated.";
          writeHtml(response, getPublicDocumentMutationStatusCode(error), renderLegacyPublicQuoteDetailPage({
            quote: detail.body.item,
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets(),
            portalReturnPath,
            sidebarTitle: "Respond to Quote",
            sidebarDescription: "Use this secure tokenized link to accept or decline the quote without signing into the client portal.",
            sidebarMarkup: [
              `<form class="form-grid" method="post" action="${escapeAttribute(quoteActionPath)}">`,
              `<label>Turnstile Token<input type="text" name="turnstileToken" value="${escapeAttribute(form.get("turnstileToken")?.trim() ?? "turnstile-ok")}" required></label>`,
              '<div class="form-actions"><button type="submit" name="action" value="accept">Accept Quote</button><button type="submit" name="action" value="decline">Decline Quote</button></div>',
              "</form>"
            ].join(""),
            feedbackMarkup: renderLegacyPublicFeedback("error", errorMessage)
          }));
          return;
        }
      }

      if (method === "GET" && url.pathname === "/backend/public/contract.php" && handlers != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const result = await handlers.handlePublicContractDetail({
          contractId: url.searchParams.get("id"),
          token: url.searchParams.get("token"),
          session
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLegacyPublicDocumentUnavailablePage({
            title: "Contract Not Found",
            eyebrow: "Contract Access",
            heading: "Contract not found",
            description: "The contract link is invalid, unavailable, or no longer active.",
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets()
          }));
          return;
        }

        const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "contract");
        const actionPanel = renderLegacyPublicDocumentActionPanel({
          session,
          requestPath,
          resourceKind: "contract",
          resourceId: result.body.item.id,
          complete: result.body.item.status === "signed"
        });
        const contractActionParams = new URLSearchParams(url.searchParams);
        contractActionParams.delete("result");
        const contractActionPath = `${url.pathname}${contractActionParams.size === 0 ? "" : `?${contractActionParams.toString()}`}`;
        const token = url.searchParams.get("token")?.trim() ?? "";
        const directPublicActionEnabled = session == null && token !== "" && result.body.item.status === "sent";
        const contractResult = url.searchParams.get("result")?.trim() ?? "";
        const feedbackMarkup = contractResult === "signed"
          ? renderLegacyPublicFeedback("success", "Contract signed successfully. Thank you.")
          : undefined;
        const sidebarTitle = directPublicActionEnabled ? "Sign Contract" : actionPanel.title;
        const sidebarDescription = directPublicActionEnabled
          ? "Provide the typed electronic signature below to complete this agreement from the secure public link."
          : actionPanel.description;
        const sidebarMarkup = directPublicActionEnabled
          ? [
            `<form class="form-grid" method="post" action="${escapeAttribute(contractActionPath)}">`,
            '<label>Typed Signature<input type="text" name="typedName" required></label>',
            '<label>Signature Style<select name="signatureFont"><option value="font-dancing">Dancing Script</option><option value="font-pacifico">Pacifico</option><option value="font-satisfy">Satisfy</option><option value="font-great-vibes">Great Vibes</option><option value="font-allura">Allura</option></select></label>',
            '<label><input type="checkbox" name="client_confirmation" value="1" required> I confirm this electronic signature is my own.</label>',
            '<label>Turnstile Token<input type="text" name="turnstileToken" value="turnstile-ok" required></label>',
            '<div class="form-actions"><button type="submit">Sign Contract</button></div>',
            "</form>"
          ].join("")
          : actionPanel.actionMarkup;
        writeHtml(response, 200, renderLegacyPublicContractDetailPage({
          contract: result.body.item,
          currentPath: requestPath,
          publicRenderAssets: await getPublicRenderAssets(),
          portalReturnPath,
          sidebarTitle,
          sidebarDescription,
          sidebarMarkup,
          feedbackMarkup
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/backend/public/contract.php" && handlers != null && resolved.api != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const form = await readFormBody(request);
        const typedName = form.get("typedName")?.trim() ?? "";
        const signatureFont = form.get("signatureFont")?.trim() ?? "font-dancing";

        try {
          if (!readCheckedFormValue(form, "client_confirmation")) {
            throw new PublicDocumentMutationError("invalid_request", "You must confirm the electronic signature before signing.");
          }

          const result = await signPublicContract({
            contractId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session,
            typedName,
            signatureFont,
            ipAddress: getRequestClientIp(request),
            userAgent: request.headers["user-agent"] ?? null,
            turnstileToken: form.get("turnstileToken")
          }, resolved.api.publicDocuments);
          const redirectParams = new URLSearchParams(url.searchParams);
          redirectParams.set("result", result.item.status);
          redirect(response, `${url.pathname}?${redirectParams.toString()}`, {}, 303);
          return;
        } catch (error) {
          const detail = await handlers.handlePublicContractDetail({
            contractId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session
          });
          if ("error" in detail.body) {
            writeHtml(response, detail.status, renderLegacyPublicDocumentUnavailablePage({
              title: "Contract Not Found",
              eyebrow: "Contract Access",
              heading: "Contract not found",
              description: "The contract link is invalid, unavailable, or no longer active.",
              currentPath: requestPath,
              publicRenderAssets: await getPublicRenderAssets()
            }));
            return;
          }

          const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "contract");
          const contractActionParams = new URLSearchParams(url.searchParams);
          contractActionParams.delete("result");
          const contractActionPath = `${url.pathname}${contractActionParams.size === 0 ? "" : `?${contractActionParams.toString()}`}`;
          const errorMessage = error instanceof PublicDocumentMutationError
            ? error.message
            : error instanceof z.ZodError
              ? "Review the contract signature fields and try again."
              : "Contract could not be signed.";
          writeHtml(response, getPublicDocumentMutationStatusCode(error), renderLegacyPublicContractDetailPage({
            contract: detail.body.item,
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets(),
            portalReturnPath,
            sidebarTitle: "Sign Contract",
            sidebarDescription: "Provide the typed electronic signature below to complete this agreement from the secure public link.",
            sidebarMarkup: [
              `<form class="form-grid" method="post" action="${escapeAttribute(contractActionPath)}">`,
              `<label>Typed Signature<input type="text" name="typedName" value="${escapeAttribute(typedName)}" required></label>`,
              '<label>Signature Style<select name="signatureFont">',
              `<option value="font-dancing"${signatureFont === "font-dancing" ? " selected" : ""}>Dancing Script</option>`,
              `<option value="font-pacifico"${signatureFont === "font-pacifico" ? " selected" : ""}>Pacifico</option>`,
              `<option value="font-satisfy"${signatureFont === "font-satisfy" ? " selected" : ""}>Satisfy</option>`,
              `<option value="font-great-vibes"${signatureFont === "font-great-vibes" ? " selected" : ""}>Great Vibes</option>`,
              `<option value="font-allura"${signatureFont === "font-allura" ? " selected" : ""}>Allura</option>`,
              "</select></label>",
              `<label><input type="checkbox" name="client_confirmation" value="1"${readCheckedFormValue(form, "client_confirmation") ? " checked" : ""}> I confirm this electronic signature is my own.</label>`,
              `<label>Turnstile Token<input type="text" name="turnstileToken" value="${escapeAttribute(form.get("turnstileToken")?.trim() ?? "turnstile-ok")}" required></label>`,
              '<div class="form-actions"><button type="submit">Sign Contract</button></div>',
              "</form>"
            ].join(""),
            feedbackMarkup: renderLegacyPublicFeedback("error", errorMessage)
          }));
          return;
        }
      }

      if (method === "POST" && url.pathname === "/backend/public/form.php" && handlers != null && resolved.api != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const form = await readFormBody(request);
        const postedValues = extractLegacyPublicFormValues(form);

        try {
          await submitPublicForm({
            submissionId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session,
            contactName: form.get("contact_name"),
            contactEmail: form.get("contact_email"),
            contactPhone: form.get("contact_phone"),
            responses: postedValues,
            turnstileToken: form.get("turnstileToken")
          }, resolved.api.publicDocuments);

          const redirectUrl = new URL(request.url ?? requestPath, "http://localhost");
          redirectUrl.searchParams.set("result", "submitted");
          redirect(response, `${redirectUrl.pathname}${redirectUrl.search}`, {}, 303);
          return;
        } catch (error) {
          const result = await handlers.handlePublicFormSubmissionDetail({
            submissionId: url.searchParams.get("id"),
            token: url.searchParams.get("token"),
            session
          });

          if ("error" in result.body) {
            writeHtml(response, result.status, renderLegacyPublicDocumentUnavailablePage({
              title: "Form Not Found",
              eyebrow: "Form Access",
              heading: "Form not found",
              description: "The form link is invalid, unavailable, or no longer active.",
              currentPath: requestPath,
              publicRenderAssets: await getPublicRenderAssets()
            }));
            return;
          }

          const errorMessage = error instanceof PublicDocumentMutationError
            ? error.message
            : error instanceof z.ZodError
              ? "Name, email, and all required form fields must be completed."
              : "Form submission could not be completed.";
          const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "form");
          const actionPanel = renderLegacyPublicDocumentActionPanel({
            session,
            requestPath,
            resourceKind: "form",
            resourceId: result.body.item.id,
            complete: result.body.item.submittedAt != null
          });
          const useDirectSubmit = session == null && result.body.item.submittedAt == null;
          writeHtml(response, getPublicDocumentMutationStatusCode(error), renderLegacyPublicFormDetailPage({
            submission: result.body.item,
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets(),
            portalReturnPath,
            sidebarTitle: useDirectSubmit ? "Secure form request" : actionPanel.title,
            sidebarDescription: useDirectSubmit
              ? "Complete the requested form directly from this secure access link."
              : actionPanel.description,
            sidebarMarkup: useDirectSubmit
              ? '<p class="meta">Use the form on this page to finish the requested submission.</p>'
              : actionPanel.actionMarkup,
            feedbackMarkup: renderLegacyPublicFeedback("error", errorMessage),
            contentMarkup: useDirectSubmit
              ? renderLegacyPublicFormSubmissionForm({
                submission: result.body.item,
                currentPath: requestPath,
                contactName: form.get("contact_name")?.trim() ?? result.body.item.contactName ?? "",
                contactEmail: form.get("contact_email")?.trim() ?? result.body.item.contactEmail ?? "",
                contactPhone: form.get("contact_phone")?.trim() ?? result.body.item.contactPhone ?? "",
                turnstileToken: form.get("turnstileToken")?.trim() ?? "turnstile-ok",
                postedValues
              })
              : [
                '<section class="surface-block">',
                '<h3>Pending Submission</h3>',
                `<p class="section-copy">${escapeHtml(errorMessage)}</p>`,
                result.body.item.responses != null && result.body.item.responses.length > 0
                  ? renderLegacyPublicFormResponses(result.body.item)
                  : "",
                "</section>"
              ].join("")
          }));
          return;
        }
      }

      if (method === "GET" && url.pathname === "/backend/public/form.php" && handlers != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        const result = await handlers.handlePublicFormSubmissionDetail({
          submissionId: url.searchParams.get("id"),
          token: url.searchParams.get("token"),
          session
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLegacyPublicDocumentUnavailablePage({
            title: "Form Not Found",
            eyebrow: "Form Access",
            heading: "Form not found",
            description: "The form link is invalid, unavailable, or no longer active.",
            currentPath: requestPath,
            publicRenderAssets: await getPublicRenderAssets()
          }));
          return;
        }

        const portalReturnPath = sanitizePortalReturnPath(url.searchParams.get("portal_return"), "form");
        const actionPanel = renderLegacyPublicDocumentActionPanel({
          session,
          requestPath,
          resourceKind: "form",
          resourceId: result.body.item.id,
          complete: result.body.item.submittedAt != null
        });
        const useDirectSubmit = session == null && result.body.item.submittedAt == null;
        const resultFlag = url.searchParams.get("result");
        writeHtml(response, 200, renderLegacyPublicFormDetailPage({
          submission: result.body.item,
          currentPath: requestPath,
          publicRenderAssets: await getPublicRenderAssets(),
          portalReturnPath,
          sidebarTitle: useDirectSubmit ? "Secure form request" : actionPanel.title,
          sidebarDescription: useDirectSubmit
            ? "Complete the requested form directly from this secure access link."
            : actionPanel.description,
          sidebarMarkup: useDirectSubmit
            ? '<p class="meta">All required questions must be completed before the form can be submitted.</p>'
            : actionPanel.actionMarkup,
          feedbackMarkup: resultFlag === "submitted"
            ? renderLegacyPublicFeedback("success", "Thank you! Your form has been submitted successfully.")
            : undefined,
          contentMarkup: result.body.item.submittedAt == null
            ? useDirectSubmit
              ? renderLegacyPublicFormSubmissionForm({
                submission: result.body.item,
                currentPath: requestPath,
                contactName: result.body.item.contactName ?? "",
                contactEmail: result.body.item.contactEmail ?? "",
                contactPhone: result.body.item.contactPhone ?? "",
                postedValues: {}
              })
              : [
                '<section class="surface-block">',
                '<h3>Pending Submission</h3>',
                '<p class="section-copy">This form is still pending. Continue from your signed-in account or use the secure submission link attached here.</p>',
                result.body.item.responses != null && result.body.item.responses.length > 0
                  ? renderLegacyPublicFormResponses(result.body.item)
                  : "",
                "</section>"
              ].join("")
            : [
              '<section class="surface-block">',
              "<h3>Submitted Responses</h3>",
              renderLegacyPublicFormResponses(result.body.item),
              "</section>"
            ].join("")
        }));
        return;
      }

      if (method === "GET" && url.pathname === "/backend/public/download_ical.php" && handlers != null) {
        const bookingId = url.searchParams.get("booking_id") ?? url.searchParams.get("id");
        const result = await handlers.handlePublicBookingIcalDetail({
          bookingId,
          token: url.searchParams.get("token"),
          session: await loadPersistedSession(resolved.sessionStore, request)
        });

        if (typeof result.body === "string") {
          writeHtml(response, result.status, result.body, {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": `attachment; filename="booking-${encodeURIComponent((bookingId?.trim() ?? "") || "event")}.ics"`
          });
          return;
        }

        writeHtml(response, result.status, renderLegacyPublicDocumentUnavailablePage({
          title: "Booking Calendar Not Found",
          eyebrow: "Calendar Access",
          heading: "Calendar feed not found",
          description: "The booking calendar link is invalid, unavailable, or no longer active.",
          currentPath: requestPath,
          publicRenderAssets: await getPublicRenderAssets()
        }));
        return;
      }

      if (method === "POST" && url.pathname === "/client/package_detail.php" && resolved.api != null) {
        const packageItem = await resolveLegacyPublicPackage(resolved.api, url);
        const checkoutForm = await resolveLegacyPublicPackageCheckoutForm(resolved.api, packageItem);
        const form = await readFormBody(request);
        const packageFormValues = extractPackageFormValues(form);
        const purchaseValues = {
          buyerName: form.get("buyer_name"),
          buyerEmail: form.get("buyer_email"),
          buyerPhone: form.get("buyer_phone"),
          notes: form.get("notes")
        };

        try {
          const token = url.searchParams.get("token")?.trim() ?? "";
          if (token === "") {
            throw new PublicPackagePurchaseError("not_found", "Public package not found.");
          }

          const origin = getRequestOrigin(request);
          const purchase = await beginPublicPackagePurchase({
            token,
            ...purchaseValues,
            successUrl: `${origin}/client/package_detail.php?token=${encodeURIComponent(token)}&session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${origin}/client/package_detail.php?token=${encodeURIComponent(token)}`,
            formResponses: packageFormValues
          }, resolved.api.publicPackages);

          if (purchase.status === "requires_payment") {
            redirect(
              response,
              purchase.paymentSession.checkoutUrl,
              {},
              303
            );
            return;
          }

          redirect(
            response,
            `/client/package_detail.php?token=${encodeURIComponent(token)}&purchase=success`,
            {},
            303
          );
          return;
        } catch (error) {
          const errorMessage = error instanceof PublicPackagePurchaseError
            ? error.message
            : error instanceof z.ZodError
              ? "Buyer name and a valid email address are required."
              : "Package purchase could not be completed.";
          const statusCode = error instanceof PublicPackagePurchaseError && error.code === "not_found" ? 404 : 400;
          const page = renderLegacyPublicPackageDetailPage({
            packageItem,
            checkoutForm,
            currentPath: `${url.pathname}${url.search}`,
            publicRenderAssets: await getPublicRenderAssets(),
            purchaseState: {
              status: "error",
              errorMessage,
              values: {
                buyerName: purchaseValues.buyerName ?? "",
                buyerEmail: purchaseValues.buyerEmail ?? "",
                buyerPhone: purchaseValues.buyerPhone ?? "",
                notes: purchaseValues.notes ?? ""
              },
              packageFormValues: checkoutForm == null ? {} : (packageFormValues[checkoutForm.id] ?? {})
            }
          });
          writeHtml(response, statusCode, page.html);
          return;
        }
      }

      const isLegacyBookingAlias = url.pathname === "/backend/public/book.php";
      const usesAppointmentTypeBookingLink = url.searchParams.has("link") || url.searchParams.has("type");
      const bookingFormAction = url.pathname === "/book" && !usesAppointmentTypeBookingLink
        ? "/book"
        : `${url.pathname}${url.search}`;

      if (method === "GET" && (url.pathname === "/book" || isLegacyBookingAlias)) {
        const appointmentType = await resolveLegacyBookingAppointmentType(resolved.api, url);
        if (isLegacyBookingAlias || appointmentType != null || usesAppointmentTypeBookingLink) {
          writeHtml(response, 200, renderLegacyBookingPage(appointmentType, bookingFormAction, await getPublicRenderAssets()));
          return;
        }

        writeHtml(response, 200, renderPublicPageLayout({
          title: "Book Training",
          publicRenderAssets: await getPublicRenderAssets(),
          requestPath,
          body: [
            '<div class="booking-shell">',
            '<section class="marketing-hero marketing-hero--compact">',
            '<p class="eyebrow">Schedule Training</p>',
            "<h1>Book Training</h1>",
            "<p class=\"section-copy\">Send a booking request for your next training session and start with the right service instead of guessing.</p>",
            "</section>",
            '<section class="booking-shell__grid">',
            '<article class="booking-form-card">',
            "<h2>Request Booking</h2>",
            '<form class="form-grid" method="post" action="/book">',
            '<label>Service ID<input type="text" name="serviceId" value="svc-private-lesson" required></label>',
            '<label>Email<input type="email" name="clientEmail" required></label>',
            '<div class="form-grid form-grid--two">',
            '<label>Requested Start<input type="datetime-local" name="requestedStart" required></label>',
            '<label>Requested End<input type="datetime-local" name="requestedEnd" required></label>',
            "</div>",
            '<label>Turnstile Token<input type="text" name="turnstileToken" value="turnstile-ok" required></label>',
            '<div class="form-actions"><button type="submit">Request Booking</button></div>',
            "</form>",
            "</article>",
            '<aside class="booking-benefits">',
            "<h2>What happens next</h2>",
            '<div class="benefit-list">',
            '<section class="benefit-item"><strong>Intake Review</strong><p>We review the request against service type, timing, and current availability.</p></section>',
            '<section class="benefit-item"><strong>Scheduling Follow-Up</strong><p>Confirmation and reminders are generated once the booking is accepted.</p></section>',
            '<section class="benefit-item"><strong>Progress Stays Organized</strong><p>After approval, reminders, forms, invoices, and upcoming sessions stay easy to review in one place.</p></section>',
            "</div>",
            "</aside>",
            "</section>",
            "</div>"
          ].join("")
        }));
        return;
      }

      if (url.pathname === "/backend/public/api_contact.php") {
        if (handlers == null) {
          writeJson(response, 503, {
            success: false,
            error: "Public contact endpoint unavailable."
          });
          return;
        }

        if (method !== "POST") {
          writeJson(response, 405, {
            success: false,
            error: "Method not allowed"
          });
          return;
        }

        const result = await handlers.handlePublicContact(await readJsonBody(request));
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

      if (method === "POST" && (url.pathname === "/book" || isLegacyBookingAlias) && handlers != null) {
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
          writeHtml(response, result.status, renderPublicPageLayout({
            title: "Book Training",
            publicRenderAssets: await getPublicRenderAssets(),
            requestPath,
            body: [
              '<section class="marketing-hero marketing-hero--compact">',
              "<p class=\"eyebrow\">Booking Error</p>",
              "<h1>Book Training</h1>",
              `<p class="section-copy">${escapeHtml(result.body.error.message)}</p>`,
              `<div class="form-actions"><a class="nav-cta" href="${escapeAttribute(bookingFormAction)}">Return to booking form</a></div>`,
              "</section>"
            ].join("")
          }));
          return;
        }

        redirect(response, `/book/confirmation?bookingId=${encodeURIComponent(result.body.bookingId)}`);
        return;
      }

      if (method === "GET" && url.pathname === "/book/confirmation") {
        const bookingId = url.searchParams.get("bookingId") ?? "pending";
        writeHtml(response, 200, renderPublicPageLayout({
          title: "Booking Confirmation",
          publicRenderAssets: await getPublicRenderAssets(),
          requestPath,
          body: [
            '<section class="marketing-hero marketing-hero--compact">',
            '<p class="eyebrow">Booking Received</p>',
            "<h1>Thanks for your request</h1>",
            `<p class="section-copy">Your booking request has been recorded as <strong>${escapeHtml(bookingId)}</strong>.</p>`,
            '<div class="form-actions"><a class="nav-cta" href="/portal/login">Go to portal</a><a class="quick-link-card quick-link-card--inline" href="/blog"><span class="quick-link-card__label">Read the journal</span><span class="quick-link-card__meta">Practical training notes while you wait</span></a></div>',
            "</section>"
          ].join("")
        }));
        return;
      }

if (method === "GET" && url.pathname === "/portal/logout") {
redirect(response, "/portal/login", await clearPersistedSession(resolved.sessionStore, request));
return;
}

if (method === "GET" && url.pathname === "/admin/logout") {
redirect(response, "/admin/login", await clearPersistedSession(resolved.sessionStore, request));
return;
}

      const quoteAcceptMatch = /^\/portal\/quotes\/([^/]+)\/accept$/.exec(url.pathname);
      if (method === "POST" && handlers != null && quoteAcceptMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
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
          redirect(response, buildPortalLoginRedirectPath(request));
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
          redirect(response, buildPortalLoginRedirectPath(request));
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

      const portalInvoiceDetailMatch = /^\/portal\/invoices\/([^/]+)$/.exec(url.pathname);
      const portalQuoteDetailMatch = /^\/portal\/quotes\/([^/]+)$/.exec(url.pathname);
      const portalContractDetailMatch = /^\/portal\/contracts\/([^/]+)$/.exec(url.pathname);
      const portalFormDetailMatch = /^\/portal\/forms\/([^/]+)$/.exec(url.pathname);
      const invoicePayMatch = /^\/portal\/invoices\/([^/]+)\/pay$/.exec(url.pathname);
      if (method === "POST" && handlers != null && invoicePayMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
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

const adminClientProfileMatch = /^\/admin\/clients\/([^/]+)\/profile$/.exec(url.pathname);
const adminClientContactsMatch = /^\/admin\/clients\/([^/]+)\/contacts$/.exec(url.pathname);
const adminClientAchievementsMatch = /^\/admin\/clients\/([^/]+)\/achievements$/.exec(url.pathname);
const adminClientAchievementDetailMatch = /^\/admin\/clients\/([^/]+)\/achievements\/([^/]+)$/.exec(url.pathname);
const adminClientAchievementCertificateDetailMatch = /^\/admin\/clients\/([^/]+)\/achievements\/([^/]+)\/certificate$/.exec(url.pathname);
const legacyClientListPath = url.pathname === "/client/clients_list.php";
const legacyClientDetailPath = url.pathname === "/client/clients_view.php";
const legacyClientEditPath = url.pathname === "/client/clients_edit.php";
const legacyPetListPath = url.pathname === "/client/pets_list.php";
const legacyPetDetailPath = url.pathname === "/client/pets_view.php";
const legacyPetEditPath = url.pathname === "/client/pets_edit.php";
const legacyBookingListPath = url.pathname === "/client/bookings_list.php";
const legacyExpenseDetailPath = url.pathname === "/client/expenses_edit.php";
const legacyInvoiceDetailPath = url.pathname === "/client/invoices_view.php";
const legacyQuoteListPath = url.pathname === "/client/quotes_list.php";
const legacyQuoteDetailPath = url.pathname === "/client/quotes_view.php";
const legacyContractListPath = url.pathname === "/client/contracts_list.php";
const legacyContractDetailPath = url.pathname === "/client/contracts_view.php";
const legacyPackageListPath = url.pathname === "/client/packages_list.php";
const legacyPackageEditPath = url.pathname === "/client/packages_edit.php";
const legacyCreditsManagePath = url.pathname === "/client/credits_manage.php";
const portalBookingDetailMatch = /^\/portal\/bookings\/([^/]+)$/.exec(url.pathname);
      const portalContactDetailMatch = /^\/portal\/contacts\/([^/]+)$/.exec(url.pathname);
      const portalContactDeleteMatch = /^\/portal\/contacts\/([^/]+)\/delete$/.exec(url.pathname);
      const portalPetDetailMatch = /^\/portal\/pets\/([^/]+)$/.exec(url.pathname);
      const portalPetFilesMatch = /^\/portal\/pets\/([^/]+)\/files$/.exec(url.pathname);
      const portalPetFileContentMatch = /^\/portal\/pets\/([^/]+)\/files\/([^/]+)\/content$/.exec(url.pathname);
      const portalPetFileDeleteMatch = /^\/portal\/pets\/([^/]+)\/files\/([^/]+)\/delete$/.exec(url.pathname);
      const portalPackageDetailMatch = /^\/portal\/packages\/([^/]+)$/.exec(url.pathname);
      const portalCreditDetailMatch = /^\/portal\/credits\/([^/]+)$/.exec(url.pathname);
 const adminClientContactDetailMatch = /^\/admin\/clients\/([^/]+)\/contacts\/([^/]+)$/.exec(url.pathname);
 const adminClientContactDeleteMatch = /^\/admin\/clients\/([^/]+)\/contacts\/([^/]+)\/delete$/.exec(url.pathname);
 const adminBookingDetailMatch = /^\/admin\/bookings\/([^/]+)$/.exec(url.pathname);
 const adminExpenseDetailMatch = /^\/admin\/expenses\/([^/]+)$/.exec(url.pathname);
 const adminInvoiceDetailMatch = /^\/admin\/invoices\/([^/]+)$/.exec(url.pathname);
 const adminQuoteDetailMatch = /^\/admin\/quotes\/([^/]+)$/.exec(url.pathname);
      const adminContractDetailMatch = /^\/admin\/contracts\/([^/]+)$/.exec(url.pathname);
      const adminPetDetailMatch = /^\/admin\/pets\/([^/]+)$/.exec(url.pathname);
      const adminPetFilesMatch = /^\/admin\/pets\/([^/]+)\/files$/.exec(url.pathname);
      const adminPetFileContentMatch = /^\/admin\/pets\/([^/]+)\/files\/([^/]+)\/content$/.exec(url.pathname);
      const adminPetFileDeleteMatch = /^\/admin\/pets\/([^/]+)\/files\/([^/]+)\/delete$/.exec(url.pathname);
      const adminPackageDetailMatch = /^\/admin\/packages\/([^/]+)$/.exec(url.pathname);
      const adminCreditDetailMatch = /^\/admin\/credits\/([^/]+)$/.exec(url.pathname);
      const adminFormDetailMatch = /^\/admin\/forms\/([^/]+)$/.exec(url.pathname);
      const adminFormReviewMatch = /^\/admin\/forms\/([^/]+)\/review$/.exec(url.pathname);
      const adminFormUnreviewMatch = /^\/admin\/forms\/([^/]+)\/unreview$/.exec(url.pathname);
      const adminAchievementTypeDetailMatch = /^\/admin\/achievement-types\/([^/]+)$/.exec(url.pathname);
      const adminBlogPostDetailMatch = /^\/admin\/blog-posts\/([^/]+)$/.exec(url.pathname);
      const adminBlogPostDeleteMatch = /^\/admin\/blog-posts\/([^/]+)\/delete$/.exec(url.pathname);
      const legacyBlogListPath = url.pathname === "/client/blog_list.php";
      const legacyBlogEditPath = url.pathname === "/client/blog_edit.php";
      const legacyBlogDeletePath = url.pathname === "/client/blog_delete.php";
      const legacyBlogPostId = url.searchParams.get("id") ?? "";
      const legacySitePagesListPath = url.pathname === "/client/site_pages_list.php";
      const legacySitePageEditorPath = url.pathname === "/client/site_editor.php";
      const legacySitePageId = url.searchParams.get("id") ?? "";
      const adminSitePageEditorMatch = /^\/admin\/site-pages\/([^/]+)\/editor$/.exec(url.pathname);
      const adminSitePageTogglePublishMatch = /^\/admin\/site-pages\/([^/]+)\/toggle-publish$/.exec(url.pathname);
      const adminSitePageDeleteMatch = /^\/admin\/site-pages\/([^/]+)\/delete$/.exec(url.pathname);
      const adminSitePageDetailMatch = /^\/admin\/site-pages\/([^/]+)$/.exec(url.pathname);
      const legacyWorkflowListPath = url.pathname === "/client/workflows_list.php";
      const legacyWorkflowEditPath = url.pathname === "/client/workflows_edit.php";
      const legacyWorkflowDeletePath = url.pathname === "/client/workflows_delete.php";
      const legacyWorkflowEnrollmentsPath = url.pathname === "/client/workflows_enrollments.php";
      const legacyWorkflowEnrollPath = url.pathname === "/client/workflows_enroll.php";
      const legacyWorkflowStepsPath = url.pathname === "/client/workflows_steps.php";
      const legacyWorkflowStepEditPath = url.pathname === "/client/workflows_steps_edit.php";
      const legacyWorkflowId = url.searchParams.get("workflow_id") ?? url.searchParams.get("id") ?? "";
      const legacyWorkflowStepId = url.searchParams.get("step_id") ?? "";
      const adminWorkflowEnrollmentsCancelMatch = /^\/admin\/workflows\/([^/]+)\/enrollments\/([^/]+)\/cancel$/.exec(url.pathname);
      const adminWorkflowEnrollmentsMatch = /^\/admin\/workflows\/([^/]+)\/enrollments$/.exec(url.pathname);
      const adminWorkflowEnrollMatch = /^\/admin\/workflows\/([^/]+)\/enroll$/.exec(url.pathname);
      const adminWorkflowTriggerDeleteMatch = /^\/admin\/workflows\/([^/]+)\/triggers\/([^/]+)\/delete$/.exec(url.pathname);
      const adminWorkflowTriggersMatch = /^\/admin\/workflows\/([^/]+)\/triggers$/.exec(url.pathname);
      const adminWorkflowStepDeleteMatch = /^\/admin\/workflows\/([^/]+)\/steps\/([^/]+)\/delete$/.exec(url.pathname);
      const adminWorkflowStepNewMatch = /^\/admin\/workflows\/([^/]+)\/steps\/new$/.exec(url.pathname);
      const adminWorkflowStepDetailMatch = /^\/admin\/workflows\/([^/]+)\/steps\/([^/]+)$/.exec(url.pathname);
      const adminWorkflowStepsMatch = /^\/admin\/workflows\/([^/]+)\/steps$/.exec(url.pathname);
      const adminWorkflowDeleteMatch = /^\/admin\/workflows\/([^/]+)\/delete$/.exec(url.pathname);
      const adminWorkflowDetailMatch = /^\/admin\/workflows\/([^/]+)$/.exec(url.pathname);
      const legacySettingsPath = url.pathname === "/client/settings.php";
      const googleCalendarOAuthInitiatePath = (
        url.pathname === adminGoogleCalendarOAuthConnectPath
        || url.pathname === legacyGoogleCalendarOAuthInitiatePath
      );
      const googleCalendarOAuthCallbackPath = (
        url.pathname === adminGoogleCalendarOAuthCallbackPath
        || url.pathname === legacyGoogleCalendarOAuthCallbackPath
      );
      const adminSettingsUserPermissionsMatch = /^\/admin\/settings\/admin-users\/([^/]+)\/permissions$/.exec(url.pathname);
      const adminSettingsUserDeleteMatch = /^\/admin\/settings\/admin-users\/([^/]+)\/delete$/.exec(url.pathname);
      const adminSettingDetailMatch = /^\/admin\/settings\/([^/]+)$/.exec(url.pathname);
      const adminAppointmentTypeDetailMatch = /^\/admin\/appointment-types\/([^/]+)$/.exec(url.pathname);
      const adminAppointmentTypeDeleteMatch = /^\/admin\/appointment-types\/([^/]+)\/delete$/.exec(url.pathname);
      const adminAppointmentTypeDuplicateMatch = /^\/admin\/appointment-types\/([^/]+)\/duplicate$/.exec(url.pathname);
      const legacyAppointmentTypeDuplicatePath = url.pathname === "/client/appointment_types_duplicate.php";
      const adminFormTemplateDetailMatch = /^\/admin\/form-templates\/([^/]+)$/.exec(url.pathname);
      const adminFormTemplateSurveyResultsMatch = /^\/admin\/form-templates\/([^/]+)\/survey-results$/.exec(url.pathname);
      const adminFormTemplateDeleteMatch = /^\/admin\/form-templates\/([^/]+)\/delete$/.exec(url.pathname);
      const adminFormTemplateDuplicateMatch = /^\/admin\/form-templates\/([^/]+)\/duplicate$/.exec(url.pathname);
      const legacyFormTemplateListPath = url.pathname === "/client/form_templates_list.php";
      const legacyFormTemplateEditPath = url.pathname === "/client/form_templates_edit.php";
      const legacyFormTemplateDeletePath = url.pathname === "/client/form_templates_delete.php";
      const legacyFormTemplateDuplicatePath = url.pathname === "/client/form_templates_duplicate.php";
      const legacyFormRequestCreatePath = url.pathname === "/client/form_requests_create.php";
      const legacyFormSubmissionsListPath = url.pathname === "/client/form_submissions_list.php";
      const legacyFormSubmissionsViewPath = url.pathname === "/client/form_submissions_view.php";
      const legacyFormSurveyResultsPath = url.pathname === "/client/form_survey_results.php";
      const adminEmailTemplateDetailMatch = /^\/admin\/email-templates\/([^/]+)$/.exec(url.pathname);
      const adminEmailTemplateDuplicateMatch = /^\/admin\/email-templates\/([^/]+)\/duplicate$/.exec(url.pathname);
      const legacyEmailTemplateDuplicatePath = url.pathname === "/client/email_templates_duplicate.php";
      const adminScheduledTaskDetailMatch = /^\/admin\/scheduled-tasks\/([^/]+)$/.exec(url.pathname);
      const adminOperationJobDetailMatch = /^\/admin\/operations\/jobs\/([^/]+)$/.exec(url.pathname);
      const adminOperationCallbackDetailMatch = /^\/admin\/operations\/callbacks\/([^/]+)$/.exec(url.pathname);

      if (method === "POST" && handlers != null && url.pathname === "/admin/blog-posts") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminBlogPostCreate(session, {
          title: readRequiredFormValue(form, "title"),
          slug: readRequiredFormValue(form, "slug"),
          content: form.get("content") ?? "",
          excerpt: form.get("excerpt") ?? "",
          coverPhoto: readOptionalFormValue(form, "coverPhoto"),
          author: readRequiredFormValue(form, "author"),
          published: readCheckedFormValue(form, "published"),
          publishDate: readOptionalFormValue(form, "publishDate")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Blog Posts",
            body: `<article><h1>Admin Blog Posts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/blog-posts/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminBlogPostDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const postId = decodeURIComponent(adminBlogPostDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminBlogPostUpdate(session, postId, {
          title: readRequiredFormValue(form, "title"),
          slug: readRequiredFormValue(form, "slug"),
          content: form.get("content") ?? "",
          excerpt: form.get("excerpt") ?? "",
          coverPhoto: readOptionalFormValue(form, "coverPhoto"),
          author: readRequiredFormValue(form, "author"),
          published: readCheckedFormValue(form, "published"),
          publishDate: readOptionalFormValue(form, "publishDate")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Blog Post",
            body: `<article><h1>Admin Blog Post</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/blog-posts/${encodeURIComponent(postId)}`);
        return;
      }

      if (method === "POST" && handlers != null && legacyBlogEditPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = legacyBlogPostId === ""
          ? await handlers.handleAdminBlogPostCreate(session, {
            title: readRequiredFormValue(form, "title"),
            slug: readRequiredFormValue(form, "slug"),
            content: form.get("content") ?? "",
            excerpt: form.get("excerpt") ?? "",
            coverPhoto: readOptionalFormValue(form, "coverPhoto"),
            author: readRequiredFormValue(form, "author"),
            published: readCheckedFormValue(form, "published"),
            publishDate: readOptionalFormValue(form, "publishDate")
          })
          : await handlers.handleAdminBlogPostUpdate(session, legacyBlogPostId, {
            title: readRequiredFormValue(form, "title"),
            slug: readRequiredFormValue(form, "slug"),
            content: form.get("content") ?? "",
            excerpt: form.get("excerpt") ?? "",
            coverPhoto: readOptionalFormValue(form, "coverPhoto"),
            author: readRequiredFormValue(form, "author"),
            published: readCheckedFormValue(form, "published"),
            publishDate: readOptionalFormValue(form, "publishDate")
          });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: legacyBlogPostId === "" ? "Create Blog Post" : "Edit Blog Post",
            body: `<article><h1>${legacyBlogPostId === "" ? "Create Blog Post" : "Edit Blog Post"}</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/client/blog_list.php");
        return;
      }

      if (method === "POST" && handlers != null && legacyBlogDeletePath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const postId = readOptionalFormValue(form, "id");
        if (postId != null) {
          await handlers.handleAdminBlogPostDelete(session, postId);
        }
        redirect(response, "/client/blog_list.php");
        return;
      }

      if (method === "POST" && handlers != null && legacySitePagesListPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminSitePageCreate(session, {
          slug: readRequiredFormValue(form, "slug"),
          title: readRequiredFormValue(form, "title"),
          htmlContent: form.get("htmlContent") ?? "",
          cssContent: form.get("cssContent") ?? "",
          metaDescription: form.get("metaDescription") ?? "",
          metaKeywords: form.get("metaKeywords") ?? "",
          ogTitle: readOptionalFormValue(form, "ogTitle"),
          ogDescription: readOptionalFormValue(form, "ogDescription"),
          ogImage: readOptionalFormValue(form, "ogImage"),
          isHomepage: readCheckedFormValue(form, "isHomepage"),
          published: readCheckedFormValue(form, "published"),
          sortOrder: Number.parseInt(readRequiredFormValue(form, "sortOrder"), 10)
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Site Pages",
            body: `<article><h1>Admin Site Pages</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/client/site_editor.php?id=${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminBlogPostDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const postId = decodeURIComponent(adminBlogPostDeleteMatch[1] ?? "");
        await handlers.handleAdminBlogPostDelete(session, postId);
        redirect(response, "/admin/blog-posts");
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/site-pages") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminSitePageCreate(session, {
          slug: readRequiredFormValue(form, "slug"),
          title: readRequiredFormValue(form, "title"),
          htmlContent: form.get("htmlContent") ?? "",
          cssContent: form.get("cssContent") ?? "",
          metaDescription: form.get("metaDescription") ?? "",
          metaKeywords: form.get("metaKeywords") ?? "",
          ogTitle: readOptionalFormValue(form, "ogTitle"),
          ogDescription: readOptionalFormValue(form, "ogDescription"),
          ogImage: readOptionalFormValue(form, "ogImage"),
          isHomepage: readCheckedFormValue(form, "isHomepage"),
          published: readCheckedFormValue(form, "published"),
          sortOrder: Number.parseInt(readRequiredFormValue(form, "sortOrder"), 10)
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Site Pages",
            body: `<article><h1>Admin Site Pages</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/site-pages/${encodeURIComponent(result.body.item.id)}/editor`);
        return;
      }

      if (method === "POST" && handlers != null && adminSitePageDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const pageId = decodeURIComponent(adminSitePageDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminSitePageUpdate(session, pageId, {
          slug: readRequiredFormValue(form, "slug"),
          title: readRequiredFormValue(form, "title"),
          htmlContent: form.get("htmlContent") ?? "",
          cssContent: form.get("cssContent") ?? "",
          metaDescription: form.get("metaDescription") ?? "",
          metaKeywords: form.get("metaKeywords") ?? "",
          ogTitle: readOptionalFormValue(form, "ogTitle"),
          ogDescription: readOptionalFormValue(form, "ogDescription"),
          ogImage: readOptionalFormValue(form, "ogImage"),
          isHomepage: readCheckedFormValue(form, "isHomepage"),
          published: readCheckedFormValue(form, "published"),
          sortOrder: Number.parseInt(readRequiredFormValue(form, "sortOrder"), 10)
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Site Page",
            body: `<article><h1>Admin Site Page</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/site-pages/${encodeURIComponent(pageId)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminSitePageTogglePublishMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const pageId = decodeURIComponent(adminSitePageTogglePublishMatch[1] ?? "");
        const current = await handlers.handleAdminSitePageDetail(session, pageId);
        if ("error" in current.body) {
          redirect(response, "/admin/site-pages");
          return;
        }

        const page = current.body.item;
        const result = await handlers.handleAdminSitePageUpdate(session, pageId, {
          slug: page.slug,
          title: page.title,
          htmlContent: page.htmlContent,
          cssContent: page.cssContent,
          metaDescription: page.metaDescription,
          metaKeywords: page.metaKeywords,
          ogTitle: page.ogTitle,
          ogDescription: page.ogDescription,
          ogImage: page.ogImage,
          isHomepage: page.isHomepage,
          published: !page.published,
          sortOrder: page.sortOrder
        });

        if ("error" in result.body) {
          redirect(response, `/admin/site-pages/${encodeURIComponent(pageId)}`);
          return;
        }

        redirect(response, "/admin/site-pages");
        return;
      }

      if (method === "POST" && handlers != null && adminSitePageDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const pageId = decodeURIComponent(adminSitePageDeleteMatch[1] ?? "");
        await handlers.handleAdminSitePageDelete(session, pageId);
        redirect(response, "/admin/site-pages");
        return;
      }

      if (method === "POST" && handlers != null && legacyWorkflowEditPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const deleteTriggerId = readOptionalFormValue(form, "delete_trigger_id");
        if (legacyWorkflowId !== "" && deleteTriggerId != null) {
          await handlers.handleAdminWorkflowTriggerDelete(session, legacyWorkflowId, deleteTriggerId);
          redirect(response, `/client/workflows_edit.php?id=${encodeURIComponent(legacyWorkflowId)}#triggers`);
          return;
        }

        if (legacyWorkflowId !== "" && form.has("add_trigger")) {
          const triggerResult = await handlers.handleAdminWorkflowTriggerCreate(session, legacyWorkflowId, {
            triggerType: readRequiredFormValue(form, "triggerType"),
            appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId"),
            formTemplateId: readOptionalFormValue(form, "formTemplateId"),
            active: readCheckedFormValue(form, "active")
          });

          if ("error" in triggerResult.body) {
            writeHtml(response, triggerResult.status, renderLayout({
              title: "Admin Workflow",
              body: `<article><h1>Admin Workflow</h1><p>${escapeHtml(triggerResult.body.error.message)}</p></article>`
            }));
            return;
          }

          redirect(response, `/client/workflows_edit.php?id=${encodeURIComponent(legacyWorkflowId)}#triggers`);
          return;
        }

        const result = legacyWorkflowId === ""
          ? await handlers.handleAdminWorkflowCreate(session, {
            name: readRequiredFormValue(form, "name"),
            description: form.get("description") ?? "",
            trigger: readRequiredFormValue(form, "trigger"),
            active: readCheckedFormValue(form, "active")
          })
          : await handlers.handleAdminWorkflowUpdate(session, legacyWorkflowId, {
            name: readRequiredFormValue(form, "name"),
            description: form.get("description") ?? "",
            trigger: readRequiredFormValue(form, "trigger"),
            active: readCheckedFormValue(form, "active")
          });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: legacyWorkflowId === "" ? "Admin Workflows" : "Admin Workflow",
            body: `<article><h1>${legacyWorkflowId === "" ? "Admin Workflows" : "Admin Workflow"}</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        const workflowId = legacyWorkflowId === "" ? result.body.item.id : legacyWorkflowId;
        redirect(response, `/client/workflows_steps.php?workflow_id=${encodeURIComponent(workflowId)}`);
        return;
      }

      if (method === "POST" && handlers != null && legacyWorkflowDeletePath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const workflowId = readOptionalFormValue(form, "id");
        if (workflowId != null) {
          await handlers.handleAdminWorkflowDelete(session, workflowId);
        }
        redirect(response, "/client/workflows_list.php");
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/workflows") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowCreate(session, {
          name: readRequiredFormValue(form, "name"),
          description: form.get("description") ?? "",
          trigger: readRequiredFormValue(form, "trigger"),
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Workflows",
            body: `<article><h1>Admin Workflows</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowUpdate(session, workflowId, {
          name: readRequiredFormValue(form, "name"),
          description: form.get("description") ?? "",
          trigger: readRequiredFormValue(form, "trigger"),
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Workflow",
            body: `<article><h1>Admin Workflow</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowTriggersMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowTriggersMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowTriggerCreate(session, workflowId, {
          triggerType: readRequiredFormValue(form, "triggerType"),
          appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId"),
          formTemplateId: readOptionalFormValue(form, "formTemplateId"),
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Workflow",
            body: `<article><h1>Admin Workflow</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}#triggers`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowTriggerDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowTriggerDeleteMatch[1] ?? "");
        const triggerId = decodeURIComponent(adminWorkflowTriggerDeleteMatch[2] ?? "");
        await handlers.handleAdminWorkflowTriggerDelete(session, workflowId, triggerId);
        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}#triggers`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowDeleteMatch[1] ?? "");
        await handlers.handleAdminWorkflowDelete(session, workflowId);
        redirect(response, "/admin/workflows");
        return;
      }

      if (method === "POST" && handlers != null && legacyWorkflowEnrollPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowEnroll(session, legacyWorkflowId, {
          clientIds: form.getAll("clientIds").map((value) => String(value).trim()).filter((value) => value !== "")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Workflow Enrollment",
            body: `<article><h1>Workflow Enrollment</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(legacyWorkflowId)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowEnrollMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowEnrollMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowEnroll(session, workflowId, {
          clientIds: form.getAll("clientIds").map((value) => String(value).trim()).filter((value) => value !== "")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Workflow Enrollment",
            body: `<article><h1>Workflow Enrollment</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}/enrollments`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowEnrollmentsCancelMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowEnrollmentsCancelMatch[1] ?? "");
        const enrollmentId = decodeURIComponent(adminWorkflowEnrollmentsCancelMatch[2] ?? "");
        await handlers.handleAdminWorkflowEnrollmentCancel(session, workflowId, enrollmentId);
        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}/enrollments`);
        return;
      }

      if (method === "POST" && handlers != null && legacyWorkflowStepEditPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = legacyWorkflowStepId === ""
          ? await handlers.handleAdminWorkflowStepCreate(session, legacyWorkflowId, {
            stepName: readRequiredFormValue(form, "stepName"),
            emailSubject: readRequiredFormValue(form, "emailSubject"),
            emailBodyHtml: form.get("emailBodyHtml") ?? "",
            emailBodyText: readOptionalFormValue(form, "emailBodyText"),
            delayType: readRequiredFormValue(form, "delayType"),
            delayValue: readOptionalFormValue(form, "delayValue"),
            scheduledDate: readOptionalTimestampFormValue(form, "scheduledDate"),
            attachContractId: readOptionalFormValue(form, "attachContractId"),
            attachFormId: readOptionalFormValue(form, "attachFormId"),
            attachQuoteId: readOptionalFormValue(form, "attachQuoteId"),
            attachInvoiceId: readOptionalFormValue(form, "attachInvoiceId"),
            includeAppointmentLink: readCheckedFormValue(form, "includeAppointmentLink"),
            appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId")
          })
          : await handlers.handleAdminWorkflowStepUpdate(session, legacyWorkflowId, legacyWorkflowStepId, {
            stepName: readRequiredFormValue(form, "stepName"),
            emailSubject: readRequiredFormValue(form, "emailSubject"),
            emailBodyHtml: form.get("emailBodyHtml") ?? "",
            emailBodyText: readOptionalFormValue(form, "emailBodyText"),
            delayType: readRequiredFormValue(form, "delayType"),
            delayValue: readOptionalFormValue(form, "delayValue"),
            scheduledDate: readOptionalTimestampFormValue(form, "scheduledDate"),
            attachContractId: readOptionalFormValue(form, "attachContractId"),
            attachFormId: readOptionalFormValue(form, "attachFormId"),
            attachQuoteId: readOptionalFormValue(form, "attachQuoteId"),
            attachInvoiceId: readOptionalFormValue(form, "attachInvoiceId"),
            includeAppointmentLink: readCheckedFormValue(form, "includeAppointmentLink"),
            appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId")
          });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: legacyWorkflowStepId === "" ? "Add Workflow Step" : "Edit Workflow Step",
            body: `<article><h1>${legacyWorkflowStepId === "" ? "Add Workflow Step" : "Edit Workflow Step"}</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/client/workflows_steps.php?workflow_id=${encodeURIComponent(legacyWorkflowId)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowStepsMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowStepsMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowStepCreate(session, workflowId, {
          stepName: readRequiredFormValue(form, "stepName"),
          emailSubject: readRequiredFormValue(form, "emailSubject"),
          emailBodyHtml: form.get("emailBodyHtml") ?? "",
          emailBodyText: readOptionalFormValue(form, "emailBodyText"),
          delayType: readRequiredFormValue(form, "delayType"),
          delayValue: readOptionalFormValue(form, "delayValue"),
          scheduledDate: readOptionalTimestampFormValue(form, "scheduledDate"),
          attachContractId: readOptionalFormValue(form, "attachContractId"),
          attachFormId: readOptionalFormValue(form, "attachFormId"),
          attachQuoteId: readOptionalFormValue(form, "attachQuoteId"),
          attachInvoiceId: readOptionalFormValue(form, "attachInvoiceId"),
          includeAppointmentLink: readCheckedFormValue(form, "includeAppointmentLink"),
          appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Workflow Step",
            body: `<article><h1>Workflow Step</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(result.body.item?.id ?? "")}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowStepDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowStepDetailMatch[1] ?? "");
        const stepId = decodeURIComponent(adminWorkflowStepDetailMatch[2] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminWorkflowStepUpdate(session, workflowId, stepId, {
          stepName: readRequiredFormValue(form, "stepName"),
          emailSubject: readRequiredFormValue(form, "emailSubject"),
          emailBodyHtml: form.get("emailBodyHtml") ?? "",
          emailBodyText: readOptionalFormValue(form, "emailBodyText"),
          delayType: readRequiredFormValue(form, "delayType"),
          delayValue: readOptionalFormValue(form, "delayValue"),
          scheduledDate: readOptionalTimestampFormValue(form, "scheduledDate"),
          attachContractId: readOptionalFormValue(form, "attachContractId"),
          attachFormId: readOptionalFormValue(form, "attachFormId"),
          attachQuoteId: readOptionalFormValue(form, "attachQuoteId"),
          attachInvoiceId: readOptionalFormValue(form, "attachInvoiceId"),
          includeAppointmentLink: readCheckedFormValue(form, "includeAppointmentLink"),
          appointmentTypeId: readOptionalFormValue(form, "appointmentTypeId")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Workflow Step",
            body: `<article><h1>Workflow Step</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}/steps/${encodeURIComponent(stepId)}`);
        return;
      }

      if (method === "POST" && handlers != null && legacyWorkflowStepsPath) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const stepId = readOptionalFormValue(form, "delete_step_id");
        if (stepId != null && legacyWorkflowId !== "") {
          await handlers.handleAdminWorkflowStepDelete(session, legacyWorkflowId, stepId);
        }
        redirect(response, `/client/workflows_steps.php?workflow_id=${encodeURIComponent(legacyWorkflowId)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminWorkflowStepDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const workflowId = decodeURIComponent(adminWorkflowStepDeleteMatch[1] ?? "");
        const stepId = decodeURIComponent(adminWorkflowStepDeleteMatch[2] ?? "");
        await handlers.handleAdminWorkflowStepDelete(session, workflowId, stepId);
        redirect(response, `/admin/workflows/${encodeURIComponent(workflowId)}/steps`);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/settings/admin-users") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        try {
          await createAdminSettingsUser(session as z.infer<typeof authSessionSchema>, {
            username: readRequiredFormValue(form, "username"),
            email: readRequiredFormValue(form, "email"),
            password: readRequiredFormValue(form, "password"),
            accountType: readRequiredFormValue(form, "accountType")
          }, resolved.content);
          redirect(response, "/admin/settings?category=admins&notice=admin-user-created");
          return;
        } catch (error) {
          if (error instanceof ContentError || error instanceof z.ZodError) {
            redirect(response, `/admin/settings?category=admins&error=${encodeURIComponent(error instanceof ContentError ? error.message : "Enter a valid username, email, password, and account type.")}`);
            return;
          }
          throw error;
        }
      }

      if (method === "POST" && adminSettingsUserPermissionsMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        try {
          await updateAdminSettingsUserPermissions(
            session as z.infer<typeof authSessionSchema>,
            decodeURIComponent(adminSettingsUserPermissionsMatch[1] ?? ""),
            {
              canManageAdminUsers: readCheckedFormValue(form, "canManageAdminUsers"),
              canManageApiKeys: readCheckedFormValue(form, "canManageApiKeys")
            },
            resolved.content
          );
          redirect(response, "/admin/settings?category=admins&notice=admin-permissions-updated");
          return;
        } catch (error) {
          if (error instanceof ContentError || error instanceof z.ZodError) {
            redirect(response, `/admin/settings?category=admins&error=${encodeURIComponent(error instanceof ContentError ? error.message : "Unable to update admin permissions.")}`);
            return;
          }
          throw error;
        }
      }

      if (method === "POST" && adminSettingsUserDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        try {
          await deleteAdminSettingsUser(
            session as z.infer<typeof authSessionSchema>,
            decodeURIComponent(adminSettingsUserDeleteMatch[1] ?? ""),
            resolved.content
          );
          redirect(response, "/admin/settings?category=admins&notice=admin-user-deleted");
          return;
        } catch (error) {
          if (error instanceof ContentError || error instanceof z.ZodError) {
            redirect(response, `/admin/settings?category=admins&error=${encodeURIComponent(error instanceof ContentError ? error.message : "Unable to delete admin user.")}`);
            return;
          }
          throw error;
        }
      }

      if (method === "POST" && url.pathname === "/admin/settings/runtime-environment") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        try {
          const settingsOverview = await getAdminSettingsOverview(session as z.infer<typeof authSessionSchema>, resolved.content);
          if (!canAccessRuntimeEnvironmentSettings(settingsOverview.currentAdmin)) {
            redirect(response, `/admin/settings?category=overview&error=${encodeURIComponent("You do not have permission to access database settings.")}`);
            return;
          }

          const updates = Object.fromEntries(
            runtimeEnvironmentFieldDefinitions.map((field) => [field.key, readOptionalFormValue(form, field.key) ?? ""])
          );

          await updateEnvFileValues({
            filePath: runtimeEnvironmentPaths.filePath,
            templateFilePath: runtimeEnvironmentPaths.templateFilePath,
            updates
          });

          redirect(response, "/admin/settings?category=database&notice=runtime-environment-saved");
          return;
        } catch (error) {
          if (error instanceof SessionActorError) {
            redirect(response, buildAdminLoginRedirectPath(request));
            return;
          }
          redirect(response, `/admin/settings?category=database&error=${encodeURIComponent(error instanceof Error ? error.message : "Unable to update runtime environment settings.")}`);
          return;
        }
      }

      if (method === "POST" && handlers != null && adminSettingDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const key = decodeURIComponent(adminSettingDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminSettingUpdate(session, key, {
          value: form.getAll("value").at(-1) ?? form.get("value") ?? ""
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Setting",
            body: `<article><h1>Admin Setting</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/settings/${encodeURIComponent(key)}`);
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/appointment-types") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminAppointmentTypeCreate(session, readAdminAppointmentTypeFormInput(form));

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Appointment Types",
            body: `<article><h1>Admin Appointment Types</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/appointment-types/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminAppointmentTypeDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const appointmentTypeId = decodeURIComponent(adminAppointmentTypeDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminAppointmentTypeUpdate(
          session,
          appointmentTypeId,
          readAdminAppointmentTypeFormInput(form)
        );

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Appointment Type",
            body: `<article><h1>Admin Appointment Type</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/appointment-types/${encodeURIComponent(appointmentTypeId)}`);
        return;
      }

      if (method === "POST" && handlers != null && (adminAppointmentTypeDuplicateMatch != null || legacyAppointmentTypeDuplicatePath)) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = legacyAppointmentTypeDuplicatePath ? await readFormBody(request) : null;
        const appointmentTypeId = adminAppointmentTypeDuplicateMatch != null
          ? decodeURIComponent(adminAppointmentTypeDuplicateMatch[1] ?? "")
          : readOptionalFormValue(form as URLSearchParams, "id") ?? "";
        const current = await handlers.handleAdminAppointmentTypeDetail(session, appointmentTypeId);
        if ("error" in current.body) {
          redirect(response, legacyAppointmentTypeDuplicatePath ? "/client/appointment_types_list.php" : "/admin/appointment-types");
          return;
        }

        const result = await handlers.handleAdminAppointmentTypeCreate(session, {
          ...current.body.item,
          name: buildDuplicateDisplayName(current.body.item.name),
          uniqueLink: buildDuplicateMachineKey(current.body.item.uniqueLink)
        });
        if ("error" in result.body) {
          redirect(response, legacyAppointmentTypeDuplicatePath ? "/client/appointment_types_list.php" : "/admin/appointment-types");
          return;
        }

        redirect(response, legacyAppointmentTypeDuplicatePath
          ? "/client/appointment_types_list.php"
          : `/admin/appointment-types/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminAppointmentTypeDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const appointmentTypeId = decodeURIComponent(adminAppointmentTypeDeleteMatch[1] ?? "");
        await handlers.handleAdminAppointmentTypeDelete(session, appointmentTypeId);
        redirect(response, "/admin/appointment-types");
        return;
      }

      if (
        method === "POST"
        && handlers != null
        && (url.pathname === "/admin/form-templates" || (legacyFormTemplateEditPath && (url.searchParams.get("id") ?? "").trim() === ""))
      ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminFormTemplateCreate(session, readAdminFormTemplateFormInput(form));

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Form Templates",
            body: `<article><h1>Admin Form Templates</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(
          response,
          legacyFormTemplateEditPath
            ? "/client/form_templates_list.php"
            : `/admin/form-templates/${encodeURIComponent(result.body.item.id)}`
        );
        return;
      }

      if (
        method === "POST"
        && handlers != null
        && (adminFormTemplateDetailMatch != null || (legacyFormTemplateEditPath && (url.searchParams.get("id") ?? "").trim() !== ""))
      ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const templateId = adminFormTemplateDetailMatch != null
          ? decodeURIComponent(adminFormTemplateDetailMatch[1] ?? "")
          : url.searchParams.get("id") ?? "";
        const form = await readFormBody(request);
        const result = await handlers.handleAdminFormTemplateUpdate(
          session,
          templateId,
          readAdminFormTemplateFormInput(form)
        );

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Form Template",
            body: `<article><h1>Admin Form Template</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(
          response,
          adminFormTemplateDetailMatch != null
            ? `/admin/form-templates/${encodeURIComponent(templateId)}`
            : `/client/form_templates_edit.php?id=${encodeURIComponent(templateId)}`
        );
        return;
      }

      if (method === "POST" && handlers != null && (adminFormTemplateDuplicateMatch != null || legacyFormTemplateDuplicatePath)) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = legacyFormTemplateDuplicatePath ? await readFormBody(request) : null;
        const templateId = adminFormTemplateDuplicateMatch != null
          ? decodeURIComponent(adminFormTemplateDuplicateMatch[1] ?? "")
          : readOptionalFormValue(form as URLSearchParams, "id") ?? "";
        const current = await handlers.handleAdminFormTemplateDetail(session, templateId);
        if ("error" in current.body) {
          redirect(response, legacyFormTemplateDuplicatePath ? "/client/form_templates_list.php" : "/admin/form-templates");
          return;
        }

        const result = await handlers.handleAdminFormTemplateCreate(session, {
          name: buildDuplicateDisplayName(current.body.item.name),
          active: current.body.item.active,
          description: current.body.item.description ?? "",
          fields: current.body.item.fields ?? [],
          formType: current.body.item.formType ?? "client_form",
          requiredFrequency: current.body.item.requiredFrequency ?? null,
          appointmentTypeId: current.body.item.appointmentTypeId ?? null,
          templateIsInternal: current.body.item.templateIsInternal ?? false,
          templateShowInClientPortal: current.body.item.templateShowInClientPortal ?? true
        });
        if ("error" in result.body) {
          redirect(response, legacyFormTemplateDuplicatePath ? "/client/form_templates_list.php" : "/admin/form-templates");
          return;
        }

        redirect(
          response,
          legacyFormTemplateDuplicatePath
            ? "/client/form_templates_list.php"
            : `/admin/form-templates/${encodeURIComponent(result.body.item.id)}`
        );
        return;
      }

      if (method === "POST" && handlers != null && (adminFormTemplateDeleteMatch != null || legacyFormTemplateDeletePath)) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = legacyFormTemplateDeletePath ? await readFormBody(request) : null;
        const templateId = adminFormTemplateDeleteMatch != null
          ? decodeURIComponent(adminFormTemplateDeleteMatch[1] ?? "")
          : readOptionalFormValue(form as URLSearchParams, "id") ?? "";
        const result = await handlers.handleAdminFormTemplateDelete(session, templateId);
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Form Template",
            body: `<article><h1>Admin Form Template</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, legacyFormTemplateDeletePath ? "/client/form_templates_list.php" : "/admin/form-templates");
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/email-templates") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminEmailTemplateCreate(session, {
          name: readRequiredFormValue(form, "name"),
          templateType: readRequiredFormValue(form, "templateType"),
          subject: readRequiredFormValue(form, "subject"),
          bodyHtml: form.get("bodyHtml") ?? "",
          bodyText: form.get("bodyText") ?? "",
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Email Templates",
            body: `<article><h1>Admin Email Templates</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/email-templates/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminEmailTemplateDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const templateId = decodeURIComponent(adminEmailTemplateDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminEmailTemplateUpdate(session, templateId, {
          name: readRequiredFormValue(form, "name"),
          templateType: readRequiredFormValue(form, "templateType"),
          subject: readRequiredFormValue(form, "subject"),
          bodyHtml: form.get("bodyHtml") ?? "",
          bodyText: form.get("bodyText") ?? "",
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Email Template",
            body: `<article><h1>Admin Email Template</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/email-templates/${encodeURIComponent(templateId)}`);
        return;
      }

      if (method === "POST" && handlers != null && (adminEmailTemplateDuplicateMatch != null || legacyEmailTemplateDuplicatePath)) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = legacyEmailTemplateDuplicatePath ? await readFormBody(request) : null;
        const templateId = adminEmailTemplateDuplicateMatch != null
          ? decodeURIComponent(adminEmailTemplateDuplicateMatch[1] ?? "")
          : readOptionalFormValue(form as URLSearchParams, "id") ?? "";
        const current = await handlers.handleAdminEmailTemplateDetail(session, templateId);
        if ("error" in current.body) {
          redirect(response, legacyEmailTemplateDuplicatePath ? "/client/email_templates_list.php" : "/admin/email-templates");
          return;
        }

        const result = await handlers.handleAdminEmailTemplateCreate(session, {
          name: buildDuplicateDisplayName(current.body.item.name),
          templateType: current.body.item.templateType,
          subject: current.body.item.subject,
          bodyHtml: current.body.item.bodyHtml,
          bodyText: current.body.item.bodyText,
          active: current.body.item.active
        });
        if ("error" in result.body) {
          redirect(response, legacyEmailTemplateDuplicatePath ? "/client/email_templates_list.php" : "/admin/email-templates");
          return;
        }

        redirect(response, legacyEmailTemplateDuplicatePath
          ? "/client/email_templates_list.php"
          : `/admin/email-templates/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/scheduled-tasks") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminScheduledTaskCreate(session, {
          name: readRequiredFormValue(form, "name"),
          taskType: readRequiredFormValue(form, "taskType"),
          scheduleType: readRequiredFormValue(form, "scheduleType"),
          scheduleValue: form.get("scheduleValue") ?? "",
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Scheduled Tasks",
            body: `<article><h1>Admin Scheduled Tasks</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/scheduled-tasks/${encodeURIComponent(result.body.item.id)}`);
        return;
      }

      if (method === "POST" && handlers != null && adminScheduledTaskDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const taskId = decodeURIComponent(adminScheduledTaskDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminScheduledTaskUpdate(session, taskId, {
          name: readRequiredFormValue(form, "name"),
          taskType: readRequiredFormValue(form, "taskType"),
          scheduleType: readRequiredFormValue(form, "scheduleType"),
          scheduleValue: form.get("scheduleValue") ?? "",
          active: readCheckedFormValue(form, "active")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Scheduled Task",
            body: `<article><h1>Admin Scheduled Task</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/scheduled-tasks/${encodeURIComponent(taskId)}`);
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/portal/profile") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handlePortalProfileUpdate(session, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: form.get("phone") ?? "",
          address: form.get("address") ?? "",
          currentPassword: form.get("currentPassword") ?? "",
          newPassword: form.get("newPassword") ?? "",
          confirmPassword: form.get("confirmPassword") ?? ""
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Profile",
            body: `<article><h1>Profile</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/profile");
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/portal/contacts") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handlePortalContactCreate(session, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: readRequiredFormValue(form, "phone"),
          isPrimary: readCheckedFormValue(form, "isPrimary")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Contacts",
            body: `<article><h1>Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/contacts");
        return;
      }

      if (method === "POST" && handlers != null && portalContactDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const contactId = decodeURIComponent(portalContactDetailMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handlePortalContactUpdate(session, contactId, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: readRequiredFormValue(form, "phone"),
          isPrimary: readCheckedFormValue(form, "isPrimary")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Contacts",
            body: `<article><h1>Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/contacts");
        return;
      }

      if (method === "POST" && handlers != null && portalContactDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const contactId = decodeURIComponent(portalContactDeleteMatch[1] ?? "");
        const result = await handlers.handlePortalContactDelete(session, contactId);
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Contacts",
            body: `<article><h1>Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, "/portal/contacts");
        return;
      }

      if (method === "POST" && handlers != null && url.pathname === "/admin/clients") {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const result = await handlers.handleAdminClientCreate(session, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: form.get("phone") ?? "",
          address: form.get("address") ?? "",
          notes: form.get("notes") ?? "",
          isAdmin: readCheckedFormValue(form, "isAdmin")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Clients",
            body: `<article><h1>Admin Clients</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/clients/${encodeURIComponent(result.body.item.id)}/profile`);
        return;
      }

      if (method === "POST" && handlers != null && adminClientProfileMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const clientId = decodeURIComponent(adminClientProfileMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminClientUpdate(session, clientId, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: form.get("phone") ?? "",
          address: form.get("address") ?? "",
          notes: form.get("notes") ?? "",
          isAdmin: readCheckedFormValue(form, "isAdmin")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Client Profile",
            body: `<article><h1>Client Profile</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/profile`);
        return;
      }

      if (method === "POST" && handlers != null && adminClientContactsMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const clientId = decodeURIComponent(adminClientContactsMatch[1] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminClientContactCreate(session, clientId, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: readRequiredFormValue(form, "phone"),
          isPrimary: readCheckedFormValue(form, "isPrimary")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Client Contacts",
            body: `<article><h1>Client Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/contacts`);
        return;
      }

      if (method === "POST" && handlers != null && adminClientContactDetailMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const clientId = decodeURIComponent(adminClientContactDetailMatch[1] ?? "");
        const contactId = decodeURIComponent(adminClientContactDetailMatch[2] ?? "");
        const form = await readFormBody(request);
        const result = await handlers.handleAdminClientContactUpdate(session, clientId, contactId, {
          name: readRequiredFormValue(form, "name"),
          email: readRequiredFormValue(form, "email"),
          phone: readRequiredFormValue(form, "phone"),
          isPrimary: readCheckedFormValue(form, "isPrimary")
        });

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Client Contacts",
            body: `<article><h1>Client Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/contacts`);
        return;
      }

      if (method === "POST" && handlers != null && adminClientContactDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const clientId = decodeURIComponent(adminClientContactDeleteMatch[1] ?? "");
        const contactId = decodeURIComponent(adminClientContactDeleteMatch[2] ?? "");
        const result = await handlers.handleAdminClientContactDelete(session, clientId, contactId);

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Client Contacts",
            body: `<article><h1>Client Contacts</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/contacts`);
        return;
      }

      if (method === "POST" && handlers != null && portalPetFilesMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const petId = decodeURIComponent(portalPetFilesMatch[1] ?? "");
        const result = await handlers.handlePortalPetFileUpload(
          session,
          petId,
          await readPetFileUploadInput(request)
        );

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Pet Files",
            body: `<article><h1>Pet Files</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/portal/pets/${encodeURIComponent(petId)}/files`);
        return;
      }

      if (method === "POST" && handlers != null && portalPetFileDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const petId = decodeURIComponent(portalPetFileDeleteMatch[1] ?? "");
        const fileId = decodeURIComponent(portalPetFileDeleteMatch[2] ?? "");
        const result = await handlers.handlePortalPetFileDelete(session, petId, fileId);
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Pet Files",
            body: `<article><h1>Pet Files</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/portal/pets/${encodeURIComponent(petId)}/files`);
        return;
      }

      if (method === "POST" && handlers != null && adminPetFilesMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const petId = decodeURIComponent(adminPetFilesMatch[1] ?? "");
        const result = await handlers.handleAdminPetFileUpload(
          session,
          petId,
          await readPetFileUploadInput(request)
        );

        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Pet Files",
            body: `<article><h1>Admin Pet Files</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/pets/${encodeURIComponent(petId)}/files`);
        return;
      }

      if (method === "POST" && handlers != null && adminPetFileDeleteMatch != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const petId = decodeURIComponent(adminPetFileDeleteMatch[1] ?? "");
        const fileId = decodeURIComponent(adminPetFileDeleteMatch[2] ?? "");
        const result = await handlers.handleAdminPetFileDelete(session, petId, fileId);
        if ("error" in result.body) {
          writeHtml(response, result.status, renderLayout({
            title: "Admin Pet Files",
            body: `<article><h1>Admin Pet Files</h1><p>${escapeHtml(result.body.error.message)}</p></article>`
          }));
          return;
        }

        redirect(response, `/admin/pets/${encodeURIComponent(petId)}/files`);
        return;
      }

      if (
        handlers != null
        && (
          url.pathname === "/portal"
          || url.pathname === "/portal/appointments"
          || portalBookingDetailMatch != null
          || url.pathname === "/portal/invoices"
            || url.pathname === "/portal/quotes"
            || url.pathname === "/portal/contracts"
            || url.pathname === "/portal/forms"
            || url.pathname === "/portal/notifications"
            || url.pathname === "/portal/profile"
          || url.pathname === "/portal/contacts"
          || url.pathname === "/portal/pets"
          || portalPetDetailMatch != null
          || url.pathname === "/portal/packages"
          || portalPackageDetailMatch != null
          || url.pathname === "/portal/credits"
          || portalCreditDetailMatch != null
          || url.pathname === "/portal/achievements"
          || portalInvoiceDetailMatch != null
          || portalQuoteDetailMatch != null
          || portalContractDetailMatch != null
          || portalFormDetailMatch != null
          || portalContactDetailMatch != null
          || /^\/portal\/achievements\/([^/]+)$/.exec(url.pathname) != null
          || /^\/portal\/achievements\/([^/]+)\/certificate$/.exec(url.pathname) != null
          || portalPetFilesMatch != null
          || portalPetFileContentMatch != null
        )
      ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildPortalLoginRedirectPath(request));
          return;
        }

        const actor = await handlers.handlePortalActorProfile(session);
        if ("error" in actor.body) {
          redirect(response, buildPortalLoginRedirectPath(request), await clearPersistedSession(resolved.sessionStore, request));
          return;
        }

if (url.pathname === "/portal") {
const summary = await handlers.handlePortalSummary(session);
if ("error" in summary.body) {
if (summary.body.error.code === "unauthorized" || summary.body.error.code === "actor_not_found") {
redirect(response, buildPortalLoginRedirectPath(request), await clearPersistedSession(resolved.sessionStore, request));
return;
}

writeHtml(response, summary.status, renderLayout({
title: "Portal",
body: `<article><h1>Portal</h1><p>${escapeHtml(summary.body.error.message)}</p></article>`
}));
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Portal",
            body: [
              "<article>",
              renderSectionIntro({
                eyebrow: "Brook's Dog Training Academy",
                title: actor.body.actor.displayName,
                description: "Your appointments, invoices, documents, pets, and training account details."
              }),
              renderStatsGrid([
                {
                  label: "Open Invoices",
                  value: summary.body.openInvoices.length,
                  meta: summary.body.openInvoices.length === 1 ? "Needs review" : "Outstanding balances",
                  accent: "primary"
                },
                {
                  label: "Upcoming Appointments",
                  value: summary.body.upcomingBookings.length,
                  meta: "Scheduled services ahead",
                  accent: "secondary"
                },
                {
                  label: "Active Quotes",
                  value: summary.body.activeQuotes.length,
                  meta: "Pending approval items",
                  accent: "success"
                },
                {
                  label: "Account Status",
                  value: "Ready",
                  meta: "Records and next steps available",
                  accent: "warning"
                }
              ]),
              renderQuickLinksGrid([
                { href: "/portal/appointments", label: "Appointments", description: "View upcoming services" },
                { href: "/portal/invoices", label: "Invoices", description: "Pay or review balances" },
                { href: "/portal/forms", label: "Agreements", description: "Forms and contracts" },
                { href: "/portal/pets", label: "Pets", description: "Profiles and uploaded files" },
                { href: "/portal/profile", label: "Profile", description: "Account details" },
                { href: "/portal/achievements", label: "Achievements", description: "Certificates and awards" }
              ]),
              '<div class="content-stack">',
              '<section class="surface-block"><h2>Upcoming Bookings</h2>',
              renderDataTable({
                headers: ["Booking", "Service", "Starts", "Status"],
                rows: summary.body.upcomingBookings.map((booking) => [
                  escapeHtml(booking.id),
                  escapeHtml(booking.serviceId),
                  escapeHtml(booking.startsAt),
                  escapeHtml(booking.status)
                ]),
                emptyMessage: "No upcoming bookings."
              }),
              "</section>",
              '<section class="surface-block"><h2>Open Invoices</h2>',
              renderDataTable({
                headers: ["Invoice", "Status", "Outstanding"],
                rows: summary.body.openInvoices.map((invoice) => [
                  `<a href="/portal/invoices">${escapeHtml(invoice.id)}</a>`,
                  escapeHtml(invoice.status),
                  escapeHtml(String(invoice.outstandingAmount))
                ]),
                emptyMessage: "No open invoices."
              }),
              "</section>",
              '<section class="surface-block"><h2>Active Quotes</h2>',
              renderDataTable({
                headers: ["Quote", "Status", "Total"],
                rows: summary.body.activeQuotes.map((quote) => [
                  `<a href="/portal/quotes">${escapeHtml(quote.id)}</a>`,
                  escapeHtml(quote.status),
                  escapeHtml(String(quote.totalAmount))
                ]),
                emptyMessage: "No active quotes."
              }),
              "</section>",
              "</div>",
              "</article>"
            ].join("")
          }));
          return;
        }

const portalNav = "";

        if (url.pathname === "/portal/profile") {
          const profile = await handlers.handlePortalProfile(session);
if ("error" in profile.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Profile",
result: profile
});
return;
}

const portalProfileItem = (profile.body as { item: ClientProfile }).item;
const clientId = portalProfileItem.id;
const [
contacts,
pets,
allBookings,
allInvoices,
allQuotes,
allContracts,
allForms,
achievements
] = await Promise.all([
loadSafeRouteItems<ClientContact>(() => handlers.handlePortalContacts(session)),
loadSafeRouteItems<Pet>(() => handlers.handlePortalPets(session)),
loadSafeRouteItems<Booking>(() => handlers.handlePortalBookings(session)),
loadSafeRouteItems<Invoice>(() => handlers.handlePortalInvoices(session)),
loadSafeRouteItems<Quote>(() => handlers.handlePortalQuotes(session)),
loadSafeRouteItems<Contract>(() => handlers.handlePortalContracts(session)),
loadSafeRouteItems<FormSubmission>(() => handlers.handlePortalForms(session)),
loadSafeRouteItems<ClientAchievement>(() => handlers.handlePortalAchievements(session))
]);
const activePets = pets.filter((item) => !item.archived);
const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
const upcomingBookings = sortByTimeAsc(
allBookings.filter((booking) => isBookingUpcoming(booking)),
(booking) => booking.startsAt
).slice(0, 5);
const portalForms = sortByTimeDesc(
allForms,
(form) => form.reviewedAt ?? form.submittedAt ?? null
);
const recentForms = portalForms.slice(0, 5);
const recentAchievements = sortByTimeDesc(
achievements,
(achievement) => achievement.revokedAt ?? achievement.updatedAt ?? achievement.awardedOn
).slice(0, 5);
const openInvoices = sortByTimeAsc(
allInvoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "void" && invoice.outstandingAmount > 0),
(invoice) => invoice.dueAt
);
const outstandingBalance = openInvoices.reduce((total, invoice) => total + invoice.outstandingAmount, 0);
const activeQuotes = allQuotes.filter((quote) => quote.status === "draft" || quote.status === "sent");
const pendingContracts = allContracts.filter((contract) => contract.status !== "signed" && contract.status !== "void");
const formsToReview = portalForms.filter((form) => normalizeAdminFormSubmissionStatus(form) !== "reviewed").length;
const nextBooking = upcomingBookings[0] ?? null;
const latestAchievement = recentAchievements[0] ?? null;

writeHtml(response, 200, renderLayout({
title: "Profile",
body: [
'<article class="content-stack">',
renderSectionIntro({
eyebrow: "Profile",
 title: (profile.body as { item: ClientProfile }).item.name,
description: "Manage primary contact information, pets, forms, and billing details in one place instead of jumping across separate portal pages."
}),
portalNav,
renderStatsGrid([
{ label: "Pets", value: pets.length, meta: formatCountLabel(activePets.length, "active profile"), accent: "primary" },
{ label: "Contacts", value: contacts.length, meta: primaryContact == null ? "No primary contact saved yet" : `Primary: ${primaryContact.name}`, accent: "secondary" },
{ label: "Upcoming Visits", value: upcomingBookings.length, meta: nextBooking == null ? "Nothing on the calendar yet" : formatAdminDateTime(nextBooking.startsAt), accent: "success" },
{ label: "Open Balance", value: formatCurrency(outstandingBalance), meta: `${formatCountLabel(openInvoices.length, "invoice")} still open`, accent: "warning" }
]),
'<section class="surface-block">',
"<h2>Account Details</h2>",
renderDetailGrid([
{ label: "Client ID", value: escapeHtml(clientId) },
{ label: "Email", value: escapeHtml(portalProfileItem.email) },
{ label: "Phone", value: escapeHtml(portalProfileItem.phone ?? "Not provided") },
{ label: "Address", value: escapeHtml(portalProfileItem.address ?? "Not provided") },
{
label: "Primary Contact",
value: primaryContact == null
? "No primary contact on file"
: `<a href="/portal/contacts/${encodeURIComponent(primaryContact.id)}">${escapeHtml(primaryContact.name)}</a>`
},
{
label: "Next Appointment",
value: nextBooking == null
? "No active appointments"
: `<a href="/portal/appointments/${encodeURIComponent(nextBooking.id)}">${escapeHtml(formatAdminDateTime(nextBooking.startsAt))}</a>`
},
{
label: "Forms Pending Review",
value: escapeHtml(formatCountLabel(formsToReview, "submission"))
},
{
label: "Latest Achievement",
value: latestAchievement == null
? "No achievements awarded yet"
: `<a href="/portal/achievements/${encodeURIComponent(latestAchievement.id)}">${escapeHtml(latestAchievement.title)}</a>`
}
]),
"</section>",
'<section class="surface-block">',
"<h2>Account Snapshot</h2>",
renderQuickLinksGrid([
{ href: "/portal/appointments", label: "Appointments", description: upcomingBookings.length === 0 ? "No active appointments scheduled." : `${formatCountLabel(upcomingBookings.length, "upcoming appointment")} ready to review.` },
{ href: "/portal/invoices", label: "Invoices", description: openInvoices.length === 0 ? "No outstanding balance." : `${formatCurrency(outstandingBalance)} still due.` },
{ href: "/portal/quotes", label: "Quotes", description: activeQuotes.length === 0 ? "No quotes need your attention." : `${formatCountLabel(activeQuotes.length, "quote")} is still open.` },
{ href: "/portal/contracts", label: "Contracts", description: pendingContracts.length === 0 ? "No unsigned contracts pending." : `${formatCountLabel(pendingContracts.length, "contract")} still needs action.` },
{ href: "/portal/forms", label: "Forms", description: formsToReview === 0 ? "No pending form submissions." : `${formatCountLabel(formsToReview, "submission")} is still in flight.` },
{ href: "/portal/achievements", label: "Achievements", description: recentAchievements.length === 0 ? "No achievements on file yet." : `${formatCountLabel(recentAchievements.length, "recent award")} available in your portal.` },
{ href: "/portal/pets", label: "Pets", description: pets.length === 0 ? "No pet profiles added yet." : `${formatCountLabel(pets.length, "pet profile")} linked to this account.` },
{ href: "/portal/contacts", label: "Contacts", description: contacts.length === 0 ? "Add a household or emergency contact." : `${formatCountLabel(contacts.length, "contact")} available to manage.` }
]),
"</section>",
'<section class="surface-block">',
"<h2>Household Contacts</h2>",
renderContactsPreviewTable(contacts, (contact) => `/portal/contacts/${encodeURIComponent(contact.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Pet Profiles</h2>",
renderPetsPreviewTable(pets, {
detailPath: (petItem) => `/portal/pets/${encodeURIComponent(petItem.id)}`,
filePath: (petItem) => `/portal/pets/${encodeURIComponent(petItem.id)}/files`
}),
"</section>",
'<section class="surface-block">',
"<h2>Upcoming Appointments</h2>",
renderBookingsPreviewTable(upcomingBookings, (booking) => `/portal/appointments/${encodeURIComponent(booking.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Recent Forms</h2>",
renderFormsPreviewTable(recentForms, (form) => `/portal/forms/${encodeURIComponent(form.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Achievements</h2>",
renderAchievementsPreviewTable(recentAchievements, (achievement) => `/portal/achievements/${encodeURIComponent(achievement.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Update Profile</h2>",
'<form class="form-grid" method="post" action="/portal/profile">',
'<div class="form-grid form-grid--two">',
`<label>Name<input type="text" name="name" value="${escapeHtml(portalProfileItem.name)}" required></label>`,
`<label>Email<input type="email" name="email" value="${escapeHtml(portalProfileItem.email)}" required></label>`,
`<label>Phone<input type="text" name="phone" value="${escapeHtml(portalProfileItem.phone ?? "")}"></label>`,
"</div>",
`<label>Address<textarea name="address">${escapeHtml(portalProfileItem.address ?? "")}</textarea></label>`,
'<div class="form-grid form-grid--two">',
'<label>Current Password<input type="password" name="currentPassword"></label>',
'<label>New Password<input type="password" name="newPassword"></label>',
"</div>",
'<label>Confirm Password<input type="password" name="confirmPassword"></label>',
'<div class="form-actions"><button type="submit">Save Profile</button></div>',
"</form>",
"</section>",
"</article>"
].join("")
}));
return;

writeHtml(response, 200, renderLayout({
            title: "Profile",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Profile",
 title: portalProfileItem.name,
                  description: "Manage the primary contact information and password used for your client access."
              }),
              portalNav,
              renderDetailGrid([
 { label: "Email", value: escapeHtml((profile.body as { item: ClientProfile }).item.email) },
 { label: "Phone", value: escapeHtml((profile.body as { item: ClientProfile }).item.phone ?? "Not provided") },
 { label: "Address", value: escapeHtml((profile.body as { item: ClientProfile }).item.address ?? "Not provided") }
              ]),
              '<section class="surface-block">',
              "<h2>Update Profile</h2>",
              '<form class="form-grid" method="post" action="/portal/profile">',
              '<div class="form-grid form-grid--two">',
 `<label>Name<input type="text" name="name" value="${escapeHtml((profile.body as { item: ClientProfile }).item.name)}" required></label>`,
 `<label>Email<input type="email" name="email" value="${escapeHtml((profile.body as { item: ClientProfile }).item.email)}" required></label>`,
 `<label>Phone<input type="text" name="phone" value="${escapeHtml((profile.body as { item: ClientProfile }).item.phone ?? "")}"></label>`,
              "</div>",
 `<label>Address<textarea name="address">${escapeHtml((profile.body as { item: ClientProfile }).item.address ?? "")}</textarea></label>`,
              '<div class="form-grid form-grid--two">',
              '<label>Current Password<input type="password" name="currentPassword"></label>',
              '<label>New Password<input type="password" name="newPassword"></label>',
              "</div>",
              '<label>Confirm Password<input type="password" name="confirmPassword"></label>',
              '<div class="form-actions"><button type="submit">Save Profile</button></div>',
              "</form>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/appointments") {
          const bookings = await handlers.handlePortalBookings(session);
          if ("error" in bookings.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildPortalLoginRedirectPath(request),
              title: "Appointments",
              result: bookings
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Appointments",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Appointments",
                title: "Your Appointments",
                description: "Review upcoming services and recent scheduling history."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Appointment Schedule</h2>",
              renderDataTable({
                headers: ["Booking ID", "Service", "Starts", "Status"],
                rows: bookings.body.items.map((booking) => [
                  `<a href="/portal/bookings/${encodeURIComponent(booking.id)}">${escapeHtml(booking.id)}</a>`,
                  escapeHtml(booking.serviceId),
                  escapeHtml(booking.startsAt),
                  renderStatusPill(booking.status, booking.status === "confirmed" ? "success" : "info")
                ]),
                emptyMessage: "No appointments."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalBookingDetailMatch != null) {
          const bookingId = decodeURIComponent(portalBookingDetailMatch[1] ?? "");
          const booking = await handlers.handlePortalBookingDetail(session, bookingId);
          if ("error" in booking.body) {
            redirect(response, "/portal/appointments");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Booking Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Appointments",
                title: booking.body.item.id,
                description: "Review the schedule, service, and calendar-access details for this appointment."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Appointment Details</h2>",
              renderDetailGrid([
                { label: "Booking ID", value: escapeHtml(booking.body.item.id) },
                { label: "Service", value: escapeHtml(booking.body.item.serviceId) },
                { label: "Starts", value: escapeHtml(booking.body.item.startsAt) },
                { label: "Ends", value: escapeHtml(booking.body.item.endsAt) },
                {
                  label: "Status",
                  value: renderStatusPill(booking.body.item.status, booking.body.item.status === "confirmed" ? "success" : "info")
                },
                {
                  label: "Calendar Access Token",
                  value: escapeHtml(booking.body.item.icalAccess?.token ?? "Unavailable")
                }
              ]),
              '<div class="form-actions"><a href="/portal/appointments">Back to Appointments</a></div>',
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/contacts") {
          const contacts = await handlers.handlePortalContacts(session);
          if ("error" in contacts.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildPortalLoginRedirectPath(request),
              title: "Contacts",
              result: contacts
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Contacts",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contacts",
                title: "Your Contacts",
                description: "Keep household members and emergency contacts up to date for scheduling and training communication."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Add Contact</h2>",
              '<form class="form-grid" method="post" action="/portal/contacts">',
              '<div class="form-grid form-grid--two">',
              '<label>Name<input type="text" name="name" required></label>',
              '<label>Email<input type="email" name="email" required></label>',
              '<label>Phone<input type="text" name="phone" required></label>',
              "</div>",
              '<label><input type="checkbox" name="isPrimary"> Primary contact</label>',
              '<div class="form-actions"><button type="submit">Add Contact</button></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Contact Directory</h2>",
              renderDataTable({
                headers: ["Contact", "Email", "Phone", "Role", "Actions"],
                rows: contacts.body.items.map((contact) => [
                  `<a href="/portal/contacts/${encodeURIComponent(contact.id)}">${escapeHtml(contact.name)}</a>`,
                  escapeHtml(contact.email),
                  escapeHtml(contact.phone),
                  renderStatusPill(contact.isPrimary ? "Primary" : "Secondary", contact.isPrimary ? "success" : "default"),
                  `<div class="table-actions"><a href="/portal/contacts/${encodeURIComponent(contact.id)}">Manage</a></div>`
                ]),
                emptyMessage: "No contacts."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalContactDetailMatch != null) {
          const contactId = decodeURIComponent(portalContactDetailMatch[1] ?? "");
          const contact = await handlers.handlePortalContactDetail(session, contactId);
          if ("error" in contact.body) {
            redirect(response, "/portal/contacts");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Contact Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contacts",
                title: contact.body.item.name,
                description: "Update a household contact and keep primary contact routing accurate."
              }),
              portalNav,
              renderDetailGrid([
                { label: "Email", value: escapeHtml(contact.body.item.email) },
                { label: "Phone", value: escapeHtml(contact.body.item.phone) },
                {
                  label: "Role",
                  value: renderStatusPill(contact.body.item.isPrimary ? "Primary contact" : "Secondary contact", contact.body.item.isPrimary ? "success" : "default")
                }
              ]),
              '<section class="surface-block">',
              "<h2>Edit Contact</h2>",
              `<form class="form-grid" method="post" action="/portal/contacts/${encodeURIComponent(contact.body.item.id)}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Name<input type="text" name="name" value="${escapeHtml(contact.body.item.name)}" required></label>`,
              `<label>Email<input type="email" name="email" value="${escapeHtml(contact.body.item.email)}" required></label>`,
              `<label>Phone<input type="text" name="phone" value="${escapeHtml(contact.body.item.phone)}" required></label>`,
              "</div>",
              `<label><input type="checkbox" name="isPrimary"${contact.body.item.isPrimary ? " checked" : ""}> Primary contact</label>`,
              '<div class="form-actions"><button type="submit">Save Contact</button></div>',
              "</form>",
              `<form class="form-actions" method="post" action="/portal/contacts/${encodeURIComponent(contact.body.item.id)}/delete"><button type="submit">Delete Contact</button></form>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalPetFilesMatch != null) {
          const petId = decodeURIComponent(portalPetFilesMatch[1] ?? "");
          const files = await handlers.handlePortalPetFiles(session, petId);
          if ("error" in files.body) {
            redirect(response, "/portal/pets");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Pet Files",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pet Files",
                title: `Files for ${petId}`,
                description: "Upload vaccine records, intake PDFs, and progress photos for this pet."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Upload File</h2>",
              `<form class="form-grid" method="post" action="/portal/pets/${encodeURIComponent(petId)}/files" enctype="multipart/form-data">`,
              '<label>Description<textarea name="description"></textarea></label>',
              '<label>File<input type="file" name="file" required></label>',
              '<div class="form-actions"><button type="submit">Upload File</button><a href="/portal/pets">Back to pets</a></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Stored Files</h2>",
              renderDataTable({
                headers: ["Name", "Description", "Type", "Size", "Actions"],
                rows: files.body.items.map((file) => [
                  escapeHtml(file.originalName),
                  escapeHtml(file.description),
                  escapeHtml(file.fileType),
                  escapeHtml(`${file.fileSize} bytes`),
                  `<div class="table-actions"><a href="/portal/pets/${encodeURIComponent(petId)}/files/${encodeURIComponent(file.id)}/content">View</a><form method="post" action="/portal/pets/${encodeURIComponent(petId)}/files/${encodeURIComponent(file.id)}/delete"><button type="submit">Delete</button></form></div>`
                ]),
                emptyMessage: "No files."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalPetFileContentMatch != null) {
          const petId = decodeURIComponent(portalPetFileContentMatch[1] ?? "");
          const fileId = decodeURIComponent(portalPetFileContentMatch[2] ?? "");
          const result = await handlers.handlePortalPetFileContent(
            session,
            petId,
            fileId,
            url.searchParams.get("download") === "1"
          );

          if ("error" in result.body) {
            redirect(response, `/portal/pets/${encodeURIComponent(petId)}/files`);
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

if (url.pathname === "/portal/pets") {
const pets = await handlers.handlePortalPets(session);
if ("error" in pets.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Pets",
result: pets
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Pets",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pets",
                title: "Your Pets",
                description: "Review the pets attached to your account and manage shared files for each one."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Pet Directory</h2>",
              renderDataTable({
                headers: ["Pet ID", "Name", "Species", "Pet Sitting Notes", "Files"],
                rows: pets.body.items.map((pet) => [
                  `<a href="/portal/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.id)}</a>`,
                  `<a href="/portal/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.name)}</a>`,
                  escapeHtml(pet.species),
                  escapeHtml(pet.petSittingNotes),
                  `<a href="/portal/pets/${encodeURIComponent(pet.id)}/files">Manage files</a>`
                ]),
                emptyMessage: "No pets."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalPetDetailMatch != null) {
          const petId = decodeURIComponent(portalPetDetailMatch[1] ?? "");
          const pet = await handlers.handlePortalPetDetail(session, petId);
if ("error" in pet.body) {
redirect(response, "/portal/pets");
return;
}

const portalPetItem = (pet.body as { item: Pet }).item;
const [profile, contacts, files, allBookings, allForms, allAchievements] = await Promise.all([
loadSafeRouteItem<ClientProfile>(() => handlers.handlePortalProfile(session)),
loadSafeRouteItems<ClientContact>(() => handlers.handlePortalContacts(session)),
loadSafeRouteItems<PetFile>(() => handlers.handlePortalPetFiles(session, petId)),
loadSafeRouteItems<Booking>(() => handlers.handlePortalBookings(session)),
loadSafeRouteItems<FormSubmission>(() => handlers.handlePortalForms(session)),
loadSafeRouteItems<ClientAchievement>(() => handlers.handlePortalAchievements(session))
]);
const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
const petBookings = sortByTimeAsc(
allBookings.filter((booking) => booking.petIds.includes(portalPetItem.id)),
(booking) => booking.startsAt
);
const upcomingBookings = petBookings.filter((booking) => isBookingUpcoming(booking)).slice(0, 5);
const recentFiles = sortByTimeDesc(files, (file) => file.uploadedAt).slice(0, 5);
const petForms = sortByTimeDesc(
allForms.filter((form) => form.petId === portalPetItem.id),
(form) => form.reviewedAt ?? form.submittedAt ?? null
).slice(0, 5);
const petAchievements = sortByTimeDesc(
allAchievements.filter((achievement) => petMatchesAchievement(portalPetItem, achievement)),
(achievement) => achievement.revokedAt ?? achievement.updatedAt ?? achievement.awardedOn
).slice(0, 5);
const nextBooking = upcomingBookings[0] ?? null;
const latestFile = recentFiles[0] ?? null;
const latestForm = petForms[0] ?? null;

writeHtml(response, 200, renderLayout({
title: "Portal Pet Detail",
body: [
'<article class="content-stack">',
renderSectionIntro({
eyebrow: "Pets",
title: portalPetItem.name,
description: "Review care notes, shared files, appointments, and completed paperwork for this pet from one profile."
}),
portalNav,
renderStatsGrid([
{ label: "Files", value: files.length, meta: latestFile == null ? "No uploads yet" : latestFile.originalName, accent: "primary" },
{ label: "Appointments", value: upcomingBookings.length, meta: nextBooking == null ? "No active appointments" : formatAdminDateTime(nextBooking.startsAt), accent: "success" },
{ label: "Forms", value: petForms.length, meta: latestForm == null ? "No linked forms yet" : getAdminFormSubmissionTitle(latestForm), accent: "secondary" },
{ label: "Achievements", value: petAchievements.length, meta: petAchievements.length === 0 ? "No pet-specific awards yet" : "Training milestones linked", accent: "warning" }
]),
'<section class="surface-block">',
"<h2>Pet Details</h2>",
renderDetailGrid([
{ label: "Pet ID", value: escapeHtml(portalPetItem.id) },
{ label: "Species", value: escapeHtml(portalPetItem.species) },
{ label: "Status", value: renderStatusPill(portalPetItem.archived ? "Archived" : "Active", portalPetItem.archived ? "warning" : "success") },
{ label: "Shared Files", value: escapeHtml(formatCountLabel(files.length, "file")) },
{
label: "Household Contact",
value: primaryContact == null
? "No contact on file"
: `<a href="/portal/contacts/${encodeURIComponent(primaryContact.id)}">${escapeHtml(primaryContact.name)}</a>`
},
{
label: "Account Profile",
value: profile == null ? "Profile unavailable" : `<a href="/portal/profile">${escapeHtml(profile.name)}</a>`
},
{
label: "Next Appointment",
value: nextBooking == null
? "No active appointments"
: `<a href="/portal/appointments/${encodeURIComponent(nextBooking.id)}">${escapeHtml(formatAdminDateTime(nextBooking.startsAt))}</a>`
},
{
label: "Latest Form",
value: latestForm == null
? "No linked forms"
: `<a href="/portal/forms/${encodeURIComponent(latestForm.id)}">${escapeHtml(getAdminFormSubmissionTitle(latestForm))}</a>`
}
]),
"</section>",
'<section class="surface-block">',
"<h2>Care Notes</h2>",
renderLongTextBlock(portalPetItem.petSittingNotes, "No care notes have been recorded for this pet yet."),
"</section>",
'<section class="surface-block">',
"<h2>Pet Workspace</h2>",
renderQuickLinksGrid([
{ href: `/portal/pets/${encodeURIComponent(portalPetItem.id)}/files`, label: "Manage Files", description: files.length === 0 ? "Upload vaccination, intake, or photo records." : `${formatCountLabel(files.length, "shared file")} already on record.` },
{ href: "/portal/appointments", label: "Appointments", description: upcomingBookings.length === 0 ? "No upcoming appointments for this pet." : `${formatCountLabel(upcomingBookings.length, "upcoming visit")} linked here.` },
{ href: "/portal/forms", label: "Forms", description: petForms.length === 0 ? "No pet-specific forms submitted yet." : `${formatCountLabel(petForms.length, "linked form")} visible from this profile.` },
{ href: "/portal/achievements", label: "Achievements", description: petAchievements.length === 0 ? "No awards linked to this pet yet." : `${formatCountLabel(petAchievements.length, "achievement")} recorded for this pet.` },
{ href: "/portal/profile", label: "Account Profile", description: "Return to the full household and billing view." },
{ href: "/portal/pets", label: "Back to Pets", description: "Open the full pet directory." }
]),
"</section>",
'<section class="surface-block">',
"<h2>Shared Files</h2>",
renderPetFilesPreviewTable(recentFiles, (file) => `/portal/pets/${encodeURIComponent(portalPetItem.id)}/files/${encodeURIComponent(file.id)}/content`),
"</section>",
'<section class="surface-block">',
"<h2>Appointments</h2>",
renderBookingsPreviewTable(upcomingBookings, (booking) => `/portal/appointments/${encodeURIComponent(booking.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Linked Forms</h2>",
renderFormsPreviewTable(petForms, (form) => `/portal/forms/${encodeURIComponent(form.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Achievements</h2>",
renderAchievementsPreviewTable(petAchievements, (achievement) => `/portal/achievements/${encodeURIComponent(achievement.id)}`),
"</section>",
"</article>"
].join("")
}));
return;

writeHtml(response, 200, renderLayout({
            title: "Portal Pet Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pets",
                title: portalPetItem.name,
                description: "Review the pet profile details and jump into shared client files for this pet."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Pet Details</h2>",
              renderDetailGrid([
                { label: "Pet ID", value: escapeHtml(portalPetItem.id) },
                { label: "Name", value: escapeHtml(portalPetItem.name) },
                { label: "Species", value: escapeHtml(portalPetItem.species) },
                {
                  label: "Status",
                  value: renderStatusPill(portalPetItem.archived ? "Archived" : "Active", portalPetItem.archived ? "warning" : "success")
                },
                { label: "Pet Sitting Notes", value: escapeHtml(portalPetItem.petSittingNotes) }
              ]),
              `<div class="form-actions"><a href="/portal/pets/${encodeURIComponent(portalPetItem.id)}/files">Manage Files</a><a href="/portal/pets">Back to Pets</a></div>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/packages") {
          const packages = await handlers.handlePortalPackages(session);
          if ("error" in packages.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildPortalLoginRedirectPath(request),
              title: "Packages",
              result: packages
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Packages",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Packages",
                title: "Your Packages",
                description: "Track purchased training packages and review the pricing tied to each account allocation."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Package Summary</h2>",
              renderDataTable({
                headers: ["Package ID", "Name", "Price", "Status"],
                rows: packages.body.items.map((item) => [
                  `<a href="/portal/packages/${encodeURIComponent(item.id)}">${escapeHtml(item.id)}</a>`,
                  `<a href="/portal/packages/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`,
                  escapeHtml(formatCurrency(item.price)),
                  renderStatusPill(item.active ? "Active" : "Inactive", item.active ? "success" : "default")
                ]),
                emptyMessage: "No packages."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalPackageDetailMatch != null) {
          const packageId = decodeURIComponent(portalPackageDetailMatch[1] ?? "");
          const packageDetail = await handlers.handlePortalPackageDetail(session, packageId);
          if ("error" in packageDetail.body) {
            redirect(response, "/portal/packages");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Package Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Packages",
                title: packageDetail.body.item.name,
                  description: "Review package pricing and active status tied to your account."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Package Details</h2>",
              renderDetailGrid([
                { label: "Package ID", value: escapeHtml(packageDetail.body.item.id) },
                { label: "Name", value: escapeHtml(packageDetail.body.item.name) },
                { label: "Price", value: escapeHtml(formatCurrency(packageDetail.body.item.price)) },
                {
                  label: "Status",
                  value: renderStatusPill(packageDetail.body.item.active ? "Active" : "Inactive", packageDetail.body.item.active ? "success" : "default")
                }
              ]),
              '<div class="form-actions"><a href="/portal/packages">Back to Packages</a></div>',
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/portal/credits") {
          const credits = await handlers.handlePortalCredits(session);
          if ("error" in credits.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildPortalLoginRedirectPath(request),
              title: "Credits",
              result: credits
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Credits",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Credits",
                title: "Your Credits",
                description: "Monitor the remaining training units tied to your active package balances."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Credit Balances</h2>",
              renderDataTable({
                headers: ["Credit ID", "Remaining Units", "Package", "Status"],
                rows: credits.body.items.map((credit) => [
                  `<a href="/portal/credits/${encodeURIComponent(credit.id)}">${escapeHtml(credit.id)}</a>`,
                  escapeHtml(String(credit.remainingUnits)),
                  escapeHtml(credit.packageId ?? "Unassigned"),
                  renderStatusPill(credit.remainingUnits > 0 ? "Available" : "Used", credit.remainingUnits > 0 ? "success" : "warning")
                ]),
                emptyMessage: "No credits."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalCreditDetailMatch != null) {
          const creditId = decodeURIComponent(portalCreditDetailMatch[1] ?? "");
          const credit = await handlers.handlePortalCreditDetail(session, creditId);
          if ("error" in credit.body) {
            redirect(response, "/portal/credits");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Credit Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Credits",
                title: credit.body.item.id,
                description: "Review the remaining training units and the package assignment for this credit balance."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Credit Details</h2>",
              renderDetailGrid([
                { label: "Credit ID", value: escapeHtml(credit.body.item.id) },
                { label: "Remaining Units", value: escapeHtml(String(credit.body.item.remainingUnits)) },
                { label: "Package", value: escapeHtml(credit.body.item.packageId ?? "Unassigned") },
                {
                  label: "Status",
                  value: renderStatusPill(credit.body.item.remainingUnits > 0 ? "Available" : "Used", credit.body.item.remainingUnits > 0 ? "success" : "warning")
                }
              ]),
              '<div class="form-actions"><a href="/portal/credits">Back to Credits</a></div>',
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/achievements") {
const achievements = await handlers.handlePortalAchievements(session);
if ("error" in achievements.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Achievements",
result: achievements
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Achievements",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Achievements",
                title: "Your Achievements",
                description: "Review earned credentials, training milestones, and printable certificates."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Achievement Library</h2>",
              renderDataTable({
                headers: ["Achievement", "Program", "Status", "Certificate"],
                rows: achievements.body.items.map((achievement) => [
                  `<a href="/portal/achievements/${encodeURIComponent(achievement.id)}">${escapeHtml(achievement.title)}</a>`,
                  escapeHtml(achievement.programName ?? "General"),
                  renderStatusPill(achievement.status, achievement.status === "awarded" ? "success" : "info"),
                  `<a href="/portal/achievements/${encodeURIComponent(achievement.id)}/certificate">View certificate</a>`
                ]),
                emptyMessage: "No achievements."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        const portalAchievementCertificateMatch = /^\/portal\/achievements\/([^/]+)\/certificate$/.exec(url.pathname);
        if (portalAchievementCertificateMatch != null) {
          const achievementId = decodeURIComponent(portalAchievementCertificateMatch[1] ?? "");
          const result = await handlers.handlePortalAchievementCertificate(
            session,
            achievementId,
            url.searchParams.get("download") === "1"
          );
          if (typeof result.body === "string") {
            writeHtml(response, result.status, result.body, {
              "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="achievement-${encodeURIComponent(achievementId)}.html"`
            });
            return;
          }

          redirect(response, "/portal/achievements");
          return;
        }

        const portalAchievementDetailMatch = /^\/portal\/achievements\/([^/]+)$/.exec(url.pathname);
        if (portalAchievementDetailMatch != null) {
          const achievementId = decodeURIComponent(portalAchievementDetailMatch[1] ?? "");
          const achievement = await handlers.handlePortalAchievementDetail(session, achievementId);
          if ("error" in achievement.body) {
            redirect(response, "/portal/achievements");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Achievement Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Achievements",
                title: achievement.body.item.title,
                description: "View the award details, supporting notes, and printable certificate for this milestone."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Award Summary</h2>",
              `<p>${escapeHtml(achievement.body.item.description)}</p>`,
              renderDetailGrid([
                {
                  label: "Status",
                  value: renderStatusPill(achievement.body.item.status, achievement.body.item.status === "awarded" ? "success" : "info")
                },
                { label: "Awarded On", value: escapeHtml(achievement.body.item.awardedOn) },
                { label: "Program", value: escapeHtml(achievement.body.item.programName ?? "General") },
                { label: "Dog", value: escapeHtml(achievement.body.item.dogName ?? "Not specified") }
              ]),
              `<p>${escapeHtml(achievement.body.item.notes)}</p>`,
              `<div class="form-actions"><a href="/portal/achievements/${encodeURIComponent(achievement.body.item.id)}/certificate">Open certificate</a></div>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/invoices") {
const invoices = await handlers.handlePortalInvoices(session);
if ("error" in invoices.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Invoices",
result: invoices
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Invoices",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Invoices",
                title: "Your Invoices",
                description: "Review open balances, settled invoices, and payment actions from one place."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Invoice Ledger</h2>",
              renderDataTable({
                headers: ["Invoice ID", "Outstanding", "Status", "Actions"],
                rows: invoices.body.items.map((invoice) => [
                  `<a href="/portal/invoices/${encodeURIComponent(invoice.id)}">${escapeHtml(invoice.id)}</a>`,
                  escapeHtml(formatCurrency(invoice.outstandingAmount)),
                  renderStatusPill(
                    invoice.status,
                    invoice.status === "paid" ? "success" : invoice.status === "void" ? "danger" : "warning"
                  ),
                  invoice.outstandingAmount > 0 && invoice.status !== "paid" && invoice.status !== "void"
                    ? `<div class="table-actions"><form method="post" action="/portal/invoices/${encodeURIComponent(invoice.id)}/pay"><button type="submit">Pay Invoice</button></form></div>`
                    : '<span class="meta">No action required</span>'
                ]),
                emptyMessage: "No invoices."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalInvoiceDetailMatch != null) {
          const invoiceId = decodeURIComponent(portalInvoiceDetailMatch[1] ?? "");
          const invoice = await handlers.handlePortalInvoiceDetail(session, invoiceId);
          if ("error" in invoice.body) {
            redirect(response, "/portal/invoices");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Invoice Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Invoices",
                title: invoice.body.item.id,
                description: "Review the balance, due date, and payment state for this invoice."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Invoice Details</h2>",
              renderDetailGrid([
                { label: "Invoice ID", value: escapeHtml(invoice.body.item.id) },
                {
                  label: "Status",
                  value: renderStatusPill(
                    invoice.body.item.status,
                    invoice.body.item.status === "paid" ? "success" : invoice.body.item.status === "void" ? "danger" : "warning"
                  )
                },
                { label: "Total Amount", value: escapeHtml(formatCurrency(invoice.body.item.totalAmount)) },
                { label: "Outstanding Balance", value: escapeHtml(formatCurrency(invoice.body.item.outstandingAmount)) },
                { label: "Due Date", value: escapeHtml(invoice.body.item.dueAt ?? "No due date") }
              ]),
              '<div class="form-actions">',
              invoice.body.item.outstandingAmount > 0 && invoice.body.item.status !== "paid" && invoice.body.item.status !== "void"
                ? `<form method="post" action="/portal/invoices/${encodeURIComponent(invoice.body.item.id)}/pay"><button type="submit">Pay Invoice</button></form>`
                : '<span class="meta">No payment action required.</span>',
              '<a href="/portal/invoices">Back to Invoices</a>',
              "</div>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/quotes") {
const quotes = await handlers.handlePortalQuotes(session);
if ("error" in quotes.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Quotes",
result: quotes
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Quotes",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Quotes",
                title: "Your Quotes",
                description: "Review proposals, confirm pricing, and accept training plans awaiting approval."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Quote Summary</h2>",
              renderDataTable({
                headers: ["Quote ID", "Total", "Status", "Actions"],
                rows: quotes.body.items.map((quote) => [
                  `<a href="/portal/quotes/${encodeURIComponent(quote.id)}">${escapeHtml(quote.id)}</a>`,
                  escapeHtml(formatCurrency(quote.totalAmount)),
                  renderStatusPill(quote.status, quote.status === "accepted" ? "success" : "warning"),
                  quote.status === "accepted"
                    ? '<span class="meta">Accepted</span>'
                    : `<div class="table-actions"><form method="post" action="/portal/quotes/${encodeURIComponent(quote.id)}/accept"><button type="submit">Accept Quote</button></form></div>`
                ]),
                emptyMessage: "No quotes."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalQuoteDetailMatch != null) {
          const quoteId = decodeURIComponent(portalQuoteDetailMatch[1] ?? "");
          const quote = await handlers.handlePortalQuoteDetail(session, quoteId);
          if ("error" in quote.body) {
            redirect(response, "/portal/quotes");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Quote Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Quotes",
                title: quote.body.item.id,
                description: "Review this quote before accepting the proposed training plan."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Quote Details</h2>",
              renderDetailGrid([
                { label: "Quote ID", value: escapeHtml(quote.body.item.id) },
                {
                  label: "Status",
                  value: renderStatusPill(quote.body.item.status, quote.body.item.status === "accepted" ? "success" : "warning")
                },
                { label: "Total Amount", value: escapeHtml(formatCurrency(quote.body.item.totalAmount)) },
                {
                  label: "Public Access",
                  value: escapeHtml(quote.body.item.publicAccess?.token ?? "Portal-only")
                }
              ]),
              '<div class="form-actions">',
              quote.body.item.status === "accepted"
                ? '<span class="meta">This quote has already been accepted.</span>'
                : `<form method="post" action="/portal/quotes/${encodeURIComponent(quote.body.item.id)}/accept"><button type="submit">Accept Quote</button></form>`,
              '<a href="/portal/quotes">Back to Quotes</a>',
              "</div>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/contracts") {
const contracts = await handlers.handlePortalContracts(session);
if ("error" in contracts.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Contracts",
result: contracts
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Contracts",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contracts",
                title: "Your Contracts",
                description: "Sign outstanding agreements and confirm which contracts are already complete."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Contract Status</h2>",
              renderDataTable({
                headers: ["Contract ID", "Status", "Actions"],
                rows: contracts.body.items.map((contract) => [
                  `<a href="/portal/contracts/${encodeURIComponent(contract.id)}">${escapeHtml(contract.id)}</a>`,
                  renderStatusPill(contract.status, contract.status === "signed" ? "success" : "warning"),
                  contract.status === "signed"
                    ? '<span class="meta">Signed</span>'
                    : `<div class="table-actions"><form method="post" action="/portal/contracts/${encodeURIComponent(contract.id)}/sign"><button type="submit">Sign Contract</button></form></div>`
                ]),
                emptyMessage: "No contracts."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalContractDetailMatch != null) {
          const contractId = decodeURIComponent(portalContractDetailMatch[1] ?? "");
          const contract = await handlers.handlePortalContractDetail(session, contractId);
          if ("error" in contract.body) {
            redirect(response, "/portal/contracts");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Contract Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contracts",
                title: contract.body.item.id,
                  description: "Review the signature status and any remaining action for this agreement."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Contract Details</h2>",
              renderDetailGrid([
                { label: "Contract ID", value: escapeHtml(contract.body.item.id) },
                {
                  label: "Status",
                  value: renderStatusPill(contract.body.item.status, contract.body.item.status === "signed" ? "success" : "warning")
                },
                {
                  label: "Public Access",
                  value: escapeHtml(contract.body.item.publicAccess?.token ?? "Portal-only")
                }
              ]),
              '<div class="form-actions">',
              contract.body.item.status === "signed"
                ? '<span class="meta">This contract is already signed.</span>'
                : `<form method="post" action="/portal/contracts/${encodeURIComponent(contract.body.item.id)}/sign"><button type="submit">Sign Contract</button></form>`,
              '<a href="/portal/contracts">Back to Contracts</a>',
              "</div>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/forms") {
const forms = await handlers.handlePortalForms(session);
if ("error" in forms.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Forms",
result: forms
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Forms",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: "Your Forms",
                description: "Complete onboarding and agreement forms that are still awaiting submission."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Form Queue</h2>",
              renderDataTable({
                headers: ["Form", "Type", "Submission State", "Actions"],
                rows: forms.body.items.map((form) => [
                  [
                    `<strong>${escapeHtml(form.templateName ?? form.id)}</strong>`,
                    `<div class="meta">${escapeHtml(form.id)}</div>`
                  ].join(""),
                  form.clientReviewSubmission === true
                    ? renderStatusPill("Client Review", "info")
                    : renderStatusPill(form.formType ?? "client_form", "default"),
                  form.submittedAt == null
                    ? renderStatusPill("Pending", "warning")
                    : renderStatusPill(`Submitted ${form.submittedAt}`, "success"),
                  form.submittedAt == null
                    ? `<div class="table-actions"><form method="post" action="/portal/forms/${encodeURIComponent(form.id)}/submit"><button type="submit">Submit Form</button></form></div>`
                    : `<div class="table-actions"><a href="/portal/forms/${encodeURIComponent(form.id)}">${form.clientReviewSubmission === true ? "Review" : "View"}</a></div>`
                ]),
                emptyMessage: "No forms."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/portal/notifications") {
const notifications = await handlers.handlePortalNotifications(session);
if ("error" in notifications.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildPortalLoginRedirectPath(request),
title: "Notifications",
result: notifications
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Notifications",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Notifications",
                title: "Client Portal Alerts",
                description: "Review follow-up notes and other updates surfaced in your client portal."
              }),
              portalNav,
              '<section class="surface-block">',
              "<h2>Notification Center</h2>",
              renderDataTable({
                headers: ["Title", "Message", "Created", "Action"],
                rows: notifications.body.items.map((notification) => [
                  notification.isRead
                    ? escapeHtml(notification.subject)
                    : `${escapeHtml(notification.subject)} ${renderStatusPill("Unread", "info")}`,
                  escapeHtml(notification.message),
                  escapeHtml(notification.createdAt),
                  `<a href="${escapeHtml(notification.url)}">Open</a>`
                ]),
                emptyMessage: "No notifications."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (portalFormDetailMatch != null) {
          const form = await handlers.handlePortalFormDetail(session, decodeURIComponent(portalFormDetailMatch[1] ?? ""));
          if ("error" in form.body) {
            redirect(response, "/portal/forms");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Portal Form Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: form.body.item.templateName ?? form.body.item.id,
                description: form.body.item.clientReviewSubmission === true
                  ? "Client Review"
                  : "Review the stored submission details for this form."
              }),
              portalNav,
              renderDetailGrid([
                { label: "Form ID", value: escapeHtml(form.body.item.id) },
                { label: "Template", value: escapeHtml(form.body.item.templateName ?? form.body.item.templateId) },
                { label: "Form Type", value: escapeHtml(form.body.item.formType ?? "client_form") },
                {
                  label: "Portal Visibility",
                  value: renderStatusPill(form.body.item.templateShowInClientPortal === false ? "Hidden" : "Visible", form.body.item.templateShowInClientPortal === false ? "warning" : "success")
                },
                {
                  label: "Submission State",
                  value: form.body.item.submittedAt == null
                    ? renderStatusPill("Pending", "warning")
                    : renderStatusPill(`Submitted ${form.body.item.submittedAt}`, "success")
                }
              ]),
              '<section class="surface-block">',
              `<p>${escapeHtml(form.body.item.clientReviewSubmission === true ? "Client Review" : "View-only submission")}</p>`,
              form.body.item.publicAccess == null
                ? "<p class=\"meta\">No public access token is attached to this form.</p>"
                : `<p class="meta">Public access token: ${escapeHtml(form.body.item.publicAccess.token)}</p>`,
              "</section>",
              '<section class="surface-block">',
              "<h3>Contact Information</h3>",
              renderDetailGrid([
                { label: "Name", value: escapeHtml(form.body.item.contactName ?? "Not provided") },
                { label: "Email", value: escapeHtml(form.body.item.contactEmail ?? "Not provided") },
                { label: "Phone", value: escapeHtml(form.body.item.contactPhone ?? "Not provided") }
              ]),
              "</section>",
              '<section class="surface-block">',
              "<h3>Responses</h3>",
              renderLegacyPublicFormResponses(form.body.item),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }
      }

      if ((method === "GET" || method === "POST") && legacyFormRequestCreatePath && resolved.api != null && handlers != null) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const actor = await handlers.handleAdminActorProfile(session);
        if ("error" in actor.body) {
          redirect(response, buildAdminLoginRedirectPath(request), await clearPersistedSession(resolved.sessionStore, request));
          return;
        }

const adminNav = "";
        const source = method === "POST" ? await readFormBody(request) : url.searchParams;
        const readSourceValue = (key: string) => String(source.get(key) ?? "").trim();
        const requestOrigin = buildRequestOrigin(request);
        const requestAction = method === "POST" ? (readSourceValue("request_action").toLowerCase() || "generate") : "generate";
        const formType = normalizeAdminFormRequestType(readSourceValue("form_type"));
        let clientId = readSourceValue("client_id");
        const bookingId = readSourceValue("booking_id");
        const petId = readSourceValue("pet_id");
        let appointmentTypeId = readSourceValue("appointment_type_id");
        const templateId = readSourceValue("template_id");
        const emailSubject = readSourceValue("email_subject");
        const errors: string[] = [];
        let successMessage = "";
        let generatedLink = "";

        const booking = bookingId === ""
          ? null
          : await resolved.api.adminResources.findAdminBookingById(bookingId);
        if (bookingId !== "" && booking == null) {
          errors.push("Appointment not found.");
        } else if (booking != null) {
          if (clientId === "") {
            clientId = booking.clientId;
          }
          if (appointmentTypeId === "") {
            appointmentTypeId = booking.serviceId;
          }
        }

        const pet = petId === ""
          ? null
          : await resolved.api.adminResources.findAdminPetById(petId);
        if (petId !== "" && pet == null) {
          errors.push("Pet not found.");
        } else if (pet != null && clientId === "") {
          clientId = pet.clientId;
        }

        const appointmentType = appointmentTypeId === ""
          ? null
          : await resolved.api.adminConfiguration.findAdminAppointmentTypeById(appointmentTypeId);
        if (appointmentTypeId !== "" && appointmentType == null) {
          errors.push("Appointment type not found.");
        }

        const clientProfile = clientId === ""
          ? null
          : await resolved.api.clientProfiles.findAdminClientProfile(clientId);
        if (clientId !== "" && clientProfile == null) {
          errors.push("Client not found.");
        }

        const templates = formType === "booking_form"
          ? []
          : (await resolved.api.adminConfiguration.listAdminFormTemplates())
            .filter((item) => item.active && matchesAdminFormRequestTemplateType(item.formType, formType))
            .sort((left, right) => left.name.localeCompare(right.name));
        const selectedTemplate = templateId === ""
          ? null
          : templates.find((item) => item.id === templateId) ?? null;
        const clientOptions = formType === "booking_form"
          ? (await resolved.api.adminResources.listAdminClients())
            .sort((left, right) => formatAdminClientOptionLabel(left).localeCompare(formatAdminClientOptionLabel(right)))
          : [];

        if (formType === "booking_form" && (appointmentType == null || appointmentType.uniqueLink.trim() === "")) {
          errors.push("This booking link is not available because the appointment type is missing its public link.");
        }
        if ((formType === "client_form" || formType === "survey_form") && clientId === "") {
          errors.push("A client is required for this form request.");
        }
        if (formType === "follow_up_note" && bookingId === "") {
          errors.push("An appointment is required for follow-up note forms.");
        }
        if (formType === "pet_form" && petId === "") {
          errors.push("A pet is required for pet forms.");
        }

        if (method === "POST") {
          if (formType !== "booking_form" && templateId === "") {
            errors.push("Please choose a form template.");
          }
          if (formType !== "booking_form" && templateId !== "" && selectedTemplate == null) {
            errors.push("The selected form template is not available for this request.");
          }
          if (requestAction === "send" && clientProfile == null) {
            errors.push("A client with an email address is required to send this link.");
          }
          if (requestAction === "send" && isAdminFormRequestInternalOnly(formType)) {
            errors.push("This form type cannot be emailed because it is for admin use only.");
          }

          if (errors.length === 0) {
            try {
              if (formType === "booking_form") {
                generatedLink = buildLegacyPublicBookingRequestUrl(requestOrigin, appointmentType?.uniqueLink ?? "");
              } else {
                const createdRequest = await resolved.api.adminResources.createAdminFormRequest({
                  templateId,
                  clientId,
                  bookingId: bookingId === "" ? null : bookingId,
                  petId: petId === "" ? null : petId,
                  sentAt: requestAction === "send" ? resolved.api.publicBooking.now() : null
                });
                if (createdRequest == null) {
                  errors.push("Unable to create the requested form link.");
                } else {
                  generatedLink = buildLegacyPublicFormRequestUrl(requestOrigin, createdRequest);
                }
              }

              if (errors.length === 0 && requestAction === "open") {
                redirect(response, generatedLink);
                return;
              }

              if (errors.length === 0 && requestAction === "send" && clientProfile != null) {
                const linkLabel = formType === "booking_form"
                  ? (appointmentType?.name ?? "booking request")
                  : (selectedTemplate?.name ?? "form request");
                const subject = emailSubject === ""
                  ? (formType === "booking_form"
                    ? `Book your ${appointmentType?.name ?? "appointment"}`
                    : `Please complete your ${selectedTemplate?.name ?? "form"}`)
                  : emailSubject;
                const html = formType === "booking_form"
                  ? `<p>Hello ${escapeHtml(clientProfile.name)},</p><p>Please use the link below to book your <strong>${escapeHtml(linkLabel)}</strong>.</p><p><a href="${escapeAttribute(generatedLink)}">Open Booking Link</a></p>`
                  : `<p>Hello ${escapeHtml(clientProfile.name)},</p><p>Please use the link below to complete your <strong>${escapeHtml(linkLabel)}</strong>.</p><p><a href="${escapeAttribute(generatedLink)}">Open Form</a></p>`;

                await resolved.api.publicBooking.queueConfirmationEmail({
                  to: [clientProfile.email],
                  subject,
                  templateKey: formType === "booking_form" ? "booking_request_link" : "form_request_link",
                  html
                });
                successMessage = `Link queued for ${clientProfile.email}.`;
              } else if (errors.length === 0) {
                successMessage = "Link generated successfully.";
              }
            } catch (error) {
              errors.push(error instanceof Error ? error.message : "Unable to process the form request.");
            }
          }
        }

        const backPath = buildAdminFormRequestBackPath({
          clientId,
          petId: pet?.id ?? (petId === "" ? null : petId),
          appointmentTypeId: appointmentType?.id ?? (appointmentTypeId === "" ? null : appointmentTypeId)
        });
        const bookingSummary = booking == null
          ? "Not linked"
          : `${appointmentType?.name ?? booking.serviceId} - ${formatAdminDateTime(booking.startsAt)}`;

        writeHtml(response, 200, renderLayout({
          title: "Generate Form Link",
          body: [
            '<article class="content-stack">',
            renderSectionIntro({
              eyebrow: "Forms",
              title: `${formatFormTemplateTypeLabel(formType)} Request`,
              description: getAdminFormRequestTypeDescription(formType)
            }),
            adminNav,
            `<section class="surface-block"><div class="form-actions"><a href="${backPath}">Back</a>${generatedLink === "" ? "" : `<a href="${generatedLink}" target="_blank" rel="noreferrer">Open Generated Link</a>`}</div></section>`,
            errors.length === 0
              ? ""
              : `<section class="surface-block" style="border-color:#b91c1c;background:#fef2f2;"><h2>Request Errors</h2><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></section>`,
            successMessage === ""
              ? ""
              : `<section class="surface-block" style="border-color:#15803d;background:#f0fdf4;"><strong>${escapeHtml(successMessage)}</strong></section>`,
            renderDetailGrid([
              { label: "Request Type", value: escapeHtml(formatFormTemplateTypeLabel(formType)) },
              { label: "Client", value: escapeHtml(clientProfile?.name ?? "Not linked") },
              { label: "Appointment Type", value: escapeHtml(appointmentType?.name ?? "Not linked") },
              { label: "Booking", value: escapeHtml(bookingSummary) },
              { label: "Pet", value: escapeHtml(pet?.name ?? "Not linked") }
            ]),
            '<section class="surface-block">',
            "<h2>Request Details</h2>",
            `<form class="form-grid" method="post" action="/client/form_requests_create.php">`,
            `<input type="hidden" name="form_type" value="${escapeAttribute(formType)}">`,
            `<input type="hidden" name="booking_id" value="${escapeAttribute(bookingId)}">`,
            `<input type="hidden" name="pet_id" value="${escapeAttribute(petId)}">`,
            `<input type="hidden" name="appointment_type_id" value="${escapeAttribute(appointmentTypeId)}">`,
            formType === "booking_form"
              ? `<label>Client<select name="client_id"><option value="">Select a client</option>${clientOptions.map((client) => `<option value="${escapeAttribute(client.id)}"${clientId === client.id ? " selected" : ""}>${escapeHtml(formatAdminClientOptionLabel(client))}</option>`).join("")}</select></label>`
              : `<input type="hidden" name="client_id" value="${escapeAttribute(clientId)}">`,
            formType === "booking_form"
              ? ""
              : `<label>Form Template<select name="template_id"><option value="">Select a template</option>${templates.map((template) => `<option value="${escapeAttribute(template.id)}"${templateId === template.id ? " selected" : ""}>${escapeHtml(template.name)}</option>`).join("")}</select></label>`,
            `<label>Email Subject<input type="text" name="email_subject" value="${escapeAttribute(emailSubject)}" placeholder="${escapeAttribute(formType === "booking_form" ? `Book your ${appointmentType?.name ?? "appointment"}` : `Please complete your ${selectedTemplate?.name ?? "form"}`)}"></label>`,
            generatedLink === ""
              ? ""
              : `<label>Generated Link<input type="url" value="${escapeAttribute(generatedLink)}" readonly></label>`,
            isAdminFormRequestInternalOnly(formType)
              ? '<p class="meta">This form type is internal-only and can be generated or opened, but not emailed.</p>'
              : '<p class="meta">Use the queued email action to hand the secure link off through the unified mail pipeline.</p>',
            '<div class="form-actions">',
            '<button type="submit" name="request_action" value="generate">Generate Link</button>',
            '<button type="submit" name="request_action" value="open">Generate and Open</button>',
            isAdminFormRequestInternalOnly(formType) ? "" : '<button type="submit" name="request_action" value="send">Generate and Queue Email</button>',
            "</div>",
            "</form>",
            "</section>",
            selectedTemplate == null || selectedTemplate.description == null || selectedTemplate.description.trim() === ""
              ? ""
              : `<section class="surface-block"><h2>Template Notes</h2><p class="section-copy">${escapeHtml(selectedTemplate.description)}</p></section>`,
            "</article>"
          ].join("")
        }));
        return;
      }

        if (
          handlers != null
          && (
            (
              method === "GET"
              && (
              url.pathname === "/admin"
 || url.pathname === "/admin/dashboard"
 || url.pathname === "/client/index.php"
 || url.pathname === "/admin/clients"
 || url.pathname === "/admin/bookings"
 || adminBookingDetailMatch != null
 || url.pathname === "/admin/expenses"
 || url.pathname === "/client/expenses_list.php"
 || adminExpenseDetailMatch != null
 || url.pathname === "/admin/invoices"
 || adminInvoiceDetailMatch != null
          || url.pathname === "/client/invoices_list.php"
          || url.pathname === "/admin/quotes"
          || adminQuoteDetailMatch != null
          || url.pathname === "/admin/contracts"
          || adminContractDetailMatch != null
          || url.pathname === "/admin/forms"
          || adminFormDetailMatch != null
          || legacyFormSubmissionsListPath
          || legacyFormSubmissionsViewPath
          || url.pathname === "/admin/pets"
          || adminPetDetailMatch != null
          || url.pathname === "/admin/packages"
          || adminPackageDetailMatch != null
          || url.pathname === "/admin/credits"
          || adminCreditDetailMatch != null
          || url.pathname === "/admin/achievement-types"
          || url.pathname === "/admin/blog-posts"
          || url.pathname === "/admin/workflows"
          || legacyWorkflowListPath
          || legacyWorkflowEditPath
          || legacyWorkflowEnrollmentsPath
          || legacyWorkflowEnrollPath
          || legacyWorkflowStepsPath
          || legacyWorkflowStepEditPath
          || adminWorkflowStepsMatch != null
          || adminWorkflowStepNewMatch != null
          || adminWorkflowStepDetailMatch != null
          || url.pathname === "/admin/site-pages"
          || legacySitePagesListPath
          || legacySitePageEditorPath
          || adminSitePageEditorMatch != null
          || adminWorkflowDetailMatch != null
          || adminWorkflowEnrollmentsMatch != null
          || adminWorkflowEnrollMatch != null
          || url.pathname === "/admin/settings"
          || legacySettingsPath
          || url.pathname === "/admin/appointment-types"
          || adminAppointmentTypeDetailMatch != null
          || legacyBlogListPath
          || legacyBlogEditPath
          || url.pathname === "/client/appointment_types_list.php"
          || url.pathname === "/client/appointment_types_edit.php"
          || url.pathname === "/admin/form-templates"
          || adminFormTemplateDetailMatch != null
          || adminFormTemplateSurveyResultsMatch != null
          || legacyFormTemplateListPath
          || legacyFormTemplateEditPath
          || legacyFormRequestCreatePath
          || legacyFormSurveyResultsPath
          || url.pathname === "/admin/email-templates"
          || adminEmailTemplateDetailMatch != null
          || url.pathname === "/client/email_templates_list.php"
          || url.pathname === "/client/email_templates_edit.php"
          || url.pathname === "/admin/scheduled-tasks"
          || adminScheduledTaskDetailMatch != null
          || url.pathname === "/client/scheduled_tasks_list.php"
          || url.pathname === "/client/scheduled_tasks_edit.php"
          || url.pathname === "/admin/operations/jobs"
          || url.pathname === "/admin/operations/callbacks"
          || adminPetFilesMatch != null
          || adminPetFileContentMatch != null
          || adminClientProfileMatch != null
          || adminClientContactsMatch != null
          || adminClientAchievementsMatch != null
          || adminClientContactDetailMatch != null
          || adminClientAchievementDetailMatch != null
          || adminClientAchievementCertificateDetailMatch != null
          || adminAchievementTypeDetailMatch != null
          || adminBlogPostDetailMatch != null
        || adminSitePageDetailMatch != null
        || adminSettingDetailMatch != null
        || adminOperationJobDetailMatch != null
        || adminOperationCallbackDetailMatch != null
        || googleCalendarOAuthInitiatePath
        || googleCalendarOAuthCallbackPath
        || legacyClientListPath
        || legacyClientDetailPath
        || legacyClientEditPath
          || legacyPetListPath
          || legacyPetDetailPath
          || legacyPetEditPath
          || legacyBookingListPath
          || legacyExpenseDetailPath
          || legacyInvoiceDetailPath
          || legacyQuoteListPath
          || legacyQuoteDetailPath
 || legacyContractListPath
 || legacyContractDetailPath
 || legacyPackageListPath
 || legacyPackageEditPath
 || legacyCreditsManagePath
              )
            )
            || (
              method === "POST"
              && resolved.api != null
              && (
                url.pathname === "/admin/expenses"
                || url.pathname === "/admin/invoices"
              )
            )
          )
        ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null) {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const actor = await handlers.handleAdminActorProfile(session);
        if ("error" in actor.body) {
          redirect(response, buildAdminLoginRedirectPath(request), await clearPersistedSession(resolved.sessionStore, request));
          return;
        }

      const adminNav = "";

      if (googleCalendarOAuthInitiatePath || googleCalendarOAuthCallbackPath) {
        let settingsOverview;
        try {
          settingsOverview = await getAdminSettingsOverview(session as z.infer<typeof authSessionSchema>, resolved.content);
        } catch (error) {
          if (error instanceof SessionActorError) {
            redirect(response, buildAdminLoginRedirectPath(request), await clearPersistedSession(resolved.sessionStore, request));
            return;
          }
          throw error;
        }

        const clientId = readSettingValue(settingsOverview.items, "google_oauth_client_id");
        const clientSecret = readSettingValue(settingsOverview.items, "google_oauth_client_secret");
        const redirectUri = resolveGoogleCalendarOAuthRedirectUri(
          request,
          readSettingValue(settingsOverview.items, "google_oauth_redirect_uri")
        );

        if (googleCalendarOAuthInitiatePath) {
          if (clientId === "" || clientSecret === "") {
            redirect(response, buildAdminCalendarSettingsLocation({
              error: "Save the Google OAuth client ID and client secret before connecting Calendar."
            }));
            return;
          }

          const stateToken = randomUUID();
          const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
          authorizationUrl.searchParams.set("client_id", clientId);
          authorizationUrl.searchParams.set("redirect_uri", redirectUri);
          authorizationUrl.searchParams.set("response_type", "code");
          authorizationUrl.searchParams.set("access_type", "offline");
          authorizationUrl.searchParams.set("include_granted_scopes", "true");
          authorizationUrl.searchParams.set("prompt", "consent");
          authorizationUrl.searchParams.set("scope", googleCalendarOAuthScopes.join(" "));
          authorizationUrl.searchParams.set("state", stateToken);

          redirect(response, authorizationUrl.toString(), {
            "set-cookie": buildGoogleCalendarOAuthStateCookie(stateToken)
          });
          return;
        }

        const returnedError = url.searchParams.get("error")?.trim() ?? "";
        if (returnedError !== "") {
          redirect(response, buildAdminCalendarSettingsLocation({
            error: "Google authorization was not completed."
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        }

        if (clientId === "" || clientSecret === "") {
          redirect(response, buildAdminCalendarSettingsLocation({
            error: "Save the Google OAuth client ID and client secret before completing Calendar authorization."
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        }

        const expectedState = readCookieValue(request, googleCalendarOAuthStateCookieName);
        const returnedState = url.searchParams.get("state")?.trim() ?? "";
        if (expectedState == null || returnedState === "" || expectedState !== returnedState) {
          redirect(response, buildAdminCalendarSettingsLocation({
            error: "Google OAuth state validation failed. Start the connection flow again."
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        }

        const authorizationCode = url.searchParams.get("code")?.trim() ?? "";
        if (authorizationCode === "") {
          redirect(response, buildAdminCalendarSettingsLocation({
            error: "Google did not return an authorization code."
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        }

        try {
          const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
              code: authorizationCode,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: "authorization_code"
            })
          });

          if (!tokenResponse.ok) {
            redirect(response, buildAdminCalendarSettingsLocation({
              error: await readGoogleOAuthErrorMessage(tokenResponse)
            }), {
              "set-cookie": expiredGoogleCalendarOAuthStateCookie
            });
            return;
          }

          const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
          const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token.trim() : "";
          if (accessToken === "") {
            redirect(response, buildAdminCalendarSettingsLocation({
              error: "Google OAuth exchange succeeded but no access token was returned."
            }), {
              "set-cookie": expiredGoogleCalendarOAuthStateCookie
            });
            return;
          }

          const existingToken = await resolved.content.findAdminGoogleCalendarOAuthToken(settingsOverview.currentAdmin.actorId);
          const refreshTokenValue = typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.trim() !== ""
            ? tokenPayload.refresh_token.trim()
            : existingToken?.refreshToken ?? null;
          const tokenType = typeof tokenPayload.token_type === "string" && tokenPayload.token_type.trim() !== ""
            ? tokenPayload.token_type.trim()
            : existingToken?.tokenType ?? "Bearer";
          const expiresInSeconds = typeof tokenPayload.expires_in === "number"
            ? tokenPayload.expires_in
            : typeof tokenPayload.expires_in === "string"
              ? Number.parseInt(tokenPayload.expires_in, 10)
              : Number.NaN;
          const expiresAt = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
            ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
            : null;
          const googleEmail = await readGoogleCalendarAuthorizedEmail(accessToken) ?? existingToken?.googleEmail ?? null;
          const calendarId = readSettingValue(settingsOverview.items, "google_calendar_id")
            || existingToken?.calendarId
            || "primary";

          await resolved.content.saveAdminGoogleCalendarOAuthToken({
            adminUserId: settingsOverview.currentAdmin.actorId,
            accessToken,
            refreshToken: refreshTokenValue,
            tokenType,
            expiresAt,
            calendarId,
            googleEmail
          });

          redirect(response, buildAdminCalendarSettingsLocation({
            notice: "google-calendar-connected"
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        } catch (error) {
          redirect(response, buildAdminCalendarSettingsLocation({
            error: error instanceof Error && error.message.trim() !== ""
              ? error.message.trim()
              : "Google Calendar authorization failed."
          }), {
            "set-cookie": expiredGoogleCalendarOAuthStateCookie
          });
          return;
        }
      }

      const legacyAdminRedirectPath = (() => {
        if (legacyClientListPath || legacyClientEditPath && (url.searchParams.get("id") ?? "").trim() === "") {
          return "/admin/clients";
        }

        if (legacyClientDetailPath || legacyClientEditPath) {
          const clientId = (url.searchParams.get("id") ?? "").trim();
          return clientId === "" ? "/admin/clients" : `/admin/clients/${encodeURIComponent(clientId)}/profile`;
        }

        if (legacyPetListPath || legacyPetEditPath && (url.searchParams.get("id") ?? "").trim() === "") {
          return "/admin/pets";
        }

        if (legacyPetDetailPath || legacyPetEditPath) {
          const petId = (url.searchParams.get("id") ?? "").trim();
          return petId === "" ? "/admin/pets" : `/admin/pets/${encodeURIComponent(petId)}`;
        }

        if (legacyBookingListPath) {
          return "/admin/bookings";
        }

        if (legacyExpenseDetailPath) {
          const expenseId = (url.searchParams.get("id") ?? "").trim();
          return expenseId === "" ? "/admin/expenses" : `/admin/expenses/${encodeURIComponent(expenseId)}`;
        }

        if (legacyInvoiceDetailPath) {
          const invoiceId = (url.searchParams.get("id") ?? "").trim();
          return invoiceId === "" ? "/admin/invoices" : `/admin/invoices/${encodeURIComponent(invoiceId)}`;
        }

        if (legacyQuoteListPath) {
          return "/admin/quotes";
        }

        if (legacyQuoteDetailPath) {
          const quoteId = (url.searchParams.get("id") ?? "").trim();
          return quoteId === "" ? "/admin/quotes" : `/admin/quotes/${encodeURIComponent(quoteId)}`;
        }

        if (legacyContractListPath) {
          return "/admin/contracts";
        }

        if (legacyContractDetailPath) {
          const contractId = (url.searchParams.get("id") ?? "").trim();
          return contractId === "" ? "/admin/contracts" : `/admin/contracts/${encodeURIComponent(contractId)}`;
        }

        if (legacyPackageListPath || legacyPackageEditPath && (url.searchParams.get("id") ?? "").trim() === "") {
          return "/admin/packages";
        }

        if (legacyPackageEditPath) {
          const packageId = (url.searchParams.get("id") ?? "").trim();
          return packageId === "" ? "/admin/packages" : `/admin/packages/${encodeURIComponent(packageId)}`;
        }

        if (legacyCreditsManagePath) {
          return "/admin/credits";
        }

        return null;
      })();

      if (legacyAdminRedirectPath != null) {
        redirect(response, legacyAdminRedirectPath);
        return;
      }

      if (url.pathname === "/admin" || url.pathname === "/admin/dashboard" || url.pathname === "/client/index.php") {
      const dashboard = await handlers.handleAdminDashboard(session);
      if ("error" in dashboard.body) {
        await handleProtectedRouteFailure({
          response,
          request,
          sessionStore: resolved.sessionStore,
          loginPath: buildAdminLoginRedirectPath(request),
          title: "Admin Dashboard",
          result: dashboard
        });
        return;
      }

          writeHtml(response, 200, renderLayout({
            title: "Admin Dashboard",
            body: [
              "<article>",
              renderSectionIntro({
                eyebrow: "Brook's Dog Training Academy",
                title: actor.body.actor.displayName,
                description: `Signed in as ${actor.body.actor.role}. Review client activity, bookings, invoices, and operational work from one place.`
              }),
              renderStatsGrid([
                { label: "pendingBookings", value: dashboard.body.metrics.pendingBookings, meta: "Awaiting confirmation", accent: "warning" },
                { label: "todaysBookings", value: dashboard.body.metrics.todaysBookings, meta: "Scheduled today", accent: "secondary" },
                { label: "overdueInvoices", value: dashboard.body.metrics.overdueInvoices, meta: "Needs follow-up", accent: "primary" },
                { label: "activeClients", value: dashboard.body.metrics.activeClients, meta: "Accessible client records", accent: "success" }
              ]),
 renderQuickLinksGrid([
 { href: "/admin/clients", label: "Clients", description: "Profiles and contacts" },
 { href: "/admin/bookings", label: "Bookings", description: "Schedule and status" },
 { href: "/admin/expenses", label: "Expenses", description: "Operating and billable costs" },
 { href: "/admin/invoices", label: "Invoices", description: "Revenue and balances" },
 { href: "/admin/contracts", label: "Contracts", description: "Pending signatures" },
                { href: "/admin/workflows", label: "Workflows", description: "Automation enrollment" },
                { href: "/admin/appointment-types", label: "Appointment Types", description: "Booking configuration" },
                { href: "/admin/form-templates", label: "Form Templates", description: "Client and internal forms" },
                { href: "/admin/email-templates", label: "Email Templates", description: "Communication catalog" },
                { href: "/admin/scheduled-tasks", label: "Scheduled Tasks", description: "Automation cadence" },
                { href: "/admin/blog-posts", label: "Blog Posts", description: "Public content" },
                { href: "/admin/operations/jobs", label: "Job Logs", description: "Background processing" }
              ]),
              '<div class="content-stack">',
              '<section class="surface-block"><h2>Recent Bookings</h2>',
              renderDataTable({
                headers: ["Booking", "Service", "Starts", "Status"],
                rows: dashboard.body.recentBookings.map((booking) => [
                  `<a href="/admin/bookings">${escapeHtml(booking.id)}</a>`,
                  escapeHtml(booking.serviceId),
                  escapeHtml(booking.startsAt),
                  escapeHtml(booking.status)
                ]),
                emptyMessage: "No recent bookings."
              }),
              "</section>",
              "</div>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/clients") {
const clients = await handlers.handleAdminClients(session);
if ("error" in clients.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Clients",
result: clients
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Admin Clients",
            body: [
      '<article class="content-stack">',
      renderSectionIntro({
        eyebrow: "Clients",
        title: "Client Management",
        description: "Create client records, jump directly into profile management, and keep contacts and achievements one click away."
      }),
      renderAdminClientCreateModal(),
      '<section class="surface-block">',
      "<h2>Client Directory</h2>",
      '<p class="section-copy">Open the client profile to edit the CRM record, then use the dedicated management links for contacts and achievements.</p>',
      renderAdminClientDirectoryTable(clients.body.items),
      "</section>",
      "</article>"
            ].join("")
          }));
          return;
        }

if (adminClientProfileMatch != null) {
const clientId = decodeURIComponent(adminClientProfileMatch[1] ?? "");
const profile = await handlers.handleAdminClientProfile(session, clientId);
if ("error" in profile.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Client Profile",
result: profile
});
return;
}

const adminClientProfileItem = (profile.body as { item: ClientProfile }).item;
const [
contacts,
allPets,
allBookings,
allInvoices,
allQuotes,
allContracts,
allForms,
achievements
] = await Promise.all([
loadSafeRouteItems<ClientContact>(() => handlers.handleAdminClientContacts(session, clientId)),
loadSafeRouteItems<Pet>(() => handlers.handleAdminPets(session)),
loadSafeRouteItems<Booking>(() => handlers.handleAdminBookings(session)),
loadSafeRouteItems<Invoice>(() => handlers.handleAdminInvoices(session)),
loadSafeRouteItems<Quote>(() => handlers.handleAdminQuotes(session)),
loadSafeRouteItems<Contract>(() => handlers.handleAdminContracts(session)),
loadSafeRouteItems<FormSubmission>(() => handlers.handleAdminForms(session)),
loadSafeRouteItems<ClientAchievement>(() => handlers.handleAdminClientAchievements(session, clientId))
]);
const pets = allPets.filter((item) => item.clientId === clientId);
const activePets = pets.filter((item) => !item.archived);
const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
const upcomingBookings = sortByTimeAsc(
allBookings.filter((booking) => booking.clientId === clientId && isBookingUpcoming(booking)),
(booking) => booking.startsAt
).slice(0, 5);
const clientForms = sortByTimeDesc(
allForms.filter((form) => form.clientId === clientId),
(form) => form.reviewedAt ?? form.submittedAt ?? null
);
const recentForms = clientForms.slice(0, 5);
const recentAchievements = sortByTimeDesc(
achievements,
(achievement) => achievement.revokedAt ?? achievement.updatedAt ?? achievement.awardedOn
).slice(0, 5);
const openInvoices = sortByTimeAsc(
allInvoices.filter((invoice) => invoice.clientId === clientId && invoice.status !== "paid" && invoice.status !== "void" && invoice.outstandingAmount > 0),
(invoice) => invoice.dueAt
);
const outstandingBalance = openInvoices.reduce((total, invoice) => total + invoice.outstandingAmount, 0);
const activeQuotes = allQuotes.filter((quote) => quote.clientId === clientId && (quote.status === "draft" || quote.status === "sent"));
const pendingContracts = allContracts.filter((contract) => contract.clientId === clientId && contract.status !== "signed" && contract.status !== "void");
const formsNeedingReview = clientForms.filter((form) => normalizeAdminFormSubmissionStatus(form) !== "reviewed").length;
const nextBooking = upcomingBookings[0] ?? null;
const latestAchievement = recentAchievements[0] ?? null;

writeHtml(response, 200, renderLayout({
title: "Client Profile",
body: [
'<article class="content-stack">',
renderSectionIntro({
eyebrow: "Client Profile",
title: adminClientProfileItem.name,
description: "Review household context, linked pets, billing, forms, and service activity without leaving this client record."
}),
adminNav,
renderStatsGrid([
{ label: "Pets", value: pets.length, meta: formatCountLabel(activePets.length, "active record"), accent: "primary" },
{ label: "Contacts", value: contacts.length, meta: primaryContact == null ? "No primary contact on file" : `Primary: ${primaryContact.name}`, accent: "secondary" },
{ label: "Upcoming Visits", value: upcomingBookings.length, meta: nextBooking == null ? "Nothing scheduled yet" : formatAdminDateTime(nextBooking.startsAt), accent: "success" },
{ label: "Open Balance", value: formatCurrency(outstandingBalance), meta: `${formatCountLabel(openInvoices.length, "invoice")} awaiting action`, accent: "warning" }
]),
'<section class="surface-block">',
"<h2>Client Details</h2>",
renderDetailGrid([
{ label: "Client ID", value: escapeHtml(adminClientProfileItem.id) },
{ label: "Email", value: escapeHtml(adminClientProfileItem.email) },
{ label: "Phone", value: escapeHtml(adminClientProfileItem.phone ?? "Not provided") },
{ label: "Address", value: escapeHtml(adminClientProfileItem.address ?? "Not provided") },
{
label: "Admin Access",
value: renderStatusPill(adminClientProfileItem.isAdmin ? "Enabled" : "Disabled", adminClientProfileItem.isAdmin ? "success" : "default")
},
{
label: "Primary Contact",
value: primaryContact == null
? "No primary contact on file"
: `<a href="/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(primaryContact.id)}">${escapeHtml(primaryContact.name)}</a>`
},
{
label: "Next Appointment",
value: nextBooking == null
? "No active appointments"
: `<a href="/admin/bookings/${encodeURIComponent(nextBooking.id)}">${escapeHtml(formatAdminDateTime(nextBooking.startsAt))}</a>`
},
{
label: "Latest Achievement",
value: latestAchievement == null
? "No achievements awarded"
: `<a href="/admin/clients/${encodeURIComponent(clientId)}/achievements/${encodeURIComponent(latestAchievement.id)}">${escapeHtml(latestAchievement.title)}</a>`
}
]),
"</section>",
'<section class="surface-block">',
"<h2>Client Actions</h2>",
`<div class="form-actions"><a href="/client/form_requests_create.php?form_type=client_form&client_id=${encodeURIComponent(clientId)}">Request Client Form</a><a href="/client/form_requests_create.php?form_type=survey_form&client_id=${encodeURIComponent(clientId)}">Request Survey</a><a href="${buildAdminInvoicesPath({ clientId })}#create-invoice">Create Invoice</a><a href="${buildAdminExpensesPath({ clientId })}#create-expense">Add Expense</a><a href="/admin/clients/${encodeURIComponent(clientId)}/contacts">Manage Contacts</a><a href="/admin/clients/${encodeURIComponent(clientId)}/achievements">View Achievements</a></div>`,
renderQuickLinksGrid([
{ href: buildAdminBookingsPath({ q: clientId }), label: "Appointments", description: upcomingBookings.length === 0 ? "No active appointments linked right now." : `${formatCountLabel(upcomingBookings.length, "upcoming appointment")} scheduled.` },
{ href: `${buildAdminInvoicesPath({ clientId })}#create-invoice`, label: "Invoices", description: openInvoices.length === 0 ? "No outstanding invoices." : `${formatCurrency(outstandingBalance)} still due across ${formatCountLabel(openInvoices.length, "invoice")}.` },
{ href: "/admin/quotes", label: "Quotes", description: activeQuotes.length === 0 ? "No open quotes awaiting response." : `${formatCountLabel(activeQuotes.length, "quote")} still active.` },
{ href: "/admin/contracts", label: "Contracts", description: pendingContracts.length === 0 ? "No unsigned contracts pending." : `${formatCountLabel(pendingContracts.length, "contract")} still needs action.` },
{ href: "/admin/forms", label: "Forms", description: formsNeedingReview === 0 ? "No pending form review." : `${formatCountLabel(formsNeedingReview, "submission")} still needs review.` },
{ href: `/admin/clients/${encodeURIComponent(clientId)}/achievements`, label: "Achievements", description: recentAchievements.length === 0 ? "No awards on record." : `${formatCountLabel(recentAchievements.length, "recent award")} visible from this profile.` }
]),
"</section>",
'<section class="surface-block">',
"<h2>Operational Notes</h2>",
renderLongTextBlock(adminClientProfileItem.notes, "No internal notes recorded for this client yet."),
"</section>",
'<section class="surface-block">',
"<h2>Household Contacts</h2>",
renderContactsPreviewTable(contacts, (contact) => `/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Pet Roster</h2>",
renderPetsPreviewTable(pets, {
detailPath: (petItem) => `/admin/pets/${encodeURIComponent(petItem.id)}`,
filePath: (petItem) => `/admin/pets/${encodeURIComponent(petItem.id)}/files`
}),
"</section>",
'<section class="surface-block">',
"<h2>Upcoming Appointments</h2>",
renderBookingsPreviewTable(upcomingBookings, (booking) => `/admin/bookings/${encodeURIComponent(booking.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Recent Forms</h2>",
renderFormsPreviewTable(recentForms, (form) => `/admin/forms/${encodeURIComponent(form.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Achievements</h2>",
renderAchievementsPreviewTable(recentAchievements, (achievement) => `/admin/clients/${encodeURIComponent(clientId)}/achievements/${encodeURIComponent(achievement.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Edit Client</h2>",
`<form class="form-grid" method="post" action="/admin/clients/${encodeURIComponent(clientId)}/profile">`,
'<div class="form-grid form-grid--two">',
`<label>Name<input type="text" name="name" value="${escapeHtml(adminClientProfileItem.name)}" required></label>`,
`<label>Email<input type="email" name="email" value="${escapeHtml(adminClientProfileItem.email)}" required></label>`,
`<label>Phone<input type="text" name="phone" value="${escapeHtml(adminClientProfileItem.phone ?? "")}"></label>`,
"</div>",
`<label>Address<textarea name="address">${escapeHtml(adminClientProfileItem.address ?? "")}</textarea></label>`,
`<label>Notes<textarea name="notes">${escapeHtml(adminClientProfileItem.notes ?? "")}</textarea></label>`,
`<label><input type="checkbox" name="isAdmin"${adminClientProfileItem.isAdmin ? " checked" : ""}> Grant admin access</label>`,
'<div class="form-actions"><button type="submit">Save Client</button></div>',
"</form>",
"</section>",
"</article>"
].join("")
}));
return;

 writeHtml(response, 200, renderLayout({
            title: "Client Profile",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Client Profile",
 title: adminClientProfileItem.name,
                description: "Update the core CRM record for this client, including admin access and operational notes."
              }),
              adminNav,
              renderDetailGrid([
 { label: "Email", value: escapeHtml(adminClientProfileItem.email) },
 { label: "Phone", value: escapeHtml(adminClientProfileItem.phone ?? "Not provided") },
 { label: "Address", value: escapeHtml(adminClientProfileItem.address ?? "Not provided") },
                {
                  label: "Admin Access",
 value: renderStatusPill(adminClientProfileItem.isAdmin ? "Enabled" : "Disabled", adminClientProfileItem.isAdmin ? "success" : "default")
                }
              ]),
              '<section class="surface-block">',
              "<h2>Client Actions</h2>",
              `<div class="form-actions"><a href="/client/form_requests_create.php?form_type=client_form&client_id=${encodeURIComponent(clientId)}">Request Client Form</a><a href="/client/form_requests_create.php?form_type=survey_form&client_id=${encodeURIComponent(clientId)}">Request Survey</a><a href="/admin/clients/${encodeURIComponent(clientId)}/contacts">Manage Contacts</a></div>`,
              "</section>",
              '<section class="surface-block">',
              "<h2>Edit Client</h2>",
              `<form class="form-grid" method="post" action="/admin/clients/${encodeURIComponent(clientId)}/profile">`,
              '<div class="form-grid form-grid--two">',
 `<label>Name<input type="text" name="name" value="${escapeHtml(adminClientProfileItem.name)}" required></label>`,
 `<label>Email<input type="email" name="email" value="${escapeHtml(adminClientProfileItem.email)}" required></label>`,
 `<label>Phone<input type="text" name="phone" value="${escapeHtml(adminClientProfileItem.phone ?? "")}"></label>`,
              "</div>",
 `<label>Address<textarea name="address">${escapeHtml(adminClientProfileItem.address ?? "")}</textarea></label>`,
 `<label>Notes<textarea name="notes">${escapeHtml(adminClientProfileItem.notes ?? "")}</textarea></label>`,
 `<label><input type="checkbox" name="isAdmin"${adminClientProfileItem.isAdmin ? " checked" : ""}> Grant admin access</label>`,
              '<div class="form-actions"><button type="submit">Save Client</button></div>',
              "</form>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (adminClientContactsMatch != null) {
const clientId = decodeURIComponent(adminClientContactsMatch[1] ?? "");
const contacts = await handlers.handleAdminClientContacts(session, clientId);
if ("error" in contacts.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Client Contacts",
result: contacts
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Client Contacts",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Client Contacts",
                title: "Client Contacts",
                description: "Manage household members, emergency contacts, and the primary communication owner for this client."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Add Contact</h2>",
              `<form class="form-grid" method="post" action="/admin/clients/${encodeURIComponent(clientId)}/contacts">`,
              '<div class="form-grid form-grid--two">',
              '<label>Name<input type="text" name="name" required></label>',
              '<label>Email<input type="email" name="email" required></label>',
              '<label>Phone<input type="text" name="phone" required></label>',
              "</div>",
              '<label><input type="checkbox" name="isPrimary"> Primary contact</label>',
              '<div class="form-actions"><button type="submit">Add Contact</button></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Contact Directory</h2>",
              renderDataTable({
                headers: ["Contact", "Email", "Phone", "Role", "Actions"],
                rows: contacts.body.items.map((contact) => [
                  `<a href="/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.id)}">${escapeHtml(contact.name)}</a>`,
                  escapeHtml(contact.email),
                  escapeHtml(contact.phone),
                  renderStatusPill(contact.isPrimary ? "Primary" : "Secondary", contact.isPrimary ? "success" : "default"),
                  `<div class="table-actions"><a href="/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.id)}">Manage</a></div>`
                ]),
                emptyMessage: "No contacts."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminClientContactDetailMatch != null) {
          const clientId = decodeURIComponent(adminClientContactDetailMatch[1] ?? "");
          const contactId = decodeURIComponent(adminClientContactDetailMatch[2] ?? "");
          const contact = await handlers.handleAdminClientContactDetail(session, clientId, contactId);
          if ("error" in contact.body) {
            redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/contacts`);
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Contact Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Client Contacts",
                title: contact.body.item.name,
                description: "Edit routing details for this contact and manage whether it is the primary account contact."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Email", value: escapeHtml(contact.body.item.email) },
                { label: "Phone", value: escapeHtml(contact.body.item.phone) },
                {
                  label: "Role",
                  value: renderStatusPill(contact.body.item.isPrimary ? "Primary contact" : "Secondary contact", contact.body.item.isPrimary ? "success" : "default")
                }
              ]),
              '<section class="surface-block">',
              "<h2>Edit Contact</h2>",
              `<form class="form-grid" method="post" action="/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.body.item.id)}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Name<input type="text" name="name" value="${escapeHtml(contact.body.item.name)}" required></label>`,
              `<label>Email<input type="email" name="email" value="${escapeHtml(contact.body.item.email)}" required></label>`,
              `<label>Phone<input type="text" name="phone" value="${escapeHtml(contact.body.item.phone)}" required></label>`,
              "</div>",
              `<label><input type="checkbox" name="isPrimary"${contact.body.item.isPrimary ? " checked" : ""}> Primary contact</label>`,
              '<div class="form-actions"><button type="submit">Save Contact</button></div>',
              "</form>",
              `<form class="form-actions" method="post" action="/admin/clients/${encodeURIComponent(clientId)}/contacts/${encodeURIComponent(contact.body.item.id)}/delete"><button type="submit">Delete Contact</button></form>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (adminClientAchievementsMatch != null) {
const clientId = decodeURIComponent(adminClientAchievementsMatch[1] ?? "");
const achievements = await handlers.handleAdminClientAchievements(session, clientId);
if ("error" in achievements.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Client Achievements",
result: achievements
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Client Achievements",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Client Achievements",
                title: "Client Achievements",
                description: "Review awarded milestones for this client and open printable certificates."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Achievement Library</h2>",
              renderDataTable({
                headers: ["Achievement", "Program", "Status", "Certificate"],
                rows: achievements.body.items.map((achievement) => [
                  `<a href="/admin/clients/${encodeURIComponent(clientId)}/achievements/${encodeURIComponent(achievement.id)}">${escapeHtml(achievement.title)}</a>`,
                  escapeHtml(achievement.programName ?? "General"),
                  renderStatusPill(achievement.status, achievement.status === "awarded" ? "success" : "info"),
                  `<a href="/admin/clients/${encodeURIComponent(clientId)}/achievements/${encodeURIComponent(achievement.id)}/certificate">Open certificate</a>`
                ]),
                emptyMessage: "No achievements."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminClientAchievementCertificateDetailMatch != null) {
          const clientId = decodeURIComponent(adminClientAchievementCertificateDetailMatch[1] ?? "");
          const achievementId = decodeURIComponent(adminClientAchievementCertificateDetailMatch[2] ?? "");
          const result = await handlers.handleAdminClientAchievementCertificate(
            session,
            clientId,
            achievementId,
            url.searchParams.get("download") === "1"
          );
          if (typeof result.body === "string") {
            writeHtml(response, result.status, result.body, {
              "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="achievement-${encodeURIComponent(achievementId)}.html"`
            });
            return;
          }

          redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/achievements`);
          return;
        }

        if (adminClientAchievementDetailMatch != null) {
          const clientId = decodeURIComponent(adminClientAchievementDetailMatch[1] ?? "");
          const achievementId = decodeURIComponent(adminClientAchievementDetailMatch[2] ?? "");
          const achievement = await handlers.handleAdminClientAchievementDetail(session, clientId, achievementId);
          if ("error" in achievement.body) {
            redirect(response, `/admin/clients/${encodeURIComponent(clientId)}/achievements`);
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Achievement Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Client Achievements",
                title: achievement.body.item.title,
                description: "View the full award details and certificate link for this client achievement."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Award Summary</h2>",
              `<p>${escapeHtml(achievement.body.item.description)}</p>`,
              renderDetailGrid([
                {
                  label: "Status",
                  value: renderStatusPill(achievement.body.item.status, achievement.body.item.status === "awarded" ? "success" : "info")
                },
                { label: "Awarded On", value: escapeHtml(achievement.body.item.awardedOn) },
                { label: "Program", value: escapeHtml(achievement.body.item.programName ?? "General") },
                { label: "Dog", value: escapeHtml(achievement.body.item.dogName ?? "Not specified") }
              ]),
              `<p>${escapeHtml(achievement.body.item.notes)}</p>`,
              `<div class="form-actions"><a href="/admin/clients/${encodeURIComponent(clientId)}/achievements/${encodeURIComponent(achievement.body.item.id)}/certificate">Open certificate</a></div>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/bookings") {
          const [bookings, clients, pets, appointmentTypes] = await Promise.all([
            handlers.handleAdminBookings(session),
            resolved.api == null ? Promise.resolve([] as Client[]) : resolved.api.adminResources.listAdminClients(),
            resolved.api == null ? Promise.resolve([] as Pet[]) : resolved.api.adminResources.listAdminPets(),
            resolved.api == null ? Promise.resolve([] as AppointmentType[]) : resolved.api.adminConfiguration.listAdminAppointmentTypes()
          ]);
          if ("error" in bookings.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Bookings",
              result: bookings
            });
            return;
          }

          const clientById = new Map(clients.map((client) => [client.id, client]));
          const petById = new Map(pets.map((pet) => [pet.id, pet]));
          const appointmentTypeById = new Map(appointmentTypes.map((appointmentType) => [appointmentType.id, appointmentType]));
          const bookingQuery = normalizeSearchQuery(url.searchParams.get("q"));
          const bookingRows = bookings.body.items
            .map((booking) => {
              const client = clientById.get(booking.clientId) ?? null;
              const linkedPets = booking.petIds.map((petId) => petById.get(petId) ?? null).filter((pet): pet is Pet => pet != null);
              const appointmentType = appointmentTypeById.get(booking.serviceId) ?? null;
              const clientLabel = client == null ? booking.clientId : renderAdminClientDisplayName(client);
              const petLabel = linkedPets.length === 0 ? "Unassigned" : linkedPets.map((pet) => pet.name).join(", ");
              const serviceLabel = appointmentType?.name ?? booking.serviceId;
              const startsLabel = formatAdminDateTime(booking.startsAt);
              return {
                booking,
                client,
                linkedPets,
                clientLabel,
                petLabel,
                serviceLabel,
                startsLabel,
                statusLabel: booking.status
              };
            })
            .filter((item) => matchesSearchQuery(
              bookingQuery,
              item.booking.id,
              item.booking.clientId,
              item.clientLabel,
              item.petLabel,
              item.serviceLabel,
              item.startsLabel,
              item.statusLabel
            ));

          writeHtml(response, 200, renderLayout({
            title: "Admin Bookings",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Bookings",
                title: "Bookings",
                description: "Monitor current scheduling, service types, and booking states across the CRM."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Find Bookings</h2>',
              `<form class="form-grid" method="get" action="/admin/bookings"><label>Client, pet, service, or booking ID<input type="search" name="q" value="${escapeAttribute(url.searchParams.get("q") ?? "")}" placeholder="Search by client name, pet name, appointment type, or booking ID"></label><div class="form-actions"><button type="submit">Filter Bookings</button><a href="/admin/bookings">Clear</a></div></form>`,
              '</section>',
              '<section class="surface-block">',
              '<h2>Booking Ledger</h2>',
              renderDataTable({
                headers: ["Booking", "Client", "Pets", "Service", "Starts", "Status", "Actions"],
                rows: bookingRows.map((item) => [
                  `<a href="/admin/bookings/${encodeURIComponent(item.booking.id)}">${escapeHtml(item.booking.id)}</a>`,
                  item.client == null
                    ? escapeHtml(item.clientLabel)
                    : `<a href="/admin/clients/${encodeURIComponent(item.client.id)}/profile">${escapeHtml(item.clientLabel)}</a>`,
                  item.linkedPets.length === 0
                    ? "Unassigned"
                    : item.linkedPets.map((pet) => `<a href="/admin/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.name)}</a>`).join(", "),
                  escapeHtml(item.serviceLabel),
                  escapeHtml(item.startsLabel),
                  renderBookingStatusPill(item.booking.status),
                  renderTableActionLinks([
                    { href: `/admin/bookings/${encodeURIComponent(item.booking.id)}`, label: "Manage" },
                    { href: buildAdminBookingsPath({ q: item.booking.clientId }), label: "Client Bookings" }
                  ])
                ]),
                emptyMessage: bookingQuery === "" ? "No bookings." : "No bookings match this filter."
              }),
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (adminBookingDetailMatch != null) {
          const bookingId = decodeURIComponent(adminBookingDetailMatch[1] ?? "");
          const booking = await handlers.handleAdminBookingDetail(session, bookingId);
          if ("error" in booking.body) {
            redirect(response, "/admin/bookings");
            return;
          }

          const [client, linkedPets, appointmentType] = await Promise.all([
            resolved.api == null ? Promise.resolve(null) : resolved.api.adminResources.findAdminClientById(booking.body.item.clientId),
            resolved.api == null
              ? Promise.resolve([] as Pet[])
              : Promise.all(booking.body.item.petIds.map(async (petId) => resolved.api?.adminResources.findAdminPetById(petId) ?? null)).then((items) => items.filter((pet): pet is Pet => pet != null)),
            resolved.api == null ? Promise.resolve(null) : resolved.api.adminConfiguration.findAdminAppointmentTypeById(booking.body.item.serviceId)
          ]);
          const clientValue = client == null
            ? escapeHtml(booking.body.item.clientId)
            : `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`;
          const petsValue = linkedPets.length === 0
            ? "No pets linked"
            : linkedPets.map((pet) => `<a href="/admin/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.name)}</a>`).join(", ");
          const serviceValue = appointmentType == null
            ? escapeHtml(booking.body.item.serviceId)
            : `<a href="/admin/appointment-types/${encodeURIComponent(appointmentType.id)}">${escapeHtml(appointmentType.name)}</a>`;

          writeHtml(response, 200, renderLayout({
            title: "Admin Booking Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Bookings",
                title: booking.body.item.id,
                description: "Review the schedule, service assignment, client, and calendar-access details for this booking."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Booking Details</h2>',
              renderDetailGrid([
                { label: "Booking ID", value: escapeHtml(booking.body.item.id) },
                { label: "Client", value: clientValue },
                { label: "Service", value: serviceValue },
                { label: "Starts", value: escapeHtml(formatAdminDateTime(booking.body.item.startsAt)) },
                { label: "Ends", value: escapeHtml(formatAdminDateTime(booking.body.item.endsAt)) },
                { label: "Status", value: renderBookingStatusPill(booking.body.item.status) },
                { label: "Pets", value: petsValue },
                { label: "Calendar Access Token", value: escapeHtml(booking.body.item.icalAccess?.token ?? "Unavailable") }
              ]),
              '</section>',
              '<section class="surface-block">',
              '<h2>Linked Records</h2>',
              `<div class="form-actions"><a href="/client/form_requests_create.php?form_type=follow_up_note&booking_id=${encodeURIComponent(booking.body.item.id)}">Create Follow-up Note</a><a href="${buildAdminBookingsPath({ q: booking.body.item.clientId })}">View Client Bookings</a><a href="/admin/bookings">Back to Bookings</a></div>`,
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }
if (method === "POST" && handlers != null && resolved.api != null && url.pathname === "/admin/expenses") {
          const session = await loadPersistedSession(resolved.sessionStore, request);
          if (session == null) {
            redirect(response, buildAdminLoginRedirectPath(request));
            return;
          }

          try {
            const form = await readFormBody(request);
            const amount = Number.parseFloat(readRequiredFormValue(form, "amount"));
            if (!Number.isFinite(amount) || amount < 0) {
              throw new Error("Expense amount must be a valid positive number.");
            }

            const createdExpense = await resolved.api.adminResources.createAdminExpense({
              clientId: readOptionalFormValue(form, "clientId"),
              category: readRequiredFormValue(form, "category"),
              description: readRequiredFormValue(form, "description"),
              amount,
              expenseDate: readOptionalFormValue(form, "expenseDate"),
              billable: readCheckedFormValue(form, "billable"),
              invoiced: readCheckedFormValue(form, "invoiced"),
              notes: form.get("notes")?.trim() ?? ""
            });
            redirect(response, `/admin/expenses/${encodeURIComponent(createdExpense.id)}`);
          } catch (error) {
            writeHtml(response, 400, renderLayout({
              title: "Admin Expenses",
              body: `<article><h1>Admin Expenses</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unable to create expense.")}</p></article>`
            }));
          }
          return;
        }

        if (url.pathname === "/admin/expenses" || url.pathname === "/client/expenses_list.php") {
          const [expenses, clients] = await Promise.all([
            handlers.handleAdminExpenses(session),
            resolved.api == null ? Promise.resolve([] as Client[]) : resolved.api.adminResources.listAdminClients()
          ]);
          if ("error" in expenses.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Expenses",
              result: expenses
            });
            return;
          }

          const selectedClientId = (url.searchParams.get("client_id") ?? "").trim();
          const totalExpenses = expenses.body.items.reduce((sum, expense) => sum + expense.amount, 0);
          const billableExpenses = expenses.body.items.reduce((sum, expense) => expense.billable ? sum + expense.amount : sum, 0);
          const invoicedExpenses = expenses.body.items.filter((expense) => expense.invoiced).length;

          writeHtml(response, 200, renderLayout({
            title: "Admin Expenses",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Expenses",
                title: "Expenses",
                description: "Track operating costs, billable reimbursements, and receipt coverage across the business."
              }),
              adminNav,
              renderStatsGrid([
                {
                  label: "Total Expenses",
                  value: formatCurrency(totalExpenses),
                  meta: "All recorded expense amounts",
                  accent: "primary"
                },
                {
                  label: "Billable Amount",
                  value: formatCurrency(billableExpenses),
                  meta: "Eligible to pass through to clients",
                  accent: "success"
                },
                {
                  label: "Invoiced Entries",
                  value: invoicedExpenses,
                  meta: invoicedExpenses === 1 ? "Expense already invoiced" : "Expenses already invoiced",
                  accent: "warning"
                }
              ]),
              '<section id="create-expense" class="surface-block">',
              '<h2>Add Expense</h2>',
              `<form class="form-grid" method="post" action="/admin/expenses"><div class="form-grid form-grid--two"><label>Client<select name="clientId"><option value="">General business expense</option>${clients.map((client) => `<option value="${escapeAttribute(client.id)}"${client.id === selectedClientId ? " selected" : ""}>${escapeHtml(renderAdminClientDisplayName(client))}</option>`).join("")}</select></label><label>Expense Date<input type="date" name="expenseDate" value="${escapeAttribute(new Date().toISOString().slice(0, 10))}"></label><label>Category<input type="text" name="category" required></label><label>Amount<input type="number" name="amount" min="0" step="0.01" required></label></div><label>Description<input type="text" name="description" required></label><div class="form-grid form-grid--two"><label><input type="checkbox" name="billable"> Billable to client</label><label><input type="checkbox" name="invoiced"> Already invoiced</label></div><label>Notes<textarea name="notes" rows="4"></textarea></label><div class="form-actions"><button type="submit">Add Expense</button></div></form>`,
              '</section>',
              '<section class="surface-block">',
              '<h2>Expense Ledger</h2>',
              renderDataTable({
                headers: ["Expense ID", "Date", "Category", "Description", "Client", "Amount", "Status", "Actions"],
                rows: expenses.body.items.map((expense) => [
                  `<a href="/admin/expenses/${encodeURIComponent(expense.id)}">${escapeHtml(expense.id)}</a>`,
                  escapeHtml(formatAdminDate(expense.expenseDate)),
                  escapeHtml(expense.category),
                  escapeHtml(expense.description),
                  expense.clientId == null
                    ? "General"
                    : `<a href="/admin/clients/${encodeURIComponent(expense.clientId)}/profile">${escapeHtml(expense.clientName ?? expense.clientId)}</a>`,
                  escapeHtml(formatCurrency(expense.amount)),
                  renderExpenseStatusPill(expense),
                  renderTableActionLinks([
                    { href: `/admin/expenses/${encodeURIComponent(expense.id)}`, label: "Manage" }
                  ])
                ]),
                emptyMessage: "No expenses."
              }),
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (adminExpenseDetailMatch != null) {
          const expenseId = decodeURIComponent(adminExpenseDetailMatch[1] ?? "");
          const expense = await handlers.handleAdminExpenseDetail(session, expenseId);
          if ("error" in expense.body) {
            redirect(response, "/admin/expenses");
            return;
          }

          const clientValue = expense.body.item.clientId == null
            ? "General business expense"
            : `<a href="/admin/clients/${encodeURIComponent(expense.body.item.clientId)}/profile">${escapeHtml(expense.body.item.clientName ?? expense.body.item.clientId)}</a>`;
          const receiptLink = expense.body.item.receiptFile == null
            ? "No receipt uploaded"
            : `<a href="/backend/uploads/receipts/${encodeURIComponent(expense.body.item.receiptFile)}" target="_blank" rel="noreferrer">Open receipt</a>`;

          writeHtml(response, 200, renderLayout({
            title: "Admin Expense Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Expenses",
                title: expense.body.item.id,
                description: "Review classification, reimbursement status, attached receipt, and bookkeeping notes for this expense."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Expense Details</h2>',
              renderDetailGrid([
                { label: "Expense ID", value: escapeHtml(expense.body.item.id) },
                { label: "Client", value: clientValue },
                { label: "Category", value: escapeHtml(expense.body.item.category) },
                { label: "Amount", value: escapeHtml(formatCurrency(expense.body.item.amount)) },
                { label: "Expense Date", value: escapeHtml(formatAdminDate(expense.body.item.expenseDate)) },
                { label: "Status", value: renderExpenseStatusPill(expense.body.item) },
                { label: "Receipt", value: receiptLink },
                { label: "Created", value: escapeHtml(formatAdminDateTime(expense.body.item.createdAt)) }
              ]),
              '</section>',
              '<section class="surface-block">',
              '<h2>Description</h2>',
              `<p>${escapeHtml(expense.body.item.description)}</p>`,
              '</section>',
              '<section class="surface-block">',
              '<h2>Notes</h2>',
              `<p>${escapeHtml(expense.body.item.notes.trim() === "" ? "No notes recorded." : expense.body.item.notes)}</p>`,
              `<div class="form-actions"><a href="${expense.body.item.clientId == null ? "/admin/expenses" : buildAdminExpensesPath({ clientId: expense.body.item.clientId })}">Back to Expenses</a></div>`,
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }
if (method === "POST" && handlers != null && resolved.api != null && url.pathname === "/admin/invoices") {
          const session = await loadPersistedSession(resolved.sessionStore, request);
          if (session == null) {
            redirect(response, buildAdminLoginRedirectPath(request));
            return;
          }

          try {
            const form = await readFormBody(request);
            const totalAmount = Number.parseFloat(readRequiredFormValue(form, "totalAmount"));
            if (!Number.isFinite(totalAmount) || totalAmount < 0) {
              throw new Error("Invoice total must be a valid positive number.");
            }

            const createdInvoice = await resolved.api.adminResources.createAdminInvoice({
              clientId: readRequiredFormValue(form, "clientId"),
              totalAmount,
              dueAt: readOptionalFormValue(form, "dueAt"),
              status: readRequiredFormValue(form, "status") as Invoice["status"],
              notes: form.get("notes")?.trim() ?? ""
            });
            redirect(response, `/admin/invoices/${encodeURIComponent(createdInvoice.id)}`);
          } catch (error) {
            writeHtml(response, 400, renderLayout({
              title: "Admin Invoices",
              body: `<article><h1>Admin Invoices</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unable to create invoice.")}</p></article>`
            }));
          }
          return;
        }

        if (url.pathname === "/admin/invoices" || url.pathname === "/client/invoices_list.php") {
          const [invoices, clients] = await Promise.all([
            handlers.handleAdminInvoices(session),
            resolved.api == null ? Promise.resolve([] as Client[]) : resolved.api.adminResources.listAdminClients()
          ]);
          if ("error" in invoices.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Invoices",
              result: invoices
            });
            return;
          }

          const clientById = new Map(clients.map((client) => [client.id, client]));
          const selectedClientId = (url.searchParams.get("client_id") ?? "").trim();

          writeHtml(response, 200, renderLayout({
            title: "Admin Invoices",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Invoices",
                title: "Invoices",
                description: "Track revenue, due dates, and outstanding balances across client billing."
              }),
              adminNav,
              '<section id="create-invoice" class="surface-block">',
              '<h2>Create Invoice</h2>',
              `<form class="form-grid" method="post" action="/admin/invoices"><div class="form-grid form-grid--two"><label>Client<select name="clientId" required><option value="">Select client</option>${clients.map((client) => `<option value="${escapeAttribute(client.id)}"${client.id === selectedClientId ? " selected" : ""}>${escapeHtml(renderAdminClientDisplayName(client))}</option>`).join("")}</select></label><label>Due Date<input type="date" name="dueAt" value="${escapeAttribute(new Date().toISOString().slice(0, 10))}"></label><label>Total Amount<input type="number" name="totalAmount" min="0" step="0.01" required></label><label>Status<select name="status"><option value="draft">Draft</option><option value="sent" selected>Sent</option><option value="paid">Paid</option><option value="void">Void</option></select></label></div><label>Notes<textarea name="notes" rows="4"></textarea></label><div class="form-actions"><button type="submit">Create Invoice</button></div></form>`,
              '</section>',
              '<section class="surface-block">',
              '<h2>Invoice Ledger</h2>',
              renderDataTable({
                headers: ["Invoice ID", "Client", "Total", "Outstanding", "Due Date", "Status", "Actions"],
                rows: invoices.body.items.map((invoice) => {
                  const client = clientById.get(invoice.clientId) ?? null;
                  return [
                    `<a href="/admin/invoices/${encodeURIComponent(invoice.id)}">${escapeHtml(invoice.id)}</a>`,
                    client == null
                      ? escapeHtml(invoice.clientId)
                      : `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`,
                    escapeHtml(formatCurrency(invoice.totalAmount)),
                    escapeHtml(formatCurrency(invoice.outstandingAmount)),
                    escapeHtml(formatAdminDate(invoice.dueAt)),
                    renderStatusPill(
                      invoice.status,
                      invoice.status === "paid" ? "success" : invoice.status === "void" ? "danger" : "warning"
                    ),
                    renderTableActionLinks([
                      { href: `/admin/invoices/${encodeURIComponent(invoice.id)}`, label: "Manage" }
                    ])
                  ];
                }),
                emptyMessage: "No invoices."
              }),
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (adminInvoiceDetailMatch != null) {
          const invoiceId = decodeURIComponent(adminInvoiceDetailMatch[1] ?? "");
          const invoice = await handlers.handleAdminInvoiceDetail(session, invoiceId);
          if ("error" in invoice.body) {
            redirect(response, "/admin/invoices");
            return;
          }

          const client = resolved.api == null
            ? null
            : await resolved.api.adminResources.findAdminClientById(invoice.body.item.clientId);
          const clientValue = client == null
            ? escapeHtml(invoice.body.item.clientId)
            : `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`;

          writeHtml(response, 200, renderLayout({
            title: "Admin Invoice Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Invoices",
                title: invoice.body.item.id,
                description: "Review balance, due date, and current collection state for this invoice."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Invoice Details</h2>',
              renderDetailGrid([
                { label: "Invoice ID", value: escapeHtml(invoice.body.item.id) },
                { label: "Client", value: clientValue },
                {
                  label: "Status",
                  value: renderStatusPill(
                    invoice.body.item.status,
                    invoice.body.item.status === "paid" ? "success" : invoice.body.item.status === "void" ? "danger" : "warning"
                  )
                },
                { label: "Total Amount", value: escapeHtml(formatCurrency(invoice.body.item.totalAmount)) },
                { label: "Outstanding Balance", value: escapeHtml(formatCurrency(invoice.body.item.outstandingAmount)) },
                { label: "Due Date", value: escapeHtml(formatAdminDate(invoice.body.item.dueAt)) }
              ]),
              `<div class="form-actions"><a href="${buildAdminInvoicesPath({ clientId: invoice.body.item.clientId })}">Back to Invoices</a></div>`,
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }
if (url.pathname === "/admin/quotes") {
          const quotes = await handlers.handleAdminQuotes(session);
          if ("error" in quotes.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Quotes",
              result: quotes
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Quotes",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Quotes",
                title: "Quotes",
                description: "Review proposal totals and identify which quotes are still waiting on approval."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Quote Pipeline</h2>",
              renderDataTable({
                headers: ["Quote ID", "Total", "Status", "Actions"],
                rows: quotes.body.items.map((quote) => [
                  `<a href="/admin/quotes/${encodeURIComponent(quote.id)}">${escapeHtml(quote.id)}</a>`,
                  escapeHtml(formatCurrency(quote.totalAmount)),
                  renderStatusPill(quote.status, quote.status === "accepted" ? "success" : "warning"),
                  renderTableActionLinks([
                    { href: `/admin/quotes/${encodeURIComponent(quote.id)}`, label: "Manage" }
                  ])
                ]),
                emptyMessage: "No quotes."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminQuoteDetailMatch != null) {
          const quoteId = decodeURIComponent(adminQuoteDetailMatch[1] ?? "");
          const quote = await handlers.handleAdminQuoteDetail(session, quoteId);
          if ("error" in quote.body) {
            redirect(response, "/admin/quotes");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Quote Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Quotes",
                title: quote.body.item.id,
                description: "Review this quote's pricing, approval state, and public-access token."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Quote Details</h2>",
              renderDetailGrid([
                { label: "Quote ID", value: escapeHtml(quote.body.item.id) },
                { label: "Client ID", value: escapeHtml(quote.body.item.clientId) },
                {
                  label: "Status",
                  value: renderStatusPill(quote.body.item.status, quote.body.item.status === "accepted" ? "success" : "warning")
                },
                { label: "Total Amount", value: escapeHtml(formatCurrency(quote.body.item.totalAmount)) },
                {
                  label: "Public Access",
                  value: escapeHtml(quote.body.item.publicAccess?.token ?? "Portal-only")
                }
              ]),
              '<div class="form-actions"><a href="/admin/quotes">Back to Quotes</a></div>',
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/contracts") {
          const contracts = await handlers.handleAdminContracts(session);
          if ("error" in contracts.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Contracts",
              result: contracts
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Contracts",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contracts",
                title: "Contracts",
                description: "Track which agreements are fully signed and which still require client action."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Contract Status</h2>",
              renderDataTable({
                headers: ["Contract ID", "Status", "Actions"],
                rows: contracts.body.items.map((contract) => [
                  `<a href="/admin/contracts/${encodeURIComponent(contract.id)}">${escapeHtml(contract.id)}</a>`,
                  renderStatusPill(contract.status, contract.status === "signed" ? "success" : "warning"),
                  renderTableActionLinks([
                    { href: `/admin/contracts/${encodeURIComponent(contract.id)}`, label: "Manage" }
                  ])
                ]),
                emptyMessage: "No contracts."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminContractDetailMatch != null) {
          const contractId = decodeURIComponent(adminContractDetailMatch[1] ?? "");
          const contract = await handlers.handleAdminContractDetail(session, contractId);
          if ("error" in contract.body) {
            redirect(response, "/admin/contracts");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Contract Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Contracts",
                title: contract.body.item.id,
                description: "Review the signature state and public-access details for this agreement."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Contract Details</h2>",
              renderDetailGrid([
                { label: "Contract ID", value: escapeHtml(contract.body.item.id) },
                { label: "Client ID", value: escapeHtml(contract.body.item.clientId) },
                {
                  label: "Status",
                  value: renderStatusPill(contract.body.item.status, contract.body.item.status === "signed" ? "success" : "warning")
                },
                {
                  label: "Public Access",
                  value: escapeHtml(contract.body.item.publicAccess?.token ?? "Portal-only")
                }
              ]),
              '<div class="form-actions"><a href="/admin/contracts">Back to Contracts</a></div>',
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminPetFilesMatch != null) {
          const petId = decodeURIComponent(adminPetFilesMatch[1] ?? "");
          const files = await handlers.handleAdminPetFiles(session, petId);
          if ("error" in files.body) {
            redirect(response, "/admin/pets");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Pet Files",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pet Files",
                title: `Files for ${petId}`,
                description: "Upload and maintain the stored documents and images associated with this pet record."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Upload File</h2>",
              `<form class="form-grid" method="post" action="/admin/pets/${encodeURIComponent(petId)}/files" enctype="multipart/form-data">`,
              '<label>Description<textarea name="description"></textarea></label>',
              '<label>File<input type="file" name="file" required></label>',
              '<div class="form-actions"><button type="submit">Upload File</button><a href="/admin/pets">Back to pets</a></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Stored Files</h2>",
              renderDataTable({
                headers: ["Name", "Description", "Type", "Size", "Actions"],
                rows: files.body.items.map((file) => [
                  escapeHtml(file.originalName),
                  escapeHtml(file.description),
                  escapeHtml(file.fileType),
                  escapeHtml(`${file.fileSize} bytes`),
                  `<div class="table-actions"><a href="/admin/pets/${encodeURIComponent(petId)}/files/${encodeURIComponent(file.id)}/content">View</a><form method="post" action="/admin/pets/${encodeURIComponent(petId)}/files/${encodeURIComponent(file.id)}/delete"><button type="submit">Delete</button></form></div>`
                ]),
                emptyMessage: "No files."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminPetFileContentMatch != null) {
          const petId = decodeURIComponent(adminPetFileContentMatch[1] ?? "");
          const fileId = decodeURIComponent(adminPetFileContentMatch[2] ?? "");
          const result = await handlers.handleAdminPetFileContent(
            session,
            petId,
            fileId,
            url.searchParams.get("download") === "1"
          );

          if ("error" in result.body) {
            redirect(response, `/admin/pets/${encodeURIComponent(petId)}/files`);
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

if (url.pathname === "/admin/pets") {
const pets = await handlers.handleAdminPets(session);
if ("error" in pets.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Pets",
result: pets
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Admin Pets",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pets",
                title: "Pets",
                description: "Browse the pet directory and open file management for records that need updated documentation."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Pet Directory</h2>",
              renderDataTable({
                headers: ["Pet ID", "Name", "Species", "Owner", "Status", "Actions"],
                rows: pets.body.items.map((pet) => [
                  `<a href="/admin/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.id)}</a>`,
                  `<a href="/admin/pets/${encodeURIComponent(pet.id)}">${escapeHtml(pet.name)}</a>`,
                  escapeHtml(pet.species),
                  `<a href="/admin/clients/${encodeURIComponent(pet.clientId)}/profile">${escapeHtml(pet.clientId)}</a>`,
                  renderStatusPill(pet.archived ? "Archived" : "Active", pet.archived ? "warning" : "success"),
                  renderTableActionLinks([
                    { href: `/admin/pets/${encodeURIComponent(pet.id)}`, label: "Manage" },
                    { href: `/admin/pets/${encodeURIComponent(pet.id)}/files`, label: "Files" },
                    { href: `/admin/clients/${encodeURIComponent(pet.clientId)}/profile`, label: "Owner" }
                  ])
                ]),
                emptyMessage: "No pets."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminPetDetailMatch != null) {
          const petId = decodeURIComponent(adminPetDetailMatch[1] ?? "");
          const pet = await handlers.handleAdminPetDetail(session, petId);
if ("error" in pet.body) {
redirect(response, "/admin/pets");
return;
}

const adminPetItem = (pet.body as { item: Pet }).item;
const ownerProfile = await loadSafeRouteItem<ClientProfile>(() => handlers.handleAdminClientProfile(session, adminPetItem.clientId));
const [contacts, files, allBookings, allForms, allAchievements] = await Promise.all([
loadSafeRouteItems<ClientContact>(() => handlers.handleAdminClientContacts(session, adminPetItem.clientId)),
loadSafeRouteItems<PetFile>(() => handlers.handleAdminPetFiles(session, petId)),
loadSafeRouteItems<Booking>(() => handlers.handleAdminBookings(session)),
loadSafeRouteItems<FormSubmission>(() => handlers.handleAdminForms(session)),
loadSafeRouteItems<ClientAchievement>(() => handlers.handleAdminClientAchievements(session, adminPetItem.clientId))
]);
const primaryContact = contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
const petBookings = sortByTimeAsc(
allBookings.filter((booking) => booking.petIds.includes(adminPetItem.id)),
(booking) => booking.startsAt
);
const upcomingBookings = petBookings.filter((booking) => booking.status !== "completed" && booking.status !== "cancelled").slice(0, 5);
const recentFiles = sortByTimeDesc(files, (file) => file.uploadedAt).slice(0, 5);
const petForms = sortByTimeDesc(
allForms.filter((form) => form.petId === adminPetItem.id),
(form) => form.reviewedAt ?? form.submittedAt ?? null
).slice(0, 5);
const petAchievements = sortByTimeDesc(
allAchievements.filter((achievement) => petMatchesAchievement(adminPetItem, achievement)),
(achievement) => achievement.revokedAt ?? achievement.updatedAt ?? achievement.awardedOn
).slice(0, 5);
const nextBooking = upcomingBookings[0] ?? null;
const latestFile = recentFiles[0] ?? null;
const latestForm = petForms[0] ?? null;

writeHtml(response, 200, renderLayout({
title: "Admin Pet Detail",
body: [
'<article class="content-stack">',
renderSectionIntro({
eyebrow: "Pets",
title: adminPetItem.name,
description: "Review ownership, care notes, linked files, appointments, and pet-specific paperwork from the same record."
}),
adminNav,
renderStatsGrid([
{ label: "Files", value: files.length, meta: latestFile == null ? "No uploads yet" : latestFile.originalName, accent: "primary" },
{ label: "Appointments", value: upcomingBookings.length, meta: nextBooking == null ? "No active bookings" : formatAdminDateTime(nextBooking.startsAt), accent: "success" },
{ label: "Forms", value: petForms.length, meta: latestForm == null ? "No linked forms yet" : getAdminFormSubmissionTitle(latestForm), accent: "secondary" },
{ label: "Achievements", value: petAchievements.length, meta: petAchievements.length === 0 ? "No pet-specific awards yet" : "Training milestones linked", accent: "warning" }
]),
'<section class="surface-block">',
"<h2>Pet Details</h2>",
renderDetailGrid([
{ label: "Pet ID", value: escapeHtml(adminPetItem.id) },
{ label: "Species", value: escapeHtml(adminPetItem.species) },
{ label: "Status", value: renderStatusPill(adminPetItem.archived ? "Archived" : "Active", adminPetItem.archived ? "warning" : "success") },
{ label: "Owner ID", value: escapeHtml(adminPetItem.clientId) },
{
label: "Owner Profile",
value: ownerProfile == null
? "Owner profile unavailable"
: `<a href="/admin/clients/${encodeURIComponent(ownerProfile.id)}/profile">${escapeHtml(ownerProfile.name)}</a>`
},
{
label: "Primary Contact",
value: primaryContact == null
? "No contact on file"
: `<a href="/admin/clients/${encodeURIComponent(adminPetItem.clientId)}/contacts/${encodeURIComponent(primaryContact.id)}">${escapeHtml(primaryContact.name)}</a>`
},
{
label: "Next Appointment",
value: nextBooking == null
? "No active appointments"
: `<a href="/admin/bookings/${encodeURIComponent(nextBooking.id)}">${escapeHtml(formatAdminDateTime(nextBooking.startsAt))}</a>`
},
{
label: "Latest Form",
value: latestForm == null
? "No linked forms"
: `<a href="/admin/forms/${encodeURIComponent(latestForm.id)}">${escapeHtml(getAdminFormSubmissionTitle(latestForm))}</a>`
}
]),
"</section>",
'<section class="surface-block">',
"<h2>Care Notes</h2>",
renderLongTextBlock(adminPetItem.petSittingNotes, "No care notes have been recorded for this pet yet."),
"</section>",
'<section class="surface-block">',
"<h2>Pet Workspace</h2>",
`<div class="form-actions"><a href="/client/form_requests_create.php?form_type=pet_form&pet_id=${encodeURIComponent(adminPetItem.id)}">Create Pet Form</a><a href="/admin/pets/${encodeURIComponent(adminPetItem.id)}/files">Manage Files</a><a href="/admin/pets">Back to Pets</a></div>`,
renderQuickLinksGrid([
{ href: `/admin/pets/${encodeURIComponent(adminPetItem.id)}/files`, label: "Files", description: files.length === 0 ? "Upload intake, vaccine, or image records." : `${formatCountLabel(files.length, "stored file")} linked to this pet.` },
{ href: `/admin/clients/${encodeURIComponent(adminPetItem.clientId)}/profile`, label: "Owner", description: ownerProfile == null ? "Open the linked client profile." : ownerProfile.name },
{ href: buildAdminBookingsPath({ q: adminPetItem.id }), label: "Appointments", description: upcomingBookings.length === 0 ? "No upcoming bookings linked to this pet." : `${formatCountLabel(upcomingBookings.length, "upcoming visit")} linked here.` },
{ href: "/admin/forms", label: "Forms", description: petForms.length === 0 ? "No pet-specific forms submitted yet." : `${formatCountLabel(petForms.length, "linked form")} visible from this profile.` },
{ href: `/admin/clients/${encodeURIComponent(adminPetItem.clientId)}/achievements`, label: "Achievements", description: petAchievements.length === 0 ? "No awards linked to this pet yet." : `${formatCountLabel(petAchievements.length, "achievement")} recorded for this pet.` },
{ href: `/admin/clients/${encodeURIComponent(adminPetItem.clientId)}/contacts`, label: "Contacts", description: contacts.length === 0 ? "No household contacts available." : `${formatCountLabel(contacts.length, "contact")} available for follow-up.` }
]),
"</section>",
'<section class="surface-block">',
"<h2>Stored Files</h2>",
renderPetFilesPreviewTable(recentFiles, (file) => `/admin/pets/${encodeURIComponent(adminPetItem.id)}/files/${encodeURIComponent(file.id)}/content`),
"</section>",
'<section class="surface-block">',
"<h2>Appointments</h2>",
renderBookingsPreviewTable(upcomingBookings, (booking) => `/admin/bookings/${encodeURIComponent(booking.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Linked Forms</h2>",
renderFormsPreviewTable(petForms, (form) => `/admin/forms/${encodeURIComponent(form.id)}`),
"</section>",
'<section class="surface-block">',
"<h2>Achievements</h2>",
renderAchievementsPreviewTable(petAchievements, (achievement) => `/admin/clients/${encodeURIComponent(adminPetItem.clientId)}/achievements/${encodeURIComponent(achievement.id)}`),
"</section>",
"</article>"
].join("")
}));
return;

writeHtml(response, 200, renderLayout({
            title: "Admin Pet Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Pets",
 title: adminPetItem.name,
                description: "Review this pet profile, service notes, and linked file management."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Pet Details</h2>",
              renderDetailGrid([
 { label: "Pet ID", value: escapeHtml(adminPetItem.id) },
 { label: "Client ID", value: escapeHtml(adminPetItem.clientId) },
 { label: "Name", value: escapeHtml(adminPetItem.name) },
 { label: "Species", value: escapeHtml(adminPetItem.species) },
                {
                  label: "Status",
 value: renderStatusPill(adminPetItem.archived ? "Archived" : "Active", adminPetItem.archived ? "warning" : "success")
                },
 { label: "Pet Sitting Notes", value: escapeHtml(adminPetItem.petSittingNotes) }
              ]),
 `<div class="form-actions"><a href="/client/form_requests_create.php?form_type=pet_form&pet_id=${encodeURIComponent(adminPetItem.id)}">Create Pet Form</a><a href="/admin/pets/${encodeURIComponent(adminPetItem.id)}/files">Manage Files</a><a href="/admin/pets">Back to Pets</a></div>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/packages") {
          const packages = await handlers.handleAdminPackages(session);
          if ("error" in packages.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Packages",
              result: packages
            });
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Packages",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Packages",
                title: "Packages",
                description: "Review published package pricing and confirm which appointment credits are included in each offer."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Package Catalog</h2>',
              renderDataTable({
                headers: ["Package ID", "Name", "Price", "Included Credits", "Public Link", "Status", "Actions"],
                rows: packages.body.items.map((item) => [
                  `<a href="/admin/packages/${encodeURIComponent(item.id)}">${escapeHtml(item.id)}</a>`,
                  escapeHtml(item.name),
                  escapeHtml(formatCurrency(item.price)),
                  escapeHtml(summarizePackageItems(item.items)),
                  item.shareToken == null
                    ? "Not shared"
                    : `<a href="/client/package_detail.php?token=${encodeURIComponent(item.shareToken)}" target="_blank" rel="noreferrer">Open public page</a>`,
                  renderStatusPill(item.active ? "Active" : "Inactive", item.active ? "success" : "default"),
                  renderTableActionLinks([
                    { href: `/admin/packages/${encodeURIComponent(item.id)}`, label: "Manage" }
                  ])
                ]),
                emptyMessage: "No packages."
              }),
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (adminPackageDetailMatch != null) {
          const packageId = decodeURIComponent(adminPackageDetailMatch[1] ?? "");
          const packageDetail = await handlers.handleAdminPackageDetail(session, packageId);
          if ("error" in packageDetail.body) {
            redirect(response, "/admin/packages");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Package Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Packages",
                title: packageDetail.body.item.name,
                description: "Review training package pricing and whether the package is currently active."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Package Details</h2>',
              renderDetailGrid([
                { label: "Package ID", value: escapeHtml(packageDetail.body.item.id) },
                { label: "Name", value: escapeHtml(packageDetail.body.item.name) },
                { label: "Price", value: escapeHtml(formatCurrency(packageDetail.body.item.price)) },
                {
                  label: "Status",
                  value: renderStatusPill(packageDetail.body.item.active ? "Active" : "Inactive", packageDetail.body.item.active ? "success" : "default")
                },
                {
                  label: "Public Link",
                  value: packageDetail.body.item.shareToken == null
                    ? "Not shared publicly"
                    : `<a href="/client/package_detail.php?token=${encodeURIComponent(packageDetail.body.item.shareToken)}" target="_blank" rel="noreferrer">Open package page</a>`
                }
              ]),
              '</section>',
              '<section class="surface-block">',
              '<h2>Included Credits</h2>',
              `<p>${escapeHtml(summarizePackageItems(packageDetail.body.item.items))}</p>`,
              '</section>',
              '<section class="surface-block">',
              '<h2>Description</h2>',
              `<p>${escapeHtml((packageDetail.body.item.description ?? "").trim() === "" ? "No description provided." : packageDetail.body.item.description ?? "")}</p>`,
              `<div class="form-actions"><a href="/admin/packages">Back to Packages</a></div>`,
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }
if (url.pathname === "/admin/credits") {
          const [credits, clients, appointmentTypes] = await Promise.all([
            handlers.handleAdminCredits(session),
            resolved.api == null ? Promise.resolve([] as Client[]) : resolved.api.adminResources.listAdminClients(),
            resolved.api == null ? Promise.resolve([] as AppointmentType[]) : resolved.api.adminConfiguration.listAdminAppointmentTypes()
          ]);
          if ("error" in credits.body) {
            await handleProtectedRouteFailure({
              response,
              request,
              sessionStore: resolved.sessionStore,
              loginPath: buildAdminLoginRedirectPath(request),
              title: "Admin Credits",
              result: credits
            });
            return;
          }

          const clientById = new Map(clients.map((client) => [client.id, client]));
          const appointmentTypeById = new Map(appointmentTypes.map((appointmentType) => [appointmentType.id, appointmentType]));

          writeHtml(response, 200, renderLayout({
            title: "Admin Credits",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Credits",
                title: "Credits",
                description: "Monitor remaining package units and identify depleted balances across the client base."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Credit Balances</h2>',
              renderDataTable({
                headers: ["Credit ID", "Client", "Appointment Type", "Remaining Units", "Package", "Status", "Actions"],
                rows: credits.body.items.map((credit) => {
                  const client = clientById.get(credit.clientId) ?? null;
                  const appointmentType = appointmentTypeById.get(credit.appointmentTypeId) ?? null;
                  return [
                    `<a href="/admin/credits/${encodeURIComponent(credit.id)}">${escapeHtml(credit.id)}</a>`,
                    client == null
                      ? escapeHtml(credit.clientId)
                      : `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`,
                    escapeHtml(appointmentType?.name ?? credit.appointmentTypeId),
                    escapeHtml(String(credit.remainingUnits)),
                    credit.packageId == null
                      ? "Unassigned"
                      : `<a href="/admin/packages/${encodeURIComponent(credit.packageId)}">${escapeHtml(credit.packageId)}</a>`,
                    renderStatusPill(credit.remainingUnits > 0 ? "Available" : "Used", credit.remainingUnits > 0 ? "success" : "warning"),
                    renderTableActionLinks([
                      { href: `/admin/credits/${encodeURIComponent(credit.id)}`, label: "Manage" }
                    ])
                  ];
                }),
                emptyMessage: "No credits."
              }),
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (adminCreditDetailMatch != null) {
          const creditId = decodeURIComponent(adminCreditDetailMatch[1] ?? "");
          const credit = await handlers.handleAdminCreditDetail(session, creditId);
          if ("error" in credit.body) {
            redirect(response, "/admin/credits");
            return;
          }

          const [client, appointmentType] = await Promise.all([
            resolved.api == null ? Promise.resolve(null) : resolved.api.adminResources.findAdminClientById(credit.body.item.clientId),
            resolved.api == null ? Promise.resolve(null) : resolved.api.adminConfiguration.findAdminAppointmentTypeById(credit.body.item.appointmentTypeId)
          ]);
          const clientValue = client == null
            ? escapeHtml(credit.body.item.clientId)
            : `<a href="/admin/clients/${encodeURIComponent(client.id)}/profile">${escapeHtml(renderAdminClientDisplayName(client))}</a>`;
          const appointmentTypeValue = appointmentType == null
            ? escapeHtml(credit.body.item.appointmentTypeId)
            : `<a href="/admin/appointment-types/${encodeURIComponent(appointmentType.id)}">${escapeHtml(appointmentType.name)}</a>`;
          const packageValue = credit.body.item.packageId == null
            ? "Unassigned"
            : `<a href="/admin/packages/${encodeURIComponent(credit.body.item.packageId)}">${escapeHtml(credit.body.item.packageId)}</a>`;

          writeHtml(response, 200, renderLayout({
            title: "Admin Credit Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Credits",
                title: credit.body.item.id,
                description: "Review remaining units and the associated appointment type for this client credit."
              }),
              adminNav,
              '<section class="surface-block">',
              '<h2>Credit Details</h2>',
              renderDetailGrid([
                { label: "Credit ID", value: escapeHtml(credit.body.item.id) },
                { label: "Client", value: clientValue },
                { label: "Appointment Type", value: appointmentTypeValue },
                { label: "Package", value: packageValue },
                { label: "Remaining Units", value: escapeHtml(String(credit.body.item.remainingUnits)) },
                {
                  label: "Availability",
                  value: renderStatusPill(credit.body.item.remainingUnits > 0 ? "Available" : "Used", credit.body.item.remainingUnits > 0 ? "success" : "warning")
                }
              ]),
              `<div class="form-actions"><a href="/admin/credits">Back to Credits</a></div>`,
              '</section>',
              '</article>'
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/achievement-types")if (url.pathname === "/admin/achievement-types") {
const types = await handlers.handleAdminAchievementTypes(session);
if ("error" in types.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Achievement Types",
result: types
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Achievement Types",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Achievement Types",
                title: "Achievement Types",
                description: "Review the award templates and badge programs available across client achievements."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Achievement Catalog</h2>",
              renderDataTable({
                headers: ["Type ID", "Title", "Award Mode", "Detail"],
                rows: types.body.items.map((item) => [
                  escapeHtml(item.id),
                  escapeHtml(item.title),
                  renderStatusPill(item.awardMode, "info"),
                  `<a href="/admin/achievement-types/${encodeURIComponent(item.id)}">Open</a>`
                ]),
                emptyMessage: "No achievement types."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminAchievementTypeDetailMatch != null) {
          const achievementTypeId = decodeURIComponent(adminAchievementTypeDetailMatch[1] ?? "");
          const achievementType = await handlers.handleAdminAchievementTypeDetail(session, achievementTypeId);
          if ("error" in achievementType.body) {
            redirect(response, "/admin/achievement-types");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Achievement Type Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Achievement Types",
                title: achievementType.body.item.title,
                description: "Inspect the full definition behind this achievement program and its certificate behavior."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Type Definition</h2>",
              `<p>${escapeHtml(achievementType.body.item.description)}</p>`,
              renderDetailGrid([
                { label: "Scope", value: escapeHtml(achievementType.body.item.scopeType) },
                { label: "Award Mode", value: escapeHtml(achievementType.body.item.awardMode) },
                {
                  label: "Status",
                  value: renderStatusPill(achievementType.body.item.active ? "Active" : "Inactive", achievementType.body.item.active ? "success" : "default")
                }
              ]),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/blog-posts" || legacyBlogListPath || (legacyBlogEditPath && legacyBlogPostId === "")) {
const posts = await handlers.handleAdminBlogPosts(session);
if ("error" in posts.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Blog Posts",
result: posts
});
return;
}
          const useLegacyBlogPaths = legacyBlogListPath || legacyBlogEditPath;

          writeHtml(response, 200, renderLayout({
            title: "Admin Blog Posts",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Content",
                title: "Blog Posts",
                description: "Create and manage public journal entries, authoring metadata, and publish state."
              }),
              adminNav,
              renderAdminBlogPostEditor(null, useLegacyBlogPaths ? "/client/blog_edit.php" : "/admin/blog-posts"),
              '<section class="surface-block">',
              "<h2>Published Content</h2>",
              renderDataTable({
                headers: ["Title", "Slug", "Author", "Publish State", "Actions"],
                rows: posts.body.items.map((post) => [
                  useLegacyBlogPaths
                    ? `<a href="/client/blog_edit.php?id=${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a>`
                    : `<a href="/admin/blog-posts/${encodeURIComponent(post.id)}">${escapeHtml(post.title)}</a>`,
                  escapeHtml(post.slug),
                  escapeHtml(post.author),
                  renderStatusPill(post.published ? "Published" : "Draft", post.published ? "success" : "warning"),
                  renderBlogPostAdminActions(post, { legacy: useLegacyBlogPaths })
                ]),
                emptyMessage: "No blog posts."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminBlogPostDetailMatch != null || (legacyBlogEditPath && legacyBlogPostId !== "")) {
          const postId = adminBlogPostDetailMatch != null
            ? decodeURIComponent(adminBlogPostDetailMatch[1] ?? "")
            : legacyBlogPostId;
          const post = await handlers.handleAdminBlogPostDetail(session, postId);
          if ("error" in post.body) {
            redirect(response, legacyBlogEditPath ? "/client/blog_list.php" : "/admin/blog-posts");
            return;
          }
          const blogDirectoryPath = legacyBlogEditPath ? "/client/blog_list.php" : "/admin/blog-posts";
          const deleteAction = legacyBlogEditPath
            ? "/client/blog_delete.php"
            : `/admin/blog-posts/${encodeURIComponent(post.body.item.id)}/delete`;
          const editAction = legacyBlogEditPath
            ? `/client/blog_edit.php?id=${encodeURIComponent(post.body.item.id)}`
            : `/admin/blog-posts/${encodeURIComponent(post.body.item.id)}`;

          writeHtml(response, 200, renderLayout({
            title: "Admin Blog Post",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Content",
                title: post.body.item.title,
                description: "Update editorial content, metadata, and publish state for this journal entry."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Author", value: escapeHtml(post.body.item.author) },
                { label: "Slug", value: escapeHtml(post.body.item.slug) },
                {
                  label: "Publish State",
                  value: renderStatusPill(post.body.item.published ? "Published" : "Draft", post.body.item.published ? "success" : "warning")
                }
              ]),
              '<section class="surface-block">',
              "<h2>Post Actions</h2>",
              `<div class="form-actions"><a href="${blogDirectoryPath}">Back to Posts</a>${post.body.item.published ? ` <a href="/blog/${encodeURIComponent(post.body.item.slug)}" target="_blank" rel="noopener noreferrer">View Live</a>` : ""}<form method="post" action="${deleteAction}" onsubmit="return confirm('Delete this blog post?');">${legacyBlogEditPath ? `<input type="hidden" name="id" value="${escapeAttribute(post.body.item.id)}">` : ""}<button type="submit">Delete Blog Post</button></form></div>`,
              "</section>",
              '<section class="surface-block">',
              "<h2>Preview Copy</h2>",
              `<p>${escapeHtml(post.body.item.excerpt)}</p>`,
              `<div class="surface-block">${post.body.item.content}</div>`,
              "</section>",
              renderAdminBlogPostEditor(post.body.item, editAction),
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/site-pages" || legacySitePagesListPath) {
const pages = await handlers.handleAdminSitePages(session);
if ("error" in pages.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Site Pages",
result: pages
});
return;
}
          const sitePageCreateAction = legacySitePagesListPath ? "/client/site_pages_list.php" : "/admin/site-pages";

          writeHtml(response, 200, renderLayout({
            title: "Admin Site Pages",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Content",
                title: "Site Pages",
                description: "Manage public site pages, SEO metadata, and homepage configuration."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Create Site Page</h2>",
              `<form class="form-grid" method="post" action="${sitePageCreateAction}">`,
              '<div class="form-grid form-grid--two">',
              '<label>Title<input type="text" name="title" required></label>',
              '<label>Slug<input type="text" name="slug" required></label>',
              '<label>Meta Description<input type="text" name="metaDescription"></label>',
              '<label>Meta Keywords<input type="text" name="metaKeywords"></label>',
              '<label>OG Title<input type="text" name="ogTitle"></label>',
              '<label>OG Description<input type="text" name="ogDescription"></label>',
              "</div>",
              '<label>HTML Content<textarea name="htmlContent"></textarea></label>',
              '<label>CSS Content<textarea name="cssContent"></textarea></label>',
              '<label>OG Image<input type="text" name="ogImage"></label>',
              '<label>Sort Order<input type="number" name="sortOrder" value="1" required></label>',
              '<label><input type="checkbox" name="isHomepage"> Homepage</label>',
              '<label><input type="checkbox" name="published" checked> Published</label>',
              '<div class="form-actions"><button type="submit">Create Site Page</button></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Site Page Directory</h2>",
              renderDataTable({
                headers: ["Title", "Slug", "Homepage", "Publish State", "Actions"],
                rows: pages.body.items.map((page) => [
                  `<div class="table-actions"><a href="/admin/site-pages/${encodeURIComponent(page.id)}">${escapeHtml(page.title)}</a><a href="${legacySitePagesListPath ? `/client/site_editor.php?id=${encodeURIComponent(page.id)}` : `/admin/site-pages/${encodeURIComponent(page.id)}/editor`}">Edit in Visual Editor</a></div>`,
                  escapeHtml(page.slug),
                  renderStatusPill(page.isHomepage ? "Homepage" : "Standard", page.isHomepage ? "info" : "default"),
                  renderStatusPill(page.published ? "Published" : "Draft", page.published ? "success" : "warning"),
                  renderSitePageAdminActions(page)
                ]),
                emptyMessage: "No site pages."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminSitePageEditorMatch != null || legacySitePageEditorPath) {
          const pageId = adminSitePageEditorMatch != null
            ? decodeURIComponent(adminSitePageEditorMatch[1] ?? "")
            : legacySitePageId;
          const page = await handlers.handleAdminSitePageDetail(session, pageId);
          if ("error" in page.body) {
            redirect(response, legacySitePageEditorPath ? "/client/site_pages_list.php" : "/admin/site-pages");
            return;
          }

          writeHtml(response, 200, renderSitePageEditor(page.body.item));
          return;
        }

        if (adminSitePageDetailMatch != null) {
          const pageId = decodeURIComponent(adminSitePageDetailMatch[1] ?? "");
          const page = await handlers.handleAdminSitePageDetail(session, pageId);
          if ("error" in page.body) {
            redirect(response, "/admin/site-pages");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Site Page",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Content",
                title: page.body.item.title,
                description: "Update page metadata, layout content, and homepage priority for this public page."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Slug", value: escapeHtml(page.body.item.slug) },
                { label: "Sort Order", value: escapeHtml(String(page.body.item.sortOrder)) },
                {
                  label: "Homepage",
                  value: renderStatusPill(page.body.item.isHomepage ? "Homepage" : "Standard", page.body.item.isHomepage ? "info" : "default")
                },
                {
                  label: "Publish State",
                  value: renderStatusPill(page.body.item.published ? "Published" : "Draft", page.body.item.published ? "success" : "warning")
                },
                { label: "Editor", value: `<a href="/admin/site-pages/${encodeURIComponent(page.body.item.id)}/editor">Open Visual Editor</a>` }
              ]),
              '<section class="surface-block">',
              "<h2>Page Actions</h2>",
              `<div class="form-actions"><a href="/admin/site-pages/${encodeURIComponent(page.body.item.id)}/editor">Open Visual Editor</a>${page.body.item.published ? ` <a href="${escapeHtml(getSitePageViewPath(page.body.item))}" target="_blank" rel="noopener noreferrer">View Live</a>` : ""}<form method="post" action="/admin/site-pages/${encodeURIComponent(page.body.item.id)}/toggle-publish"><button type="submit">${page.body.item.published ? "Unpublish" : "Publish"}</button></form>${page.body.item.isHomepage ? '<span class="meta">Homepage pages cannot be deleted.</span>' : `<form method="post" action="/admin/site-pages/${encodeURIComponent(page.body.item.id)}/delete" onsubmit="return confirm('Delete this site page?');"><button type="submit">Delete Page</button></form>`}</div>`,
              "</section>",
              '<section class="surface-block">',
              "<h2>SEO Metadata</h2>",
              `<p>${escapeHtml(page.body.item.metaDescription)}</p>`,
              `<pre>${escapeHtml(page.body.item.metaKeywords)}</pre>`,
              "</section>",
              '<section class="surface-block">',
              "<h2>Edit Site Page</h2>",
              `<form class="form-grid" method="post" action="/admin/site-pages/${encodeURIComponent(page.body.item.id)}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Title<input type="text" name="title" value="${escapeHtml(page.body.item.title)}" required></label>`,
              `<label>Slug<input type="text" name="slug" value="${escapeHtml(page.body.item.slug)}" required></label>`,
              `<label>Meta Description<input type="text" name="metaDescription" value="${escapeHtml(page.body.item.metaDescription)}"></label>`,
              `<label>Meta Keywords<input type="text" name="metaKeywords" value="${escapeHtml(page.body.item.metaKeywords)}"></label>`,
              `<label>OG Title<input type="text" name="ogTitle" value="${escapeHtml(page.body.item.ogTitle ?? "")}"></label>`,
              `<label>OG Description<input type="text" name="ogDescription" value="${escapeHtml(page.body.item.ogDescription ?? "")}"></label>`,
              "</div>",
              `<label>HTML Content<textarea name="htmlContent">${escapeHtml(page.body.item.htmlContent)}</textarea></label>`,
              `<label>CSS Content<textarea name="cssContent">${escapeHtml(page.body.item.cssContent)}</textarea></label>`,
              `<label>OG Image<input type="text" name="ogImage" value="${escapeHtml(page.body.item.ogImage ?? "")}"></label>`,
              `<label>Sort Order<input type="number" name="sortOrder" value="${page.body.item.sortOrder}" required></label>`,
              `<label><input type="checkbox" name="isHomepage"${page.body.item.isHomepage ? " checked" : ""}> Homepage</label>`,
              `<label><input type="checkbox" name="published"${page.body.item.published ? " checked" : ""}> Published</label>`,
              '<div class="form-actions"><button type="submit">Save Site Page</button></div>',
              "</form>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/workflows" || legacyWorkflowListPath || (legacyWorkflowEditPath && legacyWorkflowId === "")) {
const workflows = await handlers.handleAdminWorkflows(session);
if ("error" in workflows.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Workflows",
result: workflows
});
return;
}

          const workflowItems = workflows.body.items;
          const useLegacyWorkflowPaths = legacyWorkflowListPath || legacyWorkflowEditPath;

          writeHtml(response, 200, renderLayout({
            title: "Admin Workflows",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: "Automated Workflows",
                description: "Manage workflow definitions, enrollment volume, and manual automation entry points from one admin surface."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Create Workflow</h2>",
              `<form class="form-grid" method="post" action="${useLegacyWorkflowPaths ? "/client/workflows_edit.php" : "/admin/workflows"}">`,
              '<div class="form-grid form-grid--two">',
              '<label>Name<input type="text" name="name" required></label>',
              `<label>Trigger<select name="trigger">${renderWorkflowTriggerOptions()}</select></label>`,
              "</div>",
              '<label>Description<textarea name="description"></textarea></label>',
              '<label><input type="checkbox" name="active" checked> Active</label>',
              '<div class="form-actions"><button type="submit">Create Workflow</button></div>',
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Workflow Directory</h2>",
              renderDataTable({
                headers: ["Workflow", "Trigger", "State", "Enrollments", "Actions"],
                rows: workflowItems.map((workflow) => {
                  const workflowDescription = workflow.description ?? "";
                  return [
                    `<div class="table-actions"><a href="${useLegacyWorkflowPaths ? `/client/workflows_edit.php?id=${encodeURIComponent(workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflow.id)}`}">${escapeHtml(workflow.name)}</a>${workflowDescription.trim() === "" ? "" : `<span class="meta">${escapeHtml(workflowDescription)}</span>`}</div>`,
                    escapeHtml(formatWorkflowTriggerLabel(workflow.trigger)),
                    renderStatusPill(workflow.active ? "Active" : "Paused", workflow.active ? "success" : "warning"),
                    escapeHtml(`${workflow.activeEnrollmentCount} active / ${workflow.enrollmentCount} total`),
                    renderWorkflowAdminActions(workflow.id, workflow.active, useLegacyWorkflowPaths)
                  ];
                }),
                emptyMessage: "No workflows configured."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminWorkflowDetailMatch != null || (legacyWorkflowEditPath && legacyWorkflowId !== "")) {
          const workflowId = adminWorkflowDetailMatch != null
            ? decodeURIComponent(adminWorkflowDetailMatch[1] ?? "")
            : legacyWorkflowId;
          const workflow = await handlers.handleAdminWorkflowDetail(session, workflowId);
          if ("error" in workflow.body) {
            redirect(response, legacyWorkflowEditPath ? "/client/workflows_list.php" : "/admin/workflows");
            return;
          }

          const workflowDetail = workflow.body.item;
          const workflowTriggers = await handlers.handleAdminWorkflowTriggers(session, workflowId);
          if ("error" in workflowTriggers.body) {
            redirect(response, legacyWorkflowEditPath ? "/client/workflows_list.php" : "/admin/workflows");
            return;
          }
          const workflowDescription = workflowDetail.description ?? "";
          const workflowCreatedAt = workflowDetail.createdAt ?? "";
          const workflowEditAction = legacyWorkflowEditPath
            ? `/client/workflows_edit.php?id=${encodeURIComponent(workflowDetail.id)}`
            : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}`;
          const workflowDeleteAction = legacyWorkflowEditPath
            ? "/client/workflows_delete.php"
            : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/delete`;
          const workflowTriggerCollection = workflowTriggers.body;
          const triggerTypeOptions = [
            { value: "appointment_booking", label: "Appointment Booking" },
            { value: "form_submission", label: "Form Submission" }
          ].map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("");
          const triggerAppointmentOptions = [
            '<option value="">Select appointment type</option>',
            ...workflowTriggerCollection.options.appointmentTypes.map((option) => (
              `<option value="${escapeAttribute(option.id)}">${escapeHtml(option.label)}</option>`
            ))
          ].join("");
          const triggerFormTemplateOptions = [
            '<option value="">Select form template</option>',
            ...workflowTriggerCollection.options.formTemplates.map((option) => (
              `<option value="${escapeAttribute(option.id)}">${escapeHtml(option.label)}</option>`
            ))
          ].join("");

          writeHtml(response, 200, renderLayout({
            title: "Admin Workflow",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: workflowDetail.name,
                description: workflowDescription.trim() === ""
                  ? "Review trigger settings, active state, and enrollment actions for this workflow."
                  : workflowDescription
              }),
              adminNav,
              renderDetailGrid([
                { label: "Trigger", value: escapeHtml(formatWorkflowTriggerLabel(workflowDetail.trigger)) },
                {
                  label: "State",
                  value: renderStatusPill(workflowDetail.active ? "Active" : "Paused", workflowDetail.active ? "success" : "warning")
                },
                { label: "Created", value: escapeHtml(workflowCreatedAt === "" ? "Unknown" : workflowCreatedAt.slice(0, 10)) },
                { label: "Enrollments", value: `<a href="${legacyWorkflowEditPath ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(workflowDetail.id)}` : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/enrollments`}">View Enrollments</a>` }
              ]),
              '<section class="surface-block">',
              "<h2>Workflow Actions</h2>",
              `<div class="form-actions"><a href="${legacyWorkflowEditPath ? `/client/workflows_steps.php?workflow_id=${encodeURIComponent(workflowDetail.id)}` : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/steps`}">Workflow Steps</a><a href="${legacyWorkflowEditPath ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(workflowDetail.id)}` : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/enrollments`}">View Enrollments</a><a href="${legacyWorkflowEditPath ? `/client/workflows_enroll.php?workflow_id=${encodeURIComponent(workflowDetail.id)}` : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/enroll`}">Enroll Clients</a><form method="post" action="${workflowDeleteAction}" onsubmit="return confirm('Delete this workflow?');">${legacyWorkflowEditPath ? `<input type="hidden" name="id" value="${escapeAttribute(workflowDetail.id)}">` : ""}<button type="submit">Delete Workflow</button></form></div>`,
              "</section>",
              '<section class="surface-block">',
              "<h2>Edit Workflow</h2>",
              `<form class="form-grid" method="post" action="${workflowEditAction}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Name<input type="text" name="name" value="${escapeHtml(workflowDetail.name)}" required></label>`,
              `<label>Trigger<select name="trigger">${renderWorkflowTriggerOptions(workflowDetail.trigger)}</select></label>`,
              "</div>",
              `<label>Description<textarea name="description">${escapeHtml(workflowDescription)}</textarea></label>`,
              `<label><input type="checkbox" name="active"${workflowDetail.active ? " checked" : ""}> Active</label>`,
              '<div class="form-actions"><button type="submit">Save Workflow</button></div>',
              "</form>",
              "</section>",
              '<section class="surface-block" id="triggers">',
              "<h2>Auto-Enrollment Triggers</h2>",
              "<p>Use booking and form events to enroll clients automatically without requiring manual enrollment.</p>",
              renderDataTable({
                headers: ["Type", "Source", "State", "Actions"],
                rows: workflowTriggerCollection.items.map((trigger) => {
                  const sourceLabel = trigger.triggerType === "appointment_booking"
                    ? (trigger.appointmentTypeName ?? trigger.appointmentTypeId ?? "Unknown appointment type")
                    : (trigger.formTemplateName ?? trigger.formTemplateId ?? "Unknown form template");
                  const deleteAction = legacyWorkflowEditPath
                    ? `/client/workflows_edit.php?id=${encodeURIComponent(workflowDetail.id)}`
                    : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/triggers/${encodeURIComponent(trigger.id)}/delete`;
                  return [
                    escapeHtml(formatWorkflowTriggerLabel(trigger.triggerType)),
                    escapeHtml(sourceLabel),
                    renderStatusPill(trigger.active ? "Active" : "Paused", trigger.active ? "success" : "warning"),
                    `<form method="post" action="${deleteAction}" onsubmit="return confirm('Delete this trigger?');">${legacyWorkflowEditPath ? `<input type="hidden" name="delete_trigger_id" value="${escapeAttribute(trigger.id)}">` : ""}<button type="submit">Delete</button></form>`
                  ];
                }),
                emptyMessage: "No auto-enrollment triggers configured."
              }),
              `<form class="form-grid" method="post" action="${legacyWorkflowEditPath ? `/client/workflows_edit.php?id=${encodeURIComponent(workflowDetail.id)}` : `/admin/workflows/${encodeURIComponent(workflowDetail.id)}/triggers`}">`,
              legacyWorkflowEditPath ? '<input type="hidden" name="add_trigger" value="1">' : "",
              '<div class="form-grid form-grid--three">',
              `<label>Trigger Type<select name="triggerType">${triggerTypeOptions}</select></label>`,
              `<label>Appointment Type<select name="appointmentTypeId">${triggerAppointmentOptions}</select></label>`,
              `<label>Form Template<select name="formTemplateId">${triggerFormTemplateOptions}</select></label>`,
              "</div>",
              '<label><input type="checkbox" name="active" checked> Active</label>',
              '<div class="form-actions"><button type="submit">Add Trigger</button></div>',
              "</form>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminWorkflowEnrollmentsMatch != null || legacyWorkflowEnrollmentsPath) {
          const workflowId = adminWorkflowEnrollmentsMatch != null
            ? decodeURIComponent(adminWorkflowEnrollmentsMatch[1] ?? "")
            : legacyWorkflowId;
          if (legacyWorkflowEnrollmentsPath && url.searchParams.has("cancel") && url.searchParams.has("enrollment_id")) {
            await handlers.handleAdminWorkflowEnrollmentCancel(session, workflowId, url.searchParams.get("enrollment_id") ?? "");
            redirect(response, `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(workflowId)}`);
            return;
          }
          const enrollments = await handlers.handleAdminWorkflowEnrollments(session, workflowId);
          if ("error" in enrollments.body) {
            redirect(response, legacyWorkflowEnrollmentsPath ? "/client/workflows_list.php" : "/admin/workflows");
            return;
          }

          const workflowEnrollmentCollection = enrollments.body;

          writeHtml(response, 200, renderLayout({
            title: "Workflow Enrollments",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: "Active Enrollments",
                description: `Review client assignments for ${workflowEnrollmentCollection.workflow.name} and cancel entries that should no longer run.`
              }),
              adminNav,
              renderDetailGrid([
                { label: "Workflow", value: `<a href="${legacyWorkflowEnrollmentsPath ? `/client/workflows_edit.php?id=${encodeURIComponent(workflowEnrollmentCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowEnrollmentCollection.workflow.id)}`}">${escapeHtml(workflowEnrollmentCollection.workflow.name)}</a>` },
                { label: "Trigger", value: escapeHtml(formatWorkflowTriggerLabel(workflowEnrollmentCollection.workflow.trigger)) },
                {
                  label: "State",
                  value: renderStatusPill(workflowEnrollmentCollection.workflow.active ? "Active" : "Paused", workflowEnrollmentCollection.workflow.active ? "success" : "warning")
                },
                { label: "Enroll Clients", value: `<a href="${legacyWorkflowEnrollmentsPath ? `/client/workflows_enroll.php?workflow_id=${encodeURIComponent(workflowEnrollmentCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowEnrollmentCollection.workflow.id)}/enroll`}">Open Enrollment</a>` }
              ]),
              '<section class="surface-block">',
              "<h2>Enrollment Roster</h2>",
              renderDataTable({
                headers: ["Client", "Email", "Enrolled", "Next Run", "Status", "Actions"],
                rows: workflowEnrollmentCollection.items.map((enrollment) => {
                  const nextRunAt = enrollment.nextRunAt ?? enrollment.enrolledAt;
                  return [
                    escapeHtml(enrollment.clientName),
                    escapeHtml(enrollment.clientEmail),
                    escapeHtml(enrollment.enrolledAt.slice(0, 10)),
                    escapeHtml(nextRunAt.slice(0, 10)),
                    renderStatusPill(
                      toTitleCase(enrollment.status),
                      enrollment.status === "active" ? "success" : enrollment.status === "cancelled" ? "warning" : "default"
                    ),
                    renderWorkflowEnrollmentActions(
                      workflowEnrollmentCollection.workflow.id,
                      enrollment.id,
                      enrollment.status,
                      legacyWorkflowEnrollmentsPath
                    )
                  ];
                }),
                emptyMessage: "No workflow enrollments."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminWorkflowEnrollMatch != null || legacyWorkflowEnrollPath) {
          const workflowId = adminWorkflowEnrollMatch != null
            ? decodeURIComponent(adminWorkflowEnrollMatch[1] ?? "")
            : legacyWorkflowId;
          const clients = await handlers.handleAdminWorkflowEnrollableClients(session, workflowId);
          if ("error" in clients.body) {
            redirect(response, legacyWorkflowEnrollPath ? "/client/workflows_list.php" : "/admin/workflows");
            return;
          }

          const availableCount = clients.body.items.filter((client) => !client.alreadyEnrolled).length;
          writeHtml(response, 200, renderLayout({
            title: "Workflow Enrollment",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: "Enroll Clients",
                description: `Select eligible clients to add to ${clients.body.workflow.name}. Already-enrolled clients remain visible but cannot be selected twice.`
              }),
              adminNav,
              renderDetailGrid([
                { label: "Workflow", value: `<a href="${legacyWorkflowEnrollPath ? `/client/workflows_edit.php?id=${encodeURIComponent(clients.body.workflow.id)}` : `/admin/workflows/${encodeURIComponent(clients.body.workflow.id)}`}">${escapeHtml(clients.body.workflow.name)}</a>` },
                { label: "Trigger", value: escapeHtml(formatWorkflowTriggerLabel(clients.body.workflow.trigger)) },
                {
                  label: "State",
                  value: renderStatusPill(clients.body.workflow.active ? "Active" : "Paused", clients.body.workflow.active ? "success" : "warning")
                },
                { label: "Available Clients", value: escapeHtml(String(availableCount)) }
              ]),
              '<section class="surface-block">',
              "<h2>Enrollment Selection</h2>",
              `<form class="form-grid" method="post" action="${legacyWorkflowEnrollPath ? `/client/workflows_enroll.php?workflow_id=${encodeURIComponent(clients.body.workflow.id)}` : `/admin/workflows/${encodeURIComponent(clients.body.workflow.id)}/enroll`}">`,
              clients.body.items.length === 0
                ? "<p>No active clients are available for enrollment.</p>"
                : `<div class="detail-grid">${clients.body.items.map((client) => [
                  '<label class="detail-card">',
                  `<div class="detail-card__label"><input type="checkbox" name="clientIds" value="${escapeAttribute(client.clientId)}"${client.alreadyEnrolled ? " disabled" : ""}> ${escapeHtml(client.name)}</div>`,
                  `<div class="detail-card__value">${escapeHtml(client.email)}${client.alreadyEnrolled ? `<div>${renderStatusPill("Already Enrolled", "info")}</div>` : ""}</div>`,
                  "</label>"
                ].join("")).join("")}</div>`,
              `<div class="form-actions"><button type="submit"${availableCount === 0 ? " disabled" : ""}>Enroll Selected Clients</button><a href="${legacyWorkflowEnrollPath ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(clients.body.workflow.id)}` : `/admin/workflows/${encodeURIComponent(clients.body.workflow.id)}/enrollments`}">View Enrollments</a></div>`,
              "</form>",
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminWorkflowStepsMatch != null || legacyWorkflowStepsPath) {
          const workflowId = adminWorkflowStepsMatch != null
            ? decodeURIComponent(adminWorkflowStepsMatch[1] ?? "")
            : legacyWorkflowId;
          const steps = await handlers.handleAdminWorkflowSteps(session, workflowId);
          if ("error" in steps.body) {
            redirect(response, legacyWorkflowStepsPath ? "/client/workflows_list.php" : "/admin/workflows");
            return;
          }

          const workflowStepCollection = steps.body;

          writeHtml(response, 200, renderLayout({
            title: "Workflow Steps",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: "Workflow Steps",
                description: `Manage email sequencing for ${workflowStepCollection.workflow.name}.`
              }),
              adminNav,
              renderDetailGrid([
                { label: "Workflow", value: `<a href="${legacyWorkflowStepsPath ? `/client/workflows_edit.php?id=${encodeURIComponent(workflowStepCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}`}">${escapeHtml(workflowStepCollection.workflow.name)}</a>` },
                { label: "Trigger", value: escapeHtml(formatWorkflowTriggerLabel(workflowStepCollection.workflow.trigger)) },
                { label: "Step Count", value: escapeHtml(String(workflowStepCollection.items.length)) },
                { label: "Add Step", value: `<a href="${legacyWorkflowStepsPath ? `/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/steps/new`}">Open Step Editor</a>` }
              ]),
              '<section class="surface-block">',
              "<h2>Step Directory</h2>",
              renderDataTable({
                headers: ["Step", "When", "Delay", "Attachments", "Actions"],
                rows: workflowStepCollection.items.map((step) => [
                  `<div class="table-actions"><a href="${legacyWorkflowStepsPath ? `/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}&step_id=${encodeURIComponent(step.id)}` : `/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/steps/${encodeURIComponent(step.id)}`}">${escapeHtml(step.stepName)}</a><span class="meta">Step ${step.stepOrder}</span></div>`,
                  escapeHtml(formatWorkflowStepDelayLabel(step.delayType)),
                  escapeHtml(step.delayValue ?? (step.scheduledDate != null ? step.scheduledDate.slice(0, 10) : "Immediate")),
                  escapeHtml([
                    step.attachContractId != null ? "Contract" : "",
                    step.attachFormId != null ? "Form" : "",
                    step.attachQuoteId != null ? "Quote" : "",
                    step.attachInvoiceId != null ? "Invoice" : "",
                    step.includeAppointmentLink ? "Appointment Link" : ""
                  ].filter((item) => item !== "").join(", ") || "None"),
                  legacyWorkflowStepsPath
                    ? `<div class="table-actions"><a href="/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}&step_id=${encodeURIComponent(step.id)}">Edit</a><form method="post" action="/client/workflows_steps.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}" onsubmit="return confirm('Delete this workflow step?');"><input type="hidden" name="delete_step_id" value="${escapeAttribute(step.id)}"><button type="submit">Delete</button></form></div>`
                    : `<div class="table-actions"><a href="/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/steps/${encodeURIComponent(step.id)}">Edit</a><form method="post" action="/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/steps/${encodeURIComponent(step.id)}/delete" onsubmit="return confirm('Delete this workflow step?');"><button type="submit">Delete</button></form></div>`
                ]),
                emptyMessage: "No workflow steps configured."
              }),
              `<div class="form-actions"><a href="${legacyWorkflowStepsPath ? `/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/steps/new`}">Add Workflow Step</a><a href="${legacyWorkflowStepsPath ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(workflowStepCollection.workflow.id)}` : `/admin/workflows/${encodeURIComponent(workflowStepCollection.workflow.id)}/enrollments`}">View Enrollments</a></div>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminWorkflowStepNewMatch != null || adminWorkflowStepDetailMatch != null || legacyWorkflowStepEditPath) {
          const isLegacyWorkflowStepRoute = legacyWorkflowStepEditPath;
          const isNewStepRoute = adminWorkflowStepNewMatch != null || (isLegacyWorkflowStepRoute && legacyWorkflowStepId === "");
          const workflowId = isLegacyWorkflowStepRoute
            ? legacyWorkflowId
            : decodeURIComponent((adminWorkflowStepNewMatch?.[1] ?? adminWorkflowStepDetailMatch?.[1]) ?? "");
          const stepId = isNewStepRoute
            ? null
            : isLegacyWorkflowStepRoute
              ? legacyWorkflowStepId
              : decodeURIComponent(adminWorkflowStepDetailMatch?.[2] ?? "");
          const editor = await handlers.handleAdminWorkflowStepEditor(session, workflowId, stepId);
          if ("error" in editor.body) {
            redirect(response, isLegacyWorkflowStepRoute ? `/client/workflows_steps.php?workflow_id=${encodeURIComponent(workflowId)}` : `/admin/workflows/${encodeURIComponent(workflowId)}/steps`);
            return;
          }

          const step = editor.body.item;
          const isNew = step == null;
          const formAction = isNew
            ? (isLegacyWorkflowStepRoute ? `/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(editor.body.workflow.id)}` : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}/steps`)
            : (isLegacyWorkflowStepRoute ? `/client/workflows_steps_edit.php?workflow_id=${encodeURIComponent(editor.body.workflow.id)}&step_id=${encodeURIComponent(step.id)}` : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}/steps/${encodeURIComponent(step.id)}`);
          const scheduledDateValue = step?.scheduledDate == null
            ? ""
            : step.scheduledDate.replace(/:\d{2}\.\d{3}Z$/, "");
          const workflowDetailPath = isLegacyWorkflowStepRoute
            ? `/client/workflows_edit.php?id=${encodeURIComponent(editor.body.workflow.id)}`
            : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}`;
          const workflowStepsPath = isLegacyWorkflowStepRoute
            ? `/client/workflows_steps.php?workflow_id=${encodeURIComponent(editor.body.workflow.id)}`
            : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}/steps`;
          const workflowEnrollmentsPath = isLegacyWorkflowStepRoute
            ? `/client/workflows_enrollments.php?workflow_id=${encodeURIComponent(editor.body.workflow.id)}`
            : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}/enrollments`;
          const workflowStepDeleteAction = step == null
            ? ""
            : isLegacyWorkflowStepRoute
              ? workflowStepsPath
              : `/admin/workflows/${encodeURIComponent(editor.body.workflow.id)}/steps/${encodeURIComponent(step.id)}/delete`;
          const workflowStepTemplateOptions = [
            '<option value="">None</option>',
            ...editor.body.options.emailTemplates.map((template) => (
              `<option value="${escapeAttribute(template.id)}" data-subject="${escapeAttribute(template.subject)}" data-body-html="${escapeAttribute(template.bodyHtml)}" data-body-text="${escapeAttribute(template.bodyText)}">${escapeHtml(template.label)}</option>`
            ))
          ].join("");
          const workflowStepTemplateLoader = editor.body.options.emailTemplates.length === 0
            ? ""
            : [
              '<section class="surface-block">',
              "<h2>Load Email Template</h2>",
              '<div class="form-grid form-grid--two">',
              `<label>Template<select id="workflow-step-email-template">${workflowStepTemplateOptions}</select></label>`,
              '<div class="form-actions"><button type="button" id="workflow-step-load-template">Load Template</button></div>',
              "</div>",
              "<p class=\"meta\">Loading a template replaces the current subject and email body.</p>",
              "</section>"
            ].join("");
          const workflowStepTemplateScript = editor.body.options.emailTemplates.length === 0
            ? ""
            : `<script>
document.addEventListener("DOMContentLoaded", () => {
  const templateSelect = document.getElementById("workflow-step-email-template");
  const loadButton = document.getElementById("workflow-step-load-template");
  const subjectField = document.querySelector('input[name="emailSubject"]');
  const bodyHtmlField = document.querySelector('textarea[name="emailBodyHtml"]');
  const bodyTextField = document.querySelector('textarea[name="emailBodyText"]');
  if (!(templateSelect instanceof HTMLSelectElement) || !(loadButton instanceof HTMLButtonElement) || !(subjectField instanceof HTMLInputElement) || !(bodyHtmlField instanceof HTMLTextAreaElement) || !(bodyTextField instanceof HTMLTextAreaElement)) {
    return;
  }
  loadButton.addEventListener("click", () => {
    const selectedOption = templateSelect.selectedOptions.item(0);
    if (selectedOption == null || selectedOption.value === "") {
      return;
    }
    subjectField.value = selectedOption.dataset.subject ?? "";
    bodyHtmlField.value = selectedOption.dataset.bodyHtml ?? "";
    bodyTextField.value = selectedOption.dataset.bodyText ?? "";
  });
});
</script>`;

          writeHtml(response, 200, renderLayout({
            title: isNew ? "Add Workflow Step" : "Edit Workflow Step",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: isNew ? "Add Workflow Step" : "Edit Workflow Step",
                description: `Configure sequencing, messaging, and attachments for ${editor.body.workflow.name}.`
              }),
              adminNav,
              renderDetailGrid([
                { label: "Workflow", value: `<a href="${workflowDetailPath}">${escapeHtml(editor.body.workflow.name)}</a>` },
                { label: "Trigger", value: escapeHtml(formatWorkflowTriggerLabel(editor.body.workflow.trigger)) },
                { label: "Processor Cadence", value: escapeHtml(`${editor.body.options.processorIntervalMinutes} minutes`) },
                { label: "Enrollments", value: `<a href="${workflowEnrollmentsPath}">View Enrollments</a>` }
              ]),
              workflowStepTemplateLoader,
              '<section class="surface-block">',
              `<form class="form-grid" method="post" action="${formAction}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Step Name<input type="text" name="stepName" value="${escapeHtml(step?.stepName ?? "")}" required></label>`,
              `<label>Email Subject<input type="text" name="emailSubject" value="${escapeHtml(step?.emailSubject ?? "")}" required></label>`,
              "</div>",
              `<label>Email Body HTML<textarea name="emailBodyHtml">${escapeHtml(step?.emailBodyHtml ?? "")}</textarea></label>`,
              `<label>Email Body Text<textarea name="emailBodyText">${escapeHtml(step?.emailBodyText ?? "")}</textarea></label>`,
              '<div class="form-grid form-grid--two">',
              `<label>Delay Type<select name="delayType"><option value="immediate"${step?.delayType === "immediate" ? " selected" : ""}>Immediate</option><option value="after_enrollment"${step?.delayType === "after_enrollment" ? " selected" : ""}>After Enrollment</option><option value="after_previous"${step?.delayType === "after_previous" ? " selected" : ""}>After Previous</option><option value="specific_date"${step?.delayType === "specific_date" ? " selected" : ""}>Specific Date</option></select></label>`,
              `<label>Delay Value<input type="text" name="delayValue" value="${escapeHtml(step?.delayValue ?? "")}" placeholder="3 days"></label>`,
              "</div>",
              `<label>Scheduled Date<input type="datetime-local" name="scheduledDate" value="${escapeAttribute(scheduledDateValue)}"></label>`,
              '<div class="form-grid form-grid--two">',
              `<label>Contract Template<select name="attachContractId">${renderWorkflowStepOptionOptions(editor.body.options.contractTemplates, step?.attachContractId ?? null)}</select></label>`,
              `<label>Form Template<select name="attachFormId">${renderWorkflowStepOptionOptions(editor.body.options.formTemplates, step?.attachFormId ?? null)}</select></label>`,
              `<label>Quote<select name="attachQuoteId">${renderWorkflowStepOptionOptions(editor.body.options.quotes, step?.attachQuoteId ?? null)}</select></label>`,
              `<label>Invoice<select name="attachInvoiceId">${renderWorkflowStepOptionOptions(editor.body.options.invoices, step?.attachInvoiceId ?? null)}</select></label>`,
              `<label>Appointment Type<select name="appointmentTypeId">${renderWorkflowStepOptionOptions(editor.body.options.appointmentTypes, step?.appointmentTypeId ?? null)}</select></label>`,
              "</div>",
              `<label><input type="checkbox" name="includeAppointmentLink"${step?.includeAppointmentLink ? " checked" : ""}> Include Appointment Link</label>`,
              `<div class="form-actions"><button type="submit">${isNew ? "Create Workflow Step" : "Save Workflow Step"}</button><a href="${workflowStepsPath}">Back to Steps</a></div>`,
              "</form>",
              isNew ? "" : `<div class="form-actions"><form method="post" action="${workflowStepDeleteAction}" onsubmit="return confirm('Delete this workflow step?');">${isLegacyWorkflowStepRoute ? `<input type="hidden" name="delete_step_id" value="${escapeAttribute(step.id)}">` : ""}<button type="submit">Delete Step</button></form></div>`,
              "</section>",
              workflowStepTemplateScript,
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/settings" || legacySettingsPath) {
          let settings;
          try {
            settings = await getAdminSettingsOverview(session as z.infer<typeof authSessionSchema>, resolved.content);
          } catch (error) {
            if (error instanceof SessionActorError) {
              redirect(response, buildAdminLoginRedirectPath(request));
              return;
            }
            throw error;
          }

          const runtimeEnvironment = canAccessRuntimeEnvironmentSettings(settings.currentAdmin)
            ? await loadEffectiveRuntimeEnvironment({
              filePath: runtimeEnvironmentPaths.filePath,
              processEnv: runtimeEnvironmentProcessEnv
            })
            : null;
          const runtimeEnvironmentFields = runtimeEnvironment?.fields ?? [];
          const launchReadiness = await loadSettingsLaunchReadiness({
            environment: runtimeEnvironment?.values ?? {},
            settings: settings.items,
            enabled: canAccessRuntimeEnvironmentSettings(settings.currentAdmin)
          });
          const categories = [
            ...settings.categories,
            ...(canAccessRuntimeEnvironmentSettings(settings.currentAdmin) ? ["database"] : [])
          ].filter((value, index, items) => items.indexOf(value) === index);
          const requestedSettingsCategory = normalizeSettingsCategory(url.searchParams.get("category"));
          const validSettingsCategories = new Set([
            settingsDefaultCategory,
            "admins",
            ...categories.map((category) => normalizeSettingsCategory(category))
          ]);
          const resolvedSettingsCategory = validSettingsCategories.has(requestedSettingsCategory)
            ? requestedSettingsCategory
            : settingsDefaultCategory;
          if ((url.searchParams.get("category") ?? "").trim() !== "") {
            const canonicalSettingsUrl = new URL(url.toString());
            if (resolvedSettingsCategory === settingsDefaultCategory) {
              canonicalSettingsUrl.searchParams.delete("category");
            } else {
              canonicalSettingsUrl.searchParams.set("category", resolvedSettingsCategory);
            }
            const currentSettingsPath = `${url.pathname}${url.search}`;
            const canonicalSettingsPath = `${canonicalSettingsUrl.pathname}${canonicalSettingsUrl.search}`;
            if (canonicalSettingsPath !== currentSettingsPath) {
              redirect(response, canonicalSettingsPath);
              return;
            }
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Settings",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Configuration",
                title: "Settings",
                description: "Run the operational settings console with grouped configuration, permission-aware visibility, and safer editing paths."
              }),
              adminNav,
              renderSettingsConsole({
                basePath: legacySettingsPath ? "/client/settings.php" : "/admin/settings",
                currentCategory: resolvedSettingsCategory,
                settings: settings.items,
                categories,
                currentAdmin: settings.currentAdmin,
                adminUsers: settings.adminUsers,
                runtimeEnvironmentFields,
                launchReadiness,
                notice: resolveSettingsNotice(url)
              }),
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminSettingDetailMatch != null) {
          const key = decodeURIComponent(adminSettingDetailMatch[1] ?? "");
          const setting = await handlers.handleAdminSettingDetail(session, key);
          if ("error" in setting.body) {
            redirect(response, "/admin/settings");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Setting",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Configuration",
                title: setting.body.item.label,
                description: "Review context, current value, and launch impact before saving changes to this configuration entry."
              }),
              adminNav,
              renderSettingDetail(setting.body.item),
              "</article>"
            ].join("")
            }));
            return;
          }

if (url.pathname === "/admin/appointment-types" || url.pathname === "/client/appointment_types_list.php") {
const appointmentTypes = await handlers.handleAdminAppointmentTypes(session);
if ("error" in appointmentTypes.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Appointment Types",
result: appointmentTypes
});
return;
}
          const legacyAppointmentTypeListPath = url.pathname === "/client/appointment_types_list.php";

          writeHtml(response, 200, renderLayout({
            title: "Admin Appointment Types",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Booking Configuration",
                title: "Appointment Types",
                description: "Configure booking behavior, service availability, billing defaults, and public booking links for each appointment type."
              }),
              adminNav,
              renderAdminAppointmentTypeEditor(null, "/admin/appointment-types"),
              '<section class="surface-block">',
              "<h2>Appointment Type Directory</h2>",
              renderDataTable({
                headers: ["Name", "Unique Link", "Duration", "Schedule", "Availability", "Status", "Actions"],
                rows: appointmentTypes.body.items.map((item) => [
                  legacyAppointmentTypeListPath
                    ? `<a href="/client/appointment_types_edit.php?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`
                    : `<a href="/admin/appointment-types/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`,
                  escapeHtml(item.uniqueLink),
                  escapeHtml(`${item.durationMinutes} min`),
                  escapeHtml(item.scheduleType),
                  escapeHtml([
                    item.publicAvailable ? "Public" : "",
                    item.portalAvailable ? "Portal" : ""
                  ].filter((value) => value !== "").join(" / ") || "Internal"),
                  renderStatusPill(item.active ? "Active" : "Inactive", item.active ? "success" : "warning"),
                  renderAppointmentTypeAdminActions(item.id, { legacy: legacyAppointmentTypeListPath })
                ]),
                emptyMessage: "No appointment types."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminAppointmentTypeDetailMatch != null || url.pathname === "/client/appointment_types_edit.php") {
          const appointmentTypeId = adminAppointmentTypeDetailMatch != null
            ? decodeURIComponent(adminAppointmentTypeDetailMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
          const appointmentType = await handlers.handleAdminAppointmentTypeDetail(session, appointmentTypeId);
          if ("error" in appointmentType.body) {
            redirect(response, "/admin/appointment-types");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Appointment Type",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Booking Configuration",
                title: appointmentType.body.item.name,
                description: "Review the booking rules, scheduling model, billing defaults, and visibility controls for this appointment type."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Appointment Type ID", value: escapeHtml(appointmentType.body.item.id) },
                { label: "Unique Link", value: escapeHtml(appointmentType.body.item.uniqueLink) },
                { label: "Schedule Type", value: escapeHtml(appointmentType.body.item.scheduleType) },
                { label: "Status", value: renderStatusPill(appointmentType.body.item.active ? "Active" : "Inactive", appointmentType.body.item.active ? "success" : "warning") }
              ]),
              '<section class="surface-block">',
              "<h2>Appointment Type Actions</h2>",
              `<div class="form-actions"><a href="/client/form_requests_create.php?form_type=booking_form&appointment_type_id=${encodeURIComponent(appointmentType.body.item.id)}">Generate Booking Link</a><a href="/admin/appointment-types">Back to Directory</a><form method="post" action="/admin/appointment-types/${encodeURIComponent(appointmentType.body.item.id)}/delete" onsubmit="return confirm('Delete this appointment type?');"><button type="submit">Delete Appointment Type</button></form></div>`,
              "</section>",
              renderAdminAppointmentTypeEditor(
                appointmentType.body.item,
                `/admin/appointment-types/${encodeURIComponent(appointmentType.body.item.id)}`
              ),
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/form-templates" || legacyFormTemplateListPath) {
const [formTemplates, appointmentTypes] = await Promise.all([
handlers.handleAdminFormTemplates(session),
handlers.handleAdminAppointmentTypes(session)
]);
if ("error" in formTemplates.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Form Templates",
result: formTemplates
});
return;
}
if ("error" in appointmentTypes.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Form Templates",
result: appointmentTypes
});
return;
}

          const typeFilter = url.searchParams.get("type") ?? "all";
          const filteredTemplates = filterAdminFormTemplates(formTemplates.body.items, typeFilter);
          const appointmentTypeNameById = new Map(
            appointmentTypes.body.items.map((item) => [item.id, item.name] as const)
          );
          const listPath = legacyFormTemplateListPath ? "/client/form_templates_list.php" : "/admin/form-templates";
          const createAction = legacyFormTemplateListPath
            ? `/client/form_templates_edit.php${typeFilter === "internal" ? "?access=internal" : ""}`
            : "/admin/form-templates";

          writeHtml(response, 200, renderLayout({
            title: "Admin Form Templates",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: "Form Templates",
                description: "Manage the reusable form definitions used for booking intake, portal forms, surveys, and internal follow-up workflows."
              }),
              adminNav,
              `<div class="inline-link-list"><a href="${buildFormTemplateFilterPath(listPath, "all")}">All Templates</a><a href="${buildFormTemplateFilterPath(listPath, "client")}">Client Forms</a><a href="${buildFormTemplateFilterPath(listPath, "internal")}">Internal Forms</a></div>`,
              renderAdminFormTemplateEditor(
                null,
                createAction,
                appointmentTypes.body.items.map((item) => ({ id: item.id, name: item.name })),
                {
                  anchorId: "create-form-template",
                  defaultInternal: typeFilter === "internal"
                }
              ),
              '<section class="surface-block">',
              "<h2>Form Template Directory</h2>",
              renderDataTable({
                headers: ["Name", "Type", "Fields", "Required", "Access", "Status", "Actions"],
                rows: filteredTemplates.map((item) => [
                  legacyFormTemplateListPath
                    ? `<a href="/client/form_templates_edit.php?id=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`
                    : `<a href="/admin/form-templates/${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>`,
                  escapeHtml(formatFormTemplateTypeLabel(item.formType)),
                  escapeHtml(String(item.fields?.length ?? 0)),
                  escapeHtml([
                    formatFormTemplateRequiredFrequencyLabel(item.requiredFrequency),
                    item.appointmentTypeId == null
                      ? ""
                      : `For ${appointmentTypeNameById.get(item.appointmentTypeId) ?? item.appointmentTypeId}`
                  ].filter((value) => value !== "").join(" • ")),
                  escapeHtml([
                    item.templateIsInternal === true ? "Internal" : "Client",
                    item.templateShowInClientPortal === false ? "Hidden From Portal" : "Portal Visible"
                  ].join(" • ")),
                  renderStatusPill(item.active ? "Active" : "Inactive", item.active ? "success" : "warning"),
                  renderFormTemplateAdminActions(item.id, {
                    legacy: legacyFormTemplateListPath,
                    formType: item.formType ?? null
                  })
                ]),
                emptyMessage: "No form templates."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminFormTemplateDetailMatch != null || (legacyFormTemplateEditPath && (url.searchParams.get("id") ?? "").trim() !== "")) {
          const templateId = adminFormTemplateDetailMatch != null
            ? decodeURIComponent(adminFormTemplateDetailMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
          const [formTemplate, appointmentTypes] = await Promise.all([
            handlers.handleAdminFormTemplateDetail(session, templateId),
            handlers.handleAdminAppointmentTypes(session)
          ]);
          if ("error" in formTemplate.body) {
            redirect(response, legacyFormTemplateEditPath ? "/client/form_templates_list.php" : "/admin/form-templates");
            return;
          }
if ("error" in appointmentTypes.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Form Template",
result: appointmentTypes
});
return;
}

          const formTemplateItem = formTemplate.body.item;
          const appointmentTypeName = formTemplateItem.appointmentTypeId == null
            ? "All appointment types"
            : (appointmentTypes.body.items.find((item) => item.id === formTemplateItem.appointmentTypeId)?.name
              ?? formTemplateItem.appointmentTypeId);
          const detailAction = adminFormTemplateDetailMatch != null
            ? `/admin/form-templates/${encodeURIComponent(formTemplateItem.id)}`
            : `/client/form_templates_edit.php?id=${encodeURIComponent(formTemplateItem.id)}`;
          const deleteAction = adminFormTemplateDetailMatch != null
            ? `/admin/form-templates/${encodeURIComponent(formTemplateItem.id)}/delete`
            : "/client/form_templates_delete.php";

          writeHtml(response, 200, renderLayout({
            title: "Admin Form Template",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: formTemplateItem.name,
                description: "Review the template structure, access rules, appointment targeting, and JSON field payload used by the runtime."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Template ID", value: escapeHtml(formTemplateItem.id) },
                { label: "Form Type", value: escapeHtml(formatFormTemplateTypeLabel(formTemplateItem.formType)) },
                { label: "Required Frequency", value: escapeHtml(formatFormTemplateRequiredFrequencyLabel(formTemplateItem.requiredFrequency)) },
                { label: "Appointment Type", value: escapeHtml(appointmentTypeName) },
                {
                  label: "Access",
                  value: escapeHtml([
                    formTemplateItem.templateIsInternal === true ? "Internal" : "Client",
                    formTemplateItem.templateShowInClientPortal === false ? "Hidden From Portal" : "Portal Visible"
                  ].join(" • "))
                },
                {
                  label: "Status",
                  value: renderStatusPill(
                    formTemplateItem.active ? "Active" : "Inactive",
                    formTemplateItem.active ? "success" : "warning"
                  )
                }
              ]),
              '<section class="surface-block">',
              "<h2>Form Template Actions</h2>",
              adminFormTemplateDetailMatch != null
                ? `<div class="form-actions"><a href="/admin/form-templates">Back to Directory</a>${(formTemplateItem.formType ?? "").trim().toLowerCase() === "survey_form" ? `<a href="/admin/form-templates/${encodeURIComponent(formTemplateItem.id)}/survey-results">Survey Results</a>` : ""}<form method="post" action="${deleteAction}" onsubmit="return confirm('Delete this form template?');"><button type="submit">Delete Form Template</button></form></div>`
                : `<div class="form-actions"><a href="/client/form_templates_list.php">Back to Directory</a>${(formTemplateItem.formType ?? "").trim().toLowerCase() === "survey_form" ? `<a href="/client/form_survey_results.php?template_id=${encodeURIComponent(formTemplateItem.id)}">Survey Results</a>` : ""}<form method="post" action="${deleteAction}" onsubmit="return confirm('Delete this form template?');"><input type="hidden" name="id" value="${escapeAttribute(formTemplateItem.id)}"><button type="submit">Delete Form Template</button></form></div>`,
              "</section>",
              renderAdminFormTemplateEditor(
                formTemplateItem,
                detailAction,
                appointmentTypes.body.items.map((item) => ({ id: item.id, name: item.name }))
              ),
              "</article>"
            ].join("")
          }));
          return;
        }

if (legacyFormTemplateEditPath) {
const appointmentTypes = await handlers.handleAdminAppointmentTypes(session);
if ("error" in appointmentTypes.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Form Template",
result: appointmentTypes
});
return;
}

          const internalAccess = url.searchParams.get("access") === "internal";
          const action = internalAccess ? "/client/form_templates_edit.php?access=internal" : "/client/form_templates_edit.php";
          writeHtml(response, 200, renderLayout({
            title: "Admin Form Template",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: "Create Form Template",
                description: "Create a reusable client or internal form template with the same JSON field payload used by the runtime."
              }),
              adminNav,
              '<section class="surface-block"><div class="form-actions"><a href="/client/form_templates_list.php">Back to Directory</a></div></section>',
              renderAdminFormTemplateEditor(
                null,
                action,
                appointmentTypes.body.items.map((item) => ({ id: item.id, name: item.name })),
                { defaultInternal: internalAccess }
              ),
              "</article>"
            ].join("")
          }));
          return;
        }

        if (url.pathname === "/admin/email-templates" || url.pathname === "/client/email_templates_list.php") {
const emailTemplates = await handlers.handleAdminEmailTemplates(session);
if ("error" in emailTemplates.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Email Templates",
result: emailTemplates
});
return;
}
          const legacyEmailTemplateListPath = url.pathname === "/client/email_templates_list.php";

          writeHtml(response, 200, renderLayout({
            title: "Admin Email Templates",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Communications",
                title: "Email Templates",
                description: "Manage reusable message templates used by confirmations, reminders, workflows, and other outbound communication."
              }),
              adminNav,
              renderAdminEmailTemplateEditor(null, "/admin/email-templates"),
              '<section class="surface-block">',
              "<h2>Email Template Library</h2>",
              renderDataTable({
                headers: ["Name", "Template Type", "Subject", "Status", "Actions"],
                rows: emailTemplates.body.items.map((template) => [
                  legacyEmailTemplateListPath
                    ? `<a href="/client/email_templates_edit.php?id=${encodeURIComponent(template.id)}">${escapeHtml(template.name)}</a>`
                    : `<a href="/admin/email-templates/${encodeURIComponent(template.id)}">${escapeHtml(template.name)}</a>`,
                  escapeHtml(template.templateType),
                  escapeHtml(template.subject),
                  renderStatusPill(template.active ? "Active" : "Inactive", template.active ? "success" : "warning"),
                  renderEmailTemplateAdminActions(template.id, { legacy: legacyEmailTemplateListPath })
                ]),
                emptyMessage: "No email templates."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminEmailTemplateDetailMatch != null || url.pathname === "/client/email_templates_edit.php") {
          const templateId = adminEmailTemplateDetailMatch != null
            ? decodeURIComponent(adminEmailTemplateDetailMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
          const emailTemplate = await handlers.handleAdminEmailTemplateDetail(session, templateId);
          if ("error" in emailTemplate.body) {
            redirect(response, "/admin/email-templates");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Email Template",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Communications",
                title: emailTemplate.body.item.name,
                description: "Review the template payload, then update the subject and body content used by downstream automation."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Template ID", value: escapeHtml(emailTemplate.body.item.id) },
                { label: "Template Type", value: escapeHtml(emailTemplate.body.item.templateType) },
                { label: "Status", value: renderStatusPill(emailTemplate.body.item.active ? "Active" : "Inactive", emailTemplate.body.item.active ? "success" : "warning") }
              ]),
              renderAdminEmailTemplateEditor(emailTemplate.body.item, `/admin/email-templates/${encodeURIComponent(emailTemplate.body.item.id)}`),
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/scheduled-tasks" || url.pathname === "/client/scheduled_tasks_list.php") {
const scheduledTasks = await handlers.handleAdminScheduledTasks(session);
if ("error" in scheduledTasks.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Scheduled Tasks",
result: scheduledTasks
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Admin Scheduled Tasks",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: "Scheduled Tasks",
                description: "Configure the background task cadence that drives reminders, workflow processors, inbound email polling, and other recurring operations."
              }),
              adminNav,
              renderAdminScheduledTaskEditor(null, "/admin/scheduled-tasks"),
              '<section class="surface-block">',
              "<h2>Scheduled Tasks</h2>",
              renderDataTable({
                headers: ["Name", "Task Type", "Schedule Type", "Status"],
                rows: scheduledTasks.body.items.map((task) => [
                  `<a href="/admin/scheduled-tasks/${encodeURIComponent(task.id)}">${escapeHtml(task.name)}</a>`,
                  escapeHtml(task.taskType),
                  escapeHtml(task.scheduleType),
                  renderStatusPill(task.active ? "Active" : "Inactive", task.active ? "success" : "warning")
                ]),
                emptyMessage: "No scheduled tasks."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminScheduledTaskDetailMatch != null || url.pathname === "/client/scheduled_tasks_edit.php") {
          const taskId = adminScheduledTaskDetailMatch != null
            ? decodeURIComponent(adminScheduledTaskDetailMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
          const scheduledTask = await handlers.handleAdminScheduledTaskDetail(session, taskId);
          if ("error" in scheduledTask.body) {
            redirect(response, "/admin/scheduled-tasks");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Scheduled Task",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Automation",
                title: scheduledTask.body.item.name,
                description: "Review cadence, task type, and runtime signals before updating this scheduled job definition."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Task ID", value: escapeHtml(scheduledTask.body.item.id) },
                { label: "Task Type", value: escapeHtml(scheduledTask.body.item.taskType) },
                { label: "Schedule Type", value: escapeHtml(scheduledTask.body.item.scheduleType) },
                { label: "Schedule Value", value: escapeHtml(scheduledTask.body.item.scheduleValue) },
                { label: "Status", value: renderStatusPill(scheduledTask.body.item.active ? "Active" : "Inactive", scheduledTask.body.item.active ? "success" : "warning") }
              ]),
              renderAdminScheduledTaskEditor(scheduledTask.body.item, `/admin/scheduled-tasks/${encodeURIComponent(scheduledTask.body.item.id)}`),
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/operations/jobs") {
const jobs = await handlers.handleAdminJobLogs(session);
if ("error" in jobs.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Job Logs",
result: jobs
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Admin Job Logs",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Operations",
                title: "Job Logs",
                description: "Review background jobs, execution state, and queued workflow activity."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Job Activity</h2>",
              renderDataTable({
                headers: ["Job ID", "Kind", "Status"],
                rows: jobs.body.items.map((job) => [
                  `<a href="/admin/operations/jobs/${encodeURIComponent(job.jobId)}">${escapeHtml(job.jobId)}</a>`,
                  escapeHtml(job.kind),
                  renderStatusPill(job.status, job.status === "processed" ? "success" : job.status === "failed" ? "danger" : "warning")
                ]),
                emptyMessage: "No job logs."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminOperationJobDetailMatch != null) {
          const jobId = decodeURIComponent(adminOperationJobDetailMatch[1] ?? "");
          const job = await handlers.handleAdminJobLogDetail(session, jobId);
          if ("error" in job.body) {
            redirect(response, "/admin/operations/jobs");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Job Log",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Operations",
                title: job.body.item.jobId,
                description: "Inspect the execution summary and payload recorded for this background job."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Kind", value: escapeHtml(job.body.item.kind) },
                {
                  label: "Status",
                  value: renderStatusPill(job.body.item.status, job.body.item.status === "processed" ? "success" : job.body.item.status === "failed" ? "danger" : "warning")
                }
              ]),
              '<section class="surface-block">',
              `<p>${escapeHtml(job.body.item.summary ?? "")}</p>`,
              `<pre>${escapeHtml(toPrettyJson(job.body.item.payload))}</pre>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/operations/callbacks") {
const callbacks = await handlers.handleAdminIntegrationCallbackLogs(session);
if ("error" in callbacks.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Callback Logs",
result: callbacks
});
return;
}

          writeHtml(response, 200, renderLayout({
            title: "Admin Callback Logs",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Operations",
                title: "Callback Logs",
                description: "Review inbound provider callbacks, receipt timestamps, and queued follow-up work."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Callback Activity</h2>",
              renderDataTable({
                headers: ["Callback ID", "Provider", "Received At"],
                rows: callbacks.body.items.map((callback) => [
                  `<a href="/admin/operations/callbacks/${encodeURIComponent(callback.callbackId)}">${escapeHtml(callback.callbackId)}</a>`,
                  renderStatusPill(callback.provider, "info"),
                  escapeHtml(callback.receivedAt)
                ]),
                emptyMessage: "No callback logs."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminOperationCallbackDetailMatch != null) {
          const callbackId = decodeURIComponent(adminOperationCallbackDetailMatch[1] ?? "");
          const callback = await handlers.handleAdminIntegrationCallbackLogDetail(session, callbackId);
          if ("error" in callback.body) {
            redirect(response, "/admin/operations/callbacks");
            return;
          }

          writeHtml(response, 200, renderLayout({
            title: "Admin Callback Log",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Operations",
                title: callback.body.item.callbackId,
                description: "Inspect the provider payload and any queued job associated with this callback."
              }),
              adminNav,
              renderDetailGrid([
                { label: "Provider", value: escapeHtml(callback.body.item.provider) },
                { label: "Queued Job", value: escapeHtml(callback.body.item.queuedJobId ?? "None") }
              ]),
              '<section class="surface-block">',
              `<pre>${escapeHtml(toPrettyJson(callback.body.item.payload))}</pre>`,
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminFormTemplateSurveyResultsMatch != null || (legacyFormSurveyResultsPath && (url.searchParams.get("template_id") ?? "").trim() !== "")) {
          if (resolved.api == null) {
            redirect(response, "/admin/form-templates");
            return;
          }

          const templateId = adminFormTemplateSurveyResultsMatch != null
            ? decodeURIComponent(adminFormTemplateSurveyResultsMatch[1] ?? "")
            : url.searchParams.get("template_id") ?? "";
          const template = await resolved.api.adminConfiguration.findAdminFormTemplateById(templateId);
          if (template == null || (template.formType ?? "").trim().toLowerCase() !== "survey_form") {
            redirect(response, legacyFormSurveyResultsPath ? "/client/form_templates_list.php" : "/admin/form-templates");
            return;
          }

          const submissions = await resolved.api.adminResources.listAdminFormsByTemplate(templateId);
          const report = buildAdminSurveyReport(template, submissions);
          const backPath = legacyFormSurveyResultsPath ? "/client/form_templates_list.php" : "/admin/form-templates";
          const templatePath = legacyFormSurveyResultsPath
            ? `/client/form_templates_edit.php?id=${encodeURIComponent(template.id)}`
            : `/admin/form-templates/${encodeURIComponent(template.id)}`;

          writeHtml(response, 200, renderLayout({
            title: "Survey Results",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: "Survey Results",
                description: template.description?.trim() === ""
                  ? `Response analytics for ${template.name}.`
                  : template.description ?? `Response analytics for ${template.name}.`
              }),
              adminNav,
              '<section class="surface-block">',
              '<div class="form-actions">',
              `<a href="${backPath}">Back to Templates</a>`,
              `<a href="${templatePath}">Edit Template</a>`,
              "</div>",
              "</section>",
              renderDetailGrid([
                { label: "Template", value: escapeHtml(template.name) },
                { label: "Total Submissions", value: escapeHtml(String(report.totalSubmissions)) },
                { label: "Visualized Questions", value: escapeHtml(String(report.visualizedFieldCount)) },
                { label: "Latest Submission", value: escapeHtml(formatAdminDateTime(report.latestSubmissionAt)) }
              ]),
              report.totalSubmissions === 0
                ? '<section class="surface-block"><p class="section-copy">No survey submissions have been collected yet.</p></section>'
                : "",
              report.template.fields.length === 0
                ? '<section class="surface-block"><p class="section-copy">This survey template does not have any configured questions yet.</p></section>'
                : report.fields.map((field) => renderAdminSurveyFieldSummary(field)).join(""),
              "</article>"
            ].join("")
          }));
          return;
        }

if (url.pathname === "/admin/forms" || legacyFormSubmissionsListPath) {
const forms = await handlers.handleAdminForms(session);
if ("error" in forms.body) {
await handleProtectedRouteFailure({
response,
request,
sessionStore: resolved.sessionStore,
loginPath: buildAdminLoginRedirectPath(request),
title: "Admin Forms",
result: forms
});
return;
}

          const clientFilter = url.searchParams.get("client_id")?.trim() ?? "";
          const templateFilter = url.searchParams.get("template_id")?.trim() ?? "";
          const statusFilter = url.searchParams.get("status")?.trim() ?? "";
          const queryFilter = url.searchParams.get("q")?.trim() ?? "";
          const filteredForms = filterAdminFormSubmissions(forms.body.items, {
            clientId: clientFilter,
            templateId: templateFilter,
            status: statusFilter,
            query: queryFilter
          });
          const listPath = legacyFormSubmissionsListPath ? "/client/form_submissions_list.php" : "/admin/forms";
          const clientOptions = Array.from(new Map(
            forms.body.items.map((item) => [item.clientId, getAdminFormSubmissionClientLabel(item)])
          ).entries()).sort((left, right) => left[1].localeCompare(right[1]));
          const templateOptions = Array.from(new Map(
            forms.body.items.map((item) => [item.templateId, getAdminFormSubmissionTitle(item)])
          ).entries()).sort((left, right) => left[1].localeCompare(right[1]));

          writeHtml(response, 200, renderLayout({
            title: "Admin Forms",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: "Form Submissions",
                description: "Review submitted records, manage review status, and open survey analytics from the same admin queue."
              }),
              adminNav,
              '<section class="surface-block">',
              "<h2>Filters</h2>",
              `<form class="form-grid" method="get" action="${listPath}">`,
              '<div class="form-grid form-grid--two">',
              `<label>Client<select name="client_id"><option value="">All Clients</option>${clientOptions.map(([clientId, label]) => `<option value="${escapeAttribute(clientId)}"${clientFilter === clientId ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>`,
              `<label>Form Template<select name="template_id"><option value="">All Forms</option>${templateOptions.map(([templateId, label]) => `<option value="${escapeAttribute(templateId)}"${templateFilter === templateId ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>`,
              `<label>Status<select name="status"><option value="">All Statuses</option>${["pending", "draft", "submitted", "reviewed"].map((status) => `<option value="${status}"${statusFilter.toLowerCase() === status ? " selected" : ""}>${escapeHtml(formatAdminFormSubmissionStatus(status))}</option>`).join("")}</select></label>`,
              `<label>Search<input type="search" name="q" value="${escapeAttribute(queryFilter)}" placeholder="Search client, form, pet, booking"></label>`,
              "</div>",
              `<div class="form-actions"><button type="submit">Apply Filters</button><a href="${listPath}">Clear</a></div>`,
              "</form>",
              "</section>",
              '<section class="surface-block">',
              "<h2>Submission Queue</h2>",
              renderDataTable({
                headers: ["Form", "Client", "Type", "Submitted", "Status", "Reviewed By", "Actions"],
                rows: filteredForms.map((form) => [
                  escapeHtml(getAdminFormSubmissionTitle(form)),
                  legacyFormSubmissionsListPath
                    ? `<a href="/client/form_submissions_view.php?id=${encodeURIComponent(form.id)}">${escapeHtml(getAdminFormSubmissionClientLabel(form))}</a>`
                    : `<a href="/admin/forms/${encodeURIComponent(form.id)}">${escapeHtml(getAdminFormSubmissionClientLabel(form))}</a>`,
                  escapeHtml(formatFormTemplateTypeLabel(form.formType)),
                  escapeHtml(formatAdminDateTime(form.submittedAt)),
                  renderAdminFormSubmissionStatusPill(form),
                  escapeHtml(form.reviewedByName ?? "Not reviewed"),
                  renderAdminFormSubmissionActions(form, { legacy: legacyFormSubmissionsListPath })
                ]),
                emptyMessage: "No form submissions match the current filters."
              }),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }

        if (adminFormDetailMatch != null || (legacyFormSubmissionsViewPath && (url.searchParams.get("id") ?? "").trim() !== "")) {
          const formId = adminFormDetailMatch != null
            ? decodeURIComponent(adminFormDetailMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
          const form = await handlers.handleAdminFormDetail(session, formId);
          if ("error" in form.body) {
            redirect(response, legacyFormSubmissionsViewPath ? "/client/form_submissions_list.php" : "/admin/forms");
            return;
          }

          const detailPath = legacyFormSubmissionsViewPath
            ? `/client/form_submissions_view.php?id=${encodeURIComponent(form.body.item.id)}`
            : `/admin/forms/${encodeURIComponent(form.body.item.id)}`;
          const listPath = legacyFormSubmissionsViewPath ? "/client/form_submissions_list.php" : "/admin/forms";
          const reviewAction = legacyFormSubmissionsViewPath
            ? detailPath
            : `/admin/forms/${encodeURIComponent(form.body.item.id)}/review`;
          const unreviewAction = legacyFormSubmissionsViewPath
            ? detailPath
            : `/admin/forms/${encodeURIComponent(form.body.item.id)}/unreview`;
          const surveyResultsPath = (form.body.item.formType ?? "").trim().toLowerCase() === "survey_form"
            ? (
              legacyFormSubmissionsViewPath
                ? `/client/form_survey_results.php?template_id=${encodeURIComponent(form.body.item.templateId)}`
                : `/admin/form-templates/${encodeURIComponent(form.body.item.templateId)}/survey-results`
            )
            : null;

          writeHtml(response, 200, renderLayout({
            title: "Admin Form Detail",
            body: [
              '<article class="content-stack">',
              renderSectionIntro({
                eyebrow: "Forms",
                title: getAdminFormSubmissionTitle(form.body.item),
                description: "Review submission data, note audit status, and keep survey analytics linked to the original template."
              }),
              adminNav,
              '<section class="surface-block">',
              '<div class="form-actions">',
              `<a href="${listPath}">Back to Submissions</a>`,
              surveyResultsPath == null ? "" : `<a href="${surveyResultsPath}">Survey Results</a>`,
              "</div>",
              "</section>",
              renderDetailGrid([
                { label: "Submission ID", value: escapeHtml(form.body.item.id) },
                { label: "Template", value: escapeHtml(getAdminFormSubmissionTitle(form.body.item)) },
                { label: "Client", value: escapeHtml(getAdminFormSubmissionClientLabel(form.body.item)) },
                { label: "Form Type", value: escapeHtml(formatFormTemplateTypeLabel(form.body.item.formType)) },
                { label: "Status", value: renderAdminFormSubmissionStatusPill(form.body.item) },
                { label: "Submitted", value: escapeHtml(formatAdminDateTime(form.body.item.submittedAt)) },
                { label: "Pet", value: escapeHtml(form.body.item.petName ?? "Not linked") },
                { label: "Booking", value: escapeHtml(form.body.item.bookingSummary ?? "Not linked") },
                { label: "Submitted By", value: escapeHtml(form.body.item.submittedByName ?? "Client / public access") },
                { label: "Reviewed By", value: escapeHtml(form.body.item.reviewedByName ?? "Not reviewed") },
                { label: "Reviewed At", value: escapeHtml(formatAdminDateTime(form.body.item.reviewedAt)) },
                {
                  label: "Portal Access",
                  value: form.body.item.publicAccess == null
                    ? "No public token"
                    : escapeHtml(form.body.item.publicAccess.token)
                }
              ]),
              '<section class="surface-block">',
              "<h2>Review Status</h2>",
              normalizeAdminFormSubmissionStatus(form.body.item) === "reviewed"
                ? [
                  '<p class="section-copy">This submission has been reviewed. You can remove the review flag without deleting the stored notes.</p>',
                  `<div class="settings-current-value-panel"><strong>Admin Notes</strong><div class="meta">${escapeHtml(form.body.item.notes?.trim() === "" ? "No notes added." : form.body.item.notes ?? "")}</div></div>`,
                  `<form class="form-actions" method="post" action="${unreviewAction}">${legacyFormSubmissionsViewPath ? '<input type="hidden" name="action" value="unreview">' : ""}<button type="submit">Remove Review</button></form>`
                ].join("")
                : [
                  '<p class="section-copy">Mark this submission as reviewed and attach optional internal notes.</p>',
                  `<form class="form-grid" method="post" action="${reviewAction}">`,
                  legacyFormSubmissionsViewPath ? '<input type="hidden" name="action" value="review">' : "",
                  `<label>Admin Notes<textarea name="notes" rows="6">${escapeHtml(form.body.item.notes ?? "")}</textarea></label>`,
                  '<div class="form-actions"><button type="submit">Mark Reviewed</button></div>',
                  "</form>"
                ].join(""),
              "</section>",
              '<section class="surface-block">',
              "<h2>Contact Information</h2>",
              renderDetailGrid([
                { label: "Name", value: escapeHtml(form.body.item.contactName ?? "Not provided") },
                { label: "Email", value: escapeHtml(form.body.item.contactEmail ?? "Not provided") },
                { label: "Phone", value: escapeHtml(form.body.item.contactPhone ?? "Not provided") }
              ]),
              "</section>",
              '<section class="surface-block">',
              "<h2>Responses</h2>",
              renderLegacyPublicFormResponses(form.body.item),
              "</section>",
              "</article>"
            ].join("")
          }));
          return;
        }
      }

      if (
        method === "POST"
        && resolved.api != null
        && (
          adminFormReviewMatch != null
          || adminFormUnreviewMatch != null
          || (legacyFormSubmissionsViewPath && (url.searchParams.get("id") ?? "").trim() !== "")
        )
      ) {
        const session = await loadPersistedSession(resolved.sessionStore, request);
        if (session == null || session.actorType !== "admin_user") {
          redirect(response, buildAdminLoginRedirectPath(request));
          return;
        }

        const form = await readFormBody(request);
        const legacyAction = form.get("action")?.trim().toLowerCase() ?? "";
        const formId = adminFormReviewMatch != null
          ? decodeURIComponent(adminFormReviewMatch[1] ?? "")
          : adminFormUnreviewMatch != null
            ? decodeURIComponent(adminFormUnreviewMatch[1] ?? "")
            : url.searchParams.get("id") ?? "";
        const isReviewAction = adminFormReviewMatch != null || (legacyFormSubmissionsViewPath && legacyAction === "review");
        const redirectPath = legacyFormSubmissionsViewPath
          ? `/client/form_submissions_view.php?id=${encodeURIComponent(formId)}`
          : `/admin/forms/${encodeURIComponent(formId)}`;

        if (formId.trim() === "") {
          redirect(response, legacyFormSubmissionsViewPath ? "/client/form_submissions_list.php" : "/admin/forms");
          return;
        }

        const updated = isReviewAction
          ? await resolved.api.adminResources.reviewAdminForm(formId, session.actorId, form.get("notes") ?? "")
          : await resolved.api.adminResources.unreviewAdminForm(formId);
        if (updated == null) {
          redirect(response, legacyFormSubmissionsViewPath ? "/client/form_submissions_list.php" : "/admin/forms");
          return;
        }

        redirect(response, redirectPath);
        return;
      }

      if (method !== "GET") {
        writeHtml(response, 405, renderLayout({
          title: "Method Not Allowed",
          body: "<article><h1>Method Not Allowed</h1></article>"
        }));
        return;
      }

      if (url.pathname === "/" || url.pathname === "/index.php" || url.pathname === "/index.html") {
        const page = await getPublicSitePage(null, resolved.content);
        writeHtml(response, 200, renderPublicPageLayout({
          title: page.item.title,
          description: page.item.metaDescription,
          css: page.item.cssContent,
          publicRenderAssets: await getPublicRenderAssets(),
          includeNewsletterEmbed: true,
          requestPath,
          body: renderPublicPageContent({
            slug: "home",
            title: page.item.title,
            htmlContent: page.item.htmlContent,
            metaDescription: page.item.metaDescription
          })
        }));
        return;
      }

      if (url.pathname === "/blog" || url.pathname === "/blog/index.php") {
        const posts = await listPublicBlogPosts(resolved.content);
        writeHtml(response, 200, renderPublicPageLayout({
          title: "Blog",
          publicRenderAssets: await getPublicRenderAssets(),
          includeNewsletterEmbed: true,
          requestPath,
          body: renderPublicBlogIndexPage(posts.items)
        }));
        return;
      }

      if (url.pathname === "/blog/post.php") {
        const postSlug = url.searchParams.get("slug")?.trim() ?? "";
        const post = await getPublicBlogPostDetail(postSlug, resolved.content);
        writeHtml(response, 200, renderPublicPageLayout({
          title: post.item.title,
          description: post.item.excerpt,
          publicRenderAssets: await getPublicRenderAssets(),
          includeNewsletterEmbed: true,
          requestPath,
          body: renderPublicBlogPostPage(post.item)
        }));
        return;
      }

      const blogMatch = /^\/blog\/([^/]+)$/.exec(url.pathname);
      if (blogMatch != null) {
        const post = await getPublicBlogPostDetail(decodeURIComponent(blogMatch[1] ?? ""), resolved.content);
        writeHtml(response, 200, renderPublicPageLayout({
          title: post.item.title,
          description: post.item.excerpt,
          publicRenderAssets: await getPublicRenderAssets(),
          includeNewsletterEmbed: true,
          requestPath,
          body: renderPublicBlogPostPage(post.item)
        }));
        return;
      }

if (url.pathname === "/page.php") {
  const pageSlug = url.searchParams.get("slug")?.trim() ?? "";
  const page = await getPublicSitePageForRender(pageSlug, resolved.content);
  writeHtml(response, 200, renderPublicPageLayout({
    title: page.title,
    description: page.metaDescription,
    css: page.cssContent,
    publicRenderAssets: await getPublicRenderAssets(),
    includeNewsletterEmbed: true,
    requestPath,
    body: renderPublicPageContent({
      slug: pageSlug,
      title: page.title,
      htmlContent: page.htmlContent,
      metaDescription: page.metaDescription
    })
  }));
  return;
}

const slug = url.pathname.replace(/^\/+/, "");
if (slug !== "") {
  const page = await getPublicSitePageForRender(slug, resolved.content);
  writeHtml(response, 200, renderPublicPageLayout({
    title: page.title,
    description: page.metaDescription,
    css: page.cssContent,
    publicRenderAssets: await getPublicRenderAssets(),
    includeNewsletterEmbed: true,
    requestPath,
    body: renderPublicPageContent({
      slug,
      title: page.title,
      htmlContent: page.htmlContent,
      metaDescription: page.metaDescription
    })
  }));
  return;
}

      writeHtml(response, 404, renderPublicPageLayout({
        title: "Not Found",
        publicRenderAssets: await getSafePublicRenderAssets(),
        requestPath,
        body: "<article><h1>Not Found</h1></article>"
      }));
    } catch (error) {
      if (error instanceof ContentError && error.code === "not_found") {
        writeHtml(response, 404, renderPublicPageLayout({
          title: "Not Found",
          publicRenderAssets: await getSafePublicRenderAssets(),
          requestPath,
          body: "<article><h1>Not Found</h1></article>"
        }));
        return;
      }

    await options.onError?.(error, {
      requestId,
      method,
      path: url.pathname
    });

    if (!response.headersSent) {
      const unexpectedError = describeUnexpectedError(error);
      writeHtml(response, 500, renderLayout({
        title: "Unexpected Server Failure",
        body: renderDebugErrorArticle({
          title: "Unexpected Server Failure",
          headline: unexpectedError.headline,
          message: unexpectedError.message,
          statusCode: 500,
          requestId,
          requestPath,
          details: unexpectedError.details
        })
      }));
      return;
    }

      if (!response.writableEnded) {
        response.end();
      }
    }
  });
}









