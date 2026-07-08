import { formSubmissionSchema, type FormSubmission } from "@bdta/domain";

export function formSubmissionRequiresClientReview(formType: string | undefined): boolean {
  return formType === "follow_up_note";
}

export function isFormSubmissionClientPortalVisible(submission: Pick<
  FormSubmission,
  "formType" | "templateIsInternal" | "templateShowInClientPortal"
>): boolean {
  if (submission.templateShowInClientPortal != null) {
    return submission.templateShowInClientPortal;
  }

  if (submission.formType === "follow_up_note") {
    return true;
  }

  if (submission.templateIsInternal != null) {
    return submission.templateIsInternal === false;
  }

  return false;
}

export function normalizeFormSubmissionPortalMetadata(submission: FormSubmission): FormSubmission {
  const parsed = formSubmissionSchema.parse(submission);
  if (parsed.clientReviewSubmission == null && parsed.formType == null) {
    return parsed;
  }

  return {
    ...parsed,
    clientReviewSubmission: parsed.clientReviewSubmission ?? formSubmissionRequiresClientReview(parsed.formType)
  };
}
