import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { PaginationOptions, PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getOwnedBookmark, getOwnedCollection, getOwnedTag, requireUserId } from "./lib/access";
import { scheduleMetadata } from "./metadata";
import {
  addBookmark,
  applyChanges,
  bookmarkTotal,
  checkLength,
  cleanTitle,
  findTagByName,
  removeBookmark,
  resolveTags,
  type BookmarkChanges,
} from "./lib/bookmarkWrites";
import { LIMITS } from "../../shared/limits";
import { parseQuery } from "../../shared/parseQuery";
import { getDomain, isValidHttpUrl, normalizeUrl } from "../../shared/url";

const PURGE_BATCH = 100;
const DAY = 24 * 60 * 60 * 1000;

// ---- validators ------------------------------------------------------------

const view = v.union(
  v.literal("all"),
  v.literal("unsorted"),
  v.literal("collection"),
  v.literal("favorites"),
  v.literal("unread"),
  v.literal("trash"),
);
const sort = v.union(v.literal("newest"), v.literal("oldest"), v.literal("title"), v.literal("domain"));
type View = typeof view.type;
type Sort = typeof sort.type;

const shared = {
  _id: v.id("bookmarks"),
  _creationTime: v.number(),
  url: v.string(),
  domain: v.string(),
  title: v.string(),
  description: v.string(),
  collectionId: v.optional(v.id("collections")),
  tagIds: v.array(v.id("tags")),
  favorite: v.boolean(),
  unread: v.boolean(),
  faviconUrl: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  metaStatus: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
  deletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};
// Lists leave the note (up to 20,000 characters) on the server.
const bookmarkSummary = v.object({ ...shared, hasNote: v.boolean() });
const bookmarkFull = v.object({ ...shared, note: v.string() });

