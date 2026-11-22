import type { HttpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { httpAction, type ActionCtx } from "../_generated/server";
import { parseCreateBody, parseLimit, parseUpdateBody } from "./apiBody";
import { env } from "./env";
import { bearerToken, hashToken } from "./tokens";

// The token-protected HTTP API under /api/v1 (SPEC.md → HTTP API). Every call
// needs `Authorization: Bearer pit_...`; the token resolves to a user, the same
// ALLOWED_EMAILS check as a session runs, and 60 calls a minute are allowed
// per token (apiTokens.authenticate). The user always comes from the token.

const MAX_BODY_CHARS = 100_000; // a note is at most 20,000
const MAX_PAGES = 5; // pages tried to fill a search result

// ---- responses -------------------------------------------------------------

/** Echoes the caller's origin only for the Chrome extension and the web app. */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (origin === null) return {};
  const site = (env().SITE_URL ?? "").replace(/\/+$/, "");
  if (!origin.startsWith("chrome-extension://") && !(site !== "" && origin === site)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function respond(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(req), ...extra },
  });
}

const STATUS: Record<string, number> = {
  notAuthenticated: 401,
  notAllowed: 403,
  notFound: 404,
  tooManyRequests: 429,
  invalidUrl: 400,
  invalidName: 400,
  tooLong: 400,
  badRequest: 400,
  limitReached: 409,
  duplicate: 409,
  inTrash: 409,
  notInTrash: 409,
};

function failure(req: Request, err: unknown): Response {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return respond(req, STATUS[err.data] ?? 400, { error: err.data });
  }
  // Anything else is a bug; say nothing about it to the caller (and never log the request).
  console.error("api error:", err instanceof Error ? err.message : "unknown");
  return respond(req, 500, { error: "serverError" });
}

// ---- auth and plumbing -----------------------------------------------------

type Handler = (ctx: ActionCtx, userId: Id<"users">, req: Request, url: URL) => Promise<Response>;

function protectedRoute(handler: Handler) {
  return httpAction(async (ctx, req) => {
    try {
      const token = bearerToken(req.headers.get("Authorization"));
      if (token === null) return respond(req, 401, { error: "notAuthenticated" });
      const auth = await ctx.runMutation(internal.apiTokens.authenticate, { hash: await hashToken(token) });
      switch (auth.status) {
        case "unauthorized":
          return respond(req, 401, { error: "notAuthenticated" });
        case "forbidden":
          return respond(req, 403, { error: "notAllowed" });
        case "limited":
          return respond(req, 429, { error: "tooManyRequests" }, { "Retry-After": String(auth.retryAfterSeconds) });
        case "ok":
          return await handler(ctx, auth.userId, req, new URL(req.url));
      }
    } catch (err) {
      return failure(req, err);
    }
  });
}

/** Preflight: no token needed, and nothing but the CORS headers comes back. */
const preflight = httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req) }));

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) throw new ConvexError("tooLong");
  try {
    return JSON.parse(text);
  } catch {
    throw new ConvexError("badRequest");
  }
}

// ---- routes ----------------------------------------------------------------

const BASE = "/api/v1";
const BOOKMARK_PREFIX = `${BASE}/bookmarks/`;

export function addApiRoutes(http: HttpRouter) {
  const get = (path: string, handler: Handler) => {
    http.route({ path: `${BASE}${path}`, method: "GET", handler: protectedRoute(handler) });
    http.route({ path: `${BASE}${path}`, method: "OPTIONS", handler: preflight });
  };

  get("/me", async (ctx, userId, req) => respond(req, 200, await ctx.runQuery(internal.apiV1.me, { userId })));

  get("/collections", async (ctx, userId, req) =>
    respond(req, 200, { collections: await ctx.runQuery(internal.apiV1.collections, { userId }) }),
  );

  get("/tags", async (ctx, userId, req) =>
    respond(req, 200, { tags: await ctx.runQuery(internal.apiV1.tags, { userId }) }),
  );

  get("/bookmarks/check", async (ctx, userId, req, url) => {
    const target = url.searchParams.get("url");
    if (target === null || target === "") throw new ConvexError("badRequest");
    const bookmark = await ctx.runQuery(internal.apiV1.check, { userId, url: target });
    return respond(req, 200, bookmark === null ? { exists: false } : { exists: true, bookmark });
  });

  // Search (`?q=`, with #tag and @collection shortcuts), or the newest bookmarks without q.
  get("/bookmarks", async (ctx, userId, req, url) => {
    const limit = parseLimit(url.searchParams.get("limit"));
    if (limit === null) throw new ConvexError("badRequest");
    const q = url.searchParams.get("q") ?? "";
    const found = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES && found.length < limit; i++) {
      const page: Awaited<ReturnType<typeof ctx.runQuery<typeof internal.apiV1.find>>> = await ctx.runQuery(
        internal.apiV1.find,
        { userId, q, paginationOpts: { numItems: limit, cursor } },
      );
      found.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return respond(req, 200, { bookmarks: found.slice(0, limit) });
  });

  http.route({
    path: `${BASE}/bookmarks`,
    method: "POST",
    handler: protectedRoute(async (ctx, userId, req) => {
      const parsed = parseCreateBody(await readJson(req));
      if (!parsed.ok) throw new ConvexError("badRequest");
      const { url, collectionId, ...rest } = parsed.value;
      const result = await ctx.runMutation(internal.apiV1.create, {
        userId,
        url: url!,
        ...rest,
        ...(collectionId ? { collectionId } : {}),
      });
      return respond(req, result.existed ? 200 : 201, result);
    }),
  });

  // PATCH and DELETE /bookmarks/:id (the router has no path parameters).
  const idOf = (url: URL): string => {
    const id = url.pathname.slice(BOOKMARK_PREFIX.length);
    if (id === "" || id.includes("/")) throw new ConvexError("notFound");
    return decodeURIComponent(id);
  };
  http.route({
    pathPrefix: BOOKMARK_PREFIX,
    method: "PATCH",
    handler: protectedRoute(async (ctx, userId, req, url) => {
      const id = idOf(url);
      const parsed = parseUpdateBody(await readJson(req));
      if (!parsed.ok) throw new ConvexError("badRequest");
      return respond(req, 200, await ctx.runMutation(internal.apiV1.update, { userId, id, ...parsed.value }));
    }),
  });
  http.route({
    pathPrefix: BOOKMARK_PREFIX,
    method: "DELETE",
    handler: protectedRoute(async (ctx, userId, req, url) => {
      await ctx.runMutation(internal.apiV1.trash, { userId, id: idOf(url) });
      return respond(req, 200, { ok: true });
    }),
  });
  http.route({ pathPrefix: BOOKMARK_PREFIX, method: "OPTIONS", handler: preflight });
}
