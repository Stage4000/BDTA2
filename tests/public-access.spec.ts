import {
  authorizeTokenizedPublicAccess,
  type TokenizedPublicAccessInput
} from "@bdta/application";

function createAccessInput(overrides: Partial<TokenizedPublicAccessInput> = {}): TokenizedPublicAccessInput {
  return {
    actorType: "public",
    resourceKind: "quote",
    providedToken: "valid-token-123456",
    now: "2026-05-27T16:00:00.000Z",
    access: {
      token: "valid-token-123456",
      issuedAt: "2026-05-27T16:00:00.000Z",
      expiresAt: null,
      legacySourceId: "123"
    },
    ...overrides
  };
}

describe("tokenized public access", () => {
  it("allows public access when the supplied token matches", () => {
    const result = authorizeTokenizedPublicAccess(createAccessInput());

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
  });

  it("rejects public access when the token is missing or wrong", () => {
    expect(
      authorizeTokenizedPublicAccess(createAccessInput({ providedToken: "" })).allowed
    ).toBe(false);

    expect(
      authorizeTokenizedPublicAccess(createAccessInput({ providedToken: "wrong-token-999999" })).reason
    ).toBe("token_mismatch");
  });

  it("rejects expired public-access tokens", () => {
    const result = authorizeTokenizedPublicAccess(
      createAccessInput({
        access: {
          token: "valid-token-123456",
          issuedAt: "2026-05-27T16:00:00.000Z",
          expiresAt: "2026-05-27T16:05:00.000Z",
          legacySourceId: "123"
        },
        now: "2026-05-27T16:06:00.000Z"
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("token_expired");
  });

  it("allows authenticated portal ownership access without a public token", () => {
    const result = authorizeTokenizedPublicAccess(
      createAccessInput({
        actorType: "portal_owner",
        providedToken: null,
        access: null
      })
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("owner_access");
  });
});
