import { once } from "node:events";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { buildMigrationRuntime } from "../../migrate/src/bootstrap.js";
import { readMigrationConfig } from "../../migrate/src/config.js";
import { createHttpApiServer } from "../../api/src/server.js";
import { createUnifiedPlatformServer } from "../../platform/src/server.js";
import { createHttpWebServer } from "../../web/src/server.js";
import {
  buildLatestReleaseManifest,
  resolveReleaseArtifactRoot
} from "./artifacts.js";
import {
  analyzeLegacyPhpFailure,
  reconcileLegacyBehaviorFailures,
  summarizeLegacyPhpResults,
  type LegacyPhpFailureAnalysis,
  type LegacyPhpFailureSummary,
  type LegacyBehaviorReconciliation
} from "./legacy-php-analysis.js";
import {
  buildRepositoryReadinessAssessment,
  type RepositoryReadinessAssessment
} from "./repository-readiness.js";
import {
  buildReleaseReadinessAssessment,
  type ReleaseReadinessAssessment
} from "./release-readiness.js";
import {
  buildSettingsCatalogAssessment,
  type SettingsCatalogAssessment
} from "./settings-catalog.js";
import {
  createReleaseValidationState,
  releaseValidationAdminCredentials,
  releaseValidationNow,
  releaseValidationPortalCredentials
} from "./fixtures.js";
import { resolveLaunchReadinessEnvironment } from "./production-env.js";
import {
  releaseValidationApiSmokeRoutes,
  releaseValidationPageRoutes,
  type ReleaseValidationPageRoute
} from "./route-manifest.js";
import {
  createInMemoryApiDependencies,
  createInMemorySessionStore,
  type SqlExecutor
} from "@bdta/infrastructure";
import {
  defaultLaunchPreflightRuntimeTables,
  defaultLegacyMappings,
  defaultTokenizedPublicLinkMappings
} from "@bdta/application";

type CommandResult = {
  name: string;
  command: string;
  args: string[];
  exitCode: number | null;
  durationMs: number;
  passed: boolean;
  stdoutPath: string;
  stderrPath: string;
};

type LegacyPhpTestResult = {
  file: string;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  failureAnalysis: LegacyPhpFailureAnalysis | null;
};

type ReleaseValidationOptions = {
  externalVerificationDir?: string | null;
};

type PageCaptureResult = {
  name: string;
  role: ReleaseValidationPageRoute["role"];
  viewport: "desktop" | "mobile";
  path: string;
  finalUrl: string | null;
  title: string;
  status: number | null;
  screenshotPath: string;
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
};

type ApiSmokeResult = {
  name: string;
  path: string;
  status: number;
  contentType: string;
  passed: boolean;
};

type DatabaseParityAudit = {
  table: string;
  critical: boolean;
  referencedByAdapter: boolean;
  coveredByMigrationAudit: boolean;
  coveredByLaunchPreflight: boolean;
};

type FeatureParityAudit = {
  category: string;
  description: string;
  legacyTests: string[];
  legacyPassCount: number;
  requiredPages: string[];
  capturedPages: string[];
  requiredTables: string[];
  coveredTables: string[];
  passed: boolean;
};

type ReleaseValidationReport = {
  generatedAt: string;
  repoRoot: string;
  artifactRoot: string;
  verification: CommandResult[];
  legacyPhpTests: LegacyPhpFailureSummary & {
    results: LegacyPhpTestResult[];
  };
  legacyBehaviorReconciliation: LegacyBehaviorReconciliation;
  screenshots: {
    mode: "playwright" | "http-fallback";
    total: number;
    successful: number;
    failures: number;
    browserAcquisitionFailures: string[];
    results: PageCaptureResult[];
  };
  apiSmoke: {
    total: number;
    passed: number;
    failed: number;
    results: ApiSmokeResult[];
  };
  databaseParity: DatabaseParityAudit[];
  featureParity: FeatureParityAudit[];
  settingsCatalog: SettingsCatalogAssessment;
  repositoryReadiness: RepositoryReadinessAssessment;
  launchReadiness: Awaited<ReturnType<typeof buildMigrationRuntime>>["report"];
  releaseReadiness: ReleaseReadinessAssessment;
  summary: {
    typecheckPassed: boolean;
    testsPassed: boolean;
    buildPassed: boolean;
    productionDependencyAuditPassed: boolean;
    legacyPhpPassed: boolean;
    legacyPhpBehaviorPassed: boolean;
    legacyPhpBehaviorReconciled: boolean;
    screenshotsPassed: boolean;
    apiSmokePassed: boolean;
    databaseParityPassed: boolean;
    featureParityPassed: boolean;
    settingsCatalogPassed: boolean;
    repositoryReadinessPassed: boolean;
    validationReadinessPassed: boolean;
    liveLaunchReadinessEvaluated: boolean;
    liveLaunchReadinessPassed: boolean;
    readyForLaunch: boolean;
  };
};

function writeAndExit(stream: NodeJS.WriteStream, text: string, exitCode: number): void {
  stream.write(text);
  process.exit(exitCode);
}

type PlaywrightBrowser = {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    userAgent?: string;
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
};

type PlaywrightBrowserContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightPage = {
  on(event: "console", handler: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "requestfailed", handler: (request: { method(): string; url(): string; failure(): { errorText?: string } | null }) => void): void;
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<{ status(): number } | null>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  waitForURL(url: string | RegExp): Promise<void>;
  waitForTimeout(timeout: number): Promise<void>;
  title(): Promise<string>;
  screenshot(options: { path: string; fullPage: boolean; type: "jpeg"; quality: number }): Promise<void>;
  close(): Promise<void>;
};

type PlaywrightLaunchOptions = {
  headless: boolean;
  executablePath?: string;
};

type PlaywrightLaunchCandidate = {
  label: string;
  options: PlaywrightLaunchOptions;
};

type PlaywrightConnectionCandidate = {
  label: string;
  mode: "ws" | "cdp";
  endpoint: string;
};

type PlaywrightBrowserAcquisitionOptions = {
  processEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathExists?: (filePath: string) => boolean;
};

type PlaywrightModule = {
  chromium: {
    launch(options: PlaywrightLaunchOptions): Promise<PlaywrightBrowser>;
    connect?(wsEndpoint: string): Promise<PlaywrightBrowser>;
    connectOverCDP?(endpointURL: string): Promise<PlaywrightBrowser>;
  };
};

const httpFallbackPageVerificationNote = "Browser screenshot unavailable; verified via HTTP response only.";

