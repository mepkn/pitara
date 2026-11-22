import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { LIMITS } from "../../shared/limits";
import { parseNetscape, writeNetscape } from "../../shared/netscape";
import { fakeNet } from "./test.net";
import { expectConsistent, newTest, signedInUser, type Signed, type TestConvex } from "./test.helpers";

let t: TestConvex;
let alice: Signed;
let bob: Signed;

beforeEach(async () => {
  fakeNet.reset();
  t = newTest();
  alice = await signedInUser(t, "alice@example.com");
  bob = await signedInUser(t, "bob@example.com");
});
afterEach(() => vi.restoreAllMocks());

const fixture = (name: string) => readFileSync(new URL(`../../shared/fixtures/${name}.html`, import.meta.url), "utf8");

/** Uploads the HTML to storage like the web app will, then imports it. */
async function importFile(user: Signed, html: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([html], { type: "text/html" })));
  return await user.as.action(api.importExport.importHtml, { storageId });
}

async function everything(user: Signed) {
  const bookmarks = [];
  let cursor: string | null = null;
  let first = null;
  for (let i = 0; i < 100; i++) {
    const page: Awaited<ReturnType<typeof user.as.action<typeof api.importExport.exportJson>>> = await user.as.action(api.importExport.exportJson, { cursor, numItems: 3 });
    first ??= page;
    bookmarks.push(...page.bookmarks);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { bookmarks, collections: first!.collections!, tags: first!.tags! };
}

describe("importHtml", () => {
  test("imports a Chrome file: collections, titles, dates, skipped javascript: links", async () => {
    const result = await importFile(alice, fixture("chrome"));
    expect(result).toEqual({ found: 5, created: 5, duplicates: 0, invalid: 1, overLimit: 0, collectionsCreated: 2, foldersOverLimit: 0 });

    const lib = await everything(alice);
    expect(lib.collections.map((c) => [c.name, c.parentId === null]).sort()).toEqual([["Dev", true], ["Rust", false]].sort());
    const book = lib.bookmarks.find((b) => b.url === "https://doc.rust-lang.org/book/")!;
    const rust = lib.collections.find((c) => c.name === "Rust")!;
    const dev = lib.collections.find((c) => c.name === "Dev")!;
    expect(book).toMatchObject({ title: "The Rust Book", collectionId: rust.id, createdAt: 1_700_000_007_000 });
    expect(rust.parentId).toBe(dev.id);
    expect(lib.bookmarks.find((b) => b.url === "https://example.com/")).toMatchObject({ collectionId: null, title: "Example Domain" });
    expect(lib.bookmarks.find((b) => b.url === "https://crates.io/")!.collectionId).toBe(rust.id); // the third level collapsed
    await expectConsistent(t);
  });

  test("tags, descriptions and to-read from Firefox and linkding files", async () => {
    await importFile(alice, fixture("firefox"));
    await importFile(alice, fixture("linkding"));
    const lib = await everything(alice);
    expect(lib.bookmarks.find((b) => b.url === "https://www.wikipedia.org/")).toMatchObject({ tags: ["reference", "wiki"], description: "The free encyclopedia" });
    expect(lib.bookmarks.find((b) => b.url === "https://example.com/read-me")).toMatchObject({ unread: true, tags: ["later", "to do"] });
    expect(lib.tags.map((x) => x.name).sort()).toEqual(["later", "reference", "to do", "wiki"]);
    await expectConsistent(t);
  });

  test("importing the same file again adds nothing; trashed links stay in the trash", async () => {
    await importFile(alice, fixture("raindrop"));
    const again = await importFile(alice, fixture("raindrop"));
    expect(again).toMatchObject({ created: 0, duplicates: 3, collectionsCreated: 0 });
    const [first] = (await everything(alice)).bookmarks;
    const id = (await t.run((ctx) => ctx.db.query("bookmarks").first()))!._id;
    await alice.as.mutation(api.bookmarks.trash, { id });
    const third = await importFile(alice, fixture("raindrop"));
    expect(third).toMatchObject({ created: 0, duplicates: 3 });
    expect((await t.run((ctx) => ctx.db.get("bookmarks", id)))!.deletedAt).toBeDefined(); // not restored
    expect(first).toBeDefined();
    await expectConsistent(t);
  });

  test("links already saved by hand (any spelling of the URL) are skipped, per user", async () => {
    await alice.as.mutation(api.bookmarks.create, { url: "https://www.example.com/loose/?utm_source=x", title: "Mine" });
    await bob.as.mutation(api.bookmarks.create, { url: "https://example.com/loose", title: "Bob's" });
    const res = await importFile(alice, fixture("raindrop"));
    expect(res).toMatchObject({ created: 2, duplicates: 1 });
    expect((await everything(alice)).bookmarks.find((b) => b.url.includes("example.com/loose"))!.title).toBe("Mine");
    expect((await everything(bob)).bookmarks).toHaveLength(1); // untouched
  });

  test("imported links get their metadata fetched later, one at a time", async () => {
    vi.useFakeTimers();
    await importFile(alice, fixture("raindrop"));
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const times = scheduled.map((s) => s.scheduledTime).sort((a, b) => a - b);
    expect(times).toHaveLength(3);
    expect(times[2]! - times[0]!).toBeGreaterThanOrEqual(2 * 300);
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toSatisfy((rows: { metaStatus: string }[]) =>
      rows.every((r) => r.metaStatus === "pending"),
    );
    vi.useRealTimers();
  });

  test("enforces access and limits", async () => {
    await expect(t.action(api.importExport.importHtml, { storageId: await t.run((ctx) => ctx.storage.store(new Blob(["x"]))) })).rejects.toThrow("notAuthenticated");
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(importFile(mallory, fixture("raindrop"))).rejects.toThrow("notAllowed");
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toEqual([]);

    const huge = "x".repeat(LIMITS.importFileBytes + 1);
    await expect(importFile(alice, huge)).rejects.toThrow("tooLong");
    const many = "<DL>" + Array.from({ length: LIMITS.importLinks + 1 }, (_, i) => `<DT><A HREF="https://x.example/${i}">${i}</A>`).join("\n") + "</DL>";
    await expect(importFile(alice, many)).rejects.toThrow("limitReached");
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toEqual([]);
  });

  test("the upload is deleted afterwards, whether the import worked or not", async () => {
    const stored = (html: string) => t.run((ctx) => ctx.storage.store(new Blob([html])));
    const files = () => t.run((ctx) => ctx.db.system.query("_storage").collect());
    const ok = await stored(fixture("raindrop"));
    await alice.as.action(api.importExport.importHtml, { storageId: ok });
    expect(await files()).toEqual([]);

    const big = await stored("x".repeat(LIMITS.importFileBytes + 1));
    await expect(alice.as.action(api.importExport.importHtml, { storageId: big })).rejects.toThrow("tooLong");
    const mallory = await signedInUser(t, "mallory@example.com");
    const refused = await stored("<DL></DL>");
    await expect(mallory.as.action(api.importExport.importHtml, { storageId: refused })).rejects.toThrow("notAllowed");
    expect((await files()).map((f) => f._id)).toEqual([refused]); // refused before it was touched; not ours to delete
    await expect(alice.as.action(api.importExport.importHtml, { storageId: ok })).rejects.toThrow("notFound");
  });

  test("only signed-in, allowlisted users get an upload URL", async () => {
    expect(await alice.as.mutation(api.importData.generateUploadUrl, {})).toMatch(/^https?:\/\//);
    await expect(t.mutation(api.importData.generateUploadUrl, {})).rejects.toThrow("notAuthenticated");
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(mallory.as.mutation(api.importData.generateUploadUrl, {})).rejects.toThrow("notAllowed");
  });

  test("the 100 collection cap: extra folders' links go one level up or to Unsorted", async () => {
    for (let i = 0; i < 99; i++) await alice.as.mutation(api.collections.create, { name: `c${i}` });
    const html = `<DL><DT><H3>New one</H3><DL><DT><A HREF="https://a.example/1">a</A></DL><DT><H3>One too many</H3><DL><DT><A HREF="https://a.example/2">b</A></DL></DL>`;
    const res = await importFile(alice, html);
    expect(res).toMatchObject({ created: 2, collectionsCreated: 1, foldersOverLimit: 1 });
    const lib = await everything(alice);
    expect(lib.collections).toHaveLength(100);
    expect(lib.bookmarks.find((b) => b.url === "https://a.example/2")!.collectionId).toBeNull();
    await expectConsistent(t);
  });

  test("the 100,000 bookmark cap stops the import and says so", async () => {
    await t.run((ctx) => ctx.db.insert("userStats", { userId: alice.userId, bookmarkCount: LIMITS.bookmarksPerUser - 1 }));
    const res = await importFile(alice, fixture("raindrop"));
    expect(res).toMatchObject({ created: 1, overLimit: 2 });
  });

  test("the 1,000 tag cap: links are still imported, with the tags that fit", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < LIMITS.tagsPerUser - 1; i++) {
        await ctx.db.insert("tags", { userId: alice.userId, name: `t${i}`, bookmarkCount: 0 });
      }
    });
    const html = `<DL><DT><A HREF="https://a.example/" TAGS="t5,fits,does-not-fit">x</A></DL>`;
    expect(await importFile(alice, html)).toMatchObject({ created: 1 });
    const b = (await everything(alice)).bookmarks[0]!;
    expect(b.tags).toEqual(["t5", "fits"]);
    expect(await t.run((ctx) => ctx.db.query("tags").collect())).toHaveLength(LIMITS.tagsPerUser);
  });

  test("hostile titles and URLs are cut or skipped, never thrown on", async () => {
    const html =
      `<DL><DT><A HREF="https://a.example/1">${"t".repeat(800)}</A><DD>${"d".repeat(3000)}` +
      `<DT><A HREF="https://a.example/${"p".repeat(2100)}">long url</A>` +
      `<DT><A HREF="file:///etc/passwd">file</A><DT><A>no href</A></DL>`;
    const res = await importFile(alice, html);
    expect(res).toMatchObject({ found: 1, created: 1, invalid: 3 });
    const b = (await everything(alice)).bookmarks[0]!;
    expect(b.title).toHaveLength(500);
    expect(b.description).toHaveLength(2000);
  });

  test("a folder name over 100 characters is cut, not fatal, and the rest still imports", async () => {
    const html =
      `<DL><DT><H3>${"F".repeat(150)}</H3><DL><DT><A HREF="https://a.example/1">a</A></DL>` +
      `<DT><H3>${"F".repeat(140)}</H3><DL><DT><H3>  ${"s ".repeat(80)}</H3><DL><DT><A HREF="https://a.example/2">b</A></DL></DL>` +
      `<DT><A HREF="https://a.example/3">c</A></DL>`;
    const res = await importFile(alice, html);
    // The two long top-level names are cut to the same 100 characters, so they are one collection (with a child).
    expect(res).toMatchObject({ created: 3, collectionsCreated: 2 });
    const lib = await everything(alice);
    expect(lib.collections.map((c) => c.name.length).sort((a, b) => a - b)).toEqual([99, 100]); // the child's cut ends on a space, which is trimmed
    await expectConsistent(t);
  });

  test("a huge description is cut before it is sent in a chunk", async () => {
    const html = `<DL><DT><A HREF="https://a.example/1">a</A><DD>${"d".repeat(5_000_000)}</DL>`;
    expect(await importFile(alice, html)).toMatchObject({ created: 1 });
    expect((await everything(alice)).bookmarks[0]!.description).toHaveLength(2000);
  });

  test("many links with many new tags: tags are created once and counted right", async () => {
    const links = Array.from({ length: 120 }, (_, i) => `<DT><A HREF="https://a.example/${i}" TAGS="shared,Own ${i},own ${i}, #hash${i % 7}">x</A>`);
    const res = await importFile(alice, `<DL>${links.join("\n")}</DL>`);
    expect(res.created).toBe(120);
    const tags = await t.run((ctx) => ctx.db.query("tags").collect());
    expect(tags).toHaveLength(1 + 120 + 7);
    expect(tags.find((x) => x.name === "shared")!.bookmarkCount).toBe(120);
    await expectConsistent(t);
  });

  test("a future ADD_DATE is replaced by now", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    await importFile(alice, `<DL><DT><A HREF="https://a.example/" ADD_DATE="4102444800">x</A></DL>`);
    expect((await everything(alice)).bookmarks[0]!.createdAt).toBe(1_800_000_000_000);
    vi.useRealTimers();
  });
});

