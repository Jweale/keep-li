import { describe, it, expect } from "vitest";
import { canonicaliseUrl, computeUrlHash } from "./url";

describe("canonicaliseUrl", () => {
  it("removes tracking parameters", () => {
    const url = "https://linkedin.com/posts/123?utm_source=share&utm_campaign=test";
    const result = canonicaliseUrl(url);
    expect(result).toBe("https://linkedin.com/posts/123");
  });

  it("removes li_ tracking parameters", () => {
    const url = "https://linkedin.com/posts/123?li_source=feed&li_campaign=organic";
    const result = canonicaliseUrl(url);
    expect(result).toBe("https://linkedin.com/posts/123");
  });

  it("removes hash fragments", () => {
    const url = "https://linkedin.com/posts/123#comments";
    const result = canonicaliseUrl(url);
    expect(result).toBe("https://linkedin.com/posts/123");
  });

  it("preserves non-tracking parameters", () => {
    const url = "https://linkedin.com/posts/123?postId=456&view=full";
    const result = canonicaliseUrl(url);
    expect(result).toBe("https://linkedin.com/posts/123?postId=456&view=full");
  });

  it("handles invalid URLs gracefully", () => {
    const url = "not-a-valid-url";
    const result = canonicaliseUrl(url);
    expect(result).toBe("not-a-valid-url");
  });
});

describe("computeUrlHash", () => {
  it("returns consistent hash for same URL", async () => {
    const url = "https://linkedin.com/posts/123";
    const hash1 = await computeUrlHash(url);
    const hash2 = await computeUrlHash(url);
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different URLs", async () => {
    const url1 = "https://linkedin.com/posts/123";
    const url2 = "https://linkedin.com/posts/456";
    const hash1 = await computeUrlHash(url1);
    const hash2 = await computeUrlHash(url2);
    expect(hash1).not.toBe(hash2);
  });

  it("canonicalises before hashing", async () => {
    const url1 = "https://linkedin.com/posts/123?utm_source=test";
    const url2 = "https://linkedin.com/posts/123";
    const hash1 = await computeUrlHash(url1);
    const hash2 = await computeUrlHash(url2);
    expect(hash1).toBe(hash2);
  });

  it("returns a hex string", async () => {
    const url = "https://linkedin.com/posts/123";
    const hash = await computeUrlHash(url);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
