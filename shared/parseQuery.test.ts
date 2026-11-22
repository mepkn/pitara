import { describe, expect, test } from "vitest";
import { parseQuery } from "./parseQuery";
import { isValidTagName, normalizeTagName } from "./tags";

describe("parseQuery", () => {
  test("plain text passes through", () => {
    expect(parseQuery("  rust   async ")).toEqual({ text: "rust async", tags: [], collections: [] });
    expect(parseQuery("")).toEqual({ text: "", tags: [], collections: [] });
  });

  test("#tag and @collection are pulled out wherever they appear", () => {
    expect(parseQuery("#Rust async #web @Reading")).toEqual({
      text: "async",
      tags: ["rust", "web"],
      collections: ["Reading"],
    });
    expect(parseQuery("async @Reading")).toEqual({ text: "async", tags: [], collections: ["Reading"] });
  });

  test("quoted names may contain spaces", () => {
    expect(parseQuery('#"To  Read" @"My Folder" hello')).toEqual({
      text: "hello",
      tags: ["to read"],
      collections: ["My Folder"],
    });
  });

  test("duplicates collapse", () => {
    expect(parseQuery("#a #A @x @X")).toEqual({ text: "", tags: ["a"], collections: ["x"] });
  });

  test("URLs, emails and lone sigils stay text", () => {
    expect(parseQuery("https://x.com/page#top").text).toBe("https://x.com/page#top");
    expect(parseQuery("me@x.com").text).toBe("me@x.com");
    expect(parseQuery("# @ #\"\"").tags).toEqual([]);
    expect(parseQuery("c# tips").text).toBe("c# tips");
  });
});

describe("tag names", () => {
  test("normalize", () => {
    expect(normalizeTagName("  #Read   Later ")).toBe("read later");
    expect(normalizeTagName("###")).toBe("");
  });
  test("validity", () => {
    expect(isValidTagName("ok")).toBe(true);
    expect(isValidTagName("#")).toBe(false);
    expect(isValidTagName("x".repeat(50))).toBe(true);
    expect(isValidTagName("x".repeat(51))).toBe(false);
  });
});
