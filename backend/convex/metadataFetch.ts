"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { collectMetadata } from "./lib/collectMetadata";
import { nodeDeps } from "./lib/nodeTransport";

// The Node side of the metadata fetch (needs DNS and sockets). The rules live
// in lib/safeFetch.ts and lib/ssrf.ts; this only wires them to the database.
export const run = internalAction({
  args: { bookmarkId: v.id("bookmarks"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { bookmarkId, attempt }) => {
    const target = await ctx.runQuery(internal.metadata.target, { bookmarkId });
    if (target === null) return null;
    const result = await collectMetadata(target.url, nodeDeps());
    await ctx.runMutation(internal.metadata.finish, {
      bookmarkId,
      normalizedUrl: target.normalizedUrl,
      attempt,
      outcome: result.status === "done" ? { status: "done", ...result.meta } : result,
    });
    return null;
  },
});
