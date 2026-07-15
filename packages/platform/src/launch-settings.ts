import type { Setting } from "@bdta/domain";

export type RequiredLaunchSettingCatalogMode = "synthetic" | "bootstrap";

export type ManagedSettingDefinition = {
  key: string;
  label: string;
  description: string;
  category: string;
  type: string;
  secret: boolean;
  syntheticValue: string;
  bootstrapValue: string;
};

export type RequiredLaunchSettingDefinition = ManagedSettingDefinition;

const publicNoticeManagedSettingsDefinitions: ManagedSettingDefinition[] = [
  {
    key: "public_notice_enabled",
    label: "Public Notice Enabled",
    description: "Displays a dismissible sticky public notice bar on public-facing pages.",
    category: "site",
    type: "checkbox",
    secret: false,
    syntheticValue: "1",
    bootstrapValue: "0"
  },
  {
    key: "public_notice_text",
    label: "Public Notice Text",
    description: "Notice text displayed to visitors when the public notice bar is enabled.",
    category: "site",
    type: "textarea",
    secret: false,
    syntheticValue: "Training facility closed July 4 for the holiday.",
    bootstrapValue: ""
  }
];

const socialManagedSettingsDefinitions: ManagedSettingDefinition[] = [
  {
    key: "facebook_url",
    label: "Facebook URL",
    description: "Facebook page URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://facebook.example/bdta",
    bootstrapValue: "https://www.facebook.com/BrooksDogTrainingAcademy"
  },
  {
    key: "instagram_url",
    label: "Instagram URL",
    description: "Instagram profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://instagram.example/bdta",
    bootstrapValue: "https://www.instagram.com/brooksdogtrainingacademy"
  },
  {
    key: "linktree_url",
    label: "Linktree URL",
    description: "Linktree profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://linktr.ee/bdta-validation",
    bootstrapValue: "https://linktr.ee/brooksdogtrainingacademy"
  },
  {
    key: "tiktok_url",
    label: "TikTok URL",
    description: "TikTok profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://tiktok.example/@bdta",
    bootstrapValue: ""
  },
  {
    key: "youtube_url",
    label: "YouTube URL",
    description: "YouTube channel URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://youtube.example/@bdta",
    bootstrapValue: ""
  },
  {
    key: "twitter_x_url",
    label: "Twitter / X URL",
    description: "Twitter / X profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://x.example/bdta",
    bootstrapValue: ""
  },
  {
    key: "threads_url",
    label: "Threads URL",
    description: "Threads profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://threads.example/@bdta",
    bootstrapValue: ""
  },
  {
    key: "nextdoor_url",
    label: "Nextdoor URL",
    description: "Nextdoor business URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://nextdoor.example/pages/bdta",
    bootstrapValue: ""
  },
  {
    key: "patreon_url",
    label: "Patreon URL",
    description: "Patreon URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://patreon.example/bdta",
    bootstrapValue: ""
  },
  {
    key: "pinterest_url",
    label: "Pinterest URL",
    description: "Pinterest profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://pinterest.example/bdta",
    bootstrapValue: ""
  },
  {
    key: "snapchat_url",
    label: "Snapchat URL",
    description: "Snapchat profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://snapchat.example/add/bdta",
    bootstrapValue: ""
  },
  {
    key: "linkedin_url",
    label: "LinkedIn URL",
    description: "LinkedIn profile or company URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://linkedin.example/company/bdta",
    bootstrapValue: ""
  },
  {
    key: "bluesky_url",
    label: "Bluesky URL",
    description: "Bluesky profile URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://bsky.app/profile/bdta.validation",
    bootstrapValue: ""
  },
  {
    key: "yelp_url",
    label: "Yelp URL",
    description: "Yelp business URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://yelp.example/biz/bdta",
    bootstrapValue: ""
  },
  {
    key: "substack_url",
    label: "Substack URL",
    description: "Substack publication URL shown in public social-link slots.",
    category: "social",
    type: "url",
    secret: false,
    syntheticValue: "https://bdta.substack.com",
    bootstrapValue: ""
  }
];

const customSocialLinkManagedSettingsDefinitions: ManagedSettingDefinition[] = Array.from(
  { length: 5 },
  (_, index): ManagedSettingDefinition[] => {
    const position = index + 1;

    return [
      {
        key: `custom_social_link_${position}_label`,
        label: `Custom Link ${position} Label`,
        description: `Short label shown on the website for custom social link ${position}.`,
        category: "social",
        type: "text",
        secret: false,
        syntheticValue: position === 1 ? "Podcast" : "",
        bootstrapValue: ""
      },
      {
        key: `custom_social_link_${position}_url`,
        label: `Custom Link ${position} URL`,
        description: `Public URL shown on the website for custom social link ${position}.`,
        category: "social",
        type: "url",
        secret: false,
        syntheticValue: position === 1 ? "https://example.com/podcast" : "",
        bootstrapValue: ""
      }
    ];
  }
).flat();

