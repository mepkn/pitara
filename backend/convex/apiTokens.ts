import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { getOwnedApiToken, requireAllowed, requireUserId } from "./lib/access";
import { generateToken, hashToken, tokenPrefix } from "./lib/tokens";
import { LIMITS } from "../../shared/limits";

// Personal API tokens for the Chrome extension and scripts (HTTP API,
// lib/apiRoutes.ts). Created in the web app; the token is shown once.

const MINUTE = 60 * 1000;
const NAME_MAX = 60;

const tokenInfo = v.object({
  _id: v.id("apiTokens"),
  name: v.string(),
  prefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
});

// An action, not a mutation: the token needs real randomness, and mutations
// are deterministic. The mutation below does the checks and the insert.
export const create = action({
  args: { name: v.string() },
  returns: v.object({ id: v.id("apiTokens"), token: v.string(), prefix: v.string(), name: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("notAuthenticated");
    const token = generateToken();
    const prefix = tokenPrefix(token);
    const created: { id: Id<"apiTokens">; name: string } = await ctx.runMutation(internal.apiTokens.insert, {
      userId,
      name: args.name,
      prefix,
      hash: await hashToken(token),
    });
    return { id: created.id, token, prefix, name: created.name };
  },
});

export const insert = internalMutation({
  args: { userId: v.id("users"), name: v.string(), prefix: v.string(), hash: v.string() },
  returns: v.object({ id: v.id("apiTokens"), name: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAllowed(ctx, args.userId);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name === "") throw new ConvexError("invalidName");
    if (name.length > NAME_MAX) throw new ConvexError("tooLong");
    const owned = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LIMITS.apiTokensPerUser);
    if (owned.length >= LIMITS.apiTokensPerUser) throw new ConvexError("limitReached");
    const id = await ctx.db.insert("apiTokens", {
      userId,
      name,
      prefix: args.prefix,
      hash: args.hash,
      createdAt: Date.now(),
    });
    return { id, name };
  },
});

export const list = query({
  args: {},
  returns: v.array(tokenInfo),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(LIMITS.apiTokensPerUser);
    return rows.map(({ _id, name, prefix, createdAt, lastUsedAt }) => ({ _id, name, prefix, createdAt, lastUsedAt }));
  },
});

export const revoke = mutation({
  args: { id: v.id("apiTokens") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const token = await getOwnedApiToken(ctx, userId, args.id);
    await ctx.db.delete("apiTokens", token._id);
    return null;
  },
});

// Resolves a token's hash to its user for an HTTP API call. The same
// ALLOWED_EMAILS check as a session runs here, so removing an email also
// cuts off its tokens. Counts the call against the token's limit (60 per
// one-minute window); a refused call isn't counted. `lastUsedAt` is written
// when a window starts, so at most once a minute.
export const authenticate = internalMutation({
  args: { hash: v.string() },
  returns: v.union(
    v.object({ status: v.literal("ok"), userId: v.id("users") }),
    v.object({ status: v.literal("unauthorized") }),
    v.object({ status: v.literal("forbidden") }),
    v.object({ status: v.literal("limited"), retryAfterSeconds: v.number() }),
  ),
  handler: async (ctx, { hash }) => {
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (token === null) return { status: "unauthorized" as const };
    try {
      await requireAllowed(ctx, token.userId);
    } catch {
      return { status: "forbidden" as const };
    }

    const now = Date.now();
    const windowStart = token.windowStart;
    if (windowStart === undefined || now - windowStart >= MINUTE || now < windowStart) {
      await ctx.db.patch("apiTokens", token._id, { windowStart: now, windowCount: 1, lastUsedAt: now });
    } else if ((token.windowCount ?? 0) >= LIMITS.apiRequestsPerMinute) {
      return { status: "limited" as const, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + MINUTE - now) / 1000)) };
    } else {
      await ctx.db.patch("apiTokens", token._id, { windowCount: (token.windowCount ?? 0) + 1 });
    }
    return { status: "ok" as const, userId: token.userId };
  },
});
