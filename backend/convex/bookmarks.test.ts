import { afterEach, describe, expect, test, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LIMITS } from "../../shared/limits";
import { allPages, expectConsistent, newTest, signedInUser, type Signed } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const t = newTest();
  const alice = await signedInUser(t, "alice@example.com");
  const bob = await signedInUser(t, "bob@example.com");
  return { t, alice, bob };
}

const save = async (u: Signed, url: string, extra: Record<string, unknown> = {}) =>
  (await u.as.mutation(api.bookmarks.create, { url, ...extra })).id;

const list = (
  u: Signed,
  args: { view: "all" | "unsorted" | "collection" | "favorites" | "unread" | "trash"; sort?: "newest" | "oldest" | "title" | "domain"; collectionId?: Id<"collections">; tagId?: Id<"tags"> },
) =>
  allPages<{ _id: Id<"bookmarks">; url: string; title: string }>((paginationOpts) =>
    u.as.query(api.bookmarks.list, { sort: "newest", ...args, paginationOpts }),
  );

const find = (u: Signed, q: string, extra: Record<string, unknown> = {}) =>
  allPages<{ _id: Id<"bookmarks">; url: string }>((paginationOpts) =>
    u.as.query(api.bookmarks.search, { query: q, ...extra, paginationOpts }),
  );

const urls = (rows: { url: string }[]) => rows.map((r) => r.url);
const tagIdOf = async (u: Signed, name: string) =>
  (await u.as.query(api.tags.list, {})).find((tag) => tag.name === name)!._id;

describe("access", () => {
  test("bookmark functions refuse a removed email, anonymous callers and non-allowlisted users", async () => {
    const { t, alice } = await setup();
    await save(alice, "https://example.com/a");
    vi.stubEnv("ALLOWED_EMAILS", "bob@example.com");
    await expect(list(alice, { view: "all" })).rejects.toThrow("notAllowed");
    await expect(alice.as.mutation(api.bookmarks.create, { url: "https://example.com/b" })).rejects.toThrow("notAllowed");
    await expect(t.query(api.bookmarks.findByUrl, { url: "https://example.com/a" })).rejects.toThrow("notAuthenticated");
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(mallory.as.mutation(api.bookmarks.create, { url: "https://example.com" })).rejects.toThrow("notAllowed");
  });
});

