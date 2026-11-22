import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { decodeEntities } from "./html";
import { parseNetscape, writeNetscape } from "./netscape";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");

// The fixtures are written by hand to follow what each program's export looks
// like (nesting, attributes, unclosed <DT>/<p>); they are not real exports.

describe("parseNetscape: Chrome", () => {
  const { bookmarks, skipped } = parseNetscape(fixture("chrome"));
  const by = (url: string) => bookmarks.find((b) => b.url === url)!;

  test("the Bookmarks bar and Other bookmarks roots are not collections", () => {
    expect(by("https://example.com/").folder).toEqual([]);
    expect(by("https://news.ycombinator.com/").folder).toEqual([]);
    expect(by("https://developer.mozilla.org/en-US/").folder).toEqual(["Dev"]);
  });

  test("folders deeper than two levels collapse into the second level", () => {
    expect(by("https://doc.rust-lang.org/book/").folder).toEqual(["Dev", "Rust"]);
    expect(by("https://crates.io/").folder).toEqual(["Dev", "Rust"]);
  });

  test("entities are decoded, dates are seconds, javascript: links are skipped", () => {
    expect(by("https://developer.mozilla.org/en-US/").title).toBe("MDN & friends");
    expect(by("https://example.com/").addDate).toBe(1_700_000_001_000);
    expect(skipped).toBe(1);
    expect(bookmarks).toHaveLength(5);
  });
});

describe("parseNetscape: Firefox", () => {
  const { bookmarks, skipped } = parseNetscape(fixture("firefox"));
  const by = (url: string) => bookmarks.find((b) => b.url === url)!;

  test("Menu / Toolbar / Other Bookmarks are roots; real folders stay", () => {
    expect(by("https://www.mozilla.org/en-US/firefox/central/").folder).toEqual(["Mozilla Firefox"]);
    expect(by("https://www.wikipedia.org/").folder).toEqual([]);
    expect(by("https://example.org/a?x=1&y=2").folder).toEqual([]);
  });

  test("tags, <DD> descriptions, place: links and numeric entities", () => {
    expect(by("https://www.wikipedia.org/").tags).toEqual(["reference", "wiki"]);
    expect(by("https://www.wikipedia.org/").description).toBe("The free encyclopedia");
    expect(by("https://example.org/a?x=1&y=2").title).toBe("Café – menu");
    expect(skipped).toBe(1);
  });

  test("a folder's own <DD> is not attached to a bookmark", () => {
    expect(bookmarks.every((b) => !b.description.includes("Add bookmarks to this folder"))).toBe(true);
  });
});

describe("parseNetscape: Raindrop and linkding", () => {
  test("Raindrop: nested collections, tags de-duplicated, notes as descriptions", () => {
    const { bookmarks } = parseNetscape(fixture("raindrop"));
    const by = (url: string) => bookmarks.find((b) => b.url === url)!;
    expect(by("https://www.paulgraham.com/greatwork.html")).toMatchObject({
      folder: ["Reading"],
      tags: ["essay", "work"],
      description: "Long essay; read on the weekend.",
    });
    expect(by("https://arxiv.org/abs/1706.03762")).toMatchObject({ folder: ["Reading", "Papers"], tags: ["ml", "transformers"] });
    expect(by("https://example.com/loose").folder).toEqual([]);
  });

  test("linkding: TOREAD becomes unread, tags are normalized, empty TAGS is fine", () => {
    const { bookmarks } = parseNetscape(fixture("linkding"));
    expect(bookmarks[0]).toMatchObject({ unread: true, tags: ["later", "to do"], description: "Saved from the command line" });
    expect(bookmarks[1]).toMatchObject({ unread: false, tags: [] });
  });
});

