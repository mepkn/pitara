import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { LIMITS } from "../../../shared/limits";
import { normalizeTagName } from "../../../shared/tags";

// Every write that changes a bookmark's collection, tags or trash state goes
// through applyChanges / removeBookmark, which keep four things in step:
//   - collections.bookmarkCount and tags.bookmarkCount (live bookmarks only)
//   - the bookmarkTags join rows (mirror of bookmarks.tagIds)
//   - bookmarks.searchText (title, description, note, url, tag names)
//   - userStats.bookmarkCount (all bookmarks, trashed included)

export function checkLength(value: string, max: number): string {
  if (value.length > max) throw new ConvexError("tooLong");
  return value;
}

/** Titles are one line. */
export function cleanTitle(title: string): string {
  return checkLength(title.replace(/[\r\n]+/g, " ").trim(), LIMITS.titleMax);
}

export function buildSearchText(
  b: { url: string; title: string; description: string; note: string },
  tagNames: string[],
): string {
  // The URL goes in twice: as is, and as plain words (host and path parts), so
  // "example" finds example.com/x whichever way the index splits tokens.
  const urlWords = b.url.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return [b.title, b.description, b.note, b.url, urlWords, ...tagNames].filter((s) => s !== "").join("\n");
}

async function tagNames(ctx: QueryCtx, tagIds: Id<"tags">[]): Promise<string[]> {
  const names: string[] = [];
  for (const id of tagIds) {
    const tag = await ctx.db.get("tags", id);
    if (tag !== null) names.push(tag.name);
  }
  return names;
}

// ---- per-user total --------------------------------------------------------

export async function bookmarkTotal(ctx: QueryCtx, userId: Id<"users">): Promise<number> {
  const stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return stats?.bookmarkCount ?? 0;
}

async function bumpTotal(ctx: MutationCtx, userId: Id<"users">, delta: number): Promise<void> {
  const stats = await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (stats === null) {
    await ctx.db.insert("userStats", { userId, bookmarkCount: Math.max(0, delta) });
  } else {
    await ctx.db.patch("userStats", stats._id, { bookmarkCount: Math.max(0, stats.bookmarkCount + delta) });
  }
}

// ---- tags ------------------------------------------------------------------

/**
 * Turns tag names into ids, creating the ones that don't exist yet.
 * Blank names are ignored; names are normalized (see shared/tags.ts).
 */
export async function resolveTags(
  ctx: MutationCtx,
  userId: Id<"users">,
  names: string[],
): Promise<Id<"tags">[]> {
  const wanted = [...new Set(names.map(normalizeTagName).filter((n) => n !== ""))];
  if (wanted.length > LIMITS.tagsPerBookmark) throw new ConvexError("limitReached");
  const ids: Id<"tags">[] = [];
  let owned: number | null = null;
  for (const name of wanted) {
    checkLength(name, LIMITS.tagNameMax);
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (existing !== null) {
      ids.push(existing._id);
      continue;
    }
    if (owned === null) {
      const all = await ctx.db
        .query("tags")
        .withIndex("by_user_name", (q) => q.eq("userId", userId))
        .take(LIMITS.tagsPerUser);
      owned = all.length;
    }
    if (owned >= LIMITS.tagsPerUser) throw new ConvexError("limitReached");
    owned += 1;
    ids.push(await ctx.db.insert("tags", { userId, name, bookmarkCount: 0 }));
  }
  return ids;
}

/** Finds an existing tag by (unnormalized) name without creating it. */
export async function findTagByName(
  ctx: QueryCtx,
  userId: Id<"users">,
  name: string,
): Promise<Doc<"tags"> | null> {
  const normalized = normalizeTagName(name);
  if (normalized === "") return null;
  return await ctx.db
    .query("tags")
    .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", normalized))
    .unique();
}

// ---- counters --------------------------------------------------------------

type Counted = Pick<Doc<"bookmarks">, "collectionId" | "tagIds" | "deletedAt">;

function add<K>(map: Map<K, number>, key: K, delta: number) {
  map.set(key, (map.get(key) ?? 0) + delta);
}

