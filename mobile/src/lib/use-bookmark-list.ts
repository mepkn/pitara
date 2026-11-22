import { useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { Sort } from "./preferences";

export type View = "all" | "unsorted" | "collection" | "favorites" | "unread" | "trash";
export type Bookmark = FunctionReturnType<typeof api.bookmarks.list>["page"][number];

export interface Scope {
  view: View;
  collectionId?: Id<"collections">;
  tagId?: Id<"tags">;
}

const PAGE = 25;

/**
 * One paginated list: a scope, or search results inside it. Pages can come back short (tag view,
 * search, trash filters), so while more can be loaded and nothing is shown yet, keep loading.
 */
export function useBookmarkList(scope: Scope, q: string, sort: Sort) {
  const searching = q.trim() !== "";
  const list = usePaginatedQuery(
    api.bookmarks.list,
    searching ? "skip" : { view: scope.view, collectionId: scope.collectionId, tagId: scope.tagId, sort },
    { initialNumItems: PAGE },
  );
  const search = usePaginatedQuery(
    api.bookmarks.search,
    searching
      ? {
          query: q,
          // A tag has no view of its own ("all" + tagId); "all" needs no scoping either.
          view: scope.view === "all" ? undefined : scope.view,
          collectionId: scope.collectionId,
          tagId: scope.tagId,
        }
      : "skip",
    { initialNumItems: PAGE },
  );
  const active = searching ? search : list;
  const { status, loadMore, results } = active;

  useEffect(() => {
    if (status === "CanLoadMore" && results.length === 0) loadMore(PAGE);
  }, [status, results.length, loadMore]);

  return {
    results,
    status,
    searching,
    loading: status === "LoadingFirstPage",
    loadingMore: status === "LoadingMore",
    canLoadMore: status === "CanLoadMore",
    loadMore: () => loadMore(PAGE),
  };
}
