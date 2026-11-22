import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isAllowedEmail } from "./allowlist";

/**
 * Throws `notAllowed` unless the user exists and their email is on the
 * allowlist. For code that already knows the user (an API token, a scheduled
 * job, an internal function), not from a session.
 */
export async function requireAllowed(ctx: QueryCtx, userId: Id<"users">): Promise<Id<"users">> {
  const user = await ctx.db.get("users", userId);
  if (!isAllowedEmail(user?.email)) throw new ConvexError("notAllowed");
  return userId;
}

export async function requireUserId(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("notAuthenticated");
  // Re-checked on every call, so removing an email cuts off existing sessions.
  return await requireAllowed(ctx, userId);
}

// Missing and foreign documents are indistinguishable to the caller.
export async function getOwnedBookmark(
  ctx: QueryCtx,
  userId: Id<"users">,
  id: Id<"bookmarks">,
): Promise<Doc<"bookmarks">> {
  const doc = await ctx.db.get("bookmarks", id);
  if (doc === null || doc.userId !== userId) throw new ConvexError("notFound");
  return doc;
}

export async function getOwnedCollection(
  ctx: QueryCtx,
  userId: Id<"users">,
  id: Id<"collections">,
): Promise<Doc<"collections">> {
  const doc = await ctx.db.get("collections", id);
  if (doc === null || doc.userId !== userId) throw new ConvexError("notFound");
  return doc;
}

export async function getOwnedApiToken(
  ctx: QueryCtx,
  userId: Id<"users">,
  id: Id<"apiTokens">,
): Promise<Doc<"apiTokens">> {
  const doc = await ctx.db.get("apiTokens", id);
  if (doc === null || doc.userId !== userId) throw new ConvexError("notFound");
  return doc;
}

export async function getOwnedTag(
  ctx: QueryCtx,
  userId: Id<"users">,
  id: Id<"tags">,
): Promise<Doc<"tags">> {
  const doc = await ctx.db.get("tags", id);
  if (doc === null || doc.userId !== userId) throw new ConvexError("notFound");
  return doc;
}