describe("parseNetscape: odd input", () => {
  test("empty and non-bookmark input give nothing", () => {
    expect(parseNetscape("")).toEqual({ bookmarks: [], skipped: 0 });
    expect(parseNetscape("<html><body>hello</body></html>").bookmarks).toEqual([]);
  });

  test("lower-case tags, single quotes, unquoted values, missing </A>", () => {
    const { bookmarks } = parseNetscape(
      `<dl><dt><a href='https://a.example/x' add_date=1700000000>Lower</a>\n<dt><a href=https://b.example/y>No close\n<dt><a href="https://c.example/z">Z</a></dl>`,
    );
    expect(bookmarks.map((b) => [b.url, b.title])).toEqual([
      ["https://a.example/x", "Lower"],
      ["https://b.example/y", "No close"],
      ["https://c.example/z", "Z"],
    ]);
  });

  test("tags are capped at 20 per bookmark and bad dates are ignored", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(",");
    const { bookmarks } = parseNetscape(`<DL><DT><A HREF="https://x.example/" ADD_DATE="abc" TAGS="${many}">x</A></DL>`);
    expect(bookmarks[0]?.tags).toHaveLength(20);
    expect(bookmarks[0]?.addDate).toBeUndefined();
  });

  test("a URL over the limit is skipped", () => {
    const { bookmarks, skipped } = parseNetscape(`<DL><DT><A HREF="https://x.example/${"a".repeat(2100)}">x</A></DL>`);
    expect(bookmarks).toEqual([]);
    expect(skipped).toBe(1);
  });
});

describe("decodeEntities", () => {
  test("named, decimal, hex; unknown and invalid ones stay", () => {
    expect(decodeEntities("a &amp; b &#65; &#x42; &bogus; &#0; &#xD800;")).toBe("a & b A B &bogus; &#0; &#xD800;");
  });
});

describe("writeNetscape", () => {
  const collections = [
    { id: "c1", name: "Dev <tools>" },
    { id: "c2", name: "Rust", parentId: "c1" },
    { id: "c3", name: "Reading" },
  ];
  const bookmarks = [
    { url: "https://a.example/?x=1&y=2", title: 'Quote "A"', description: "desc <b>", note: "", tags: ["x", "y z"], unread: true, createdAt: 1_700_000_000_000, collectionId: undefined },
    { url: "https://b.example/", title: "B", description: "", note: "my note", tags: [], unread: false, createdAt: 1_700_000_100_000, collectionId: "c1" },
    { url: "https://c.example/", title: "C", description: "d", note: "", tags: ["x"], unread: false, createdAt: 1_700_000_200_000, collectionId: "c2" },
    { url: "https://d.example/", title: "", description: "", note: "", tags: [], unread: false, createdAt: 1_700_000_300_000, collectionId: "c3" },
    { url: "https://e.example/", title: "E", description: "", note: "", tags: [], unread: false, createdAt: 1_700_000_400_000, collectionId: "gone" },
  ];

  test("round trip: parsing what was written gives the same bookmarks, folders and tags", () => {
    const html = writeNetscape({ collections, bookmarks });
    const parsed = parseNetscape(html);
    expect(parsed.skipped).toBe(0);
    const by = (url: string) => parsed.bookmarks.find((b) => b.url === url)!;
    expect(parsed.bookmarks).toHaveLength(5);
    expect(by("https://a.example/?x=1&y=2")).toMatchObject({
      title: 'Quote "A"', description: "desc <b>", tags: ["x", "y z"], unread: true, addDate: 1_700_000_000_000, folder: [],
    });
    expect(by("https://b.example/")).toMatchObject({ folder: ["Dev <tools>"], description: "my note" });
    expect(by("https://c.example/")).toMatchObject({ folder: ["Dev <tools>", "Rust"], tags: ["x"] });
    expect(by("https://d.example/")).toMatchObject({ folder: ["Reading"], title: "https://d.example/" });
    expect(by("https://e.example/").folder).toEqual([]); // unknown collection: top level, not lost
  });

  test("description and note share the one text field", () => {
    const html = writeNetscape({
      collections: [],
      bookmarks: [{ ...bookmarks[0]!, description: "D", note: "N", collectionId: undefined }],
    });
    expect(parseNetscape(html).bookmarks[0]?.description).toBe("D\n\nN");
  });

  test("writing nothing still gives a valid empty file", () => {
    expect(parseNetscape(writeNetscape({ collections: [], bookmarks: [] })).bookmarks).toEqual([]);
  });
});