export const releaseCategories = [
  {
    category: "public-site-booking",
    description: "Public pages, navigation, and booking entry flow.",
    legacyPatterns: [
      "test_public_navigation.php",
      "test_public_services_frontend.php",
      "test_public_homepage_mobile_css.php",
      "test_public_contact_form.php",
      "test_public_booking_confirmation_requirements.php",
      "test_public_booking_direct_link_price.php"
    ],
    requiredPages: [
      "public-home",
      "public-services",
      "public-directory",
      "public-blog-index",
      "public-blog-post",
      "public-book",
      "public-book-legacy",
      "public-package-detail-legacy",
      "public-book-confirmation"
    ],
    requiredTables: [
      "site_pages",
      "blog_posts",
      "clients",
      "bookings",
      "pets"
    ]
  },
  {
    category: "portal-self-service",
    description: "Portal login, profile, contacts, pets, packages, credits, and achievements.",
    legacyPatterns: [
      "test_portal_booking_flow_regression.php",
      "test_portal_forms_visibility.php",
      "test_portal_packages_visibility.php",
      "test_portal_credit_booking.php",
      "test_pet_profile_view.php",
      "test_achievements_feature.php"
    ],
    requiredPages: [
      "portal-login",
      "portal-home",
      "portal-appointments",
      "portal-booking-detail",
      "portal-profile",
      "portal-contacts",
      "portal-contact-detail",
      "portal-pets",
      "portal-pet-detail",
      "portal-pet-files",
      "portal-packages",
      "portal-package-detail",
      "portal-credits",
      "portal-credit-detail",
        "portal-achievements",
        "portal-achievement-detail",
        "portal-achievement-certificate",
        "portal-notifications"
      ],
      requiredTables: [
        "clients",
        "client_contacts",
        "pets",
      "pet_files",
      "packages",
        "client_packages",
        "client_package_credits",
        "achievement_types",
        "client_achievements",
        "notifications"
      ]
  },
  {
    category: "documents-commerce",
    description: "Invoices, quotes, contracts, forms, and public-access tokens.",
    legacyPatterns: [
      "test_invoice_pay_return.php",
      "test_invoice_payment_progress.php",
      "test_invoice_reminder.php",
      "test_contract_delivery_regression.php",
      "test_form_link_requests.php",
      "test_public_access_links.php",
      "test_public_access_token_schema.php"
    ],
    requiredPages: [
      "portal-invoices",
      "portal-invoice-detail",
      "portal-quotes",
      "portal-quote-detail",
      "portal-contracts",
      "portal-contract-detail",
      "portal-forms",
      "portal-form-detail",
      "admin-invoices",
      "admin-invoice-detail",
      "admin-invoices-legacy",
      "admin-quotes",
      "admin-quote-detail",
      "admin-contracts",
      "admin-contract-detail",
      "admin-forms",
      "admin-form-detail",
      "admin-form-submissions-legacy",
      "admin-form-submission-legacy-detail",
      "admin-form-request-create-legacy",
      "admin-form-template-survey-results",
      "admin-form-template-survey-results-legacy"
    ],
    requiredTables: [
      "invoices",
      "quotes",
      "contracts",
      "form_submissions"
    ]
  },
  {
    category: "admin-crm-content-ops",
    description: "Admin dashboard, CRM lists, content management, settings, and operational logs.",
    legacyPatterns: [
      "test_admin_dashboard_enhancements.php",
      "test_admin_route_guards.php",
      "test_blog_content_helper.php",
      "test_blog_cover_photo_helper.php",
      "test_sitebuilder_manual_pages.php",
      "test_notifications_helper.php",
      "test_imap_receiver.php"
    ],
    requiredPages: [
      "admin-login",
      "admin-dashboard",
      "admin-dashboard-legacy",
      "admin-clients",
      "admin-client-profile",
      "admin-client-contacts",
      "admin-client-contact-detail",
      "admin-client-achievements",
      "admin-client-achievement-detail",
      "admin-client-achievement-certificate",
      "admin-bookings",
      "admin-booking-detail",
      "admin-pets",
      "admin-pet-detail",
      "admin-pet-files",
      "admin-packages",
      "admin-package-detail",
      "admin-credits",
      "admin-credit-detail",
      "admin-achievement-types",
      "admin-achievement-type-detail",
      "admin-workflows",
      "admin-workflow-detail",
      "admin-workflow-enrollments",
      "admin-workflow-enroll",
      "admin-workflow-steps",
      "admin-workflow-step-new",
      "admin-workflow-step-detail",
      "admin-blog-posts",
      "admin-blog-post-detail",
      "admin-site-pages",
      "admin-site-page-detail",
      "admin-site-page-editor",
      "admin-settings",
      "admin-setting-detail",
      "admin-appointment-types",
      "admin-appointment-type-detail",
      "admin-form-templates",
      "admin-form-template-detail",
      "admin-email-templates",
      "admin-email-template-detail",
      "admin-scheduled-tasks",
      "admin-scheduled-task-detail",
      "admin-job-logs",
      "admin-job-log-detail",
      "admin-callback-logs",
      "admin-callback-log-detail"
    ],
    requiredTables: [
      "admin_users",
      "clients",
      "bookings",
      "pets",
      "pet_files",
      "appointment_types",
      "blog_posts",
      "site_pages",
      "settings",
      "email_templates",
      "workflows",
      "workflow_triggers",
      "workflow_enrollments",
      "workflow_steps",
      "workflow_step_executions",
      "scheduled_tasks",
      "job_queue",
      "integration_callbacks"
    ]
  }
] as const;

function getRefactorRoot(): string {
  const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.basename(candidate).toLowerCase() === "dist"
    ? path.dirname(candidate)
    : candidate;
}

