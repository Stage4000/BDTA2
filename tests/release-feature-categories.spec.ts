import { releaseCategories } from "../apps/release/src/main.js";

describe("release feature categories", () => {
  it("tracks the remaining portal and admin parity surfaces in required page coverage", () => {
    const categoriesByName = new Map(releaseCategories.map((category) => [category.category, category]));

    expect(categoriesByName.get("portal-self-service")?.requiredPages).toEqual(
      expect.arrayContaining([
        "portal-appointments",
        "portal-booking-detail",
        "portal-pet-detail",
        "portal-package-detail",
        "portal-credit-detail"
      ])
    );

    expect(categoriesByName.get("documents-commerce")?.requiredPages).toEqual(
      expect.arrayContaining([
        "portal-invoice-detail",
        "portal-quote-detail",
        "portal-contract-detail",
        "portal-form-detail",
        "admin-invoice-detail",
        "admin-quote-detail",
        "admin-contract-detail",
        "admin-form-detail"
      ])
    );

    expect(categoriesByName.get("public-site-booking")?.requiredPages).toEqual(
      expect.arrayContaining([
        "public-book",
        "public-book-legacy",
        "public-package-detail-legacy",
        "public-book-confirmation"
      ])
    );

    expect(categoriesByName.get("admin-crm-content-ops")?.requiredPages).toEqual(
      expect.arrayContaining([
        "admin-booking-detail",
        "admin-pet-detail",
        "admin-packages",
        "admin-package-detail",
        "admin-credits",
        "admin-credit-detail",
        "admin-site-page-editor",
        "admin-workflows",
        "admin-workflow-step-detail",
        "admin-appointment-types",
        "admin-appointment-type-detail",
        "admin-email-templates",
        "admin-email-template-detail",
        "admin-scheduled-tasks",
        "admin-scheduled-task-detail"
      ])
    );
  });
});
