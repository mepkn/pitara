import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { applyChanges, type BookmarkChanges } from "./lib/bookmarkWrites";
import { LIMITS } from "../../shared/limits";

// Page metadata for a saved bookmark: title, description, favicon, preview
// image. The fetch itself is metadataFetch.ts (a Node action, SSRF-guarded);
// this file holds the database side and the scheduling. Nobody waits for it.

const HOUR = 60 * 60 * 1000;
/** A failed fetch is retried once an hour, at most this many times. */
export const MAX_RETRIES = 3;
const STUCK_BATCH = 50;

/** Queues the fetch for a bookmark (now, or after `delayMs`, e.g. to spread out an import). */
export async function scheduleMetadata(ctx: MutationCtx, bookmarkId: Id<"bookmarks">, delayMs = 0): Promise<void> {
  await ctx.scheduler.runAfter(delayMs, internal.metadataFetch.run, { bookmarkId, attempt: 0 });
}

// What the action needs: the URL to fetch. Nothing for a bookmark that is gone or in the trash.
export const target = internalQuery({
  args: { bookmarkId: v.id("bookmarks") },
  returns: v.union(v.object({ url: v.string(), normalizedUrl: v.string() }), v.null()),
  handler: async (ctx, { bookmarkId }) => {
    const b = await ctx.db.get("bookmarks", bookmarkId);
    if (b === null || b.deletedAt !== undefined) return null;
    return { url: b.url, normalizedUrl: b.normalizedUrl };
  },
});

function httpUrlOrUndefined(url: string | undefined): string | undefined {
  if (url === undefined || url.length > LIMITS.urlMax) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

// Stores the result. Re-reads the bookmark first: it may have been deleted,
// trashed or pointed at another URL while the fetch ran. Never overwrites a
// title or description the user already has (typed, or fetched before). A
// failure is recorded and, for transient ones, retried later.
export const finish = internalMutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    normalizedUrl: v.string(), // the URL the fetch was for
    attempt: v.number(),
    outcome: v.union(
      v.object({
        status: v.literal("done"),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        faviconUrl: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
      }),
      v.object({ status: v.literal("failed"), retry: v.boolean() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { bookmarkId, normalizedUrl, attempt, outcome }) => {
    const b = await ctx.db.get("bookmarks", bookmarkId);
    if (b === null || b.deletedAt !== undefined || b.normalizedUrl !== normalizedUrl) return null;

    if (outcome.status === "failed") {
      await applyChanges(ctx, b, { metaStatus: "failed" });
      if (outcome.retry && attempt < MAX_RETRIES) {
        await ctx.scheduler.runAfter(HOUR, internal.metadataFetch.run, { bookmarkId, attempt: attempt + 1 });
      }
      return null;
    }

    // Text is cut to the limits (not rejected like user input would be).
    const changes: BookmarkChanges = { metaStatus: "done" };
    const title = outcome.title?.replace(/[\r\n]+/g, " ").trim().slice(0, LIMITS.titleMax);
    const description = outcome.description?.trim().slice(0, LIMITS.descriptionMax);
    if (b.title === "" && title) changes.title = title;
    if (b.description === "" && description) changes.description = description;
    const faviconUrl = httpUrlOrUndefined(outcome.faviconUrl);
    const imageUrl = httpUrlOrUndefined(outcome.imageUrl);
    if (faviconUrl !== undefined) changes.faviconUrl = faviconUrl;
    if (imageUrl !== undefined) changes.imageUrl = imageUrl;
    await applyChanges(ctx, b, changes);
    return null;
  },
});

// Hourly (crons.ts): bookmarks still `pending` an hour after their last change
// lost their scheduled fetch (a crash, a deploy mid-run). Queue them again.
// Trashed ones are left out by the index and wait until they are restored.
export const retryStuck = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - HOUR;
    const stuck = await ctx.db
      .query("bookmarks")
      .withIndex("by_meta_status", (q) => q.eq("metaStatus", "pending").eq("deletedAt", undefined).lt("updatedAt", cutoff))
      .take(STUCK_BATCH);
    for (const b of stuck) {
      // Bumping updatedAt keeps the next run from queueing it a second time.
      await ctx.db.patch("bookmarks", b._id, { updatedAt: Date.now() });
      await scheduleMetadata(ctx, b._id);
    }
    return null;
  },
});
