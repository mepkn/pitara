import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LIMITS } from "../../shared/limits";
import { expectConsistent, newTest, signedInUser, type Signed, type TestConvex } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const t = newTest();
  return { t, alice: await signedInUser(t, "alice@example.com"), bob: await signedInUser(t, "bob@example.com") };
}

const make = (u: Signed, name: string, parentId?: Id<"collections">) =>
  u.as.mutation(api.collections.create, { name, parentId });

const tree = async (u: Signed) =>
  (await u.as.query(api.collections.list, {})).map((c) => `${c.parentId ? "  " : ""}${c.name}`);

async function insertBookmarks(t: TestConvex, userId: Id<"users">, collectionId: Id<"collections">, n: number, deletedAt?: number) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("bookmarks", {
        userId, url: `https://x.com/${collectionId}/${i}/${deletedAt ?? "live"}`, normalizedUrl: `https://x.com/${collectionId}/${i}/${deletedAt ?? "live"}`,
        domain: "x.com", title: "", description: "", note: "", collectionId, tagIds: [], favorite: false,
        unread: false, metaStatus: "pending", searchText: "", deletedAt, createdAt: now, updatedAt: now,
      });
    }
    const stats = await ctx.db.query("userStats").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (stats) await ctx.db.patch("userStats", stats._id, { bookmarkCount: stats.bookmarkCount + n });
    else await ctx.db.insert("userStats", { userId, bookmarkCount: n });
    const c = await ctx.db.get("collections", collectionId);
    if (c && deletedAt === undefined) await ctx.db.patch("collections", collectionId, { bookmarkCount: c.bookmarkCount + n });
  });
}

describe("collections", () => {
  test("create, rename, list order and name rules", async () => {
    const { alice } = await setup();
    const a = await make(alice, "  Work   stuff ");
    await make(alice, "Home");
    const child = await make(alice, "Reading", a);
    expect(await tree(alice)).toEqual(["Work stuff", "Home", "  Reading"]); // top level first, then children
    await alice.as.mutation(api.collections.rename, { id: child, name: "Books" });
    expect(await tree(alice)).toContain("  Books");
    await expect(make(alice, "   ")).rejects.toThrow("invalidName");
    await expect(make(alice, "x".repeat(LIMITS.collectionNameMax + 1))).rejects.toThrow("tooLong");
    await make(alice, "x".repeat(LIMITS.collectionNameMax));
    await expect(alice.as.mutation(api.collections.rename, { id: a, name: "" })).rejects.toThrow("invalidName");
  });

  test("at most 100 per user, and the cap is per user", async () => {
    const { t, alice, bob } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < LIMITS.collectionsPerUser; i++) {
        await ctx.db.insert("collections", { userId: alice.userId, name: `c${i}`, sortOrder: i, bookmarkCount: 0, updatedAt: 0 });
      }
    });
    await expect(make(alice, "one too many")).rejects.toThrow("limitReached");
    await make(bob, "fine");
  });

  test("two levels only: parent must be top-level, no self-parent, no nesting a parent", async () => {
    const { alice } = await setup();
    const a = await make(alice, "A");
    const b = await make(alice, "B");
    const child = await make(alice, "Child", a);
    await expect(make(alice, "Grandchild", child)).rejects.toThrow("invalidParent");
    await expect(alice.as.mutation(api.collections.move, { id: b, parentId: child })).rejects.toThrow("invalidParent");
    await expect(alice.as.mutation(api.collections.move, { id: b, parentId: b })).rejects.toThrow("invalidParent");
    await expect(alice.as.mutation(api.collections.move, { id: a, parentId: b })).rejects.toThrow("invalidParent"); // a has a child
    await alice.as.mutation(api.collections.move, { id: b, parentId: a }); // fine: b has no children
    expect(await tree(alice)).toEqual(["A", "  Child", "  B"]);
    await alice.as.mutation(api.collections.move, { id: child, parentId: null });
    expect(await tree(alice)).toEqual(["A", "Child", "  B"]);
    await alice.as.mutation(api.collections.move, { id: child, parentId: null }); // no-op
  });

  test("reorder sets the order among siblings only", async () => {
    const { alice } = await setup();
    const a = await make(alice, "A");
    const b = await make(alice, "B");
    const c = await make(alice, "C");
    const kid = await make(alice, "Kid", a);
    await alice.as.mutation(api.collections.reorder, { parentId: null, ids: [c, a, b] });
    expect(await tree(alice)).toEqual(["C", "A", "B", "  Kid"]);
    await expect(alice.as.mutation(api.collections.reorder, { parentId: null, ids: [kid] })).rejects.toThrow("invalidParent");
    await expect(alice.as.mutation(api.collections.reorder, { parentId: a, ids: [b] })).rejects.toThrow("invalidParent");
  });

  test("another user's collections are notFound everywhere, including inside reorder", async () => {
    const { alice, bob } = await setup();
    const a = await make(alice, "A");
    const mine = await make(bob, "Mine");
    await expect(alice.as.mutation(api.collections.rename, { id: a, name: "x" })).resolves.toBeNull();
    await expect(bob.as.mutation(api.collections.rename, { id: a, name: "x" })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.collections.move, { id: a, parentId: null })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.collections.move, { id: mine, parentId: a })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.collections.remove, { id: a })).rejects.toThrow("notFound");
    await expect(make(bob, "Child", a)).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.collections.reorder, { parentId: null, ids: [mine, a] })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.collections.reorder, { parentId: a, ids: [] })).rejects.toThrow("notFound");
    expect(await tree(bob)).toEqual(["Mine"]);
    expect(await tree(alice)).toEqual(["x"]);
  });

  test("removing: children go to the top level, bookmarks (trashed too) go to Unsorted", async () => {
    const { t, alice } = await setup();
    const other = await make(alice, "Other");
    const doomed = await make(alice, "Doomed");
    const kid = await make(alice, "Kid", doomed);
    const keep = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/kid", collectionId: kid });
    const inside = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/in", collectionId: doomed, tags: ["t"] });
    const trashed = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/gone", collectionId: doomed });
    await alice.as.mutation(api.bookmarks.trash, { id: trashed.id });
    await alice.as.mutation(api.collections.remove, { id: doomed });

    expect(await tree(alice)).toEqual(["Other", "Kid"]);
    expect((await alice.as.query(api.bookmarks.get, { id: inside.id })).collectionId).toBeUndefined();
    expect((await alice.as.query(api.bookmarks.get, { id: keep.id })).collectionId).toBe(kid);
    await alice.as.mutation(api.bookmarks.restore, { id: trashed.id });
    expect((await alice.as.query(api.bookmarks.get, { id: trashed.id })).collectionId).toBeUndefined();
    expect((await alice.as.query(api.collections.list, {})).find((c) => c._id === kid)!.bookmarkCount).toBe(1);
    expect(other).toBeDefined();
    await expectConsistent(t);
  });

  test("removing a big collection continues in batches", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    const big = await make(alice, "Big");
    await insertBookmarks(t, alice.userId, big, 101);
    await insertBookmarks(t, alice.userId, big, 5, Date.now()); // trashed ones too
    await alice.as.mutation(api.collections.remove, { id: big });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run((ctx) => ctx.db.query("bookmarks").collect());
    expect(left).toHaveLength(106);
    expect(left.every((b) => b.collectionId === undefined)).toBe(true);
    await expectConsistent(t);
  });
});
