import { z } from "zod";

import { adminRoleSchema, emailSchema, idSchema, timestampSchema } from "@bdta/domain";
import { authSessionSchema } from "@bdta/contracts";

const sessionSnapshotSchema = authSessionSchema.extend({
  role: adminRoleSchema.nullable().optional(),
  roleRefreshedAt: timestampSchema.optional()
});

const portalLoginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
  returnTo: z.string().url().nullable().optional()
});

const adminLoginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const portalUserRecordSchema = z.object({
  clientId: idSchema,
  email: emailSchema,
  displayName: z.string().min(1),
  passwordHash: z.string().min(1),
  archived: z.boolean()
});

const portalLoginResultSchema = z.object({
  clientId: idSchema,
  redirectTo: z.string().url(),
  session: sessionSnapshotSchema
});

const adminIdentitySchema = z.object({
  actorId: idSchema,
  source: z.enum(["admin_user", "client_admin"]),
  username: z.string().min(1).optional(),
  email: emailSchema.optional(),
  displayName: z.string().min(1),
  passwordHash: z.string().min(1),
  role: adminRoleSchema
});

const adminLoginResultSchema = z.object({
  actorId: idSchema,
  redirectTo: z.string().min(1),
  session: sessionSnapshotSchema
});

type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginInputSchema>;
export type PortalLoginInput = z.infer<typeof portalLoginInputSchema>;
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;
export type PortalUserRecord = z.infer<typeof portalUserRecordSchema>;
export type AdminLoginResult = z.infer<typeof adminLoginResultSchema>;
export type PortalLoginResult = z.infer<typeof portalLoginResultSchema>;

export type AdminLoginDependencies = {
  now(): string;
  findAdminUserByUsername(username: string): Promise<AdminIdentity | null>;
  findAdminClientByEmail(email: string): Promise<AdminIdentity | null>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  buildAdminRedirectPath(role: z.infer<typeof adminRoleSchema>): string;
  recordSuccessfulLogin(identity: AdminIdentity): Promise<void>;
};

export type PortalLoginDependencies = {
  now(): string;
  findPortalUserByEmail(email: string): Promise<PortalUserRecord | null>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  buildPortalReturnUrl(clientId: string, requestedReturnTo: string | null): string;
  recordSuccessfulLogin(clientId: string): Promise<void>;
};

export function sessionNeedsRoleRefresh(session: SessionSnapshot, now: string, ttlSeconds = 300): boolean {
  if (session.actorType !== "admin_user") {
    return false;
  }

  if (session.role == null) {
    return true;
  }

  if (session.roleRefreshedAt == null) {
    return true;
  }

  const currentTime = Date.parse(timestampSchema.parse(now));
  const refreshedAt = Date.parse(session.roleRefreshedAt);

  return !Number.isFinite(currentTime) || !Number.isFinite(refreshedAt) || currentTime - refreshedAt >= ttlSeconds * 1000;
}

export async function authenticateAdminLogin(
  input: AdminLoginInput,
  dependencies: AdminLoginDependencies
): Promise<AdminLoginResult> {
  const parsedInput = adminLoginInputSchema.parse(input);
  const adminIdentity =
    await dependencies.findAdminUserByUsername(parsedInput.username)
    ?? await dependencies.findAdminClientByEmail(parsedInput.username);

  if (adminIdentity == null) {
    throw new Error("Invalid username or password.");
  }

  const verified = await dependencies.verifyPassword(parsedInput.password, adminIdentity.passwordHash);
  if (!verified) {
    throw new Error("Invalid username or password.");
  }

  await dependencies.recordSuccessfulLogin(adminIdentity);

  const now = timestampSchema.parse(dependencies.now());
  return adminLoginResultSchema.parse({
    actorId: adminIdentity.actorId,
    redirectTo: dependencies.buildAdminRedirectPath(adminIdentity.role),
    session: {
      actorId: adminIdentity.actorId,
      actorType: "admin_user",
      role: adminIdentity.role,
      roleRefreshedAt: now,
      issuedAt: now,
      expiresAt: now
    }
  });
}

export async function authenticatePortalLogin(
  input: PortalLoginInput,
  dependencies: PortalLoginDependencies
): Promise<PortalLoginResult> {
  const parsedInput = portalLoginInputSchema.parse(input);
  const portalUser = await dependencies.findPortalUserByEmail(parsedInput.email);

  if (portalUser == null || portalUser.archived) {
    throw new Error("Invalid email address or password.");
  }

  const verified = await dependencies.verifyPassword(parsedInput.password, portalUser.passwordHash);
  if (!verified) {
    throw new Error("Invalid email address or password.");
  }

  await dependencies.recordSuccessfulLogin(portalUser.clientId);

  const now = timestampSchema.parse(dependencies.now());
  return portalLoginResultSchema.parse({
    clientId: portalUser.clientId,
    redirectTo: dependencies.buildPortalReturnUrl(portalUser.clientId, parsedInput.returnTo ?? null),
    session: {
      actorId: portalUser.clientId,
      actorType: "portal_user",
      role: null,
      issuedAt: now,
      expiresAt: now
    }
  });
}
