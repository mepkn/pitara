import { describe, expect, it } from "vitest";
import { parseNetscape } from "@shared/netscape";
import { collectExport, exportHtmlText, exportJsonText, type ExportPage } from "./exportFile";

const bm = (url: string, over: Partial<ExportPage["bookmarks"][number]> = {}): ExportPage["bookmarks"][number] => ({
  url, title: url, description: "", note: "", collectionId: null, tags: [], favorite: false, unread: false,
  faviconUrl: null, imageUrl: null, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, deletedAt: null, ...over,
});

const pages: ExportPage[] = [
  { bookmarks: [bm("https://a.example/", { collectionId: "c1", tags: ["x"] })], isDone: false, continueCursor: "k1",
    collections: [{ id: "c1", name: "Reading", parentId: null, sortOrder: 0 }], tags: [{ name: "x", count: 1 }] },
  { bookmarks: [bm("https://b.example/", { unread: true }), bm("https://gone.example/", { deletedAt: 5 })], isDone: true, continueCursor: "" },
];

describe("collectExport", () => {
  it("joins every page and keeps the first page's collections and tags", async () => {
    const cursors: (string | null)[] = [];
    const seen: number[] = [];
    const data = await collectExport(async (cursor) => { cursors.push(cursor); return pages[cursors.length - 1]!; }, (n) => seen.push(n));
    expect(cursors).toEqual([null, "k1"]);
    expect(seen).toEqual([1, 3]);
    expect(data.bookmarks).toHaveLength(3);
    expect(data.collections).toHaveLength(1);
    expect(JSON.parse(exportJsonText(data)).tags).toEqual([{ name: "x", count: 1 }]);
  });
});

describe("exportHtmlText", () => {
  it("writes live bookmarks as Netscape HTML that parses back (trash left out)", async () => {
    let i = 0;
    const data = await collectExport(async () => pages[i++]!);
    const parsed = parseNetscape(exportHtmlText(data));
    expect(parsed.bookmarks.map((b) => b.url).sort()).toEqual(["https://a.example/", "https://b.example/"]);
    const a = parsed.bookmarks.find((b) => b.url === "https://a.example/")!;
    expect(a.tags).toEqual(["x"]);
  });
});
