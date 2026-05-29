import { z } from "zod";

import { adminRouteAccessSchema, adminActorProfileSchema, authSessionSchema, portalActorProfileSchema } from "@bdta/contracts";
import { adminRoleSchema, timestampSchema } from "@bdta/domain";

const sessionSnapshotSchema = authSessionSchema.extend({
  role: adminRoleSchema.nullable().optional(),
  roleRefreshedAt: timestampSchema.optional()
});

const adminRouteAccessInputSchema = z.object({
  session: sessionSnapshotSchema,
  path: z.string().min(1)
});

const accountantAllowedAdminPaths = new Set([
  "change_password.php",
  "expenses_list.php",
  "invoices_list.php",
  "invoices_view.php",
  "logout.php",
  "notification_action.php",
  "notification_redirect.php",
  "reports_export.php",
  "reports_financial.php"
]);

export class SessionActorError extends Error {
  constructor(
    public readonly code: "unauthorized" | "actor_not_found",
    message: string
  ) {
    super(message);
    this.name = "SessionActorError";
  }
}

export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type PortalActorProfile = z.infer<typeof portalActorProfileSchema>;
export type AdminActorProfile = z.infer<typeof adminActorProfileSchema>;

export type PortalActorProfileDependencies = {
  findPortalActorById(clientId: string): Promise<PortalActorProfile | null>;
};

export type AdminActorProfileDependencies = {
  findAdminActorById(actorId: string): Promise<AdminActorProfile | null>;
};

function normalizeAdminPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").trim();
  if (normalized === "" || normalized.includes("..")) {
    return null;
  }

  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? null;
}

export function authorizeAdminRoute(session: SessionSnapshot, path: string): z.infer<typeof adminRouteAccessSchema> {
  if (session.actorType !== "admin_user") {
    return {
      allowed: false,
      reason: "unauthenticated"
    };
  }

  const basename = normalizeAdminPath(path);
  if (basename === null || basename === "") {
    return {
      allowed: false,
      reason: "invalid_path"
    };
  }

  if (session.role === "accountant" && !accountantAllowedAdminPaths.has(basename)) {
    return {
      allowed: false,
      reason: "accountant_restricted"
    };
  }

  return {
    allowed: true,
    reason: "allowed"
  };
}

export async function resolvePortalActorProfile(
  session: SessionSnapshot,
  dependencies: PortalActorProfileDependencies
): Promise<PortalActorProfile> {
  const parsedSession = sessionSnapshotSchema.parse(session);
  if (parsedSession.actorType !== "portal_user") {
    throw new SessionActorError("unauthorized", "Portal session required.");
  }

  const actor = await dependencies.findPortalActorById(parsedSession.actorId);
  if (actor == null || actor.archived) {
    throw new SessionActorError("actor_not_found", "Portal actor no longer exists.");
  }

  return portalActorProfileSchema.parse(actor);
}

export async function resolveAdminActorProfile(
  session: SessionSnapshot,
  dependencies: AdminActorProfileDependencies
): Promise<AdminActorProfile> {
  const parsedSession = sessionSnapshotSchema.parse(session);
  if (parsedSession.actorType !== "admin_user") {
    throw new SessionActorError("unauthorized", "Admin session required.");
  }

  const actor = await dependencies.findAdminActorById(parsedSession.actorId);
  if (actor == null || !actor.active) {
    throw new SessionActorError("actor_not_found", "Admin actor no longer exists.");
  }

  return adminActorProfileSchema.parse(actor);
}

export function resolveAdminRouteAccess(input: z.infer<typeof adminRouteAccessInputSchema>) {
  const parsedInput = adminRouteAccessInputSchema.parse(input);
  return adminRouteAccessSchema.parse(authorizeAdminRoute(parsedInput.session, parsedInput.path));
}