describe("ownership", () => {
  test("another user's bookmark, collection and tag ids are all notFound", async () => {
    const { t, alice, bob } = await setup();
    const id = await save(alice, "https://example.com/a", { tags: ["x"] });
    const collectionId = await alice.as.mutation(api.collections.create, { name: "Mine" });
    const tagId = await tagIdOf(alice, "x");
    await alice.as.mutation(api.bookmarks.trash, { id: await save(alice, "https://example.com/trashed") });
    const trashedId = (await list(alice, { view: "trash" }))[0]!._id;

    const mine = async (u: Signed) => ({
      bookmark: await save(u, "https://example.com/own"),
      collection: await u.as.mutation(api.collections.create, { name: "Own" }),
    });
    const bobs = await mine(bob);

    await expect(bob.as.query(api.bookmarks.get, { id })).rejects.toThrow("notFound");
    for (const mutation of [
      api.bookmarks.toggleFavorite, api.bookmarks.toggleUnread, api.bookmarks.trash,
      api.bookmarks.restore, api.bookmarks.deleteForever,
    ]) {
      await expect(bob.as.mutation(mutation, { id })).rejects.toThrow("notFound");
    }
    await expect(bob.as.mutation(api.bookmarks.deleteForever, { id: trashedId })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.bookmarks.update, { id, title: "hacked" })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.bookmarks.setTags, { id, tags: ["y"] })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.bookmarks.move, { id, collectionId: bobs.collection })).rejects.toThrow("notFound");

    // Alice's collection / tag as a target or scope for Bob.
    await expect(bob.as.mutation(api.bookmarks.create, { url: "https://example.com/z", collectionId })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.bookmarks.update, { id: bobs.bookmark, collectionId })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.bookmarks.move, { id: bobs.bookmark, collectionId })).rejects.toThrow("notFound");
    await expect(
      bob.as.mutation(api.bookmarks.bulk, { ids: [bobs.bookmark], action: { type: "move", collectionId } }),
    ).rejects.toThrow("notFound");
    await expect(list(bob, { view: "collection", collectionId })).rejects.toThrow("notFound");
    await expect(list(bob, { view: "all", tagId })).rejects.toThrow("notFound");
    await expect(find(bob, "example", { view: "collection", collectionId })).rejects.toThrow("notFound");
    await expect(find(bob, "example", { tagId })).rejects.toThrow("notFound");

    // Nothing of Alice's changed.
    expect((await alice.as.query(api.bookmarks.get, { id })).title).toBe("");
    await expectConsistent(t);
  });

  test("bulk with one foreign id fails as a whole and changes nothing", async () => {
    const { t, alice, bob } = await setup();
    const mine: Id<"bookmarks">[] = [];
    for (let i = 0; i < 5; i++) mine.push(await save(alice, `https://example.com/${i}`));
    const foreign = await save(bob, "https://example.com/bob");
    await expect(
      alice.as.mutation(api.bookmarks.bulk, { ids: [...mine, foreign], action: { type: "trash" } }),
    ).rejects.toThrow("notFound");
    expect(await list(alice, { view: "all" })).toHaveLength(5);
    expect(await list(bob, { view: "all" })).toHaveLength(1);
    await expectConsistent(t);
  });

  test("duplicates are per user; findByUrl, list and search never cross users", async () => {
    const { t, alice, bob } = await setup();
    const a = await save(alice, "https://example.com/shared", { title: "alice's secret" });
    const b = await save(bob, "https://example.com/shared", { title: "bob's" });
    expect(a).not.toBe(b);
    expect((await alice.as.query(api.bookmarks.findByUrl, { url: "https://example.com/shared" }))?._id).toBe(a);
    expect((await bob.as.query(api.bookmarks.findByUrl, { url: "https://example.com/shared" }))?._id).toBe(b);
    expect(await list(bob, { view: "all" })).toHaveLength(1);
    expect(urls(await find(bob, "secret"))).toEqual([]);
    await expectConsistent(t);
  });

  test("#tag and @collection shortcuts only see the caller's own names", async () => {
    const { t, alice, bob } = await setup();
    const c = await alice.as.mutation(api.collections.create, { name: "Private" });
    await save(alice, "https://example.com/a", { tags: ["secret"], collectionId: c, title: "hello" });
    await save(bob, "https://example.com/b", { title: "hello" });
    expect(await find(bob, "#secret hello")).toEqual([]);
    expect(await find(bob, "@Private hello")).toEqual([]);
    expect(await find(bob, "#secret")).toEqual([]);
    expect(urls(await find(alice, "#secret hello"))).toEqual(["https://example.com/a"]);
    await expectConsistent(t);
  });
});

