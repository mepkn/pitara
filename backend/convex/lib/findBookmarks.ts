import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

const MAX_PAGES = 5; // pages tried to fill a search result

/**
 * Search (`q`, with #tag and @collection shortcuts) or the newest bookmarks
 * (empty `q`), up to `limit`. A page can come back short because some filters
 * apply after the index, so this keeps asking until it has enough or is done.
 * Shared by the HTTP API and the kunji tools.
 */
export async function findBookmarks(ctx: ActionCtx, userId: Id<"users">, q: string, limit: number) {
  const found: (typeof internal.apiV1.find)["_returnType"]["page"] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES && found.length < limit; i++) {
    const page: (typeof internal.apiV1.find)["_returnType"] = await ctx.runQuery(internal.apiV1.find, {
      userId,
      q,
      paginationOpts: { numItems: limit, cursor },
    });
    found.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return found.slice(0, limit);
}
