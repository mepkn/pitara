import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getOwnedCollection, requireUserId } from "./lib/access";
import { LIMITS } from "../../shared/limits";

const RELEASE_BATCH = 100;

const collectionDoc = v.object({
  _id: v.id("collections"),
  name: v.string(),
  parentId: v.optional(v.id("collections")),
  sortOrder: v.number(),
  bookmarkCount: v.number(),
});

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed === "") throw new ConvexError("invalidName");
  if (trimmed.length > LIMITS.collectionNameMax) throw new ConvexError("tooLong");
  return trimmed;
}

// Flat list, top level first then children, each group by sortOrder. The
// client builds the tree. bookmarkCount counts live bookmarks directly in it.
export const list = query({
  args: {},
  returns: v.array(collectionDoc),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId))
      .take(LIMITS.collectionsPerUser);
    return rows.map(({ _id, name, parentId, sortOrder, bookmarkCount }) => ({
      _id, name, parentId, sortOrder, bookmarkCount,
    }));
  },
});

async function nextSortOrder(
  ctx: QueryCtx,
  userId: Id<"users">,
  parentId: Id<"collections"> | undefined,
): Promise<number> {
  const last = await ctx.db
    .query("collections")
    .withIndex("by_user_parent", (q) => q.eq("userId", userId).eq("parentId", parentId))
    .order("desc")
    .first();
  return last === null ? 0 : last.sortOrder + 1;
}

// A parent must be one of the caller's top-level collections.
async function getParent(
  ctx: QueryCtx,
  userId: Id<"users">,
  parentId: Id<"collections">,
): Promise<Doc<"collections">> {
  const parent = await getOwnedCollection(ctx, userId, parentId);
  if (parent.parentId !== undefined) throw new ConvexError("invalidParent");
  return parent;
}

async function hasChildren(ctx: QueryCtx, userId: Id<"users">, id: Id<"collections">): Promise<boolean> {
  const child = await ctx.db
    .query("collections")
    .withIndex("by_user_parent", (q) => q.eq("userId", userId).eq("parentId", id))
    .first();
  return child !== null;
}

/**
 * The caller's collection with this name under `parentId` (compared ignoring
 * case), created if there is none. Null if it would be the 101st collection.
 * For the importer; the app's own `create` refuses duplicates by other means.
 */
export async function findOrCreateCollection(
  ctx: MutationCtx,
  userId: Id<"users">,
  rawName: string,
  parentId: Id<"collections"> | undefined,
): Promise<{ id: Id<"collections">; created: boolean } | null> {
  // Names are cut to the limit rather than refused: an importer must not stop on a long folder name.
  const name = cleanName(rawName.trim().replace(/\s+/g, " ").slice(0, LIMITS.collectionNameMax));
  const owned = await ctx.db
    .query("collections")
    .withIndex("by_user_parent", (q) => q.eq("userId", userId))
    .take(LIMITS.collectionsPerUser);
  const hit = owned.find((c) => c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
  if (hit !== undefined) return { id: hit._id, created: false };
  if (owned.length >= LIMITS.collectionsPerUser) return null;
  const id = await ctx.db.insert("collections", {
    userId,
    name,
    parentId,
    sortOrder: await nextSortOrder(ctx, userId, parentId),
    bookmarkCount: 0,
    updatedAt: Date.now(),
  });
  return { id, created: true };
}

export const create = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("collections")) },
  returns: v.id("collections"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = cleanName(args.name);
    const parent = args.parentId === undefined ? undefined : await getParent(ctx, userId, args.parentId);
    const owned = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId))
      .take(LIMITS.collectionsPerUser);
    if (owned.length >= LIMITS.collectionsPerUser) throw new ConvexError("limitReached");
    return await ctx.db.insert("collections", {
      userId,
      name,
      parentId: parent?._id,
      sortOrder: await nextSortOrder(ctx, userId, parent?._id),
      bookmarkCount: 0,
      updatedAt: Date.now(),
    });
  },
});