function getWorkspaceRoot(refactorRoot: string): string {
  return path.resolve(refactorRoot, "..");
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function ensureCleanDirectory(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

function resolveNpmCliPath(): string {
  const candidates = [
    path.resolve(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(process.execPath, "..", "..", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved == null) {
    throw new Error("Could not resolve npm-cli.js for release validation command execution.");
  }

  return resolved;
}

async function runCommand(args: string[], options: {
  cwd: string;
  name: string;
  logDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutPath = path.join(options.logDir, `${sanitizeFileName(options.name)}.stdout.log`);
  const stderrPath = path.join(options.logDir, `${sanitizeFileName(options.name)}.stderr.log`);
  const startedAt = Date.now();
  const npmCliPath = resolveNpmCliPath();
  const commandLine = [process.execPath, npmCliPath, ...args].join(" ");

  const child = spawn(process.execPath, [npmCliPath, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  await mkdir(options.logDir, { recursive: true });
  await writeFile(stdoutPath, stdoutChunks.join(""), "utf8");
  await writeFile(stderrPath, stderrChunks.join(""), "utf8");

  return {
    name: options.name,
    command: commandLine,
    args,
    exitCode,
    durationMs: Date.now() - startedAt,
    passed: exitCode === 0,
    stdoutPath,
    stderrPath
  };
}

async function loadExternalVerificationResult(input: {
  name: string;
  command: string;
  args: string[];
  baseDir: string;
  logDir: string;
}): Promise<CommandResult> {
  const stdoutSourcePath = path.join(input.baseDir, `${sanitizeFileName(input.name)}.stdout.log`);
  const stderrSourcePath = path.join(input.baseDir, `${sanitizeFileName(input.name)}.stderr.log`);
  const exitCodePath = path.join(input.baseDir, `${sanitizeFileName(input.name)}.exitcode`);
  const stdoutPath = path.join(input.logDir, `${sanitizeFileName(input.name)}.stdout.log`);
  const stderrPath = path.join(input.logDir, `${sanitizeFileName(input.name)}.stderr.log`);

  if (!existsSync(stdoutSourcePath) || !existsSync(stderrSourcePath) || !existsSync(exitCodePath)) {
    throw new Error(`Missing external verification artifacts for ${input.name}.`);
  }

  await mkdir(input.logDir, { recursive: true });
  if (path.resolve(stdoutSourcePath) !== path.resolve(stdoutPath)) {
    await copyFile(stdoutSourcePath, stdoutPath);
  }
  if (path.resolve(stderrSourcePath) !== path.resolve(stderrPath)) {
    await copyFile(stderrSourcePath, stderrPath);
  }

  const exitCodeText = (await readFile(exitCodePath, "utf8")).trim();
  const parsedExitCode = Number.parseInt(exitCodeText, 10);
  if (!Number.isInteger(parsedExitCode) || parsedExitCode < 0) {
    throw new Error(`Invalid external verification exit code for ${input.name}.`);
  }

  return {
    name: input.name,
    command: input.command,
    args: input.args,
    exitCode: parsedExitCode,
    durationMs: 0,
    passed: parsedExitCode === 0,
    stdoutPath,
    stderrPath
  };
}

async function runLegacyPhpTest(filePath: string): Promise<LegacyPhpTestResult> {
  const startedAt = Date.now();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const child = spawn("php", [filePath], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  return {
    file: path.basename(filePath),
    passed: exitCode === 0,
    exitCode,
    durationMs: Date.now() - startedAt,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    failureAnalysis: analyzeLegacyPhpFailure({
      passed: exitCode === 0,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join("")
    })
  };
}

async function runLegacyPhpSuite(legacyTestsDir: string): Promise<ReleaseValidationReport["legacyPhpTests"]> {
  const files = (await readdir(legacyTestsDir))
    .filter((entry) => /^test_.*\.php$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));

  const results: LegacyPhpTestResult[] = [];
  for (const file of files) {
    results.push(await runLegacyPhpTest(path.join(legacyTestsDir, file)));
  }

  const summary = summarizeLegacyPhpResults(results);
  return {
    ...summary,
    results
  };
}

async function loadExternalLegacyPhpSuite(resultsPath: string): Promise<ReleaseValidationReport["legacyPhpTests"]> {
  if (!existsSync(resultsPath)) {
    throw new Error(`Missing external legacy PHP results at ${resultsPath}.`);
  }

  const parsed = JSON.parse(await readFile(resultsPath, "utf8")) as Array<{
    file?: unknown;
    exitCode?: unknown;
    durationMs?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  }>;

  const results: LegacyPhpTestResult[] = parsed.map((item) => {
    const file = typeof item.file === "string" ? item.file : "";
    const exitCode = typeof item.exitCode === "number"
      ? item.exitCode
      : item.exitCode === null
        ? null
        : Number.parseInt(String(item.exitCode ?? ""), 10);
    const durationMs = typeof item.durationMs === "number"
      ? item.durationMs
      : Number.parseInt(String(item.durationMs ?? "0"), 10);
    const stdout = typeof item.stdout === "string" ? item.stdout : "";
    const stderr = typeof item.stderr === "string" ? item.stderr : "";
    const passed = exitCode === 0;

    return {
      file,
      passed,
      exitCode: Number.isInteger(exitCode) || exitCode === null ? exitCode : null,
      durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
      stdout,
      stderr,
      failureAnalysis: analyzeLegacyPhpFailure({
        passed,
        stdout,
        stderr
      })
    };
  });

  const summary = summarizeLegacyPhpResults(results);
  return {
    ...summary,
    results
  };
}

async function resolvePlaywrightModule(): Promise<PlaywrightModule> {
  const envPath = process.env.PLAYWRIGHT_MODULE_PATH?.trim();
  const candidates = [
    envPath ? pathToFileURL(envPath).href : null,
    "playwright"
  ].filter((candidate): candidate is string => candidate != null && candidate !== "");

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return await import(candidate) as PlaywrightModule;
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Unable to load Playwright. Tried: ${failures.join(" | ")}`);
}

export function resolvePlaywrightConnectionCandidates(
  input: PlaywrightBrowserAcquisitionOptions = {}
): PlaywrightConnectionCandidate[] {
  const processEnv = input.processEnv ?? process.env;

  return [
    {
      label: "PLAYWRIGHT_WS_ENDPOINT",
      mode: "ws" as const,
      endpoint: processEnv.PLAYWRIGHT_WS_ENDPOINT?.trim() ?? ""
    },
    {
      label: "PLAYWRIGHT_CDP_URL",
      mode: "cdp" as const,
      endpoint: processEnv.PLAYWRIGHT_CDP_URL?.trim() ?? ""
    },
    {
      label: "CHROME_REMOTE_DEBUGGING_URL",
      mode: "cdp" as const,
      endpoint: processEnv.CHROME_REMOTE_DEBUGGING_URL?.trim() ?? ""
    }
  ].filter((candidate) => candidate.endpoint !== "");
}

export function resolvePlaywrightLaunchCandidates(
  input: PlaywrightBrowserAcquisitionOptions = {}
): PlaywrightLaunchCandidate[] {
  const processEnv = input.processEnv ?? process.env;
  const platform = input.platform ?? process.platform;
  const pathExists = input.pathExists ?? existsSync;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const candidates: PlaywrightLaunchCandidate[] = [];
  const seenExecutablePaths = new Set<string>();

  function appendExecutableCandidate(
    label: string,
    executablePath: string | null | undefined,
    options: { requireExisting: boolean }
  ): void {
    const trimmed = executablePath?.trim();
    if (trimmed == null || trimmed === "") {
      return;
    }

    const normalizedPath = pathApi.normalize(trimmed);
    const dedupeKey = platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
    if (seenExecutablePaths.has(dedupeKey)) {
      return;
    }

    if (options.requireExisting && !pathExists(normalizedPath)) {
      return;
    }

    seenExecutablePaths.add(dedupeKey);
    candidates.push({
      label,
      options: {
        headless: true,
        executablePath: normalizedPath
      }
    });
  }

  appendExecutableCandidate(
    "PLAYWRIGHT_EXECUTABLE_PATH",
    processEnv.PLAYWRIGHT_EXECUTABLE_PATH,
    { requireExisting: false }
  );

  if (platform === "win32") {
    const programFileRoots = [
      processEnv.PROGRAMFILES,
      processEnv["PROGRAMFILES(X86)"],
      "C:\\Program Files",
      "C:\\Program Files (x86)"
    ];
    for (const root of programFileRoots) {
      appendExecutableCandidate(
        "Google Chrome",
        root == null ? null : path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        { requireExisting: true }
      );
      appendExecutableCandidate(
        "Microsoft Edge",
        root == null ? null : path.win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        { requireExisting: true }
      );
    }

    const localAppData = processEnv.LOCALAPPDATA?.trim();
    if (localAppData != null && localAppData !== "") {
      appendExecutableCandidate(
        "Google Chrome (Local AppData)",
        path.win32.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        { requireExisting: true }
      );
      appendExecutableCandidate(
        "Microsoft Edge (Local AppData)",
        path.win32.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
        { requireExisting: true }
      );
    }
  } else if (platform === "darwin") {
    const macApplicationRoots = [
      "/Applications",
      processEnv.HOME == null ? null : path.posix.join(processEnv.HOME, "Applications")
    ];
    for (const root of macApplicationRoots) {
      appendExecutableCandidate(
        "Google Chrome",
        root == null ? null : path.posix.join(root, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
        { requireExisting: true }
      );
      appendExecutableCandidate(
        "Microsoft Edge",
        root == null ? null : path.posix.join(root, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
        { requireExisting: true }
      );
      appendExecutableCandidate(
        "Chromium",
        root == null ? null : path.posix.join(root, "Chromium.app", "Contents", "MacOS", "Chromium"),
        { requireExisting: true }
      );
    }
  } else {
    const linuxExecutables = [
      ["Google Chrome", "/usr/bin/google-chrome"],
      ["Google Chrome Stable", "/usr/bin/google-chrome-stable"],
      ["Chrome", "/opt/google/chrome/chrome"],
      ["Chromium Browser", "/usr/bin/chromium-browser"],
      ["Chromium", "/usr/bin/chromium"],
      ["Chromium (snap)", "/snap/bin/chromium"],
      ["Microsoft Edge", "/usr/bin/microsoft-edge"],
      ["Microsoft Edge Stable", "/usr/bin/microsoft-edge-stable"]
    ] as const;

    for (const [label, executablePath] of linuxExecutables) {
      appendExecutableCandidate(label, executablePath, { requireExisting: true });
    }
  }

  candidates.push({
    label: "Playwright bundled Chromium",
    options: {
      headless: true
    }
  });

  return candidates;
}

export async function launchPlaywrightBrowser(
  playwright: PlaywrightModule,
  input: PlaywrightBrowserAcquisitionOptions = {}
): Promise<PlaywrightBrowser> {
  const failures: string[] = [];

  for (const candidate of resolvePlaywrightConnectionCandidates(input)) {
    try {
      if (candidate.mode === "ws") {
        if (typeof playwright.chromium.connect !== "function") {
          throw new Error("Playwright chromium.connect is unavailable in this runtime.");
        }

        return await playwright.chromium.connect(candidate.endpoint);
      }

      if (typeof playwright.chromium.connectOverCDP !== "function") {
        throw new Error("Playwright chromium.connectOverCDP is unavailable in this runtime.");
      }

      return await playwright.chromium.connectOverCDP(candidate.endpoint);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.label} (${candidate.endpoint}): ${detail}`);
    }
  }

  for (const candidate of resolvePlaywrightLaunchCandidates(input)) {
    try {
      return await playwright.chromium.launch(candidate.options);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(candidate.options.executablePath == null
        ? `${candidate.label}: ${detail}`
        : `${candidate.label} (${candidate.options.executablePath}): ${detail}`);
    }
  }

  throw new Error(`Unable to acquire Playwright browser. Tried: ${failures.join(" | ")}`);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error == null ? resolve() : reject(error));
  });
}

async function startServer(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Expected TCP server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function loginPortal(context: PlaywrightBrowserContext, baseUrl: string): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/portal/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', releaseValidationPortalCredentials.email);
    await page.fill('input[name="password"]', releaseValidationPortalCredentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/portal$/);
  } finally {
    await page.close();
  }
}

