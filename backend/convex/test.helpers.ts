/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, vi } from "vitest";
import schema from "./schema";

export const modules = import.meta.glob("./**/*.ts");

export function newTest() {
  vi.stubEnv("ALLOWED_EMAILS", "alice@example.com, Bob@Example.com");
  vi.stubEnv("SITE_URL", "http://localhost:5173");
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof newTest>;

export async function signedInUser(t: TestConvex, email: string) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|session-${email}` }) };
}

export type Signed = Awaited<ReturnType<typeof signedInUser>>;

/** Reads every page of a paginated query (small pages, to exercise paging). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function allPages<T>(run: (opts: { numItems: number; cursor: string | null }) => Promise<any>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 200; i++) {
    const result: { page: T[]; isDone: boolean; continueCursor: string } = await run({ numItems: 3, cursor });
    out.push(...result.page);
    if (result.isDone) return out;
    cursor = result.continueCursor;
  }
  throw new Error("pagination did not finish");
}

/**
 * Recomputes every derived value from the rows and compares it with what is
 * stored: collection and tag counters (live bookmarks only), the per-user
 * total, and the bookmarkTags join rows. Call at the end of multi-step tests.
 */
export async function expectConsistent(t: TestConvex) {
  await t.run(async (ctx) => {
    const bookmarks = await ctx.db.query("bookmarks").collect();
    const live = bookmarks.filter((b) => b.deletedAt === undefined);
    const problems: string[] = [];

    for (const c of await ctx.db.query("collections").collect()) {
      const n = live.filter((b) => b.collectionId === c._id).length;
      if (c.bookmarkCount !== n) problems.push(`collection ${c.name}: stored ${c.bookmarkCount}, actual ${n}`);
    }
    for (const tag of await ctx.db.query("tags").collect()) {
      const n = live.filter((b) => b.tagIds.includes(tag._id)).length;
      if (tag.bookmarkCount !== n) problems.push(`tag ${tag.name}: stored ${tag.bookmarkCount}, actual ${n}`);
    }
    const stats = await ctx.db.query("userStats").collect();
    for (const userId of new Set(bookmarks.map((b) => b.userId))) {
      const n = bookmarks.filter((b) => b.userId === userId).length;
      const stored = stats.find((s) => s.userId === userId)?.bookmarkCount ?? 0;
      if (stored !== n) problems.push(`userStats: stored ${stored}, actual ${n}`);
    }
    const links = await ctx.db.query("bookmarkTags").collect();
    const expected = bookmarks.flatMap((b) => b.tagIds.map((tagId) => `${b._id}|${tagId}`)).sort();
    const actual = links.map((l) => `${l.bookmarkId}|${l.tagId}`).sort();
    if (expected.join() !== actual.join()) problems.push(`bookmarkTags rows differ from tagIds (${actual.length} vs ${expected.length})`);
    for (const b of bookmarks) {
      for (const id of b.tagIds) {
        const tag = await ctx.db.get("tags", id);
        if (tag === null) problems.push(`${b.url} has a dangling tag`);
        else if (!b.searchText.includes(tag.name)) problems.push(`${b.url}: searchText lacks tag ${tag.name}`);
      }
    }
    expect(problems).toEqual([]);
  });
}
