import { outboundEmailSchema, type OutboundEmailMessage } from "@bdta/domain";
import type { JobEnvelope } from "@bdta/contracts";

export type ScheduledEmailSenderDependencies = {
  queueScheduledEmail(message: OutboundEmailMessage): Promise<void>;
};

export async function processScheduledEmailSenderJob(
  job: JobEnvelope,
  dependencies: ScheduledEmailSenderDependencies
): Promise<string> {
  const message = outboundEmailSchema.parse(job.payload);
  await dependencies.queueScheduledEmail(message);
  return `Queued scheduled email for ${message.to.join(", ")}.`;
}