describe("create and duplicates", () => {
  test("stores the bookmark pending, with domain, tags and counters", async () => {
    const { t, alice } = await setup();
    const c = await alice.as.mutation(api.collections.create, { name: "Reading" });
    const res = await alice.as.mutation(api.bookmarks.create, {
      url: " https://www.Example.com/post?utm_source=x&id=3#top ",
      title: "A post\nwith a break",
      tags: ["Rust", "#rust", " web dev ", ""],
      collectionId: c,
      favorite: true,
    });
    expect(res.existed).toBe(false);
    const b = await alice.as.query(api.bookmarks.get, { id: res.id });
    expect(b).toMatchObject({
      url: "https://www.Example.com/post?utm_source=x&id=3#top",
      domain: "example.com",
      title: "A post with a break",
      favorite: true,
      unread: false,
      metaStatus: "pending",
      collectionId: c,
    });
    expect(b.tagIds).toHaveLength(2);
    expect((await alice.as.query(api.tags.list, {})).map((x) => [x.name, x.count])).toEqual([["rust", 1], ["web dev", 1]]);
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(1);
    await expectConsistent(t);
  });

  test("a URL that normalizes to an existing one is not saved twice", async () => {
    const { t, alice } = await setup();
    const first = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/page", title: "Keep me" });
    for (const url of [
      "https://www.example.com/page/",
      "HTTPS://EXAMPLE.COM:443/page#frag",
      "https://example.com/page?utm_campaign=a&fbclid=b",
    ]) {
      const again = await alice.as.mutation(api.bookmarks.create, { url, title: "Other" });
      expect(again).toEqual({ id: first.id, existed: true });
    }
    // Different query params are different pages.
    expect((await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/page?id=2" })).existed).toBe(false);
    expect((await alice.as.query(api.bookmarks.get, { id: first.id })).title).toBe("Keep me");
    expect(await list(alice, { view: "all" })).toHaveLength(2);
    await expectConsistent(t);
  });

  test("saving a URL that is in the trash restores it", async () => {
    const { t, alice } = await setup();
    const c = await alice.as.mutation(api.collections.create, { name: "C" });
    const id = await save(alice, "https://example.com/x", { collectionId: c, tags: ["t"] });
    await alice.as.mutation(api.bookmarks.trash, { id });
    expect(await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/x" })).toEqual({ id, existed: true });
    expect(urls(await list(alice, { view: "all" }))).toEqual(["https://example.com/x"]);
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(1);
    await expectConsistent(t);
  });

  test("findByUrl matches after normalization, null otherwise", async () => {
    const { alice } = await setup();
    const id = await save(alice, "https://example.com/p");
    expect((await alice.as.query(api.bookmarks.findByUrl, { url: "https://www.example.com/p/#x" }))?._id).toBe(id);
    expect(await alice.as.query(api.bookmarks.findByUrl, { url: "https://example.com/other" })).toBeNull();
    expect(await alice.as.query(api.bookmarks.findByUrl, { url: "not a url" })).toBeNull();
  });

  test("changing the URL on update checks for duplicates and re-queues metadata", async () => {
    const { t, alice } = await setup();
    const a = await save(alice, "https://example.com/a");
    await save(alice, "https://example.com/b");
    await expect(alice.as.mutation(api.bookmarks.update, { id: a, url: "https://www.example.com/b/" })).rejects.toThrow("duplicate");
    await t.run((ctx) => ctx.db.patch("bookmarks", a, { metaStatus: "done" }));
    await alice.as.mutation(api.bookmarks.update, { id: a, url: "https://other.org/c" });
    expect(await alice.as.query(api.bookmarks.get, { id: a })).toMatchObject({ domain: "other.org", metaStatus: "pending" });
    await alice.as.mutation(api.bookmarks.update, { id: a, url: "https://other.org/c#same" }); // same page, no clash with itself
    await expectConsistent(t);
  });
});

describe("limits", () => {
  test("bad URLs and over-long fields are rejected with plain codes", async () => {
    const { alice } = await setup();
    const create = (args: Record<string, unknown>) =>
      alice.as.mutation(api.bookmarks.create, { url: "https://example.com", ...args });
    for (const url of ["", "ftp://example.com", "javascript:alert(1)", "example.com", "http://"]) {
      await expect(create({ url })).rejects.toThrow("invalidUrl");
    }
    await expect(create({ url: `https://example.com/${"a".repeat(LIMITS.urlMax)}` })).rejects.toThrow("tooLong");
    await expect(create({ title: "t".repeat(LIMITS.titleMax + 1) })).rejects.toThrow("tooLong");
    await expect(create({ description: "d".repeat(LIMITS.descriptionMax + 1) })).rejects.toThrow("tooLong");
    await expect(create({ note: "n".repeat(LIMITS.noteMax + 1) })).rejects.toThrow("tooLong");
    await expect(create({ tags: ["x".repeat(LIMITS.tagNameMax + 1)] })).rejects.toThrow("tooLong");
    // Exactly at the limit is fine.
    await create({ title: "t".repeat(LIMITS.titleMax), description: "d".repeat(LIMITS.descriptionMax), note: "n".repeat(LIMITS.noteMax) });
    expect(await list(alice, { view: "all" })).toHaveLength(1);
  });

  test("tag limits: 20 per bookmark, 1,000 per user", async () => {
    const { t, alice } = await setup();
    const twenty = Array.from({ length: LIMITS.tagsPerBookmark }, (_, i) => `t${i}`);
    const id = await save(alice, "https://example.com/a", { tags: twenty });
    await expect(alice.as.mutation(api.bookmarks.setTags, { id, tags: [...twenty, "one more"] })).rejects.toThrow("limitReached");
    await expect(
      alice.as.mutation(api.bookmarks.bulk, { ids: [id], action: { type: "addTag", tag: "one more" } }),
    ).rejects.toThrow("limitReached");
    // 20 distinct names after normalization is still 20.
    await alice.as.mutation(api.bookmarks.setTags, { id, tags: [...twenty, "#T0", " t1 "] });

    await t.run(async (ctx) => {
      const have = (await ctx.db.query("tags").collect()).length;
      for (let i = have; i < LIMITS.tagsPerUser; i++) {
        await ctx.db.insert("tags", { userId: alice.userId, name: `fill${i}`, bookmarkCount: 0 });
      }
    });
    await expect(save(alice, "https://example.com/b", { tags: ["brand new"] })).rejects.toThrow("limitReached");
    await save(alice, "https://example.com/b", { tags: ["t0"] }); // existing tags still work
  });

  test("100,000 bookmarks per user, and 200 ids per bulk call", async () => {
    const { t, alice, bob } = await setup();
    await t.run((ctx) => ctx.db.insert("userStats", { userId: alice.userId, bookmarkCount: LIMITS.bookmarksPerUser }));
    await expect(save(alice, "https://example.com/a")).rejects.toThrow("limitReached");
    await save(bob, "https://example.com/a"); // someone else's cap is separate

    const ids = await t.run(async (ctx) => {
      const out: Id<"bookmarks">[] = [];
      const now = Date.now();
      for (let i = 0; i <= LIMITS.bulkIds; i++) {
        out.push(await ctx.db.insert("bookmarks", {
          userId: bob.userId, url: `https://x.com/${i}`, normalizedUrl: `https://x.com/${i}`, domain: "x.com",
          title: "", description: "", note: "", tagIds: [], favorite: false, unread: false,
          metaStatus: "pending", searchText: "", createdAt: now, updatedAt: now,
        }));
      }
      return out;
    });
    await expect(
      bob.as.mutation(api.bookmarks.bulk, { ids, action: { type: "favorite", value: true } }),
    ).rejects.toThrow("limitReached");
    expect(await bob.as.mutation(api.bookmarks.bulk, { ids: ids.slice(0, LIMITS.bulkIds), action: { type: "favorite", value: true } })).toEqual({ changed: LIMITS.bulkIds });
  });
});

describe("views, sorting and paging", () => {
  async function seeded() {
    const ctx = await setup();
    const { alice } = ctx;
    vi.useFakeTimers({ toFake: ["Date"] });
    const col = await alice.as.mutation(api.collections.create, { name: "Col" });
    const put = async (url: string, extra: Record<string, unknown> = {}) => {
      vi.setSystemTime(Date.now() + 1000);
      return await save(alice, url, extra);
    };
    const b1 = await put("https://zeta.com/1", { title: "Banana", collectionId: col });
    const b2 = await put("https://alpha.com/2", { title: "apple", favorite: true });
    const b3 = await put("https://mid.com/3", { title: "Cherry", unread: true, collectionId: col, favorite: true });
    const b4 = await put("https://alpha.com/4", { title: "Date" });
    return { ...ctx, col, b1, b2, b3, b4 };
  }

  test("views: all, unsorted, collection, favorites, unread", async () => {
    const { alice, col } = await seeded();
    expect(urls(await list(alice, { view: "all" }))).toEqual([
      "https://alpha.com/4", "https://mid.com/3", "https://alpha.com/2", "https://zeta.com/1",
    ]);
    expect(urls(await list(alice, { view: "unsorted" }))).toEqual(["https://alpha.com/4", "https://alpha.com/2"]);
    expect(urls(await list(alice, { view: "collection", collectionId: col }))).toEqual(["https://mid.com/3", "https://zeta.com/1"]);
    expect(urls(await list(alice, { view: "favorites" }))).toEqual(["https://mid.com/3", "https://alpha.com/2"]);
    expect(urls(await list(alice, { view: "unread" }))).toEqual(["https://mid.com/3"]);
    await expect(list(alice, { view: "collection" })).rejects.toThrow("notFound");
  });

  test("sorts: newest, oldest, title, domain, in every view that supports them", async () => {
    const { alice, col } = await seeded();
    const titles = async (args: Parameters<typeof list>[1]) => (await list(alice, args)).map((b) => b.title);
    expect(await titles({ view: "all", sort: "oldest" })).toEqual(["Banana", "apple", "Cherry", "Date"]);
    expect(await titles({ view: "all", sort: "title" })).toEqual(["Banana", "Cherry", "Date", "apple"]); // plain code-point order
    expect(await titles({ view: "all", sort: "domain" })).toEqual(["apple", "Date", "Cherry", "Banana"]);
    expect(await titles({ view: "collection", collectionId: col, sort: "title" })).toEqual(["Banana", "Cherry"]);
    expect(await titles({ view: "collection", collectionId: col, sort: "domain" })).toEqual(["Cherry", "Banana"]);
    expect(await titles({ view: "unsorted", sort: "oldest" })).toEqual(["apple", "Date"]);
    expect(await titles({ view: "favorites", sort: "title" })).toEqual(["Cherry", "apple"]);
    expect(await titles({ view: "favorites", sort: "domain" })).toEqual(["apple", "Cherry"]);
    expect(await titles({ view: "unread", sort: "domain" })).toEqual(["Cherry"]);
    expect(await titles({ view: "unread", sort: "title" })).toEqual(["Cherry"]);
  });

  test("a tag's bookmarks, most recently tagged first, trashed ones left out", async () => {
    const { t, alice, b1, b2, b3 } = await seeded();
    for (const id of [b1, b2, b3]) await alice.as.mutation(api.bookmarks.setTags, { id, tags: ["x"] });
    const tagId = await tagIdOf(alice, "x");
    expect((await list(alice, { view: "all", tagId })).map((b) => b._id)).toEqual([b3, b2, b1]);
    await alice.as.mutation(api.bookmarks.trash, { id: b2 });
    expect((await list(alice, { view: "all", tagId })).map((b) => b._id)).toEqual([b3, b1]);
    await expectConsistent(t);
  });

  test("lists don't carry the note, get does", async () => {
    const { alice } = await setup();
    const id = await save(alice, "https://example.com/n", { note: "private words" });
    const [row] = await list(alice, { view: "all" });
    expect(row).toMatchObject({ hasNote: true });
    expect(JSON.stringify(row)).not.toContain("private words");
    expect((await alice.as.query(api.bookmarks.get, { id })).note).toBe("private words");
  });
});

describe("flags, move and counters", () => {
  test("favorite, unread, move and tags keep every counter right", async () => {
    const { t, alice } = await setup();
    const c1 = await alice.as.mutation(api.collections.create, { name: "One" });
    const c2 = await alice.as.mutation(api.collections.create, { name: "Two" });
    const id = await save(alice, "https://example.com/a", { collectionId: c1, tags: ["a", "b"] });
    expect(await alice.as.mutation(api.bookmarks.toggleFavorite, { id })).toBe(true);
    expect(await alice.as.mutation(api.bookmarks.toggleUnread, { id })).toBe(true);
    await alice.as.mutation(api.bookmarks.move, { id, collectionId: c2 });
    await alice.as.mutation(api.bookmarks.setTags, { id, tags: ["b", "c"] });
    const counts = Object.fromEntries((await alice.as.query(api.collections.list, {})).map((c) => [c.name, c.bookmarkCount]));
    expect(counts).toEqual({ One: 0, Two: 1 });
    expect(Object.fromEntries((await alice.as.query(api.tags.list, {})).map((x) => [x.name, x.count]))).toEqual({ a: 0, b: 1, c: 1 });
    await alice.as.mutation(api.bookmarks.move, { id, collectionId: null });
    expect((await alice.as.query(api.bookmarks.get, { id })).collectionId).toBeUndefined();
    await expectConsistent(t);
  });

  test("trashed bookmarks can't be edited, only restored or deleted", async () => {
    const { alice } = await setup();
    const id = await save(alice, "https://example.com/a");
    await alice.as.mutation(api.bookmarks.trash, { id });
    await expect(alice.as.mutation(api.bookmarks.update, { id, title: "x" })).rejects.toThrow("inTrash");
    await expect(alice.as.mutation(api.bookmarks.toggleFavorite, { id })).rejects.toThrow("inTrash");
    await expect(alice.as.mutation(api.bookmarks.restore, { id: await save(alice, "https://example.com/live") })).rejects.toThrow("notInTrash");
  });

  test("bulk: move, add and remove tag, favorite, trash; trashed ones are skipped", async () => {
    const { t, alice } = await setup();
    const col = await alice.as.mutation(api.collections.create, { name: "C" });
    const ids: Id<"bookmarks">[] = [];
    for (let i = 0; i < 4; i++) ids.push(await save(alice, `https://example.com/${i}`, { tags: i === 0 ? ["old"] : [] }));
    await alice.as.mutation(api.bookmarks.trash, { id: ids[3]! });
    const run = (action: FunctionArgs<typeof api.bookmarks.bulk>["action"]) =>
      alice.as.mutation(api.bookmarks.bulk, { ids, action });

    expect(await run({ type: "move", collectionId: col })).toEqual({ changed: 3 });
    expect(await run({ type: "addTag", tag: "New" })).toEqual({ changed: 3 });
    expect(await run({ type: "addTag", tag: "new" })).toEqual({ changed: 0 }); // already there
    expect(await run({ type: "removeTag", tag: "old" })).toEqual({ changed: 1 });
    expect(await run({ type: "removeTag", tag: "never-existed" })).toEqual({ changed: 0 });
    expect(await run({ type: "favorite", value: true })).toEqual({ changed: 3 });
    expect(urls(await list(alice, { view: "favorites" }))).toHaveLength(3);
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(3);
    expect(await run({ type: "trash" })).toEqual({ changed: 3 });
    expect(await list(alice, { view: "all" })).toEqual([]);
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(0);
    expect(await alice.as.query(api.tags.list, {})).toMatchObject([{ name: "new", count: 0 }, { name: "old", count: 0 }]);
    await expectConsistent(t);
  });
});

describe("trash", () => {
  test("trash, restore, delete forever, empty trash", async () => {
    const { t, alice } = await setup();
    const col = await alice.as.mutation(api.collections.create, { name: "C" });
    const a = await save(alice, "https://example.com/a", { collectionId: col, tags: ["t"] });
    const b = await save(alice, "https://example.com/b", { tags: ["t"] });
    const c = await save(alice, "https://example.com/c");
    await alice.as.mutation(api.bookmarks.trash, { id: a });
    await alice.as.mutation(api.bookmarks.trash, { id: a }); // idempotent
    await alice.as.mutation(api.bookmarks.trash, { id: b });
    expect(urls(await list(alice, { view: "trash" }))).toEqual(["https://example.com/b", "https://example.com/a"]);
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(0);
    expect((await alice.as.query(api.tags.list, {}))[0]!.count).toBe(0);

    await alice.as.mutation(api.bookmarks.restore, { id: a });
    expect((await alice.as.query(api.collections.list, {}))[0]!.bookmarkCount).toBe(1);
    expect((await alice.as.query(api.tags.list, {}))[0]!.count).toBe(1);
    await expect(alice.as.mutation(api.bookmarks.deleteForever, { id: a })).rejects.toThrow("notInTrash");

    await alice.as.mutation(api.bookmarks.deleteForever, { id: b });
    await expect(alice.as.query(api.bookmarks.get, { id: b })).rejects.toThrow("notFound");
    await alice.as.mutation(api.bookmarks.trash, { id: c });
    await alice.as.mutation(api.bookmarks.emptyTrash, {});
    expect(await list(alice, { view: "trash" })).toEqual([]);
    expect(urls(await list(alice, { view: "all" }))).toEqual(["https://example.com/a"]);
    await expectConsistent(t);
  });

  test("emptyTrash continues in batches and leaves other users and live bookmarks alone", async () => {
    vi.useFakeTimers();
    const { t, alice, bob } = await setup();
    await save(alice, "https://example.com/live");
    await save(bob, "https://example.com/bobs-trash");
    await bob.as.mutation(api.bookmarks.trash, { id: (await list(bob, { view: "all" }))[0]!._id });
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 101; i++) {
        await ctx.db.insert("bookmarks", {
          userId: alice.userId, url: `https://x.com/${i}`, normalizedUrl: `https://x.com/${i}`, domain: "x.com",
          title: "", description: "", note: "", tagIds: [], favorite: false, unread: false,
          metaStatus: "pending", searchText: "", deletedAt: now, createdAt: now, updatedAt: now,
        });
      }
      const stats = await ctx.db.query("userStats").withIndex("by_user", (q) => q.eq("userId", alice.userId)).unique();
      await ctx.db.patch("userStats", stats!._id, { bookmarkCount: 102 });
    });
    await alice.as.mutation(api.bookmarks.emptyTrash, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await list(alice, { view: "trash" })).toEqual([]);
    expect(urls(await list(alice, { view: "all" }))).toEqual(["https://example.com/live"]);
    expect(await list(bob, { view: "trash" })).toHaveLength(1);
    await expectConsistent(t);
  });

  test("the purge job removes only bookmarks trashed more than 30 days ago", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    const old = await save(alice, "https://example.com/old");
    const recent = await save(alice, "https://example.com/recent");
    const live = await save(alice, "https://example.com/live", { tags: ["t"] });
    await alice.as.mutation(api.bookmarks.trash, { id: old });
    await alice.as.mutation(api.bookmarks.trash, { id: recent });
    await t.run(async (ctx) => {
      await ctx.db.patch("bookmarks", old, { deletedAt: Date.now() - (LIMITS.trashDays + 1) * DAY });
      await ctx.db.patch("bookmarks", recent, { deletedAt: Date.now() - (LIMITS.trashDays - 1) * DAY });
    });
    await t.mutation(internal.bookmarks.purgeTrash, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("bookmarks").collect());
    expect(left.map((b) => b._id).sort()).toEqual([recent, live].sort());
    await expectConsistent(t);
  });
});