const managedSettingsDefinitions: ManagedSettingDefinition[] = [
  {
    key: "base_url",
    label: "Base URL",
    description: "Canonical website base URL used for portal links and public redirects.",
    category: "site",
    type: "text",
    secret: false,
    syntheticValue: "https://validation.brook.example",
    bootstrapValue: ""
  },
  {
    key: "business_email",
    label: "Business Email",
    description: "Primary customer-facing inbox used in confirmations, reminders, and footer contact references.",
    category: "site",
    type: "email",
    secret: false,
    syntheticValue: "help@validation.example",
    bootstrapValue: "bookings@brooksdogtrainingacademy.com"
  },
  {
    key: "stripe_enabled",
    label: "Stripe Enabled",
    description: "Enables Stripe payment processing flows.",
    category: "payments",
    type: "boolean",
    secret: false,
    syntheticValue: "1",
    bootstrapValue: "0"
  },
  {
    key: "stripe_mode",
    label: "Stripe Mode",
    description: "Select whether Stripe should use live or test credentials.",
    category: "payments",
    type: "select",
    secret: false,
    syntheticValue: "live",
    bootstrapValue: "test"
  },
  {
    key: "stripe_test_publishable_key",
    label: "Stripe Test Publishable Key",
    description: "Stripe test publishable key used by checkout flows in non-production mode.",
    category: "payments",
    type: "text",
    secret: false,
    syntheticValue: "pk_test_validation_fixture",
    bootstrapValue: ""
  },
  {
    key: "stripe_test_secret_key",
    label: "Stripe Test Secret Key",
    description: "Test Stripe API secret used for non-production payment validation.",
    category: "payments",
    type: "password",
    secret: true,
    syntheticValue: "sk_test_validation_fixture",
    bootstrapValue: ""
  },
  {
    key: "stripe_live_publishable_key",
    label: "Stripe Live Publishable Key",
    description: "Stripe live publishable key exposed to production checkout flows.",
    category: "payments",
    type: "text",
    secret: false,
    syntheticValue: "pk_live_validation_fixture",
    bootstrapValue: ""
  },
  {
    key: "stripe_live_secret_key",
    label: "Stripe Live Secret Key",
    description: "Live Stripe API secret used for production charges.",
    category: "payments",
    type: "password",
    secret: true,
    syntheticValue: "sk_live_validation_fixture",
    bootstrapValue: ""
  },
  {
    key: "stripe_webhook_secret",
    label: "Stripe Webhook Secret",
    description: "Webhook signing secret used to verify raw Stripe callback events.",
    category: "payments",
    type: "password",
    secret: true,
    syntheticValue: "whsec_validation_fixture",
    bootstrapValue: ""
  },
  {
    key: "turnstile_site_key",
    label: "Turnstile Site Key",
    description: "Cloudflare Turnstile site key used on public booking forms.",
    category: "security",
    type: "text",
    secret: false,
    syntheticValue: "site-key-1",
    bootstrapValue: ""
  },
  {
    key: "turnstile_secret_key",
    label: "Turnstile Secret Key",
    description: "Cloudflare Turnstile secret used to validate public form submissions.",
    category: "security",
    type: "password",
    secret: true,
    syntheticValue: "turnstile-validation-secret",
    bootstrapValue: ""
  },
  {
    key: "smtp_host",
    label: "SMTP Host",
    description: "Outbound SMTP hostname used for application email delivery.",
    category: "communications",
    type: "text",
    secret: false,
    syntheticValue: "smtp.validation.local",
    bootstrapValue: ""
  },
  {
    key: "smtp_port",
    label: "SMTP Port",
    description: "SMTP server port used for outgoing mail delivery.",
    category: "communications",
    type: "number",
    secret: false,
    syntheticValue: "587",
    bootstrapValue: "587"
  },
  {
    key: "smtp_encryption",
    label: "SMTP Encryption",
    description: "Encryption mode used for SMTP delivery.",
    category: "communications",
    type: "select",
    secret: false,
    syntheticValue: "tls",
    bootstrapValue: "tls"
  },
  {
    key: "smtp_username",
    label: "SMTP Username",
    description: "SMTP authentication username when the mail host requires credentials.",
    category: "communications",
    type: "text",
    secret: false,
    syntheticValue: "smtp-user",
    bootstrapValue: ""
  },
  {
    key: "smtp_password",
    label: "SMTP Password",
    description: "SMTP authentication password used by outgoing email delivery.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "smtp-validation-password",
    bootstrapValue: ""
  },
  {
    key: "smtp_debug",
    label: "SMTP Debug Mode",
    description: "Enables detailed SMTP troubleshooting output during outbound email delivery.",
    category: "communications",
    type: "checkbox",
    secret: false,
    syntheticValue: "1",
    bootstrapValue: "0"
  },
  {
    key: "sendgrid_api_key",
    label: "SendGrid API Key",
    description: "SendGrid API key used by legacy or alternate outbound email delivery paths.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "SG.validation-key",
    bootstrapValue: ""
  },
  {
    key: "mailgun_api_key",
    label: "Mailgun API Key",
    description: "Mailgun API key used by legacy or alternate outbound email delivery paths.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "mailgun-validation-key",
    bootstrapValue: ""
  },
  {
    key: "mailjet_api_key",
    label: "Mailjet API Key",
    description: "Mailjet API key used for newsletter opt-in integrations.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "mailjet-validation-key",
    bootstrapValue: ""
  },
  {
    key: "mailjet_api_secret",
    label: "Mailjet API Secret",
    description: "Mailjet API secret used for newsletter opt-in integrations.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "mailjet-validation-secret",
    bootstrapValue: ""
  },
  {
    key: "mailjet_newsletter_list_id",
    label: "Mailjet Newsletter List ID",
    description: "Mailjet contacts list ID used when syncing newsletter signups.",
    category: "communications",
    type: "number",
    secret: false,
    syntheticValue: "12345",
    bootstrapValue: "0"
  },
  {
    key: "imap_enabled",
    label: "IMAP Enabled",
    description: "Enables inbound mailbox processing for matched client email.",
    category: "communications",
    type: "boolean",
    secret: false,
    syntheticValue: "1",
    bootstrapValue: "0"
  },
  {
    key: "imap_host",
    label: "IMAP Host",
    description: "Inbound IMAP hostname used for email ingestion.",
    category: "communications",
    type: "text",
    secret: false,
    syntheticValue: "imap.validation.local",
    bootstrapValue: ""
  },
  {
    key: "imap_port",
    label: "IMAP Port",
    description: "IMAP server port used for mailbox synchronization.",
    category: "communications",
    type: "number",
    secret: false,
    syntheticValue: "993",
    bootstrapValue: "993"
  },
  {
    key: "imap_encryption",
    label: "IMAP Encryption",
    description: "Encryption mode used for IMAP connections.",
    category: "communications",
    type: "select",
    secret: false,
    syntheticValue: "ssl",
    bootstrapValue: "ssl"
  },
  {
    key: "imap_username",
    label: "IMAP Username",
    description: "IMAP authentication username, usually the mailbox email address.",
    category: "communications",
    type: "text",
    secret: false,
    syntheticValue: "inbox@example.com",
    bootstrapValue: ""
  },
  {
    key: "imap_password",
    label: "IMAP Password",
    description: "IMAP authentication password used for mailbox ingestion.",
    category: "communications",
    type: "password",
    secret: true,
    syntheticValue: "imap-validation-password",
    bootstrapValue: ""
  },
  {
    key: "imap_folder",
    label: "IMAP Folder",
    description: "Mailbox folder or label used for inbound email synchronization.",
    category: "communications",
    type: "text",
    secret: false,
    syntheticValue: "INBOX",
    bootstrapValue: "INBOX"
  },
  {
    key: "imap_sync_days",
    label: "IMAP Sync Days",
    description: "Number of historical days the inbound mailbox job should sync.",
    category: "communications",
    type: "number",
    secret: false,
    syntheticValue: "30",
    bootstrapValue: "30"
  },
  {
    key: "google_calendar_enabled",
    label: "Google Calendar Sync Enabled",
    description: "Enables Google Calendar synchronization using the service-account integration path.",
    category: "calendar",
    type: "checkbox",
    secret: false,
    syntheticValue: "1",
    bootstrapValue: "0"
  },
  {
    key: "google_calendar_id",
    label: "Google Calendar ID",
    description: "Calendar ID used by the service-account synchronization path.",
    category: "calendar",
    type: "text",
    secret: false,
    syntheticValue: "primary",
    bootstrapValue: "primary"
  },
  {
    key: "google_calendar_credentials_file",
    label: "Google Calendar Credentials File",
    description: "Filesystem path to the Google service-account JSON credentials used by legacy calendar sync.",
    category: "calendar",
    type: "text",
    secret: false,
    syntheticValue: "/secure/google-calendar-credentials.json",
    bootstrapValue: ""
  },
  {
    key: "google_oauth_client_id",
    label: "Google OAuth Client ID",
    description: "Google OAuth client ID for calendar authorization.",
    category: "calendar",
    type: "text",
    secret: false,
    syntheticValue: "google-validation-client-id",
    bootstrapValue: ""
  },
  {
    key: "google_oauth_client_secret",
    label: "Google OAuth Client Secret",
    description: "Google OAuth client secret for calendar authorization.",
    category: "calendar",
    type: "password",
    secret: true,
    syntheticValue: "google-validation-client-secret",
    bootstrapValue: ""
  },
  {
    key: "google_oauth_redirect_uri",
    label: "Google OAuth Redirect URI",
    description: "OAuth callback URL used when admins authorize Google Calendar access.",
    category: "calendar",
    type: "url",
    secret: false,
    syntheticValue: "https://validation.brook.example/backend/public/google_oauth_callback.php",
    bootstrapValue: ""
  },
  ...publicNoticeManagedSettingsDefinitions,
  ...socialManagedSettingsDefinitions,
  ...customSocialLinkManagedSettingsDefinitions,
  {
    key: "moxie_base_url",
    label: "Moxie Base URL",
    description: "Workspace base URL used by the Moxie public API client import tool.",
    category: "advanced",
    type: "url",
    secret: false,
    syntheticValue: "https://pod00.withmoxie.dev",
    bootstrapValue: ""
  },
  {
    key: "moxie_api_key",
    label: "Moxie API Key",
    description: "API key for importing clients from Moxie.",
    category: "advanced",
    type: "password",
    secret: true,
    syntheticValue: "moxie-validation-key",
    bootstrapValue: ""
  },
  {
    key: "tawk_to_enabled",
    label: "Tawk.to Enabled",
    description: "Loads the Tawk.to chat widget on public-facing pages and the client portal.",
    category: "advanced",
    type: "checkbox",
    secret: false,
    syntheticValue: "0",
    bootstrapValue: "0"
  },
  {
    key: "tawk_to_property_id",
    label: "Tawk.to Property ID",
    description: "Tawk.to property ID from the embed snippet.",
    category: "advanced",
    type: "text",
    secret: false,
    syntheticValue: "0123456789abcdef01234567",
    bootstrapValue: ""
  },
  {
    key: "tawk_to_widget_id",
    label: "Tawk.to Widget ID",
    description: "Optional Tawk.to widget ID from the embed snippet.",
    category: "advanced",
    type: "text",
    secret: false,
    syntheticValue: "default",
    bootstrapValue: "default"
  },
  {
    key: "newsletter_embed_html",
    label: "Newsletter Embed HTML",
    description: "Trusted newsletter signup embed code rendered on public site pages.",
    category: "advanced",
    type: "textarea",
    secret: false,
    syntheticValue: "<form><input type=\"email\" name=\"email\"></form>",
    bootstrapValue: ""
  }
];

