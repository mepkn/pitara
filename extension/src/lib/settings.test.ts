import { describe, expect, it } from "vitest";
import { DEFAULT_WEB_URL } from "./config";
import { cleanWebUrl, normalizeSettings } from "./settings";

describe("settings", () => {
  it("falls back to defaults for missing or junk data", () => {
    expect(normalizeSettings(undefined)).toEqual({ token: "", webUrl: DEFAULT_WEB_URL, defaultCollectionId: null });
    expect(normalizeSettings({ token: 5, webUrl: 7, defaultCollectionId: {} })).toEqual({
      token: "", webUrl: DEFAULT_WEB_URL, defaultCollectionId: null,
    });
  });
  it("trims the token and keeps a valid collection id", () => {
    expect(normalizeSettings({ token: "  pit_abc \n", defaultCollectionId: "k1" })).toMatchObject({
      token: "pit_abc", defaultCollectionId: "k1",
    });
  });
  it("reduces the web URL to an http(s) origin", () => {
    expect(cleanWebUrl("https://example.com/path?q=1")).toBe("https://example.com");
    expect(cleanWebUrl("javascript:alert(1)")).toBe(DEFAULT_WEB_URL);
    expect(cleanWebUrl("not a url")).toBe(DEFAULT_WEB_URL);
  });
});
