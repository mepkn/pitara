import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  collections: defineTable({
    userId: v.id("users"),
    name: v.string(),
    parentId: v.optional(v.id("collections")), // one level of nesting only
    sortOrder: v.number(),
    bookmarkCount: v.number(), // live (not trashed) bookmarks directly in it; kept by lib/bookmarkWrites.ts
    updatedAt: v.number(),
  }).index("by_user_parent", ["userId", "parentId", "sortOrder"]),

  bookmarks: defineTable({
    userId: v.id("users"),
    url: v.string(), // as the user saved it
    normalizedUrl: v.string(), // for duplicate detection (shared/url.ts)
    domain: v.string(),
    title: v.string(),
    description: v.string(),
    note: v.string(), // the user's own note
    collectionId: v.optional(v.id("collections")),
    tagIds: v.array(v.id("tags")),
    favorite: v.boolean(),
    unread: v.boolean(),
    faviconUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()), // og:image, stored as a URL, not downloaded
    metaStatus: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    // Link checker (linkCheck.ts): "broken" = the page is gone (404/410, or the
    // host no longer resolves) on two checks a day apart. Unset = not checked yet.
    linkStatus: v.optional(v.union(v.literal("ok"), v.literal("broken"))),
    linkCheckedAt: v.optional(v.number()),
    searchText: v.string(), // title, description, note, url, tag names; keep in sync
    deletedAt: v.optional(v.number()), // set = in trash
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_created", ["userId", "deletedAt", "createdAt"])
    .index("by_user_collection", ["userId", "collectionId", "deletedAt", "createdAt"])
    .index("by_user_favorite", ["userId", "favorite", "deletedAt", "createdAt"])
    .index("by_user_unread", ["userId", "unread", "deletedAt", "createdAt"])
    .index("by_user_url", ["userId", "normalizedUrl"])
    // Sort by title / domain: the sort key comes last, so every view that
    // supports those sorts needs its own copy of the index.
    .index("by_user_title", ["userId", "deletedAt", "title"])
    .index("by_user_domain", ["userId", "deletedAt", "domain"])
    .index("by_user_collection_title", ["userId", "collectionId", "deletedAt", "title"])
    .index("by_user_collection_domain", ["userId", "collectionId", "deletedAt", "domain"])
    .index("by_user_favorite_title", ["userId", "favorite", "deletedAt", "title"])
    .index("by_user_favorite_domain", ["userId", "favorite", "deletedAt", "domain"])
    .index("by_user_unread_title", ["userId", "unread", "deletedAt", "title"])
    .index("by_user_unread_domain", ["userId", "unread", "deletedAt", "domain"])
    .index("by_deleted", ["deletedAt"])
    // The hourly cron finds bookmarks whose metadata fetch never finished.
    .index("by_meta_status", ["metaStatus", "deletedAt", "updatedAt"])
    // The daily cron finds bookmarks not checked for a week; the Broken view lists the broken ones.
    .index("by_link_checked", ["deletedAt", "linkCheckedAt"])
    .index("by_user_link", ["userId", "linkStatus", "deletedAt", "createdAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["userId", "deletedAt", "collectionId"],
    }),

  tags: defineTable({
    userId: v.id("users"),
    name: v.string(), // lower-cased, unique per user
    bookmarkCount: v.number(), // live (not trashed) bookmarks with the tag
  }).index("by_user_name", ["userId", "name"]),

  // One row per user: total bookmarks, trashed ones included, for the 100,000 cap.
  userStats: defineTable({
    userId: v.id("users"),
    bookmarkCount: v.number(),
  }).index("by_user", ["userId"]),

  // Mirrors bookmarks.tagIds so a tag's bookmarks can be found through an index.
  bookmarkTags: defineTable({
    userId: v.id("users"),
    bookmarkId: v.id("bookmarks"),
    tagId: v.id("tags"),
  })
    .index("by_tag", ["tagId"])
    .index("by_bookmark", ["bookmarkId"]),

  apiTokens: defineTable({
    userId: v.id("users"),
    name: v.string(),
    prefix: v.string(),
    hash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // Rate limit: requests counted since windowStart (one-minute windows).
    windowStart: v.optional(v.number()),
    windowCount: v.optional(v.number()),
  })
    .index("by_hash", ["hash"])
    .index("by_user", ["userId"]),
});