function summarize(b: Doc<"bookmarks">) {
  return {
    _id: b._id,
    _creationTime: b._creationTime,
    url: b.url,
    domain: b.domain,
    title: b.title,
    description: b.description,
    hasNote: b.note !== "",
    collectionId: b.collectionId,
    tagIds: b.tagIds,
    favorite: b.favorite,
    unread: b.unread,
    faviconUrl: b.faviconUrl,
    imageUrl: b.imageUrl,
    metaStatus: b.metaStatus,
    deletedAt: b.deletedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function full(b: Doc<"bookmarks">) {
  const { hasNote: _hasNote, ...rest } = { ...summarize(b), note: b.note };
  return rest;
}

const emptyPage = { page: [], isDone: true, continueCursor: "" };

// ---- listing ---------------------------------------------------------------

// The index for a view and sort. Live views use deletedAt = undefined; trash
// ignores the sort and shows the most recently trashed first.
function scopedQuery(
  ctx: QueryCtx,
  userId: Id<"users">,
  scope: { view: View; collectionId?: Id<"collections">; sort: Sort },
) {
  const t = ctx.db.query("bookmarks");
  const { sort: by } = scope;
  const order = by === "oldest" ? "asc" : by === "newest" ? "desc" : "asc";
  switch (scope.view) {
    case "trash":
      return t.withIndex("by_user_created", (q) => q.eq("userId", userId).gte("deletedAt", 0)).order("desc");
    case "all":
      if (by === "title")
        return t.withIndex("by_user_title", (q) => q.eq("userId", userId).eq("deletedAt", undefined)).order(order);
      if (by === "domain")
        return t.withIndex("by_user_domain", (q) => q.eq("userId", userId).eq("deletedAt", undefined)).order(order);
      return t.withIndex("by_user_created", (q) => q.eq("userId", userId).eq("deletedAt", undefined)).order(order);
    case "unsorted":
    case "collection": {
      const collectionId = scope.view === "unsorted" ? undefined : scope.collectionId;
      if (by === "title")
        return t
          .withIndex("by_user_collection_title", (q) =>
            q.eq("userId", userId).eq("collectionId", collectionId).eq("deletedAt", undefined),
          )
          .order(order);
      if (by === "domain")
        return t
          .withIndex("by_user_collection_domain", (q) =>
            q.eq("userId", userId).eq("collectionId", collectionId).eq("deletedAt", undefined),
          )
          .order(order);
      return t
        .withIndex("by_user_collection", (q) =>
          q.eq("userId", userId).eq("collectionId", collectionId).eq("deletedAt", undefined),
        )
        .order(order);
    }
    case "favorites":
      if (by === "title")
        return t
          .withIndex("by_user_favorite_title", (q) => q.eq("userId", userId).eq("favorite", true).eq("deletedAt", undefined))
          .order(order);
      if (by === "domain")
        return t
          .withIndex("by_user_favorite_domain", (q) => q.eq("userId", userId).eq("favorite", true).eq("deletedAt", undefined))
          .order(order);
      return t
        .withIndex("by_user_favorite", (q) => q.eq("userId", userId).eq("favorite", true).eq("deletedAt", undefined))
        .order(order);
    case "unread":
      if (by === "title")
        return t
          .withIndex("by_user_unread_title", (q) => q.eq("userId", userId).eq("unread", true).eq("deletedAt", undefined))
          .order(order);
      if (by === "domain")
        return t
          .withIndex("by_user_unread_domain", (q) => q.eq("userId", userId).eq("unread", true).eq("deletedAt", undefined))
          .order(order);
      return t
        .withIndex("by_user_unread", (q) => q.eq("userId", userId).eq("unread", true).eq("deletedAt", undefined))
        .order(order);
  }
}

async function checkScope(
  ctx: QueryCtx,
  userId: Id<"users">,
  args: { view: View; collectionId?: Id<"collections"> },
): Promise<void> {
  if (args.view === "collection") {
    if (args.collectionId === undefined) throw new ConvexError("notFound");
    await getOwnedCollection(ctx, userId, args.collectionId);
  }
}

// One page of the bookmarks tagged with tagId, most recently tagged first,
// trashed ones skipped (so a page can be short; keep paging until isDone).
async function tagPage(
  ctx: QueryCtx,
  userId: Id<"users">,
  tagId: Id<"tags">,
  paginationOpts: PaginationOptions,
): Promise<PaginationResult<Doc<"bookmarks">>> {
  const tag = await getOwnedTag(ctx, userId, tagId);
  const result = await ctx.db
    .query("bookmarkTags")
    .withIndex("by_tag", (q) => q.eq("tagId", tag._id))
    .order("desc")
    .paginate(paginationOpts);
  const page: Doc<"bookmarks">[] = [];
  for (const link of result.page) {
    const b = await ctx.db.get("bookmarks", link.bookmarkId);
    if (b !== null && b.userId === userId && b.deletedAt === undefined) page.push(b);
  }
  return { ...result, page };
}

/** One page of a view (or a tag), as documents. Shared by `list` and the HTTP API. */
export async function listBookmarks(
  ctx: QueryCtx,
  userId: Id<"users">,
  args: {
    view: View;
    collectionId?: Id<"collections">;
    tagId?: Id<"tags">; // when set, lists that tag's live bookmarks and ignores view and sort
    sort: Sort;
    paginationOpts: PaginationOptions;
  },
): Promise<PaginationResult<Doc<"bookmarks">>> {
  if (args.tagId !== undefined) return await tagPage(ctx, userId, args.tagId, args.paginationOpts);
  await checkScope(ctx, userId, args);
  return await scopedQuery(ctx, userId, args).paginate(args.paginationOpts);
}

export const list = query({
  args: {
    view,
    collectionId: v.optional(v.id("collections")),
    tagId: v.optional(v.id("tags")), // when set, lists that tag's live bookmarks and ignores view and sort
    sort,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(bookmarkSummary),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const result = await listBookmarks(ctx, userId, args);
    return { ...result, page: result.page.map(summarize) };
  },
});

// Server-side search over title, description, note, URL and tag names, inside
// the current view / collection / tag. `#tag` and `@collection` in the text
// narrow it further (see shared/parseQuery.ts). Relevance order; with only
// shortcuts and no words, newest first. Pages can come back short because
// some filters apply after the index, so keep paging until isDone.
export async function searchBookmarks(
  ctx: QueryCtx,
  userId: Id<"users">,
  args: {
    query: string;
    view?: View;
    collectionId?: Id<"collections">;
    tagId?: Id<"tags">;
    paginationOpts: PaginationOptions;
  },
): Promise<PaginationResult<Doc<"bookmarks">>> {
  const scope = args.view ?? "all";
  await checkScope(ctx, userId, { view: scope, collectionId: args.collectionId });
  if (args.tagId !== undefined) await getOwnedTag(ctx, userId, args.tagId);
  const parsed = parseQuery(args.query);
  if (parsed.text === "" && parsed.tags.length === 0 && parsed.collections.length === 0) return emptyPage;

  // What a bookmark must match: tags, collection (null = Unsorted), flags.
  const tagIds: Id<"tags">[] = args.tagId === undefined ? [] : [args.tagId];
  for (const name of parsed.tags) {
    const tag = await findTagByName(ctx, userId, name);
    if (tag === null) return emptyPage; // unknown tag: nothing can match
    if (!tagIds.includes(tag._id)) tagIds.push(tag._id);
  }
  let collection: Id<"collections"> | null | undefined =
    scope === "unsorted" ? null : scope === "collection" ? args.collectionId : undefined;
  if (parsed.collections.length > 0) {
    const mine = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId))
      .take(LIMITS.collectionsPerUser);
    const found = new Set<Id<"collections">>();
    for (const name of parsed.collections) {
      const hit = mine.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (hit === undefined) return emptyPage;
      found.add(hit._id);
    }
    if (found.size > 1) return emptyPage; // a bookmark is in one collection
    const [id] = [...found];
    if (collection !== undefined && collection !== id) return emptyPage;
    collection = id;
  }

  const matches = (b: Doc<"bookmarks">) =>
    (scope === "trash" ? b.deletedAt !== undefined : b.deletedAt === undefined) &&
    (collection === undefined || (b.collectionId ?? null) === collection) &&
    (scope !== "favorites" || b.favorite) &&
    (scope !== "unread" || b.unread) &&
    tagIds.every((id) => b.tagIds.includes(id));

  if (parsed.text === "") {
    // Only shortcuts: a plain listing narrowed by the same predicate.
    const listView: View =
      scope === "trash" ? "trash"
      : collection === null ? "unsorted"
      : collection !== undefined ? "collection"
      : scope === "favorites" || scope === "unread" ? scope
      : "all";
    const result = await scopedQuery(ctx, userId, {
      view: listView,
      collectionId: collection ?? undefined,
      sort: "newest",
    }).paginate(args.paginationOpts);
    return { ...result, page: result.page.filter(matches) };
  }

  const result = await ctx.db
    .query("bookmarks")
    .withSearchIndex("search_text", (q) => {
      let s = q.search("searchText", parsed.text).eq("userId", userId);
      if (scope !== "trash") s = s.eq("deletedAt", undefined);
      if (collection !== undefined) s = s.eq("collectionId", collection ?? undefined);
      return s;
    })
    .paginate(args.paginationOpts);
  return { ...result, page: result.page.filter(matches) };
}