export const rename = mutation({
  args: { id: v.id("collections"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const collection = await getOwnedCollection(ctx, userId, args.id);
    await ctx.db.patch("collections", collection._id, { name: cleanName(args.name), updatedAt: Date.now() });
    return null;
  },
});

// Nests a collection under a top-level one, or (parentId null) moves it to the
// top level, at the end of its new siblings. Two levels only: a collection that
// has children can't be nested, and a collection can't be its own parent.
export const move = mutation({
  args: { id: v.id("collections"), parentId: v.union(v.id("collections"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const collection = await getOwnedCollection(ctx, userId, args.id);
    let parentId: Id<"collections"> | undefined;
    if (args.parentId !== null) {
      const parent = await getParent(ctx, userId, args.parentId);
      if (parent._id === collection._id) throw new ConvexError("invalidParent");
      if (await hasChildren(ctx, userId, collection._id)) throw new ConvexError("invalidParent");
      parentId = parent._id;
    }
    if (parentId === collection.parentId) return null;
    await ctx.db.patch("collections", collection._id, {
      parentId,
      sortOrder: await nextSortOrder(ctx, userId, parentId),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// Sets sortOrder to the position in `ids`, which must all be children of
// `parentId` (null = top level).
export const reorder = mutation({
  args: { parentId: v.union(v.id("collections"), v.null()), ids: v.array(v.id("collections")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const ids = [...new Set(args.ids)];
    if (ids.length > LIMITS.collectionsPerUser) throw new ConvexError("limitReached");
    const parentId = args.parentId ?? undefined;
    if (parentId !== undefined) await getOwnedCollection(ctx, userId, parentId);
    const rows: Doc<"collections">[] = [];
    for (const id of ids) {
      const row = await getOwnedCollection(ctx, userId, id);
      if (row.parentId !== parentId) throw new ConvexError("invalidParent");
      rows.push(row);
    }
    const now = Date.now();
    for (const [index, row] of rows.entries()) {
      if (row.sortOrder !== index) await ctx.db.patch("collections", row._id, { sortOrder: index, updatedAt: now });
    }
    return null;
  },
});

// Puts up to RELEASE_BATCH of a removed collection's bookmarks (trashed ones
// too) back in Unsorted. Returns whether there may be more.
async function releaseBatch(ctx: MutationCtx, userId: Id<"users">, collectionId: Id<"collections">) {
  const rows = await ctx.db
    .query("bookmarks")
    .withIndex("by_user_collection", (q) => q.eq("userId", userId).eq("collectionId", collectionId))
    .take(RELEASE_BATCH);
  for (const b of rows) await ctx.db.patch("bookmarks", b._id, { collectionId: undefined });
  return rows.length === RELEASE_BATCH;
}

// Deletes the collection. Its children move to the top level; its bookmarks
// go to Unsorted (the rest of a big collection follows in scheduled batches).
export const remove = mutation({
  args: { id: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const collection = await getOwnedCollection(ctx, userId, args.id);
    const children = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId).eq("parentId", collection._id))
      .take(LIMITS.collectionsPerUser);
    let order = await nextSortOrder(ctx, userId, undefined);
    for (const child of children) {
      await ctx.db.patch("collections", child._id, { parentId: undefined, sortOrder: order++, updatedAt: Date.now() });
    }
    await ctx.db.delete("collections", collection._id);
    if (await releaseBatch(ctx, userId, collection._id)) {
      await ctx.scheduler.runAfter(0, internal.collections.releaseBookmarks, {
        userId,
        collectionId: collection._id,
      });
    }
    return null;
  },
});

export const releaseBookmarks = internalMutation({
  args: { userId: v.id("users"), collectionId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await releaseBatch(ctx, args.userId, args.collectionId)) {
      await ctx.scheduler.runAfter(0, internal.collections.releaseBookmarks, args);
    }
    return null;
  },
});
