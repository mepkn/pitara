"use node";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { IMPORT_CHUNK } from "./lib/importConfig";
import { LIMITS } from "../../shared/limits";
import { parseNetscape } from "../../shared/netscape";

// Import and export, for Settings in the web app. Actions, because parsing a
// 10 MB file is too much for a mutation; the writes happen in importData.ts.
// A Node action file: it has more memory than the default runtime, which a
// 10 MB bookmark file needs while it is parsed.

const importResult = v.object({
  found: v.number(), // links in the file that could be read
  created: v.number(),
  duplicates: v.number(),
  invalid: v.number(), // not http(s), too long, or no URL
  overLimit: v.number(),
  collectionsCreated: v.number(),
  foldersOverLimit: v.number(),
});

// Imports a Netscape bookmark file (Chrome, Firefox, Raindrop, linkding ...)
// that was uploaded to storage (see generateUploadUrl).
// Folders become collections (2 levels), TAGS become tags. Links already saved
// are skipped. The file is read in chunks, so a failure partway leaves the
// earlier chunks saved; running the same import again only adds what is missing.
export const importHtml = action({
  args: { storageId: v.id("_storage") },
  returns: importResult,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("notAuthenticated");
    await ctx.runQuery(internal.importData.assertAllowed, { userId });
    // The file was uploaded to storage first (importData.generateUploadUrl): a
    // Node action takes arguments of 5 MiB at most, less than the 10 MB file limit.
    // It is deleted whatever happens, so uploads don't pile up.
    try {
      const file = await ctx.storage.get(args.storageId);
      if (file === null) throw new ConvexError("notFound");
      if (file.size > LIMITS.importFileBytes) throw new ConvexError("tooLong");
      return await importText(ctx, userId, await file.text());
    } finally {
      await ctx.storage.delete(args.storageId).catch(() => {});
    }
  },
});

async function importText(ctx: ActionCtx, userId: Id<"users">, html: string) {
  const parsed = parseNetscape(html);
  if (parsed.bookmarks.length > LIMITS.importLinks) throw new ConvexError("limitReached");
  // Text is cut to the limits here, so a huge <DD> can't make a chunk's arguments too big.
  const items = parsed.bookmarks.map((b) => ({
    ...b,
    title: b.title.slice(0, LIMITS.titleMax),
    description: b.description.slice(0, LIMITS.descriptionMax),
    folder: b.folder.map((name) => name.slice(0, LIMITS.collectionNameMax)),
  }));

  const total = {
    found: parsed.bookmarks.length,
    created: 0,
    duplicates: 0,
    invalid: parsed.skipped,
    overLimit: 0,
    collectionsCreated: 0,
    foldersOverLimit: 0,
  };
  for (let i = 0; i < items.length; ) {
    const counts = await ctx.runMutation(internal.importData.importChunk, {
      userId,
      items: items.slice(i, i + IMPORT_CHUNK),
      fetchesQueued: total.created,
    });
    i += Math.max(1, counts.consumed); // a chunk can stop early; the next one starts where it ended
    total.created += counts.created;
    total.duplicates += counts.duplicates;
    total.invalid += counts.invalid;
    total.overLimit += counts.overLimit;
    total.collectionsCreated += counts.collectionsCreated;
    total.foldersOverLimit += counts.foldersOverLimit;
  }
  return total;
}

// A page of the user's whole library as JSON-ready data, 200 bookmarks at most
// (a full library is too big for one return value). Call with cursor null,
// then with each continueCursor until isDone; the first page also has the
// collections and tags. The web app joins the pages into the file, and can feed
// them to shared/netscape.ts `writeNetscape` for the HTML export.
export const exportJson = action({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("notAuthenticated");
    const page: ExportPage = await ctx.runQuery(internal.importData.exportPage, {
      userId,
      paginationOpts: { numItems: args.numItems ?? 100, cursor: args.cursor },
    });
    return page;
  },
});

type ExportPage = {
  bookmarks: {
    url: string;
    title: string;
    description: string;
    note: string;
    collectionId: string | null;
    tags: string[];
    favorite: boolean;
    unread: boolean;
    faviconUrl: string | null;
    imageUrl: string | null;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
  }[];
  isDone: boolean;
  continueCursor: string;
  collections?: { id: string; name: string; parentId: string | null; sortOrder: number }[];
  tags?: { name: string; count: number }[];
};