// A bookmark counts toward its collection and tags only while it is live.
async function moveCounters(ctx: MutationCtx, before: Counted | null, after: Counted | null) {
  const collections = new Map<Id<"collections">, number>();
  const tags = new Map<Id<"tags">, number>();
  for (const [state, sign] of [[before, -1], [after, 1]] as const) {
    if (state === null || state.deletedAt !== undefined) continue;
    if (state.collectionId !== undefined) add(collections, state.collectionId, sign);
    for (const tagId of state.tagIds) add(tags, tagId, sign);
  }
  for (const [id, delta] of collections) {
    if (delta === 0) continue;
    const doc = await ctx.db.get("collections", id);
    if (doc !== null) await ctx.db.patch("collections", id, { bookmarkCount: Math.max(0, doc.bookmarkCount + delta) });
  }
  for (const [id, delta] of tags) {
    if (delta === 0) continue;
    const doc = await ctx.db.get("tags", id);
    if (doc !== null) await ctx.db.patch("tags", id, { bookmarkCount: Math.max(0, doc.bookmarkCount + delta) });
  }
}

// ---- writes ----------------------------------------------------------------

export type BookmarkChanges = Partial<
  Pick<
    Doc<"bookmarks">,
    | "url" | "normalizedUrl" | "domain" | "title" | "description" | "note"
    | "collectionId" | "tagIds" | "favorite" | "unread" | "metaStatus" | "deletedAt"
    | "faviconUrl" | "imageUrl"
  >
>;

/**
 * Applies `changes` to a bookmark and fixes counters, join rows and search
 * text. A key present with value `undefined` clears that optional field
 * (`{ collectionId: undefined }` = Unsorted, `{ deletedAt: undefined }` = restore).
 * Returns the bookmark as stored afterwards.
 */
export async function applyChanges(
  ctx: MutationCtx,
  before: Doc<"bookmarks">,
  changes: BookmarkChanges,
): Promise<Doc<"bookmarks">> {
  const after = { ...before, ...changes, updatedAt: Date.now() };

  if (changes.tagIds !== undefined) {
    const kept = new Set(after.tagIds);
    const had = new Set(before.tagIds);
    const removed = before.tagIds.filter((id) => !kept.has(id));
    const added = after.tagIds.filter((id) => !had.has(id));
    if (removed.length > 0) {
      const rows = await ctx.db
        .query("bookmarkTags")
        .withIndex("by_bookmark", (q) => q.eq("bookmarkId", before._id))
        .take(LIMITS.tagsPerBookmark * 2);
      for (const row of rows) {
        if (!kept.has(row.tagId)) await ctx.db.delete("bookmarkTags", row._id);
      }
    }
    for (const tagId of added) {
      await ctx.db.insert("bookmarkTags", { userId: before.userId, bookmarkId: before._id, tagId });
    }
  }

  await moveCounters(ctx, before, after);

  const textChanged =
    changes.tagIds !== undefined ||
    changes.url !== undefined ||
    changes.title !== undefined ||
    changes.description !== undefined ||
    changes.note !== undefined;
  const searchText = textChanged
    ? buildSearchText(after, await tagNames(ctx, after.tagIds))
    : before.searchText;

  await ctx.db.patch("bookmarks", before._id, { ...changes, searchText, updatedAt: after.updatedAt });
  return { ...after, searchText };
}

/** Rebuilds searchText after a tag was renamed. Counters and links are untouched. */
export async function refreshSearchText(ctx: MutationCtx, bookmark: Doc<"bookmarks">): Promise<void> {
  const searchText = buildSearchText(bookmark, await tagNames(ctx, bookmark.tagIds));
  if (searchText !== bookmark.searchText) await ctx.db.patch("bookmarks", bookmark._id, { searchText });
}

export async function addBookmark(
  ctx: MutationCtx,
  fields: Omit<Doc<"bookmarks">, "_id" | "_creationTime" | "searchText">,
): Promise<Id<"bookmarks">> {
  const searchText = buildSearchText(fields, await tagNames(ctx, fields.tagIds));
  const id = await ctx.db.insert("bookmarks", { ...fields, searchText });
  for (const tagId of fields.tagIds) {
    await ctx.db.insert("bookmarkTags", { userId: fields.userId, bookmarkId: id, tagId });
  }
  await moveCounters(ctx, null, fields);
  await bumpTotal(ctx, fields.userId, 1);
  return id;
}

/** Deletes a bookmark for good (trash purge, "delete forever"). */
export async function removeBookmark(ctx: MutationCtx, bookmark: Doc<"bookmarks">): Promise<void> {
  const rows = await ctx.db
    .query("bookmarkTags")
    .withIndex("by_bookmark", (q) => q.eq("bookmarkId", bookmark._id))
    .take(LIMITS.tagsPerBookmark * 2);
  for (const row of rows) await ctx.db.delete("bookmarkTags", row._id);
  await moveCounters(ctx, bookmark, null);
  await ctx.db.delete("bookmarks", bookmark._id);
  await bumpTotal(ctx, bookmark.userId, -1);
}
