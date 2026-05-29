import { z } from "zod";

import { publicAccessTokenSchema, timestampSchema } from "@bdta/domain";

const tokenizedPublicAccessInputSchema = z.object({
  actorType: z.enum(["public", "portal_owner", "admin_user"]),
  resourceKind: z.enum(["quote", "contract", "form_submission", "booking_ical"]),
  providedToken: z.string().nullable(),
  access: publicAccessTokenSchema.nullable(),
  now: timestampSchema.default(() => new Date().toISOString())
});

export type TokenizedPublicAccessInput = z.infer<typeof tokenizedPublicAccessInputSchema>;

export type TokenizedPublicAccessResult = {
  allowed: boolean;
  reason: "allowed" | "owner_access" | "missing_token" | "missing_access_policy" | "token_mismatch" | "token_expired";
};

export function authorizeTokenizedPublicAccess(input: TokenizedPublicAccessInput): TokenizedPublicAccessResult {
  const parsed = tokenizedPublicAccessInputSchema.parse(input);

  if (parsed.actorType === "portal_owner" || parsed.actorType === "admin_user") {
    return {
      allowed: true,
      reason: "owner_access"
    };
  }

  if (parsed.access == null) {
    return {
      allowed: false,
      reason: "missing_access_policy"
    };
  }

  if (parsed.providedToken == null || parsed.providedToken.trim() === "") {
    return {
      allowed: false,
      reason: "missing_token"
    };
  }

  if (parsed.providedToken !== parsed.access.token) {
    return {
      allowed: false,
      reason: "token_mismatch"
    };
  }

  if (parsed.access.expiresAt != null) {
    const expiresAt = Date.parse(parsed.access.expiresAt);
    const now = Date.parse(parsed.now);

    if (Number.isFinite(expiresAt) && Number.isFinite(now) && now > expiresAt) {
      return {
        allowed: false,
        reason: "token_expired"
      };
    }
  }

  return {
    allowed: true,
    reason: "allowed"
  };
}