describe("exportJson", () => {
  test("pages through everything, trash last; the first page has collections and tags", async () => {
    const c = await alice.as.mutation(api.collections.create, { name: "Dev" });
    for (let i = 0; i < 7; i++) {
      await alice.as.mutation(api.bookmarks.create, {
        url: `https://a.example/${i}`, title: `T${i}`, note: `note ${i}`, tags: i % 2 === 0 ? ["even"] : [], collectionId: i < 3 ? c : undefined, favorite: i === 0,
      });
    }
    const trashed = (await t.run((ctx) => ctx.db.query("bookmarks").first()))!._id;
    await alice.as.mutation(api.bookmarks.trash, { id: trashed });
    await bob.as.mutation(api.bookmarks.create, { url: "https://bob.example/", title: "Bob" });

    const first = await alice.as.action(api.importExport.exportJson, { cursor: null, numItems: 3 });
    expect(first.bookmarks).toHaveLength(3);
    expect(first.isDone).toBe(false);
    expect(first.collections).toEqual([{ id: c, name: "Dev", parentId: null, sortOrder: 0 }]);
    expect(first.tags).toEqual([{ name: "even", count: 3 }]); // 4 even ones, one of them trashed
    const second = await alice.as.action(api.importExport.exportJson, { cursor: first.continueCursor, numItems: 3 });
    expect(second.collections).toBeUndefined();

    const all = await everything(alice);
    expect(all.bookmarks).toHaveLength(7);
    expect(all.bookmarks.at(-1)).toMatchObject({ url: "https://a.example/0", deletedAt: expect.any(Number) });
    expect(all.bookmarks.filter((b) => b.deletedAt === null)).toHaveLength(6);
    expect(all.bookmarks.find((b) => b.url === "https://a.example/2")).toMatchObject({ note: "note 2", tags: ["even"], collectionId: c, title: "T2" });
    expect(JSON.stringify(all)).not.toContain("bob.example");
  });

  test("the page size is capped and access is enforced", async () => {
    for (let i = 0; i < 3; i++) await alice.as.mutation(api.bookmarks.create, { url: `https://a.example/${i}` });
    expect((await alice.as.action(api.importExport.exportJson, { cursor: null, numItems: 100000 })).bookmarks).toHaveLength(3);
    await expect(t.action(api.importExport.exportJson, { cursor: null })).rejects.toThrow("notAuthenticated");
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(mallory.as.action(api.importExport.exportJson, { cursor: null })).rejects.toThrow("notAllowed");
  });

  test("an empty library exports an empty page", async () => {
    expect(await alice.as.action(api.importExport.exportJson, { cursor: null })).toMatchObject({ bookmarks: [], isDone: true, collections: [], tags: [] });
  });
});

