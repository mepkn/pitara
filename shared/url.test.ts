import { describe, expect, test } from "vitest";
import { LIMITS } from "./limits";
import { getDomain, isValidHttpUrl, normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  test("lower-cases the host but not the path", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe("https://example.com/Path");
  });
  test("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/a#section")).toBe("https://example.com/a");
  });
  test("drops utm_*, fbclid and gclid", () => {
    expect(normalizeUrl("https://example.com/a?utm_source=x&UTM_medium=y&fbclid=1&gclid=2")).toBe(
      "https://example.com/a",
    );
  });
  test("keeps other query params, in order", () => {
    expect(normalizeUrl("https://example.com/a?b=2&utm_source=x&a=1")).toBe("https://example.com/a?b=2&a=1");
  });
  test("drops the trailing slash", () => {
    expect(normalizeUrl("https://example.com/a/")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });
  test("drops default ports only", () => {
    expect(normalizeUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(normalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
    expect(normalizeUrl("https://example.com:8443/a")).toBe("https://example.com:8443/a");
  });
  test("drops www.", () => {
    expect(normalizeUrl("https://www.example.com/a")).toBe("https://example.com/a");
  });
  test("treats equivalent URLs as the same", () => {
    expect(normalizeUrl("HTTPS://WWW.Example.com:443/a/?utm_x=1#top")).toBe(normalizeUrl("https://example.com/a"));
  });
  test("keeps http and https distinct", () => {
    expect(normalizeUrl("http://example.com")).not.toBe(normalizeUrl("https://example.com"));
  });
  test("returns null for invalid input", () => {
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("isValidHttpUrl", () => {
  test("accepts http and https", () => {
    expect(isValidHttpUrl("http://example.com")).toBe(true);
    expect(isValidHttpUrl("https://example.com/a?b=1")).toBe(true);
  });
  test("rejects other schemes and junk", () => {
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "example.com", ""]) {
      expect(isValidHttpUrl(bad)).toBe(false);
    }
  });
  test("rejects URLs over the length limit", () => {
    const long = "https://example.com/" + "a".repeat(LIMITS.urlMax);
    expect(isValidHttpUrl(long)).toBe(false);
    expect(isValidHttpUrl(long.slice(0, LIMITS.urlMax))).toBe(true);
  });
});

describe("getDomain", () => {
  test("returns the lower-cased host without www.", () => {
    expect(getDomain("https://WWW.Example.com/a")).toBe("example.com");
    expect(getDomain("https://blog.example.com")).toBe("blog.example.com");
  });
  test("returns an empty string for an invalid URL", () => {
    expect(getDomain("nope")).toBe("");
  });
});
