import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import { getOwnedBookmark, requireUserId } from "./lib/access";

// Dead-link checker. A daily cron (crons.ts) starts the check for a batch of
// bookmarks not checked in the last 7 days, so every bookmark is looked at about
// weekly without a spike. The fetch is linkCheckFetch.ts (a Node action, the
// same SSRF-guarded fetch as the metadata). A page is marked broken only when
// two checks a day apart both say gone; one bad answer (a blip, a deploy) is
// not enough. "unknown" answers (403, 5xx, timeouts) never mark anything.

const DAY = 24 * 60 * 60 * 1000;
export const RECHECK_AFTER = 7 * DAY;
export const CONFIRM_AFTER = DAY;
export const BATCH = 100;
const SPREAD_MS = 2000; // between two fetches, so a batch doesn't hit the network all at once

const verdict = v.union(v.literal("ok"), v.literal("broken"), v.literal("unknown"));

// Daily (crons.ts). Marking the time now keeps the next run from queueing the
// same bookmark again while its check is still waiting; the check sets it again.
export const checkDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    // Never-checked bookmarks (field unset) sort before every number, so the range includes them.
    const due = await ctx.db
      .query("bookmarks")
      .withIndex("by_link_checked", (q) => q.eq("deletedAt", undefined).lt("linkCheckedAt", now - RECHECK_AFTER))
      .take(BATCH);
    let i = 0;
    for (const b of due) {
      await ctx.db.patch("bookmarks", b._id, { linkCheckedAt: now });
      await ctx.scheduler.runAfter(i++ * SPREAD_MS, internal.linkCheckFetch.run, { bookmarkId: b._id, attempt: 0 });
    }
    return due.length;
  },
});

// Stores a verdict. Re-reads the bookmark: it may be gone, trashed or point at
// another URL since the fetch started.
export const record = internalMutation({
  args: {
    bookmarkId: v.id("bookmarks"),
    normalizedUrl: v.string(), // the URL the check was for
    attempt: v.number(), // 0 = a routine check, 1 = the confirmation
    verdict,
  },
  returns: v.null(),
  handler: async (ctx, { bookmarkId, normalizedUrl, attempt, verdict }) => {
    const b = await ctx.db.get("bookmarks", bookmarkId);
    if (b === null || b.deletedAt !== undefined || b.normalizedUrl !== normalizedUrl) return null;
    const linkCheckedAt = Date.now();
    // Direct patches: a link check isn't an edit, so updatedAt, counters and search text stay as they are.
    if (verdict === "ok") {
      await ctx.db.patch("bookmarks", bookmarkId, { linkStatus: "ok", linkCheckedAt });
    } else if (verdict === "broken" && attempt >= 1) {
      await ctx.db.patch("bookmarks", bookmarkId, { linkStatus: "broken", linkCheckedAt });
    } else if (verdict === "broken") {
      await ctx.db.patch("bookmarks", bookmarkId, { linkCheckedAt });
      await ctx.scheduler.runAfter(CONFIRM_AFTER, internal.linkCheckFetch.run, { bookmarkId, attempt: 1 });
    } else {
      await ctx.db.patch("bookmarks", bookmarkId, { linkCheckedAt }); // unknown: try again next week
    }
    return null;
  },
});

// "Check again" in the app: one fresh check now, and its answer is final (it
// counts as the confirmation), so a fixed link clears its Broken mark at once.
export const recheck = mutation({
  args: { id: v.id("bookmarks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const b = await getOwnedBookmark(ctx, userId, id);
    if (b.deletedAt !== undefined) return null;
    await ctx.scheduler.runAfter(0, internal.linkCheckFetch.run, { bookmarkId: b._id as Id<"bookmarks">, attempt: 1 });
    return null;
  },
});