async function loginAdmin(context: PlaywrightBrowserContext, baseUrl: string): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/admin/login`, { waitUntil: "networkidle" });
    await page.fill('input[name="username"]', releaseValidationAdminCredentials.username);
    await page.fill('input[name="password"]', releaseValidationAdminCredentials.password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(admin|client\/index\.php)$/);
  } finally {
    await page.close();
  }
}

async function capturePage(
  page: PlaywrightPage,
  baseUrl: string,
  route: ReleaseValidationPageRoute,
  viewport: "desktop" | "mobile",
  screenshotRoot: string
): Promise<PageCaptureResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    requestFailures.push(`${request.method()} ${request.url()} :: ${failure?.errorText ?? "request failed"}`);
  });

  const response = await page.goto(`${baseUrl}${route.path}`, {
    waitUntil: "networkidle"
  });
  await page.waitForTimeout(150);

  const screenshotPath = path.join(
    screenshotRoot,
    viewport,
    `${sanitizeFileName(route.name)}.jpg`
  );
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    type: "jpeg",
    quality: 80
  });

  return {
    name: route.name,
    role: route.role,
    viewport,
    path: route.path,
    finalUrl: response == null ? null : `${baseUrl}${route.path}`,
    title: await page.title(),
    status: response?.status() ?? null,
    screenshotPath,
    consoleErrors,
    pageErrors,
    requestFailures
  };
}

function extractHtmlTitle(markup: string): string {
  const match = /<title>([^<]*)<\/title>/i.exec(markup);
  return match == null ? "" : match[1].trim();
}

function isHttpFallbackPageError(message: string): boolean {
  return message === httpFallbackPageVerificationNote;
}

function isVisualScreenshotClean(result: PageCaptureResult): boolean {
  return result.status === 200
    && result.consoleErrors.length === 0
    && result.pageErrors.length === 0
    && result.requestFailures.length === 0;
}

function isPageVerificationSuccessful(result: PageCaptureResult): boolean {
  return isVisualScreenshotClean(result)
    || (
      result.status === 200
      && result.consoleErrors.length === 0
      && result.requestFailures.length === 0
      && result.pageErrors.every((message) => isHttpFallbackPageError(message))
    );
}

async function probePagesWithoutBrowser(
  platformServer: Server,
  screenshotRoot: string,
  browserAcquisitionFailures: string[] = []
): Promise<ReleaseValidationReport["screenshots"]> {
  await mkdir(path.join(screenshotRoot, "desktop"), { recursive: true });
  await mkdir(path.join(screenshotRoot, "mobile"), { recursive: true });

  async function loginPageRole(baseUrl: string, role: "portal" | "admin"): Promise<string> {
    const response = await fetch(`${baseUrl}${role === "portal" ? "/api/portal/login" : "/api/admin/login"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(role === "portal"
        ? {
            email: releaseValidationPortalCredentials.email,
            password: releaseValidationPortalCredentials.password
          }
        : {
            username: releaseValidationAdminCredentials.username,
            password: releaseValidationAdminCredentials.password
          })
    });

    const setCookie = response.headers.get("set-cookie");
    if (response.status !== 200 || setCookie == null || setCookie.trim() === "") {
      throw new Error(`Failed to establish ${role} session for HTTP page verification fallback.`);
    }

    return setCookie;
  }

  const results: PageCaptureResult[] = [];

  try {
    const baseUrl = await startServer(platformServer);
    const portalCookie = await loginPageRole(baseUrl, "portal");
    const adminCookie = await loginPageRole(baseUrl, "admin");

    for (const viewportSpec of [
      {
        name: "desktop" as const,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
      },
      {
        name: "mobile" as const,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
      }
    ]) {
      for (const route of releaseValidationPageRoutes) {
        const htmlPath = path.join(
          screenshotRoot,
          viewportSpec.name,
          `${sanitizeFileName(route.name)}.html`
        );

        try {
          const response = await fetch(`${baseUrl}${route.path}`, {
            headers: {
              "user-agent": viewportSpec.userAgent,
              ...(route.role === "portal"
                ? { cookie: portalCookie }
                : route.role === "admin"
                  ? { cookie: adminCookie }
                  : {})
            }
          });
          const html = await response.text();
          await writeFile(htmlPath, html, "utf8");
          results.push({
            name: route.name,
            role: route.role,
            viewport: viewportSpec.name,
            path: route.path,
            finalUrl: response.url || `${baseUrl}${route.path}`,
            title: extractHtmlTitle(html),
            status: response.status,
            screenshotPath: htmlPath,
            consoleErrors: [],
            pageErrors: [httpFallbackPageVerificationNote],
            requestFailures: []
          });
        } catch (error) {
          results.push({
            name: route.name,
            role: route.role,
            viewport: viewportSpec.name,
            path: route.path,
            finalUrl: null,
            title: "",
            status: null,
            screenshotPath: htmlPath,
            consoleErrors: [],
            pageErrors: [
              httpFallbackPageVerificationNote,
              `HTTP fallback failed: ${error instanceof Error ? error.message : String(error)}`
            ],
            requestFailures: []
          });
        }
      }
    }
  } finally {
    await closeServer(platformServer);
  }

  return {
    mode: "http-fallback",
    total: results.length,
    successful: 0,
    failures: results.length,
    browserAcquisitionFailures,
    results
  };
}