describe("search", () => {
  test("a search filter on deletedAt really excludes trashed rows (base assumption)", async () => {
    const { alice } = await setup();
    const a = await save(alice, "https://example.com/a", { title: "needle one" });
    await save(alice, "https://example.com/b", { title: "needle two" });
    await alice.as.mutation(api.bookmarks.trash, { id: a });
    expect(urls(await find(alice, "needle"))).toEqual(["https://example.com/b"]);
    expect(urls(await find(alice, "needle", { view: "trash" }))).toEqual(["https://example.com/a"]);
  });

  test("matches title, description, note, URL and tag names", async () => {
    const { alice } = await setup();
    await save(alice, "https://example.com/1", { title: "alphaword" });
    await save(alice, "https://example.com/2", { description: "betaword here" });
    await save(alice, "https://example.com/3", { note: "gammaword" });
    await save(alice, "https://deltaword.org/4");
    await save(alice, "https://example.com/5", { tags: ["epsilonword"] });
    for (const [q, url] of [
      ["alphaword", "https://example.com/1"], ["betaword", "https://example.com/2"],
      ["gammaword", "https://example.com/3"], ["deltaword", "https://deltaword.org/4"],
      ["epsilonword", "https://example.com/5"],
    ] as const) {
      expect(urls(await find(alice, q))).toEqual([url]);
    }
    expect(await find(alice, "   ")).toEqual([]);
  });

  test("works inside the current collection, unsorted, favorites, unread and tag", async () => {
    const { alice } = await setup();
    const col = await alice.as.mutation(api.collections.create, { name: "Col" });
    await save(alice, "https://example.com/in", { title: "match in", collectionId: col, favorite: true, tags: ["x"] });
    await save(alice, "https://example.com/out", { title: "match out", unread: true });
    expect(await find(alice, "match")).toHaveLength(2);
    expect(urls(await find(alice, "match", { view: "collection", collectionId: col }))).toEqual(["https://example.com/in"]);
    expect(urls(await find(alice, "match", { view: "unsorted" }))).toEqual(["https://example.com/out"]);
    expect(urls(await find(alice, "match", { view: "favorites" }))).toEqual(["https://example.com/in"]);
    expect(urls(await find(alice, "match", { view: "unread" }))).toEqual(["https://example.com/out"]);
    expect(urls(await find(alice, "match", { tagId: await tagIdOf(alice, "x") }))).toEqual(["https://example.com/in"]);
  });

  test("#tag and @collection shortcuts, with and without words", async () => {
    const { alice } = await setup();
    const col = await alice.as.mutation(api.collections.create, { name: "Read Later" });
    await save(alice, "https://example.com/1", { title: "rust guide", tags: ["rust", "guide"], collectionId: col });
    await save(alice, "https://example.com/2", { title: "rust news", tags: ["rust"] });
    await save(alice, "https://example.com/3", { title: "go guide", tags: ["guide"], collectionId: col });
    expect(urls(await find(alice, "#rust"))).toHaveLength(2);
    expect(urls(await find(alice, "rust #guide"))).toEqual(["https://example.com/1"]);
    expect(urls(await find(alice, "#RUST #guide"))).toEqual(["https://example.com/1"]);
    expect(urls(await find(alice, '@"read later" guide'))).toHaveLength(2);
    expect(urls(await find(alice, '@"READ LATER" #rust'))).toEqual(["https://example.com/1"]);
    expect(await find(alice, "#nosuchtag")).toEqual([]);
    expect(await find(alice, "@nosuchcollection rust")).toEqual([]);
    // The shortcut and the current scope are intersected.
    expect(await find(alice, '@"Read Later" rust', { view: "unsorted" })).toEqual([]);
    expect(urls(await find(alice, "rust", { view: "all", tagId: await tagIdOf(alice, "guide") }))).toEqual(["https://example.com/1"]);
  });

  test("renaming a tag keeps its bookmarks searchable by the new name", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    await save(alice, "https://example.com/1", { tags: ["oldname"] });
    await alice.as.mutation(api.tags.rename, { id: await tagIdOf(alice, "oldname"), name: "newname" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await find(alice, "oldname")).toEqual([]);
    expect(urls(await find(alice, "newname"))).toEqual(["https://example.com/1"]);
    await expectConsistent(t);
  });
});