export const managedSettingsCatalog = new Map<string, ManagedSettingDefinition>(
  managedSettingsDefinitions.map((definition) => [definition.key, definition])
);

const requiredLaunchSettingKeys = new Set<string>([
  "base_url",
  "stripe_enabled",
  "stripe_mode",
  "stripe_live_secret_key",
  "stripe_test_secret_key",
  "stripe_webhook_secret",
  "turnstile_site_key",
  "turnstile_secret_key",
  "imap_enabled",
  "imap_host",
  "smtp_host",
  "google_oauth_client_id",
  "google_oauth_client_secret"
]);

export const requiredLaunchSettingsCatalog = new Map<string, RequiredLaunchSettingDefinition>(
  managedSettingsDefinitions
    .filter((definition) => requiredLaunchSettingKeys.has(definition.key))
    .map((definition) => [definition.key, definition])
);

function createSettingsFromCatalog(
  catalog: Map<string, ManagedSettingDefinition>,
  updatedAt: string,
  mode: RequiredLaunchSettingCatalogMode
): Setting[] {
  return [...catalog.values()].map((definition, index) => ({
    id: `launch-setting-${index + 1}`,
    key: definition.key,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    type: definition.type,
    value: mode === "bootstrap" ? definition.bootstrapValue : definition.syntheticValue,
    secret: definition.secret,
    updatedAt
  }));
}

export function createManagedSettingsCatalog(
  updatedAt: string,
  mode: RequiredLaunchSettingCatalogMode = "synthetic"
): Setting[] {
  return createSettingsFromCatalog(managedSettingsCatalog, updatedAt, mode);
}

export function createRequiredLaunchSettingsCatalog(
  updatedAt: string,
  mode: RequiredLaunchSettingCatalogMode = "synthetic"
): Setting[] {
  return createSettingsFromCatalog(requiredLaunchSettingsCatalog, updatedAt, mode);
}
