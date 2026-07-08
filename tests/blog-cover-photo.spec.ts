import path from "node:path";

import {
  getBlogCoverPhotoAbsoluteUrl,
  getBlogCoverPhotoLocalPath,
  isValidBlogCoverPhotoPath,
  normalizeBlogCoverPhotoPath
} from "@bdta/application";

describe("blog cover photo helpers", () => {
  it("accepts safe root-relative and https cover photo paths while rejecting unsafe values", () => {
    expect(isValidBlogCoverPhotoPath("/backend/uploads/blog/example.jpg")).toBe(true);
    expect(isValidBlogCoverPhotoPath("https://cdn.example.com/cover.jpg")).toBe(true);
    expect(isValidBlogCoverPhotoPath("http://example.com/cover.jpg")).toBe(false);
    expect(isValidBlogCoverPhotoPath("javascript:alert(1)")).toBe(false);
    expect(isValidBlogCoverPhotoPath("//evil.example/image.jpg")).toBe(false);
    expect(isValidBlogCoverPhotoPath("/backend/uploads/blog/../../secret.jpg")).toBe(false);
  });

  it("normalizes, expands, and resolves local blog cover photo paths with legacy-compatible rules", () => {
    expect(normalizeBlogCoverPhotoPath(" /backend/uploads/blog/example.jpg ")).toBe("/backend/uploads/blog/example.jpg");
    expect(normalizeBlogCoverPhotoPath("javascript:alert(1)")).toBe("");
    expect(getBlogCoverPhotoAbsoluteUrl("/backend/uploads/blog/example.jpg", "https://bdta.test/")).toBe(
      "https://bdta.test/backend/uploads/blog/example.jpg"
    );
    expect(getBlogCoverPhotoAbsoluteUrl("https://cdn.example.com/cover.jpg", "https://bdta.test/")).toBe(
      "https://cdn.example.com/cover.jpg"
    );
    expect(getBlogCoverPhotoAbsoluteUrl("/backend/uploads/blog/example.jpg")).toBe(
      "http://localhost:8000/backend/uploads/blog/example.jpg"
    );
    expect(getBlogCoverPhotoLocalPath("/backend/uploads/blog/example.jpg", "C:\\repo")).toBe(
      path.join("C:\\repo", "backend", "uploads", "blog", "example.jpg")
    );
    expect(getBlogCoverPhotoLocalPath("https://cdn.example.com/cover.jpg", "C:\\repo")).toBe("");
    expect(getBlogCoverPhotoLocalPath("/backend/uploads/blog/nested/example.jpg", "C:\\repo")).toBe("");
  });
});