async function captureScreenshots(refactorRoot: string, artifactRoot: string): Promise<ReleaseValidationReport["screenshots"]> {
  const state = createReleaseValidationState();
  const dependencies = createInMemoryApiDependencies(state);
  const sessionStore = createInMemorySessionStore(state);
  const apiServer = createHttpApiServer({
    dependencies,
    sessionStore
  });
  const webServer = createHttpWebServer({
    dependencies,
    sessionStore
  });
  const platformServer = createUnifiedPlatformServer({
    apiServer,
    webServer
  });

  const screenshotRoot = path.join(artifactRoot, "screenshots");
  await mkdir(path.join(screenshotRoot, "desktop"), { recursive: true });
  await mkdir(path.join(screenshotRoot, "mobile"), { recursive: true });

  let browser: PlaywrightBrowser;
  try {
    const playwright = await resolvePlaywrightModule();
    browser = await launchPlaywrightBrowser(playwright);
  } catch (error) {
    return probePagesWithoutBrowser(
      platformServer,
      screenshotRoot,
      [error instanceof Error ? error.message : String(error)]
    );
  }

  const results: PageCaptureResult[] = [];

  try {
    const baseUrl = await startServer(platformServer);
    for (const viewportSpec of [
      {
        name: "desktop" as const,
        options: {
          viewport: { width: 1440, height: 900 }
        }
      },
      {
        name: "mobile" as const,
        options: {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        }
      }
    ]) {
      const publicContext = await browser.newContext(viewportSpec.options);
      const portalContext = await browser.newContext(viewportSpec.options);
      const adminContext = await browser.newContext(viewportSpec.options);

      try {
        await loginPortal(portalContext, baseUrl);
        await loginAdmin(adminContext, baseUrl);

        for (const route of releaseValidationPageRoutes) {
          const context = route.role === "portal"
            ? portalContext
            : route.role === "admin"
              ? adminContext
              : publicContext;
          const page = await context.newPage();
          try {
            results.push(await capturePage(page, baseUrl, route, viewportSpec.name, screenshotRoot));
          } finally {
            await page.close();
          }
        }
      } finally {
        await publicContext.close();
        await portalContext.close();
        await adminContext.close();
      }
    }
  } finally {
    await browser.close();
    await closeServer(platformServer);
  }

  const failures = results.filter((result) => (
    result.status !== 200
    || result.consoleErrors.length > 0
    || result.pageErrors.length > 0
    || result.requestFailures.length > 0
  ));

  return {
    mode: "playwright",
    total: results.length,
    successful: results.length - failures.length,
    failures: failures.length,
    browserAcquisitionFailures: [],
    results
  };
}

