import { describe, expect, it } from "vitest";
import { findUrl, readShare } from "./share";

describe("findUrl", () => {
  it("finds a bare link", () => expect(findUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1"));
  it("finds a link inside a sentence and drops the full stop", () =>
    expect(findUrl("Look at this: https://example.com/post.")).toBe("https://example.com/post"));
  it("drops a closing bracket that is not part of the link", () =>
    expect(findUrl("(see https://example.com/x)")).toBe("https://example.com/x"));
  it("keeps a balanced bracket", () =>
    expect(findUrl("https://en.wikipedia.org/wiki/Basket_(disambiguation)")).toBe(
      "https://en.wikipedia.org/wiki/Basket_(disambiguation)",
    ));
  it("takes the first link", () => expect(findUrl("http://a.com and https://b.com")).toBe("http://a.com"));
  it("ignores other schemes and empty text", () => {
    expect(findUrl("ftp://example.com")).toBeNull();
    expect(findUrl("mailto:me@example.com")).toBeNull();
    expect(findUrl("")).toBeNull();
    expect(findUrl(null)).toBeNull();
    expect(findUrl("no link here")).toBeNull();
  });
  it("skips a link over the length limit", () => expect(findUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull());
});

describe("readShare", () => {
  it("reads the title and the link from the text", () =>
    expect(readShare({ webUrl: "https://other.com", text: "https://example.com", meta: { title: " Example " } })).toEqual({
      url: "https://example.com",
      title: "Example",
    }));
  it("keeps a link the library's webUrl would have cut at a bracket", () =>
    expect(readShare({ webUrl: "https://en.wikipedia.org/wiki/Basket_", text: "Great read https://en.wikipedia.org/wiki/Basket_(disambiguation)" })?.url).toBe(
      "https://en.wikipedia.org/wiki/Basket_(disambiguation)",
    ));
  it("falls back to webUrl when the text has no link", () =>
    expect(readShare({ webUrl: "https://example.com", text: "see this" })?.url).toBe("https://example.com"));
  it("falls back to a link in the text", () =>
    expect(readShare({ text: "Great read https://example.com/x" })).toEqual({ url: "https://example.com/x", title: "" }));
  it("drops a title that is just the address", () =>
    expect(readShare({ webUrl: "https://example.com", meta: { title: "https://example.com" } })?.title).toBe(""));
  it("returns null when nothing can be saved", () => {
    expect(readShare({ text: "just words" })).toBeNull();
    expect(readShare({ webUrl: "javascript:alert(1)" })).toBeNull();
    expect(readShare({})).toBeNull();
  });
});
