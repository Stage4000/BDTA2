import type { OutboundEmailMessage } from "@bdta/domain";
import {
  jobEnvelopeSchema,
  jobResultSchema,
  type JobEnvelope,
  type JobResult,
  type SupportedJobKind
} from "@bdta/contracts";

export type QueuedEmailRecord = {
  emailId: string;
  message: OutboundEmailMessage;
};

export type BackgroundProcessorDependencies = {
  now(): string;
  claimDueJobs(limit: number): Promise<JobEnvelope[]>;
  completeJob(result: JobResult): Promise<void>;
  failJob(result: JobResult): Promise<void>;
  claimQueuedEmails(limit: number): Promise<QueuedEmailRecord[]>;
  sendEmail(message: OutboundEmailMessage): Promise<void>;
  markEmailSent(emailId: string, processedAt: string): Promise<void>;
  markEmailFailed(emailId: string, reason: string, processedAt: string): Promise<void>;
  handlers: Partial<Record<SupportedJobKind, (job: JobEnvelope) => Promise<string>>>;
};

export type BackgroundCycleOptions = {
  jobLimit?: number;
  emailLimit?: number;
};

export type BackgroundCycleResult = {
  jobResults: JobResult[];
  emailsSent: number;
  emailsFailed: number;
};

function toFailureSummary(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "Unknown processing failure.";
}

export async function runBackgroundCycle(
  dependencies: BackgroundProcessorDependencies,
  options: BackgroundCycleOptions = {}
): Promise<BackgroundCycleResult> {
  const jobLimit = options.jobLimit ?? 25;
  const emailLimit = options.emailLimit ?? 25;
  const processedAt = dependencies.now();

  const dueJobs = (await dependencies.claimDueJobs(jobLimit)).map((job) => jobEnvelopeSchema.parse(job));
  const jobResults: JobResult[] = [];

  for (const job of dueJobs) {
    const handler = dependencies.handlers[job.kind];

    if (handler == null) {
      const result = jobResultSchema.parse({
        jobId: job.jobId,
        kind: job.kind,
        processedAt,
        success: false,
        summary: `No handler registered for ${job.kind}.`
      });
      await dependencies.failJob(result);
      jobResults.push(result);
      continue;
    }

    try {
      const summary = await handler(job);
      const result = jobResultSchema.parse({
        jobId: job.jobId,
        kind: job.kind,
        processedAt,
        success: true,
        summary
      });
      await dependencies.completeJob(result);
      jobResults.push(result);
    } catch (error) {
      const result = jobResultSchema.parse({
        jobId: job.jobId,
        kind: job.kind,
        processedAt,
        success: false,
        summary: toFailureSummary(error)
      });
      await dependencies.failJob(result);
      jobResults.push(result);
    }
  }

  let emailsSent = 0;
  let emailsFailed = 0;

  const queuedEmails = await dependencies.claimQueuedEmails(emailLimit);
  for (const queuedEmail of queuedEmails) {
    try {
      await dependencies.sendEmail(queuedEmail.message);
      await dependencies.markEmailSent(queuedEmail.emailId, processedAt);
      emailsSent += 1;
    } catch (error) {
      await dependencies.markEmailFailed(queuedEmail.emailId, toFailureSummary(error), processedAt);
      emailsFailed += 1;
    }
  }

  return {
    jobResults,
    emailsSent,
    emailsFailed
  };
}
