import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { requireAllowed, requireUserId } from "./lib/access";
import { addBookmark, bookmarkTotal } from "./lib/bookmarkWrites";
import { findOrCreateCollection } from "./collections";
import { EXPORT_PAGE_MAX, IMPORT_CHUNK, IMPORT_FETCH_SPACING_MS } from "./lib/importConfig";
import { scheduleMetadata } from "./metadata";
import { LIMITS } from "../../shared/limits";
import { normalizeTagName } from "../../shared/tags";
import { getDomain, normalizeUrl } from "../../shared/url";

// The database side of importExport.ts (which is a Node action file and can't
// hold queries or mutations).

// Step 1 of an import: a one-time URL to upload the bookmark file to (POST the
// file body to it, then pass the returned storageId to importExport.importHtml).
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const assertAllowed = internalQuery({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAllowed(ctx, args.userId);
    return null;
  },
});

const importItem = v.object({
  url: v.string(),
  title: v.string(),
  description: v.string(),
  tags: v.array(v.string()),
  unread: v.boolean(),
  addDate: v.optional(v.number()),
  folder: v.array(v.string()),
});

const chunkCounts = v.object({
  consumed: v.number(), // how many of the items were handled; fewer than sent if the chunk ran out of transaction headroom
  created: v.number(),
  duplicates: v.number(), // already saved (live or in the trash): left alone
  invalid: v.number(), // a URL that doesn't pass the rules
  overLimit: v.number(), // not imported: the 100,000 bookmark cap
  collectionsCreated: v.number(),
  foldersOverLimit: v.number(), // bookmarks put in a higher folder or Unsorted: the 100 collection cap
});

/** The creation time to keep: the file's ADD_DATE unless it is missing or in the future. */
function createdAtFor(addDate: number | undefined, now: number): number {
  return addDate !== undefined && addDate > 0 && addDate <= now ? addDate : now;
}

/** Room left in this transaction for at least one more link, even one with 20 new tags (a safety net; see the note in importChunk). */
async function hasHeadroom(ctx: MutationCtx): Promise<boolean> {
  const m = await ctx.meta.getTransactionMetrics();
  return (
    m.databaseQueries.remaining >= 200 &&
    m.documentsRead.remaining >= 200 &&
    m.documentsWritten.remaining >= 150 &&
    m.bytesRead.remaining >= 1_000_000 &&
    m.bytesWritten.remaining >= 200_000 &&
    m.functionsScheduled.remaining >= 2 &&
    m.scheduledFunctionArgsBytes.remaining >= 10_000
  );
}