export const search = query({
  args: {
    query: v.string(),
    view: v.optional(view),
    collectionId: v.optional(v.id("collections")),
    tagId: v.optional(v.id("tags")),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(bookmarkSummary),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const result = await searchBookmarks(ctx, userId, args);
    return { ...result, page: result.page.map(summarize) };
  },
});

export const get = query({
  args: { id: v.id("bookmarks") },
  returns: bookmarkFull,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return full(await getOwnedBookmark(ctx, userId, args.id));
  },
});

// The caller's bookmark for a URL (after normalization), live or in the trash.
export const findByUrl = query({
  args: { url: v.string() },
  returns: v.union(bookmarkSummary, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const normalized = args.url.length > LIMITS.urlMax ? null : normalizeUrl(args.url);
    if (normalized === null) return null;
    const found = await ctx.db
      .query("bookmarks")
      .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("normalizedUrl", normalized))
      .unique();
    return found === null ? null : summarize(found);
  },
});

// ---- writes ----------------------------------------------------------------

function parseUrl(url: string): { url: string; normalizedUrl: string; domain: string } {
  const trimmed = url.trim();
  checkLength(trimmed, LIMITS.urlMax);
  const normalizedUrl = isValidHttpUrl(trimmed) ? normalizeUrl(trimmed) : null;
  if (normalizedUrl === null) throw new ConvexError("invalidUrl");
  return { url: trimmed, normalizedUrl, domain: getDomain(trimmed) };
}