describe("round trip", () => {
  test("export → HTML file → import into a fresh account gives the same library", async () => {
    const dev = await alice.as.mutation(api.collections.create, { name: "Dev <&> tools" });
    const rust = await alice.as.mutation(api.collections.create, { name: "Rust", parentId: dev });
    const reading = await alice.as.mutation(api.collections.create, { name: "Reading" });
    const make = (n: number, extra: Record<string, unknown> = {}) =>
      alice.as.mutation(api.bookmarks.create, { url: `https://site${n}.example/p?a=1&b=2`, title: `Title ${n} "q" & <b>`, description: `Desc ${n}`, ...extra });
    await make(1);
    await make(2, { collectionId: dev, tags: ["alpha", "two words"] });
    await make(3, { collectionId: rust, tags: ["alpha"], unread: true });
    await make(4, { collectionId: reading });
    const trashedOne = await make(5);
    await alice.as.mutation(api.bookmarks.trash, { id: trashedOne.id });

    const lib = await everything(alice);
    const html = writeNetscape({
      collections: lib.collections,
      bookmarks: lib.bookmarks.filter((b) => b.deletedAt === null).map((b) => ({ ...b, collectionId: b.collectionId ?? undefined })),
    });
    expect(parseNetscape(html).bookmarks).toHaveLength(4);

    const carol = await signedInUser(t, "bob@example.com"); // a second allowlisted account
    expect((await importFile(carol, html)).created).toBe(4);
    const copy = await everything(carol);

    const shape = (l: typeof lib) => {
      const name = (id: string | null) => l.collections.find((c) => c.id === id)?.name ?? null;
      const parent = (id: string | null) => name(l.collections.find((c) => c.id === id)?.parentId ?? null);
      return l.bookmarks
        .filter((b) => b.deletedAt === null)
        .map((b) => [b.url, b.title, b.description, [...b.tags].sort(), b.unread, name(b.collectionId), parent(b.collectionId)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    expect(shape(copy)).toEqual(shape(lib));
    expect(copy.collections.map((c) => c.name).sort()).toEqual(["Dev <&> tools", "Reading", "Rust"]);
    await expectConsistent(t);
  });
});

describe("transaction limits", () => {
  test("links with 20 new tags each are all imported (convex-test doesn't enforce limits; the live check is in the README)", async () => {
    const links = Array.from({ length: 120 }, (_, i) => {
      const tags = Array.from({ length: 20 }, (_, k) => `t${i}-${k}`).join(",");
      return `<DT><A HREF="https://a.example/${i}" TAGS="${tags}">x</A>`;
    });
    const res = await importFile(alice, `<DL>${links.join("\n")}</DL>`);
    expect(res).toMatchObject({ found: 120, created: 120, duplicates: 0 });
    expect(await t.run((ctx) => ctx.db.query("tags").collect())).toHaveLength(LIMITS.tagsPerUser); // 2,400 wanted, capped
    await expectConsistent(t);
  });
});
