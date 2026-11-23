import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { requireAllowed } from "./lib/access";
import { applyChanges } from "./lib/bookmarkWrites";
import { insertBookmark, listBookmarks, searchBookmarks, updateBookmark } from "./bookmarks";
import { LIMITS } from "../../shared/limits";
import { normalizeUrl } from "../../shared/url";

// What the HTTP API (lib/apiRoutes.ts) calls once a token has been resolved to
// a user. Internal only: the user comes from the token, never from the caller.
// Each function re-checks the allowlist. Ids that arrive as text from a URL or
// a JSON body are checked with normalizeId, so a malformed one is `notFound`
// like a missing or foreign one.

const metaStatus = v.union(v.literal("pending"), v.literal("done"), v.literal("failed"));
const apiBookmark = v.object({
  id: v.string(),
  url: v.string(),
  domain: v.string(),
  title: v.string(),
  description: v.string(),
  note: v.optional(v.string()),
  hasNote: v.boolean(),
  collectionId: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  favorite: v.boolean(),
  unread: v.boolean(),
  faviconUrl: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
  metaStatus,
  linkStatus: v.union(v.literal("ok"), v.literal("broken"), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

async function toApi(ctx: QueryCtx, docs: Doc<"bookmarks">[], withNote: boolean) {
  const names = new Map<Id<"tags">, string>();
  for (const b of docs) {
    for (const id of b.tagIds) {
      if (names.has(id)) continue;
      const tag = await ctx.db.get("tags", id);
      if (tag !== null) names.set(id, tag.name);
    }
  }
  return docs.map((b) => ({
    id: b._id as string,
    url: b.url,
    domain: b.domain,
    title: b.title,
    description: b.description,
    ...(withNote ? { note: b.note } : {}),
    hasNote: b.note !== "",
    collectionId: (b.collectionId ?? null) as string | null,
    tags: b.tagIds.flatMap((id) => names.get(id) ?? []),
    favorite: b.favorite,
    unread: b.unread,
    faviconUrl: b.faviconUrl ?? null,
    imageUrl: b.imageUrl ?? null,
    metaStatus: b.metaStatus,
    linkStatus: b.linkStatus ?? null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
}

function ownBookmark(ctx: QueryCtx, userId: Id<"users">, id: string) {
  const bookmarkId = ctx.db.normalizeId("bookmarks", id);
  if (bookmarkId === null) throw new ConvexError("notFound");
  return ctx.db.get("bookmarks", bookmarkId).then((b) => {
    if (b === null || b.userId !== userId) throw new ConvexError("notFound");
    return b;
  });
}

function collectionArg(ctx: QueryCtx, id: string | null | undefined): Id<"collections"> | null | undefined {
  if (id === undefined || id === null) return id;
  const normalized = ctx.db.normalizeId("collections", id);
  if (normalized === null) throw new ConvexError("notFound");
  return normalized;
}

export const me = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ email: v.string() }),
  handler: async (ctx, args) => {
    await requireAllowed(ctx, args.userId);
    const user = await ctx.db.get("users", args.userId);
    return { email: user?.email ?? "" };
  },
});

// Is this URL already saved (live, after normalization)? The extension asks on every tab.
export const check = internalQuery({
  args: { userId: v.id("users"), url: v.string() },
  returns: v.union(apiBookmark, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const normalized = args.url.length > LIMITS.urlMax ? null : normalizeUrl(args.url);
    if (normalized === null) throw new ConvexError("invalidUrl");
    const found = await ctx.db
      .query("bookmarks")
      .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("normalizedUrl", normalized))
      .unique();
    if (found === null || found.deletedAt !== undefined) return null;
    return (await toApi(ctx, [found], true))[0]!;
  },
});

// A page of recent bookmarks (no `q`) or search hits. Pages can be short; the
// route keeps asking until it has enough or `isDone`.
export const find = internalQuery({
  args: { userId: v.id("users"), q: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(apiBookmark),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const result =
      args.q.trim() === ""
        ? await listBookmarks(ctx, userId, { view: "all", sort: "newest", paginationOpts: args.paginationOpts })
        : await searchBookmarks(ctx, userId, { query: args.q, paginationOpts: args.paginationOpts });
    return { page: await toApi(ctx, result.page, false), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    url: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    note: v.optional(v.string()),
    collectionId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
  },
  returns: v.object({ id: v.string(), existed: v.boolean() }),
  handler: async (ctx, { userId: id, collectionId, ...fields }) => {
    const userId = await requireAllowed(ctx, id);
    const collection = collectionArg(ctx, collectionId) ?? undefined;
    const result = await insertBookmark(ctx, userId, { ...fields, collectionId: collection });
    return { id: result.id as string, existed: result.existed };
  },
});

export const update = internalMutation({
  args: {
    userId: v.id("users"),
    id: v.string(),
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    note: v.optional(v.string()),
    collectionId: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
  },
  returns: apiBookmark,
  handler: async (ctx, { userId: asked, id, collectionId, ...fields }) => {
    const userId = await requireAllowed(ctx, asked);
    const bookmark = await ownBookmark(ctx, userId, id);
    await updateBookmark(ctx, userId, bookmark._id, { ...fields, collectionId: collectionArg(ctx, collectionId) });
    const after = await ctx.db.get("bookmarks", bookmark._id);
    return (await toApi(ctx, [after!], true))[0]!;
  },
});

// DELETE: moves to the trash (restorable in the app); already trashed is fine.
export const trash = internalMutation({
  args: { userId: v.id("users"), id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const bookmark = await ownBookmark(ctx, userId, args.id);
    if (bookmark.deletedAt === undefined) await applyChanges(ctx, bookmark, { deletedAt: Date.now() });
    return null;
  },
});

export const collections = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      parentId: v.union(v.string(), v.null()),
      sortOrder: v.number(),
      bookmarkCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const rows = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId))
      .take(LIMITS.collectionsPerUser);
    return rows.map((c) => ({
      id: c._id as string,
      name: c.name,
      parentId: (c.parentId ?? null) as string | null,
      sortOrder: c.sortOrder,
      bookmarkCount: c.bookmarkCount,
    }));
  },
});

export const tags = internalQuery({
  args: { userId: v.id("users") },
  returns: v.array(v.object({ id: v.string(), name: v.string(), count: v.number() })),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const rows = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .take(LIMITS.tagsPerUser);
    return rows.map((t) => ({ id: t._id as string, name: t.name, count: t.bookmarkCount }));
  },
});
