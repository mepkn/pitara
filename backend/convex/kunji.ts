import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { findKunjiUser, type KunjiTool } from "./lib/kunji";
import { findBookmarks } from "./lib/findBookmarks";
import { insertBookmark } from "./bookmarks";
import { LIMITS } from "../../shared/limits";

// Pitara's tools for kunji (kunji SPEC.md → App contract). Each runs as the
// user kunji named and only ever sees that user's bookmarks. Writes: add_bookmark
// only; nothing deletes, trashes or rewrites an existing bookmark.

// The app's ConvexErrors are UI codes; kunji shows the message to a model.
const MESSAGES: Record<string, string> = {
  invalidUrl: "That isn't a valid http(s) URL.",
  tooLong: "The URL, title or note is too long.",
  limitReached: `A limit was reached (${LIMITS.tagsPerBookmark} tags per bookmark, ${LIMITS.tagsPerUser} tags or ${LIMITS.bookmarksPerUser.toLocaleString("en")} bookmarks in total).`,
};

const SEARCH_LIMIT = 10;
const SEARCH_MAX = 25;

export const access = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => await findKunjiUser(ctx, email),
});

export const addBookmark = internalMutation({
  args: {
    userId: v.id("users"),
    url: v.string(),
    title: v.string(),
    note: v.string(),
    tags: v.array(v.string()),
    collection: v.string(),
  },
  handler: async (ctx, { userId, url, title, note, tags, collection }) => {
    let collectionId: Id<"collections"> | undefined;
    if (collection !== "") {
      const mine = await ctx.db
        .query("collections")
        .withIndex("by_user_parent", (q) => q.eq("userId", userId))
        .take(LIMITS.collectionsPerUser);
      const hit = mine.find((c) => c.name.toLowerCase() === collection.toLowerCase());
      if (hit === undefined) {
        const known = mine.map((c) => c.name).join(", ") || "none yet";
        throw new ConvexError(`No collection named "${collection}". The user's collections: ${known}. Collections are created in the app.`);
      }
      collectionId = hit._id;
    }
    try {
      const result = await insertBookmark(ctx, userId, { url, title, note, tags, collectionId });
      const saved = (await ctx.db.get("bookmarks", result.id))!;
      return {
        id: result.id as string,
        existed: result.existed,
        url: saved.url,
        title: saved.title,
        message: result.existed
          ? "That URL was already saved (a bookmark in the trash is restored); nothing else was changed."
          : "Saved. The page's title and description are filled in a moment later.",
      };
    } catch (err) {
      if (err instanceof ConvexError && typeof err.data === "string" && MESSAGES[err.data]) {
        throw new ConvexError(MESSAGES[err.data]);
      }
      throw err;
    }
  },
});

export const tools: KunjiTool[] = [
  {
    name: "search_bookmarks",
    description:
      "Search the user's saved bookmarks by words in the title, description, note, URL or tag names, best match first. " +
      "`#tag` and `@collection` in the query narrow the search (e.g. \"#recipes pasta\", \"@Work\"). " +
      "Returns each bookmark's id, title, URL, description, tags, whether it is a favorite or marked to read, and when it was saved.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for, e.g. \"rust async\", optionally with #tag or @collection." },
        limit: { type: "integer", description: `How many bookmarks to return, 1–${SEARCH_MAX} (default ${SEARCH_LIMIT}).` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async (ctx, userId, input) => {
      const limit = (input.limit as number | undefined) ?? SEARCH_LIMIT;
      if (limit < 1 || limit > SEARCH_MAX) throw new ConvexError(`"limit" must be from 1 to ${SEARCH_MAX}.`);
      const query = (input.query as string).trim();
      if (query === "") throw new ConvexError("The query can't be empty.");
      const found = await findBookmarks(ctx, userId, query, limit);
      return found.map((b) => ({
        id: b.id,
        title: b.title || b.domain,
        url: b.url,
        description: b.description,
        tags: b.tags,
        favorite: b.favorite,
        toRead: b.unread,
        hasNote: b.hasNote,
        savedAt: new Date(b.createdAt).toISOString(),
      }));
    },
  },
  {
    name: "add_bookmark",
    description:
      "Save a link to the user's Pitara bookmarks. The title and description are filled in from the page afterwards if left out. " +
      "A URL that is already saved is not duplicated. Tags are created if new; the collection must already exist " +
      "(an unknown name is refused with the list of the user's collections). Never changes or deletes an existing bookmark.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) link to save." },
        title: { type: "string", description: "Optional title; leave out to use the page's own." },
        note: { type: "string", description: "Optional note of the user's own." },
        tags: { type: "string", description: "Optional comma-separated tags, e.g. \"recipes, to-try\"." },
        collection: { type: "string", description: "Optional name of an existing collection." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    handler: async (ctx, userId, input) =>
      await ctx.runMutation(internal.kunji.addBookmark, {
        userId,
        url: input.url as string,
        title: (input.title as string | undefined) ?? "",
        note: (input.note as string | undefined) ?? "",
        tags: ((input.tags as string | undefined) ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        collection: ((input.collection as string | undefined) ?? "").trim(),
      }),
  },
];