async function checkCollection(
  ctx: QueryCtx,
  userId: Id<"users">,
  id: Id<"collections"> | null | undefined,
): Promise<Id<"collections"> | undefined> {
  if (id === null || id === undefined) return undefined;
  return (await getOwnedCollection(ctx, userId, id))._id;
}

async function byUrl(ctx: QueryCtx, userId: Id<"users">, normalizedUrl: string) {
  return await ctx.db
    .query("bookmarks")
    .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("normalizedUrl", normalizedUrl))
    .unique();
}

export interface CreateArgs {
  url: string;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: Id<"collections">;
  tags?: string[];
  favorite?: boolean;
  unread?: boolean;
}

/**
 * Saves a URL, or finds the bookmark that already has it (after normalization).
 * An existing one is returned as is; if it was in the trash it is restored.
 * Shared by the `create` mutation and the HTTP API.
 */
export async function insertBookmark(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: CreateArgs,
): Promise<{ id: Id<"bookmarks">; existed: boolean }> {
  const parsed = parseUrl(args.url);
  const existing = await byUrl(ctx, userId, parsed.normalizedUrl);
  if (existing !== null) {
    if (existing.deletedAt !== undefined) await applyChanges(ctx, existing, { deletedAt: undefined });
    return { id: existing._id, existed: true };
  }
  const title = cleanTitle(args.title ?? "");
  const description = checkLength((args.description ?? "").trim(), LIMITS.descriptionMax);
  const note = checkLength(args.note ?? "", LIMITS.noteMax);
  const collectionId = await checkCollection(ctx, userId, args.collectionId);
  if ((await bookmarkTotal(ctx, userId)) >= LIMITS.bookmarksPerUser) throw new ConvexError("limitReached");
  const tagIds = await resolveTags(ctx, userId, args.tags ?? []);
  const now = Date.now();
  const id = await addBookmark(ctx, {
    userId,
    ...parsed,
    title,
    description,
    note,
    collectionId,
    tagIds,
    favorite: args.favorite ?? false,
    unread: args.unread ?? false,
    metaStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await scheduleMetadata(ctx, id); // fills title, description, favicon, image; nobody waits for it
  return { id, existed: false };
}

export const create = mutation({
  args: {
    url: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    note: v.optional(v.string()),
    collectionId: v.optional(v.id("collections")),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
  },
  returns: v.object({ id: v.id("bookmarks"), existed: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await insertBookmark(ctx, userId, args);
  },
});

async function getLive(ctx: QueryCtx, userId: Id<"users">, id: Id<"bookmarks">) {
  const b = await getOwnedBookmark(ctx, userId, id);
  if (b.deletedAt !== undefined) throw new ConvexError("inTrash");
  return b;
}

export interface UpdateArgs {
  url?: string;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: Id<"collections"> | null; // null = Unsorted
  tags?: string[]; // replaces the tags
  favorite?: boolean;
  unread?: boolean;
}

/** Edits a live bookmark. Shared by `update` and the HTTP API's PATCH. */
export async function updateBookmark(
  ctx: MutationCtx,
  userId: Id<"users">,
  id: Id<"bookmarks">,
  args: UpdateArgs,
): Promise<void> {
  const b = await getLive(ctx, userId, id);
  const changes: BookmarkChanges = {};
  if (args.url !== undefined) {
    const parsed = parseUrl(args.url);
    if (parsed.normalizedUrl !== b.normalizedUrl) {
      const clash = await byUrl(ctx, userId, parsed.normalizedUrl);
      if (clash !== null && clash._id !== b._id) throw new ConvexError("duplicate");
      Object.assign(changes, parsed, { metaStatus: "pending" as const });
    } else {
      changes.url = parsed.url;
    }
  }
  if (args.title !== undefined) changes.title = cleanTitle(args.title);
  if (args.description !== undefined) {
    changes.description = checkLength(args.description.trim(), LIMITS.descriptionMax);
  }
  if (args.note !== undefined) changes.note = checkLength(args.note, LIMITS.noteMax);
  if (args.collectionId !== undefined) changes.collectionId = await checkCollection(ctx, userId, args.collectionId);
  if (args.tags !== undefined) changes.tagIds = await resolveTags(ctx, userId, args.tags);
  if (args.favorite !== undefined) changes.favorite = args.favorite;
  if (args.unread !== undefined) changes.unread = args.unread;
  await applyChanges(ctx, b, changes);
  if (changes.metaStatus === "pending") await scheduleMetadata(ctx, b._id); // the URL changed
}

export const update = mutation({
  args: {
    id: v.id("bookmarks"),
    url: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    note: v.optional(v.string()),
    collectionId: v.optional(v.union(v.id("collections"), v.null())),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...rest }) => {
    const userId = await requireUserId(ctx);
    await updateBookmark(ctx, userId, id, rest);
    return null;
  },
});

export const setTags = mutation({
  args: { id: v.id("bookmarks"), tags: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await updateBookmark(ctx, userId, args.id, { tags: args.tags });
    return null;
  },
});

export const move = mutation({
  args: { id: v.id("bookmarks"), collectionId: v.union(v.id("collections"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await updateBookmark(ctx, userId, args.id, { collectionId: args.collectionId });
    return null;
  },
});

export const toggleFavorite = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const b = await getLive(ctx, userId, args.id);
    await applyChanges(ctx, b, { favorite: !b.favorite });
    return !b.favorite;
  },
});

export const toggleUnread = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const b = await getLive(ctx, userId, args.id);
    await applyChanges(ctx, b, { unread: !b.unread });
    return !b.unread;
  },
});