async function runApiSmoke(artifactRoot: string): Promise<ReleaseValidationReport["apiSmoke"]> {
  const state = createReleaseValidationState();
  const dependencies = createInMemoryApiDependencies(state);
  const sessionStore = createInMemorySessionStore(state);
  const apiServer = createHttpApiServer({
    dependencies,
    sessionStore
  });
  const webServer = createHttpWebServer({
    dependencies,
    sessionStore
  });
  const platformServer = createUnifiedPlatformServer({
    apiServer,
    webServer
  });

  const results: ApiSmokeResult[] = [];

  async function loginApiRole(
    baseUrl: string,
    role: "portal" | "admin"
  ): Promise<string> {
    const response = await fetch(`${baseUrl}${role === "portal" ? "/api/portal/login" : "/api/admin/login"}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(role === "portal"
        ? {
            email: releaseValidationPortalCredentials.email,
            password: releaseValidationPortalCredentials.password
          }
        : {
            username: releaseValidationAdminCredentials.username,
            password: releaseValidationAdminCredentials.password
          })
    });

    const setCookie = response.headers.get("set-cookie");
    if (response.status !== 200 || setCookie == null || setCookie.trim() === "") {
      throw new Error(`Failed to establish ${role} API session for release validation smoke tests.`);
    }

    return setCookie;
  }

  try {
    const baseUrl = await startServer(platformServer);
    const portalCookie = await loginApiRole(baseUrl, "portal");
    const adminCookie = await loginApiRole(baseUrl, "admin");
    for (const route of releaseValidationApiSmokeRoutes) {
      const response = await fetch(`${baseUrl}${route.path}`, {
        method: route.method ?? "GET",
        headers: route.role === "portal"
          ? { cookie: portalCookie }
          : route.role === "admin"
            ? { cookie: adminCookie }
            : route.body == null
              ? {}
              : { "content-type": "application/json" },
        body: route.body == null ? undefined : JSON.stringify(route.body)
      });
      const contentType = response.headers.get("content-type") ?? "";
      results.push({
        name: route.name,
        path: route.path,
        status: response.status,
        contentType,
        passed: response.status === route.expectedStatus && contentType.startsWith(route.expectedContentTypePrefix)
      });
    }
  } finally {
    await closeServer(platformServer);
  }

  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results
  };
}

function countFixtureRows(table: string): number {
  const state = createReleaseValidationState();
  switch (table) {
    case "clients":
      return state.portalUsers.length;
    case "pets":
      return state.pets.length;
    case "bookings":
      return state.bookings.length;
    case "invoices":
      return state.invoices.length;
    case "quotes":
      return state.quotes.length;
    case "contracts":
      return state.contracts.length;
    case "form_submissions":
      return state.formSubmissions.length;
    case "packages":
      return state.packages.length;
    case "client_package_credits":
      return state.credits.length;
    case "notifications":
      return state.notifications.length;
    case "settings":
      return state.settings.length;
    case "workflows":
      return state.workflows.length;
    case "workflow_triggers":
      return state.workflowTriggers.length;
    case "workflow_enrollments":
      return state.workflowEnrollments.length;
    case "workflow_steps":
      return state.workflowSteps.length;
    case "workflow_step_executions":
      return state.workflowStepExecutions.length;
    case "scheduled_tasks":
      return state.scheduledTasks.length;
    case "admin_users":
      return state.adminUsers.length;
    default:
      return 0;
  }
}

function countFixtureMissingTokens(table: string, tokenField: string): number {
  const state = createReleaseValidationState();
  switch (`${table}.${tokenField}`) {
    case "quotes.access_token":
      return state.quotes.filter((item) => item.publicAccess?.token == null || item.publicAccess.token.trim() === "").length;
    case "contracts.access_token":
      return state.contracts.filter((item) => item.publicAccess?.token == null || item.publicAccess.token.trim() === "").length;
    case "form_submissions.access_token":
      return state.formSubmissions.filter((item) => item.publicAccess?.token == null || item.publicAccess.token.trim() === "").length;
    case "bookings.ical_token":
      return state.bookings.filter((item) => item.icalAccess?.token == null || item.icalAccess.token.trim() === "").length;
    default:
      return 0;
  }
}

function createReleaseValidationExecutor(): SqlExecutor {
  const supportedTables = new Set<string>([
    ...defaultLegacyMappings.map((mapping) => mapping.legacyTable),
    ...defaultLaunchPreflightRuntimeTables.map((table) => table.table)
  ]);
  const state = createReleaseValidationState();

  return {
    async execute<T>(sql: string, params: unknown[] = []) {
      if (sql.startsWith("SELECT COUNT(*) AS rowCount FROM ")) {
        const missingTokenMatch = /^SELECT COUNT\(\*\) AS rowCount FROM ([a-z_]+) WHERE ([a-z_]+) IS NULL OR TRIM\(\2\) = ''$/i.exec(sql);
        if (missingTokenMatch != null) {
          return [[{ rowCount: countFixtureMissingTokens(missingTokenMatch[1], missingTokenMatch[2]) }] as T, {}];
        }

        const tableMatch = /^SELECT COUNT\(\*\) AS rowCount FROM ([a-z_]+)$/i.exec(sql);
        if (tableMatch != null) {
          return [[{ rowCount: countFixtureRows(tableMatch[1]) }] as T, {}];
        }
      }

      if (sql.includes("FROM information_schema.tables")) {
        const table = String(params[0] ?? "");
        return [supportedTables.has(table) ? [{ tableName: table }] as T : [] as T, {}];
      }

      if (sql.includes("FROM information_schema.statistics")) {
        return [[] as T, {}];
      }

      if (sql.includes("FROM settings")) {
        const settingRows = params
          .map((value) => String(value))
          .flatMap((key) => state.settings
            .filter((setting) => setting.key === key)
            .map((setting) => ({
              setting_key: setting.key,
              setting_value: setting.value
            })));
        return [settingRows as T, {}];
      }

      return [[] as T, {}];
    }
  };
}

function buildDatabaseParity(mysqlSource: string): DatabaseParityAudit[] {
  const criticalTables = [
    "clients",
    "pets",
    "pet_files",
    "client_contacts",
    "bookings",
    "invoices",
    "quotes",
    "contracts",
    "form_submissions",
    "notifications",
    "packages",
    "client_packages",
    "client_package_credits",
    "admin_users",
    "blog_posts",
    "site_pages",
    "settings",
    "appointment_types",
    "email_templates",
    "achievement_types",
    "client_achievements",
    "job_queue",
    "email_outbox",
    "integration_callbacks",
    "inbound_emails",
    "unmatched_emails",
    "calendar_sync_links",
    "workflows",
    "workflow_triggers",
    "workflow_enrollments",
    "workflow_steps",
    "workflow_step_executions",
    "scheduled_tasks",
    "app_sessions"
  ];

  const migrationTables = new Set(defaultLegacyMappings.map((mapping) => mapping.legacyTable));
  const runtimeTables = new Set(defaultLaunchPreflightRuntimeTables.map((table) => table.table));

  return criticalTables.map((table) => ({
    table,
    critical: true,
    referencedByAdapter: new RegExp(`\\b${table}\\b`, "i").test(mysqlSource),
    coveredByMigrationAudit: migrationTables.has(table),
    coveredByLaunchPreflight: runtimeTables.has(table)
  }));
}

function buildFeatureParity(
  legacyTests: ReleaseValidationReport["legacyPhpTests"]["results"],
  screenshotResults: ReleaseValidationReport["screenshots"]["results"],
  databaseParity: DatabaseParityAudit[]
): FeatureParityAudit[] {
  const capturedPages = new Set(
    screenshotResults
      .filter((result) => isPageVerificationSuccessful(result))
      .map((result) => result.name)
  );
  const coveredTables = new Set(
    databaseParity
      .filter((audit) => audit.referencedByAdapter || audit.coveredByMigrationAudit || audit.coveredByLaunchPreflight)
      .map((audit) => audit.table)
  );

  return releaseCategories.map((category) => {
    const matchedLegacyTests = legacyTests.filter((result) => (category.legacyPatterns as readonly string[]).includes(result.file));
    const captured = category.requiredPages.filter((page) => capturedPages.has(page));
    const tables = category.requiredTables.filter((table) => coveredTables.has(table));
    const passed = matchedLegacyTests.length > 0
      && captured.length === category.requiredPages.length
      && tables.length === category.requiredTables.length;

    return {
      category: category.category,
      description: category.description,
      legacyTests: matchedLegacyTests.map((result) => result.file),
      legacyPassCount: matchedLegacyTests.filter((result) => result.passed).length,
      requiredPages: [...category.requiredPages],
      capturedPages: captured,
      requiredTables: [...category.requiredTables],
      coveredTables: tables,
      passed
    };
  });
}

async function buildLaunchReadinessReport(): Promise<Awaited<ReturnType<typeof buildMigrationRuntime>>["report"]> {
  const launchEnvironment = await resolveLaunchReadinessEnvironment({
    cwd: process.cwd(),
    processEnv: process.env
  });

  const migrationConfig = (() => {
    try {
      return readMigrationConfig(launchEnvironment);
    } catch {
      return {
        databaseUrl: launchEnvironment.DATABASE_URL ?? "mysql://validation:validation@localhost:3306/bdta",
        rehearsalId: "release-validation",
        dryRun: true,
        rollbackPlanDocumented: (launchEnvironment.ROLLBACK_PLAN_DOCUMENTED ?? "").trim().toLowerCase() === "true",
        applyBootstrap: false,
        requireReady: false
      };
    }
  })();

  const runtime = await buildMigrationRuntime({
    executor: createReleaseValidationExecutor(),
    rehearsalId: migrationConfig.rehearsalId,
    dryRun: migrationConfig.dryRun,
    rollbackPlanDocumented: migrationConfig.rollbackPlanDocumented,
    applyBootstrap: false,
    requireReady: false,
    environment: launchEnvironment,
    now: () => releaseValidationNow
  });

  return runtime.report;
}

function buildMarkdownReport(report: ReleaseValidationReport): string {
  const verificationLines = report.verification
    .map((result) => `- \`${result.name}\`: ${result.passed ? "passed" : "failed"} (${result.durationMs}ms)`)
    .join("\n");
  const screenshotFailures = report.screenshots.results.filter((result) => !isVisualScreenshotClean(result));
  const screenshotFallbackUsed = report.screenshots.results.some((result) =>
    result.pageErrors.some((message) => isHttpFallbackPageError(message))
  );
  const screenshotAcquisitionFailureLines = report.screenshots.browserAcquisitionFailures.length === 0
    ? []
    : [
        "Browser acquisition failures:",
        ...report.screenshots.browserAcquisitionFailures.map((failure) => `- ${failure}`)
      ];
  const featureLines = report.featureParity
    .map((item) => `- \`${item.category}\`: ${item.passed ? "pass" : "fail"} (${item.legacyPassCount}/${item.legacyTests.length} legacy tests, ${item.capturedPages.length}/${item.requiredPages.length} pages, ${item.coveredTables.length}/${item.requiredTables.length} tables)`)
    .join("\n");
  const settingsCatalogLines = report.settingsCatalog.entries
    .map((entry) => `- \`${entry.key}\`: ${entry.issues.length === 0 ? "pass" : `fail (${entry.issues.join(" | ")})`}`)
    .join("\n");
  const validationBlockingIssues = report.releaseReadiness.validationBlockingIssues.length === 0
    ? "- None"
    : report.releaseReadiness.validationBlockingIssues.map((issue) => `- ${issue}`).join("\n");
  const validationWarnings = report.releaseReadiness.validationWarnings.length === 0
    ? "- None"
    : report.releaseReadiness.validationWarnings.map((warning) => `- ${warning}`).join("\n");
  const liveLaunchStatus = !report.releaseReadiness.liveLaunchEvaluated
    ? "n/a"
    : report.summary.liveLaunchReadinessPassed
      ? "yes"
      : "no";
  const liveLaunchBlockingIssues = !report.releaseReadiness.liveLaunchEvaluated
    ? (
      report.releaseReadiness.liveLaunchEvaluationNotes.length === 0
        ? "- Live launch was not evaluated in this environment."
        : report.releaseReadiness.liveLaunchEvaluationNotes.map((note) => `- ${note}`).join("\n")
    )
    : report.releaseReadiness.liveLaunchBlockingIssues.length === 0
      ? "- None"
      : report.releaseReadiness.liveLaunchBlockingIssues.map((issue) => `- ${issue}`).join("\n");
  const legacyCategoryLines = Object.entries(report.legacyPhpTests.categoryCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, count]) => `- \`${category}\`: ${count}`)
    .join("\n");
  const legacyReconciliationLines = report.legacyBehaviorReconciliation.items.length === 0
    ? "- No legacy PHP behavior failures required reconciliation."
    : report.legacyBehaviorReconciliation.items
      .map((item) => `- \`${item.file}\`: ${item.status} (${item.reason}${item.evidence.length === 0 ? "" : ` | evidence: ${item.evidence.join(", ")}`}${item.missingEvidence.length === 0 ? "" : ` | missing: ${item.missingEvidence.join(", ")}`})`)
      .join("\n");
  const repositoryReadinessLines = report.repositoryReadiness.audits
    .map((audit) => `- \`${audit.area}\`: ${audit.ready ? "pass" : "fail"}${audit.issues.length === 0 ? "" : ` (${audit.issues.join(" | ")})`}`)
    .join("\n");

  return [
    "# Release Validation Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Verification",
    verificationLines,
    "",
    `Legacy PHP tests: ${report.legacyPhpTests.passed}/${report.legacyPhpTests.total} passed`,
    `Legacy PHP environment-blocked failures: ${report.legacyPhpTests.environmentBlocked}`,
    `Legacy PHP behavior failures: ${report.legacyPhpTests.behaviorFailures}`,
    `Legacy PHP behavior failures reconciled by TS parity evidence: ${report.legacyBehaviorReconciliation.reconciled}/${report.legacyBehaviorReconciliation.total}`,
    `Legacy PHP unreconciled behavior gaps: ${report.legacyBehaviorReconciliation.unresolved}`,
    `Rendered screenshots: ${report.screenshots.successful}/${report.screenshots.total} clean`,
    ...(screenshotFallbackUsed
      ? ["Page-route verification fallback: browser automation unavailable, so HTML response captures were written instead of rendered screenshots."]
      : []),
    ...screenshotAcquisitionFailureLines,
    `API smoke routes: ${report.apiSmoke.passed}/${report.apiSmoke.total} passed`,
    "",
    "## Legacy PHP Baseline",
    legacyCategoryLines === "" ? "- No legacy PHP failures detected." : legacyCategoryLines,
    "",
    "## Legacy Behavior Reconciliation",
    legacyReconciliationLines,
    "",
    "## Feature Parity",
    featureLines,
    "",
    "## Settings Catalog",
    `- Admin settings page captured: ${report.settingsCatalog.adminCatalogPageCaptured ? "pass" : "fail"}`,
    `- Admin setting detail page captured: ${report.settingsCatalog.adminSettingDetailPageCaptured ? "pass" : "fail"}`,
    `- Required launch settings present: ${report.settingsCatalog.presentCount}/${report.settingsCatalog.totalRequired}`,
    settingsCatalogLines,
    "",
    "## Repository Readiness",
    repositoryReadinessLines,
    "",
    "## Validation Readiness",
    `Ready for release validation: ${report.summary.validationReadinessPassed ? "yes" : "no"}`,
    validationBlockingIssues,
    "",
    "Validation warnings:",
    validationWarnings,
    "",
    "## Production Readiness",
    `Ready for live launch: ${liveLaunchStatus}`,
    liveLaunchBlockingIssues,
    "",
    "## Screenshot Notes",
    screenshotFailures.length === 0
      ? "- No console errors, page errors, request failures, or non-200 page responses were detected."
      : screenshotFailures.map((failure) => `- ${failure.viewport} ${failure.name}: status=${failure.status ?? "n/a"}, console=${failure.consoleErrors.length}, page=${failure.pageErrors.length}, request=${failure.requestFailures.length}`).join("\n"),
    "",
    "## Artifacts",
    `- JSON report: ${path.join(report.artifactRoot, "report.json")}`,
    `- Desktop screenshots: ${path.join(report.artifactRoot, "screenshots", "desktop")}`,
    `- Mobile screenshots: ${path.join(report.artifactRoot, "screenshots", "mobile")}`,
    `- Verification logs: ${path.join(report.artifactRoot, "logs")}`
  ].join("\n");
}

