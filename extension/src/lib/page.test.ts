import { describe, expect, it } from "vitest";
import { isSavableUrl, parseTags, usefulTitle } from "./page";

describe("isSavableUrl", () => {
  it("accepts http and https", () => {
    expect(isSavableUrl("https://example.com/a?b=1")).toBe(true);
    expect(isSavableUrl("http://example.com")).toBe(true);
  });
  it("refuses browser, file and extension pages and junk", () => {
    for (const u of ["chrome://extensions", "chrome-extension://abc/popup.html", "file:///etc/hosts", "about:blank", "javascript:alert(1)", "data:text/html,hi", "", "nonsense", undefined, null]) {
      expect(isSavableUrl(u as string)).toBe(false);
    }
  });
});

describe("usefulTitle", () => {
  it("keeps a real title", () => expect(usefulTitle("  Hello  ", "https://a.com")).toBe("Hello"));
  it("drops empty titles and titles that are just the address", () => {
    expect(usefulTitle("", "https://a.com")).toBeUndefined();
    expect(usefulTitle(undefined, "https://a.com")).toBeUndefined();
    expect(usefulTitle("https://a.com/x", "https://a.com/x")).toBeUndefined();
    expect(usefulTitle("a.com/x", "https://a.com/x")).toBeUndefined();
  });
});

describe("parseTags", () => {
  it("splits on commas and newlines, trims, lower-cases, strips # and dedupes", () => {
    expect(parseTags("Foo, #bar,\nfoo ,, baz")).toEqual(["foo", "bar", "baz"]);
  });
  it("returns nothing for blank input", () => expect(parseTags(" , ")).toEqual([]));
});
