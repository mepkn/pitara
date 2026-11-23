"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { checkLink } from "./lib/linkVerdict";
import { nodeDeps } from "./lib/nodeTransport";

// The Node side of the link check (needs DNS and sockets); the rules are in
// lib/linkVerdict.ts and lib/safeFetch.ts.
export const run = internalAction({
  args: { bookmarkId: v.id("bookmarks"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { bookmarkId, attempt }) => {
    const target = await ctx.runQuery(internal.metadata.target, { bookmarkId });
    if (target === null) return null;
    const verdict = await checkLink(target.url, nodeDeps());
    await ctx.runMutation(internal.linkCheck.record, { bookmarkId, normalizedUrl: target.normalizedUrl, attempt, verdict });
    return null;
  },
});