export async function runReleaseValidation(options: ReleaseValidationOptions = {}): Promise<{
  report: ReleaseValidationReport;
  reportPath: string;
}> {
  const refactorRoot = getRefactorRoot();
  const workspaceRoot = getWorkspaceRoot(refactorRoot);
  const legacyTestsDir = path.join(workspaceRoot, "legacy", "tests");
  const generatedAt = new Date().toISOString();
  const artifactRoot = resolveReleaseArtifactRoot(refactorRoot, {
    now: new Date(generatedAt),
    overrideDate: process.env.RELEASE_VALIDATION_DATE
  });
  const logDir = path.join(artifactRoot, "logs");
  await ensureCleanDirectory(artifactRoot);
  await mkdir(logDir, { recursive: true });
  const externalVerificationDir = options.externalVerificationDir == null
    ? null
    : path.resolve(options.externalVerificationDir);
  const externalLegacyPhpResultsPath = externalVerificationDir == null
    ? null
    : path.join(externalVerificationDir, "legacy-php-results.json");

  const typecheckResult = externalVerificationDir == null
    ? await runCommand(["run", "typecheck"], {
      cwd: refactorRoot,
      name: "typecheck",
      logDir
    })
    : await loadExternalVerificationResult({
      name: "typecheck",
      command: "npm run typecheck",
      args: ["run", "typecheck"],
      baseDir: externalVerificationDir,
      logDir
    });
  const testResult = externalVerificationDir == null
    ? await runCommand(["test"], {
      cwd: refactorRoot,
      name: "test",
      logDir
    })
    : await loadExternalVerificationResult({
      name: "test",
      command: "npm test",
      args: ["test"],
      baseDir: externalVerificationDir,
      logDir
    });
  const buildResult = externalVerificationDir == null
    ? await runCommand(["run", "build"], {
      cwd: refactorRoot,
      name: "build",
      logDir
    })
    : await loadExternalVerificationResult({
      name: "build",
      command: "npm run build",
      args: ["run", "build"],
      baseDir: externalVerificationDir,
      logDir
    });
  const productionDependencyAuditResult = externalVerificationDir == null
    ? await runCommand(["audit", "--omit=dev", "--json"], {
      cwd: refactorRoot,
      name: "audit-production",
      logDir
    })
    : await loadExternalVerificationResult({
      name: "audit-production",
      command: "npm audit --omit=dev --json",
      args: ["audit", "--omit=dev", "--json"],
      baseDir: externalVerificationDir,
      logDir
    });

  const verification = [
    typecheckResult,
    testResult,
    buildResult,
    productionDependencyAuditResult
  ];

  const legacyPhpTests = externalLegacyPhpResultsPath == null
    ? await runLegacyPhpSuite(legacyTestsDir)
    : await loadExternalLegacyPhpSuite(externalLegacyPhpResultsPath);
  await writeFile(path.join(artifactRoot, "legacy-php-tests.json"), JSON.stringify(legacyPhpTests, null, 2), "utf8");

  const screenshots = await captureScreenshots(refactorRoot, artifactRoot);
  const apiSmoke = await runApiSmoke(artifactRoot);
  const mysqlSource = await readFile(path.join(refactorRoot, "packages", "infrastructure", "src", "mysql.ts"), "utf8");
  const databaseParity = buildDatabaseParity(mysqlSource);
  const featureParity = buildFeatureParity(legacyPhpTests.results, screenshots.results, databaseParity);
  const cleanCapturedPages = screenshots.results
    .filter((result) => isPageVerificationSuccessful(result))
    .map((result) => result.name);
  const settingsCatalog = buildSettingsCatalogAssessment({
    settings: createReleaseValidationState().settings,
    capturedPages: cleanCapturedPages
  });
  const coveredTables = databaseParity
    .filter((audit) => audit.referencedByAdapter || audit.coveredByMigrationAudit || audit.coveredByLaunchPreflight)
    .map((audit) => audit.table);
  const legacyBehaviorReconciliation = reconcileLegacyBehaviorFailures({
    results: legacyPhpTests.results,
    passedFeatureCategories: featureParity.filter((audit) => audit.passed).map((audit) => audit.category),
    cleanCapturedPages,
    coveredTables,
    mysqlSource
  });
  const repositoryReadiness = await buildRepositoryReadinessAssessment({
    refactorRoot,
    productionAuditReportJson: await readFile(productionDependencyAuditResult.stdoutPath, "utf8")
  });
  const launchReadiness = await buildLaunchReadinessReport();
  const releaseReadiness = buildReleaseReadinessAssessment({
    repositoryReadiness,
    launchReadiness,
    settingsCatalogBlockingIssues: settingsCatalog.blockingIssues
  });

  const report: ReleaseValidationReport = {
    generatedAt,
    repoRoot: refactorRoot,
    artifactRoot,
    verification,
    legacyPhpTests,
    legacyBehaviorReconciliation,
    screenshots,
    apiSmoke,
    databaseParity,
    featureParity,
    settingsCatalog,
    repositoryReadiness,
    launchReadiness,
    releaseReadiness,
    summary: {
      typecheckPassed: typecheckResult.passed,
      testsPassed: testResult.passed,
      buildPassed: buildResult.passed,
      productionDependencyAuditPassed: productionDependencyAuditResult.passed,
      legacyPhpPassed: legacyPhpTests.failed === 0,
      legacyPhpBehaviorPassed: legacyPhpTests.behaviorFailures === 0,
      legacyPhpBehaviorReconciled: legacyBehaviorReconciliation.unresolved === 0,
      screenshotsPassed: screenshots.failures === 0,
      apiSmokePassed: apiSmoke.failed === 0,
      databaseParityPassed: databaseParity.every((audit) => audit.referencedByAdapter || audit.coveredByMigrationAudit || audit.coveredByLaunchPreflight),
      featureParityPassed: featureParity.every((audit) => audit.passed),
      settingsCatalogPassed: settingsCatalog.ready,
      repositoryReadinessPassed: repositoryReadiness.blockingIssues.length === 0,
      validationReadinessPassed: releaseReadiness.readyForValidation,
      liveLaunchReadinessEvaluated: releaseReadiness.liveLaunchEvaluated,
      liveLaunchReadinessPassed: releaseReadiness.readyForLiveLaunch,
      readyForLaunch: releaseReadiness.readyForLiveLaunch
    }
  };

  await writeFile(path.join(artifactRoot, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(path.join(artifactRoot, "REPORT.md"), buildMarkdownReport(report), "utf8");
  await writeFile(
    path.join(refactorRoot, "reports", "release-validation", "latest.json"),
    JSON.stringify(buildLatestReleaseManifest({
      generatedAt,
      artifactRoot
    }), null, 2),
    "utf8"
  );

  return {
    report,
    reportPath: path.join(artifactRoot, "REPORT.md")
  };
}

const isMainModule = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  void runReleaseValidation()
    .then((result) => {
      writeAndExit(process.stdout, `${result.reportPath}\n`, 0);
    })
    .catch((error) => {
      writeAndExit(
        process.stderr,
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
        1
      );
    });
}
