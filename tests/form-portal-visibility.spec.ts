import {
  formSubmissionRequiresClientReview,
  isFormSubmissionClientPortalVisible
} from "../packages/application/src/form-portal-visibility.js";

describe("form portal visibility", () => {
  it("fails closed when client-facing metadata is missing for standard forms", () => {
    expect(isFormSubmissionClientPortalVisible({
      formType: "client_form"
    })).toBe(false);
  });

  it("treats follow-up notes as client-review submissions by default", () => {
    expect(isFormSubmissionClientPortalVisible({
      formType: "follow_up_note"
    })).toBe(true);
    expect(formSubmissionRequiresClientReview("follow_up_note")).toBe(true);
  });

  it("honors explicit template visibility overrides for internal forms", () => {
    expect(isFormSubmissionClientPortalVisible({
      formType: "pet_form",
      templateIsInternal: true,
      templateShowInClientPortal: true
    })).toBe(true);

    expect(isFormSubmissionClientPortalVisible({
      formType: "follow_up_note",
      templateShowInClientPortal: false
    })).toBe(false);
  });
});