export const trash = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const b = await getOwnedBookmark(ctx, userId, args.id);
    if (b.deletedAt === undefined) await applyChanges(ctx, b, { deletedAt: Date.now() });
    return null;
  },
});

export const restore = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const b = await getOwnedBookmark(ctx, userId, args.id);
    if (b.deletedAt === undefined) throw new ConvexError("notInTrash");
    // Its collection may be gone; then it comes back as Unsorted.
    const collection = b.collectionId === undefined ? null : await ctx.db.get("collections", b.collectionId);
    await applyChanges(
      ctx,
      b,
      b.collectionId !== undefined && collection === null
        ? { deletedAt: undefined, collectionId: undefined }
        : { deletedAt: undefined },
    );
    return null;
  },
});

export const deleteForever = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const b = await getOwnedBookmark(ctx, userId, args.id);
    if (b.deletedAt === undefined) throw new ConvexError("notInTrash");
    await removeBookmark(ctx, b);
    return null;
  },
});

// ---- bulk ------------------------------------------------------------------

const bulkAction = v.union(
  v.object({ type: v.literal("move"), collectionId: v.union(v.id("collections"), v.null()) }),
  v.object({ type: v.literal("addTag"), tag: v.string() }),
  v.object({ type: v.literal("removeTag"), tag: v.string() }),
  v.object({ type: v.literal("favorite"), value: v.boolean() }),
  v.object({ type: v.literal("trash") }),
);

