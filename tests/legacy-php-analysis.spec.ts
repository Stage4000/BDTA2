import {
  analyzeLegacyPhpFailure,
  reconcileLegacyBehaviorFailures,
  summarizeLegacyPhpResults
} from "../apps/release/src/legacy-php-analysis.js";

describe("legacy PHP analysis", () => {
  it("classifies missing PDO drivers as environment-blocked failures", () => {
    const analysis = analyzeLegacyPhpFailure({
      passed: false,
      stdout: "",
      stderr: "PHP Fatal error: Uncaught PDOException: could not find driver in legacy/tests/example.php:10"
    });

    expect(analysis).toEqual({
      category: "environment_missing_driver",
      environmentBlocked: true,
      summary: "Missing PDO driver in the local PHP environment."
    });
  });

  it("classifies missing mbstring helpers as environment-blocked failures", () => {
    const analysis = analyzeLegacyPhpFailure({
      passed: false,
      stdout: "",
      stderr: "PHP Fatal error: Uncaught Error: Call to undefined function mb_convert_encoding() in legacy/backend/includes/blog_content.php:23"
    });

    expect(analysis).toEqual({
      category: "environment_missing_extension",
      environmentBlocked: true,
      summary: "Missing required mbstring function in the local PHP environment."
    });
  });

  it("classifies assertion-style messages as behavior failures", () => {
    const analysis = analyzeLegacyPhpFailure({
      passed: false,
      stdout: "",
      stderr: "Expected upload-directory cover photo paths to resolve to local filesystem paths."
    });

    expect(analysis?.category).toBe("assertion_failure");
    expect(analysis?.environmentBlocked).toBe(false);
  });

  it("summarizes environment-blocked and behavior failures separately", () => {
    const summary = summarizeLegacyPhpResults([
      { passed: true, stdout: "ok", stderr: "" },
      { passed: false, stdout: "", stderr: "PDOException: could not find driver" },
      { passed: false, stdout: "", stderr: "Expected upload-directory cover photo paths to resolve to local filesystem paths." }
    ]);

    expect(summary).toEqual({
      total: 3,
      passed: 1,
      failed: 2,
      environmentBlocked: 1,
      behaviorFailures: 1,
      categoryCounts: {
        environment_missing_driver: 1,
        assertion_failure: 1
      }
    });
  });

  it("reconciles covered legacy behavior failures separately from unresolved parity gaps", () => {
    const reconciliation = reconcileLegacyBehaviorFailures({
      results: [
        {
          file: "test_blog_cover_photo_helper.php",
          passed: false,
          stdout: "",
          stderr: "Expected upload-directory cover photo paths to resolve to local filesystem paths.",
          failureAnalysis: {
            category: "assertion_failure",
            environmentBlocked: false,
            summary: "Expected upload-directory cover photo paths to resolve to local filesystem paths."
          }
        },
        {
          file: "test_follow_up_portal_source.php",
          passed: false,
          stdout: "",
          stderr: "Follow-up note helper should create a portal notification for the client.",
          failureAnalysis: {
            category: "unknown_failure",
            environmentBlocked: false,
            summary: "Follow-up note helper should create a portal notification for the client."
          }
        }
      ],
      passedFeatureCategories: ["public-site-booking", "admin-crm-content-ops", "portal-self-service", "documents-commerce"],
      cleanCapturedPages: ["public-blog-index", "public-blog-post", "admin-blog-post-detail", "portal-forms", "portal-form-detail", "portal-notifications"],
      coveredTables: ["blog_posts", "form_submissions", "notifications"],
      mysqlSource: "CREATE INDEX idx_inbound_emails_provider_message_id ON inbound_emails(provider(16), message_id(170));"
    });

    expect(reconciliation.total).toBe(2);
    expect(reconciliation.reconciled).toBe(2);
    expect(reconciliation.unresolved).toBe(0);
    expect(reconciliation.items).toEqual([
      {
        file: "test_blog_cover_photo_helper.php",
        status: "reconciled",
        summary: "Expected upload-directory cover photo paths to resolve to local filesystem paths.",
        reason: "TypeScript public/admin blog cover-photo behavior is covered by release validation.",
        evidence: [
          "feature:public-site-booking",
          "feature:admin-crm-content-ops",
          "page:public-blog-index",
          "page:public-blog-post",
          "page:admin-blog-post-detail",
          "table:blog_posts"
        ],
        missingEvidence: []
      },
      {
        file: "test_follow_up_portal_source.php",
        status: "reconciled",
        summary: "Follow-up note helper should create a portal notification for the client.",
        reason: "TypeScript follow-up note portal review and notification parity is covered by release validation.",
        evidence: [
          "feature:portal-self-service",
          "feature:documents-commerce",
          "page:portal-forms",
          "page:portal-form-detail",
          "page:portal-notifications",
          "table:form_submissions",
          "table:notifications"
        ],
        missingEvidence: []
      }
    ]);
  });

  it("reconciles SQL-backed legacy behavior failures when the required patterns exist", () => {
    const reconciliation = reconcileLegacyBehaviorFailures({
      results: [
        {
          file: "test_email_message_id_indexes.php",
          passed: false,
          stdout: "",
          stderr: "client_emails message_id index SQL should use safe prefixes for direction and message_id.",
          failureAnalysis: {
            category: "unknown_failure",
            environmentBlocked: false,
            summary: "client_emails message_id index SQL should use safe prefixes for direction and message_id."
          }
        }
      ],
      passedFeatureCategories: [],
      cleanCapturedPages: [],
      coveredTables: ["inbound_emails"],
      mysqlSource: [
        "CREATE INDEX idx_inbound_emails_provider_message_id ON inbound_emails(provider(16), message_id(170));",
        "CREATE INDEX idx_inbound_emails_message_id ON inbound_emails(message_id(170));"
      ].join("\n")
    });

    expect(reconciliation.reconciled).toBe(1);
    expect(reconciliation.unresolved).toBe(0);
    expect(reconciliation.items[0]).toEqual({
      file: "test_email_message_id_indexes.php",
      status: "reconciled",
      summary: "client_emails message_id index SQL should use safe prefixes for direction and message_id.",
      reason: "TypeScript MySQL bootstrap includes the required safe-prefix message_id indexes.",
      evidence: [
        "table:inbound_emails",
        "sql:idx_inbound_emails_provider_message_id",
        "sql:idx_inbound_emails_message_id"
      ],
      missingEvidence: []
    });
  });
});
