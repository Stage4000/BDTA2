import { z } from "zod";

import type { Client, InboundEmail, UnmatchedEmail } from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

const unmatchedEmailCleanerPayloadSchema = z.object({
  limit: z.number().int().positive().max(500).optional()
});

type UnresolvedUnmatchedEmailRecord = {
  unmatchedEmail: UnmatchedEmail;
  inboundEmail: Pick<InboundEmail, "id" | "fromEmail"> | null;
};

export type UnmatchedEmailCleanerDependencies = {
  now(): string;
  listUnresolvedUnmatchedEmails(limit: number): Promise<UnresolvedUnmatchedEmailRecord[]>;
  findPortalUsersByEmail(email: string): Promise<Array<Pick<Client, "id" | "email">>>;
  resolveUnmatchedEmail(input: {
    unmatchedEmailId: string;
    inboundEmailId: string;
    matchedClientId: string;
    resolvedAt: string;
  }): Promise<void>;
};

export async function processUnmatchedEmailCleanerJob(
  job: JobEnvelope,
  dependencies: UnmatchedEmailCleanerDependencies
): Promise<string> {
  const payload = unmatchedEmailCleanerPayloadSchema.parse(job.payload);
  const limit = payload.limit ?? 50;
  const unresolvedRecords = await dependencies.listUnresolvedUnmatchedEmails(limit);

  let resolvedCount = 0;

  for (const record of unresolvedRecords) {
    if (record.inboundEmail == null) {
      continue;
    }

    const matches = await dependencies.findPortalUsersByEmail(record.inboundEmail.fromEmail);
    if (matches.length !== 1) {
      continue;
    }

    const matchedClientId = matches[0]?.id;
    if (matchedClientId == null) {
      continue;
    }

    await dependencies.resolveUnmatchedEmail({
      unmatchedEmailId: record.unmatchedEmail.id,
      inboundEmailId: record.inboundEmail.id,
      matchedClientId,
      resolvedAt: dependencies.now()
    });
    resolvedCount += 1;
  }

  const remainingCount = unresolvedRecords.length - resolvedCount;
  const resolvedLabel = resolvedCount === 1 ? "email" : "emails";
  const remainingLabel = remainingCount === 1 ? "email" : "emails";

  return `Resolved ${resolvedCount} unmatched ${resolvedLabel}; ${remainingCount} unresolved ${remainingLabel} remain.`;
}