// One mutation for up to LIMITS.bulkIds bookmarks. Every id is checked before
// the first write, so a foreign or missing id fails the whole call. Bookmarks
// already in the trash are skipped. Returns how many were changed.
export const bulk = mutation({
  args: { ids: v.array(v.id("bookmarks")), action: bulkAction },
  returns: v.object({ changed: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const ids = [...new Set(args.ids)];
    if (ids.length > LIMITS.bulkIds) throw new ConvexError("limitReached");
    const owned: Doc<"bookmarks">[] = [];
    for (const id of ids) owned.push(await getOwnedBookmark(ctx, userId, id));
    const live = owned.filter((b) => b.deletedAt === undefined);

    const action = args.action;
    let changes: (b: Doc<"bookmarks">) => BookmarkChanges | null;
    switch (action.type) {
      case "move": {
        const collectionId = await checkCollection(ctx, userId, action.collectionId);
        changes = () => ({ collectionId });
        break;
      }
      case "addTag": {
        const [tagId] = await resolveTags(ctx, userId, [action.tag]);
        if (tagId === undefined) return { changed: 0 };
        changes = (b) => {
          if (b.tagIds.includes(tagId)) return null;
          if (b.tagIds.length >= LIMITS.tagsPerBookmark) throw new ConvexError("limitReached");
          return { tagIds: [...b.tagIds, tagId] };
        };
        break;
      }
      case "removeTag": {
        const tag = await findTagByName(ctx, userId, action.tag);
        if (tag === null) return { changed: 0 };
        changes = (b) => (b.tagIds.includes(tag._id) ? { tagIds: b.tagIds.filter((t) => t !== tag._id) } : null);
        break;
      }
      case "favorite":
        changes = (b) => (b.favorite === action.value ? null : { favorite: action.value });
        break;
      case "trash": {
        const now = Date.now();
        changes = () => ({ deletedAt: now });
        break;
      }
    }
    let changed = 0;
    for (const b of live) {
      const patch = changes(b);
      if (patch === null) continue;
      await applyChanges(ctx, b, patch);
      changed += 1;
    }
    return { changed };
  },
});

// ---- trash -----------------------------------------------------------------

async function deleteTrashBatch(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  const rows = await ctx.db
    .query("bookmarks")
    .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("deletedAt", 0))
    .take(PURGE_BATCH);
  for (const b of rows) await removeBookmark(ctx, b);
  return rows.length === PURGE_BATCH;
}

export const emptyTrash = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    if (await deleteTrashBatch(ctx, userId)) {
      await ctx.scheduler.runAfter(0, internal.bookmarks.emptyTrashBatch, { userId });
    }
    return null;
  },
});

export const emptyTrashBatch = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await deleteTrashBatch(ctx, args.userId)) {
      await ctx.scheduler.runAfter(0, internal.bookmarks.emptyTrashBatch, args);
    }
    return null;
  },
});

// Run daily by crons.ts. Reschedules itself while a full batch was deleted.
export const purgeTrash = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - LIMITS.trashDays * DAY;
    // gte(0) skips live bookmarks, whose deletedAt is unset (sorts before numbers).
    const rows = await ctx.db
      .query("bookmarks")
      .withIndex("by_deleted", (q) => q.gte("deletedAt", 0).lt("deletedAt", cutoff))
      .take(PURGE_BATCH);
    for (const b of rows) await removeBookmark(ctx, b);
    if (rows.length === PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.bookmarks.purgeTrash, {});
    return null;
  },
});
