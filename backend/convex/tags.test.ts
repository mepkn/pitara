import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LIMITS } from "../../shared/limits";
import { allPages, expectConsistent, newTest, signedInUser, type Signed } from "./test.helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const t = newTest();
  return { t, alice: await signedInUser(t, "alice@example.com"), bob: await signedInUser(t, "bob@example.com") };
}

const save = async (u: Signed, url: string, tags: string[] = []) =>
  (await u.as.mutation(api.bookmarks.create, { url, tags })).id;
const tagList = async (u: Signed) =>
  Object.fromEntries((await u.as.query(api.tags.list, {})).map((x) => [x.name, x.count]));
const tagId = async (u: Signed, name: string) =>
  (await u.as.query(api.tags.list, {})).find((x) => x.name === name)!._id;
const tagsOf = async (u: Signed, id: Id<"bookmarks">) => {
  const b = await u.as.query(api.bookmarks.get, { id });
  const all = await u.as.query(api.tags.list, {});
  return b.tagIds.map((i) => all.find((x) => x._id === i)!.name).sort();
};

describe("tags", () => {
  test("created inline, lower-cased, listed with counts, per user", async () => {
    const { t, alice, bob } = await setup();
    await save(alice, "https://example.com/1", ["Rust", "web"]);
    await save(alice, "https://example.com/2", ["rust"]);
    await save(bob, "https://example.com/1", ["rust"]);
    expect(await tagList(alice)).toEqual({ rust: 2, web: 1 });
    expect(await tagList(bob)).toEqual({ rust: 1 });
    await expectConsistent(t);
  });

  test("another user's tag can't be renamed or deleted", async () => {
    const { alice, bob } = await setup();
    await save(alice, "https://example.com/1", ["mine"]);
    const id = await tagId(alice, "mine");
    await expect(bob.as.mutation(api.tags.rename, { id, name: "x" })).rejects.toThrow("notFound");
    await expect(bob.as.mutation(api.tags.remove, { id })).rejects.toThrow("notFound");
    expect(await tagList(alice)).toEqual({ mine: 1 });
    expect(await tagList(bob)).toEqual({});
  });

  test("rename: normalizes, validates, no-op for the same name", async () => {
    const { t, alice } = await setup();
    const b = await save(alice, "https://example.com/1", ["old"]);
    const id = await tagId(alice, "old");
    await expect(alice.as.mutation(api.tags.rename, { id, name: "  #  " })).rejects.toThrow("invalidName");
    await expect(alice.as.mutation(api.tags.rename, { id, name: "x".repeat(LIMITS.tagNameMax + 1) })).rejects.toThrow("tooLong");
    await alice.as.mutation(api.tags.rename, { id, name: "OLD" });
    await alice.as.mutation(api.tags.rename, { id, name: "  #New   Name " });
    expect(await tagList(alice)).toEqual({ "new name": 1 });
    expect(await tagsOf(alice, b)).toEqual(["new name"]);
    await expectConsistent(t);
  });

  test("renaming to an existing name merges the two tags", async () => {
    const { t, alice } = await setup();
    const onlyA = await save(alice, "https://example.com/a", ["js"]);
    const both = await save(alice, "https://example.com/both", ["js", "javascript"]);
    const onlyB = await save(alice, "https://example.com/b", ["javascript"]);
    const trashed = await save(alice, "https://example.com/t", ["js"]);
    await alice.as.mutation(api.bookmarks.trash, { id: trashed });
    await alice.as.mutation(api.tags.rename, { id: await tagId(alice, "js"), name: "JavaScript" });

    expect(await tagList(alice)).toEqual({ javascript: 3 });
    expect(await tagsOf(alice, onlyA)).toEqual(["javascript"]);
    expect(await tagsOf(alice, both)).toEqual(["javascript"]);
    expect(await tagsOf(alice, onlyB)).toEqual(["javascript"]);
    expect(await tagsOf(alice, trashed)).toEqual(["javascript"]); // trashed ones are merged too
    const found = await allPages<{ url: string }>((paginationOpts) =>
      alice.as.query(api.bookmarks.search, { query: "javascript", paginationOpts }),
    );
    expect(found).toHaveLength(3);
    await expectConsistent(t);
  });

  test("a big merge continues in batches", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    const ids: Id<"bookmarks">[] = [];
    for (let i = 0; i < 120; i++) ids.push(await save(alice, `https://example.com/${i}`, i % 3 === 0 ? ["src", "dst"] : ["src"]));
    await alice.as.mutation(api.tags.rename, { id: await tagId(alice, "src"), name: "dst" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await tagList(alice)).toEqual({ dst: 120 });
    await expectConsistent(t);
  });

  test("remove: deletes the tag from its bookmarks, which stay", async () => {
    const { t, alice } = await setup();
    const a = await save(alice, "https://example.com/a", ["x", "y"]);
    const b = await save(alice, "https://example.com/b", ["x"]);
    const gone = await save(alice, "https://example.com/c", ["x"]);
    await alice.as.mutation(api.bookmarks.trash, { id: gone });
    await alice.as.mutation(api.tags.remove, { id: await tagId(alice, "x") });
    expect(await tagList(alice)).toEqual({ y: 1 });
    expect(await tagsOf(alice, a)).toEqual(["y"]);
    expect(await tagsOf(alice, b)).toEqual([]);
    expect(await tagsOf(alice, gone)).toEqual([]);
    await expectConsistent(t);
  });

  test("removing a tag used by many bookmarks continues in batches", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    for (let i = 0; i < 130; i++) await save(alice, `https://example.com/${i}`, ["bulk", "keep"]);
    await alice.as.mutation(api.tags.remove, { id: await tagId(alice, "bulk") });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await tagList(alice)).toEqual({ keep: 130 });
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toHaveLength(130);
    await expectConsistent(t);
  });

  test("a big rename refreshes search text in batches", async () => {
    vi.useFakeTimers();
    const { t, alice } = await setup();
    for (let i = 0; i < 120; i++) await save(alice, `https://example.com/${i}`, ["before"]);
    await alice.as.mutation(api.tags.rename, { id: await tagId(alice, "before"), name: "after" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectConsistent(t); // every searchText contains the new name
    const found = await allPages<{ url: string }>((paginationOpts) =>
      alice.as.query(api.bookmarks.search, { query: "after", paginationOpts }),
    );
    expect(found).toHaveLength(120);
  });
});