// Imports up to IMPORT_CHUNK parsed links (fewer if the transaction runs short
// of headroom: see `consumed`). Nothing here throws on bad data: every item is
// checked first, so a chunk is never half-written. Duplicates (including
// ones in the trash) are skipped, never restored. Safe to run again on the same file.
export const importChunk = internalMutation({
  args: { userId: v.id("users"), items: v.array(importItem), fetchesQueued: v.number() },
  returns: chunkCounts,
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    if (args.items.length > IMPORT_CHUNK) throw new ConvexError("limitReached");
    const counts = { consumed: 0, created: 0, duplicates: 0, invalid: 0, overLimit: 0, collectionsCreated: 0, foldersOverLimit: 0 };
    const now = Date.now();
    const folders = new Map<string, Id<"collections"> | undefined>();

    // The user's tags are read once per chunk and kept here as links are added
    // (resolveTags would rescan them for every new tag). New tags are created
    // until the cap; past it a link just keeps the tags that fit.
    const tagIds = new Map<string, Id<"tags">>();
    for (const tag of await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .take(LIMITS.tagsPerUser)) {
      tagIds.set(tag.name, tag._id);
    }
    const tagsFor = async (names: string[]): Promise<Id<"tags">[]> => {
      const ids: Id<"tags">[] = [];
      for (const raw of names) {
        const name = normalizeTagName(raw);
        if (name === "" || name.length > LIMITS.tagNameMax || ids.length >= LIMITS.tagsPerBookmark) continue;
        let id = tagIds.get(name);
        if (id === undefined) {
          if (tagIds.size >= LIMITS.tagsPerUser) continue;
          id = await ctx.db.insert("tags", { userId, name, bookmarkCount: 0 });
          tagIds.set(name, id);
        }
        if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    };

    const collectionFor = async (path: string[]): Promise<Id<"collections"> | undefined> => {
      let parent: Id<"collections"> | undefined;
      for (let depth = 0; depth < Math.min(path.length, LIMITS.collectionDepth); depth++) {
        const key = path.slice(0, depth + 1).join("\u0000").toLowerCase();
        if (!folders.has(key)) {
          const name = (path[depth] ?? "").trim();
          const found = name === "" ? null : await findOrCreateCollection(ctx, userId, name, parent);
          if (found?.created) counts.collectionsCreated += 1;
          folders.set(key, found?.id);
        }
        const id = folders.get(key);
        if (id === undefined) {
          counts.foldersOverLimit += 1;
          return parent; // the cap: keep it in the folder above, or Unsorted
        }
        parent = id;
      }
      return parent;
    };

    for (const item of args.items) {
      // A transaction allows 4,096 reads and 8,192 writes. A link with 20 new tags
      // costs about 50 reads and 60 writes, so 50 links fit, but this guard makes
      // that a certainty rather than arithmetic: it stops with room to spare and the
      // caller sends the rest in the next chunk. The first item always goes in.
      if (counts.consumed > 0 && !(await hasHeadroom(ctx))) break;
      counts.consumed += 1;
      const url = item.url.trim();
      const normalizedUrl = url.length <= LIMITS.urlMax ? normalizeUrl(url) : null;
      if (normalizedUrl === null) {
        counts.invalid += 1;
        continue;
      }
      const existing = await ctx.db
        .query("bookmarks")
        .withIndex("by_user_url", (q) => q.eq("userId", userId).eq("normalizedUrl", normalizedUrl))
        .unique();
      if (existing !== null) {
        counts.duplicates += 1;
        continue;
      }
      if ((await bookmarkTotal(ctx, userId)) >= LIMITS.bookmarksPerUser) {
        counts.overLimit += 1;
        continue;
      }
      const createdAt = createdAtFor(item.addDate, now);
      const id = await addBookmark(ctx, {
        userId,
        url,
        normalizedUrl,
        domain: getDomain(url),
        title: item.title.replace(/[\r\n]+/g, " ").trim().slice(0, LIMITS.titleMax),
        description: item.description.trim().slice(0, LIMITS.descriptionMax),
        note: "",
        collectionId: await collectionFor(item.folder),
        tagIds: await tagsFor(item.tags),
        favorite: false,
        unread: item.unread,
        metaStatus: "pending",
        createdAt,
        updatedAt: now,
      });
      await scheduleMetadata(ctx, id, (args.fetchesQueued + counts.created) * IMPORT_FETCH_SPACING_MS);
      counts.created += 1;
    }
    return counts;
  },
});

// ---- export ----------------------------------------------------------------

const exportBookmark = v.object({
  url: v.string(),
  title: v.string(),
  description: v.string(),
  note: v.string(),
  collectionId: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  favorite: v.boolean(),
  unread: v.boolean(),
  faviconUrl: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()), // set = in the trash
});

// One page of everything the user has saved, trashed bookmarks last. The first
// page (cursor null) also carries the collections and the tags.
export const exportPage = internalQuery({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    bookmarks: v.array(exportBookmark),
    isDone: v.boolean(),
    continueCursor: v.string(),
    collections: v.optional(
      v.array(v.object({ id: v.string(), name: v.string(), parentId: v.union(v.string(), v.null()), sortOrder: v.number() })),
    ),
    tags: v.optional(v.array(v.object({ name: v.string(), count: v.number() }))),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const numItems = Math.min(Math.max(1, args.paginationOpts.numItems), EXPORT_PAGE_MAX);
    const result = await ctx.db
      .query("bookmarks")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .paginate({ ...args.paginationOpts, numItems });

    const tagNames = new Map<Id<"tags">, string>();
    const bookmarks = [];
    for (const b of result.page) {
      for (const id of b.tagIds) {
        if (tagNames.has(id)) continue;
        const tag = await ctx.db.get("tags", id);
        if (tag !== null) tagNames.set(id, tag.name);
      }
      bookmarks.push({
        url: b.url,
        title: b.title,
        description: b.description,
        note: b.note,
        collectionId: (b.collectionId ?? null) as string | null,
        tags: b.tagIds.flatMap((id) => tagNames.get(id) ?? []),
        favorite: b.favorite,
        unread: b.unread,
        faviconUrl: b.faviconUrl ?? null,
        imageUrl: b.imageUrl ?? null,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        deletedAt: b.deletedAt ?? null,
      });
    }

    const out = { bookmarks, isDone: result.isDone, continueCursor: result.continueCursor };
    if (args.paginationOpts.cursor !== null) return out;
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user_parent", (q) => q.eq("userId", userId))
      .take(LIMITS.collectionsPerUser);
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .take(LIMITS.tagsPerUser);
    return {
      ...out,
      collections: collections.map((c) => ({
        id: c._id as string,
        name: c.name,
        parentId: (c.parentId ?? null) as string | null,
        sortOrder: c.sortOrder,
      })),
      tags: tags.map((t) => ({ name: t.name, count: t.bookmarkCount })),
    };
  },
});
