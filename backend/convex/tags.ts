import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { getOwnedTag, requireUserId } from "./lib/access";
import { applyChanges, checkLength, refreshSearchText } from "./lib/bookmarkWrites";
import { LIMITS } from "../../shared/limits";
import { normalizeTagName } from "../../shared/tags";

// Bookmarks fixed up per transaction when a tag is renamed, merged or deleted.
const BATCH = 50;

export const list = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("tags"), name: v.string(), count: v.number() })),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .take(LIMITS.tagsPerUser);
    return tags.map((t) => ({ _id: t._id, name: t.name, count: t.bookmarkCount }));
  },
});

// Moves up to BATCH of the source tag's bookmarks to `target` (or just drops
// the tag from them when target is null). applyChanges removes the join row,
// moves the counters and rewrites the search text. True if there may be more.
async function retagBatch(
  ctx: MutationCtx,
  source: Id<"tags">,
  target: Id<"tags"> | null,
): Promise<boolean> {
  const links = await ctx.db
    .query("bookmarkTags")
    .withIndex("by_tag", (q) => q.eq("tagId", source))
    .take(BATCH);
  for (const link of links) {
    const bookmark = await ctx.db.get("bookmarks", link.bookmarkId);
    if (bookmark === null) {
      await ctx.db.delete("bookmarkTags", link._id);
      continue;
    }
    const tagIds = bookmark.tagIds.filter((id) => id !== source);
    if (target !== null && !tagIds.includes(target)) tagIds.push(target);
    await applyChanges(ctx, bookmark, { tagIds });
  }
  return links.length === BATCH;
}

// Renames the tag. If another tag already has the name, the two are merged:
// this tag's bookmarks move to the other one and this tag is deleted.
export const rename = mutation({
  args: { id: v.id("tags"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const tag = await getOwnedTag(ctx, userId, args.id);
    const name = normalizeTagName(args.name);
    if (name === "") throw new ConvexError("invalidName");
    checkLength(name, LIMITS.tagNameMax);
    if (name === tag.name) return null;
    const other = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (other !== null) {
      await ctx.db.delete("tags", tag._id);
      if (await retagBatch(ctx, tag._id, other._id)) {
        await ctx.scheduler.runAfter(0, internal.tags.retag, { source: tag._id, target: other._id });
      }
      return null;
    }
    await ctx.db.patch("tags", tag._id, { name });
    // Tag names are part of every tagged bookmark's search text.
    await refreshBatch(ctx, tag._id, null);
    return null;
  },
});

// Rewrites the search text of a page of the tag's bookmarks; schedules itself
// for the next page. Returns true when that was the last page.
async function refreshBatch(ctx: MutationCtx, tagId: Id<"tags">, cursor: string | null): Promise<boolean> {
  const result = await ctx.db
    .query("bookmarkTags")
    .withIndex("by_tag", (q) => q.eq("tagId", tagId))
    .paginate({ numItems: BATCH, cursor });
  for (const link of result.page) {
    const bookmark = await ctx.db.get("bookmarks", link.bookmarkId);
    if (bookmark !== null) await refreshSearchText(ctx, bookmark);
  }
  if (!result.isDone) {
    await ctx.scheduler.runAfter(0, internal.tags.refreshSearch, { tagId, cursor: result.continueCursor });
  }
  return result.isDone;
}

export const refreshSearch = internalMutation({
  args: { tagId: v.id("tags"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await refreshBatch(ctx, args.tagId, args.cursor);
    return null;
  },
});

export const retag = internalMutation({
  args: { source: v.id("tags"), target: v.union(v.id("tags"), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await retagBatch(ctx, args.source, args.target)) {
      await ctx.scheduler.runAfter(0, internal.tags.retag, args);
    }
    return null;
  },
});

// Deletes the tag and removes it from its bookmarks; the bookmarks stay.
export const remove = mutation({
  args: { id: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const tag = await getOwnedTag(ctx, userId, args.id);
    await ctx.db.delete("tags", tag._id);
    if (await retagBatch(ctx, tag._id, null)) {
      await ctx.scheduler.runAfter(0, internal.tags.retag, { source: tag._id, target: null });
    }
    return null;
  },
});
