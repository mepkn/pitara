import { useCallback, useEffect, useRef, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Route } from "@/lib/router";
import type { Sort } from "@/lib/prefs";

type View = "all" | "unsorted" | "collection" | "favorites" | "unread" | "broken" | "trash";

/** The backend view for a route (a tag route lists by tag id and ignores the view). */
export function routeView(route: Route): View {
  switch (route.kind) {
    case "settings":
    case "tag":
      return "all";
    default:
      return route.kind;
  }
}

const PAGE = 30;

/**
 * One paginated list: a view, or search results inside it. Pages can come back short (tag view,
 * search, trash filters), so while more can be loaded and the sentinel is visible, keep loading.
 */
export function useBookmarkList(route: Route, q: string, sort: Sort) {
  const view = routeView(route);
  const collectionId = route.kind === "collection" ? (route.id as Id<"collections">) : undefined;
  const tagId = route.kind === "tag" ? (route.id as Id<"tags">) : undefined;
  const searching = q.trim() !== "";
  const off = route.kind === "settings";

  const list = usePaginatedQuery(
    api.bookmarks.list,
    off || searching ? "skip" : { view, collectionId, tagId, sort },
    { initialNumItems: PAGE },
  );
  const search = usePaginatedQuery(
    api.bookmarks.search,
    off || !searching ? "skip" : { query: q, view: route.kind === "all" || route.kind === "tag" ? undefined : view, collectionId, tagId },
    { initialNumItems: PAGE },
  );
  const active = searching ? search : list;

  const [visible, setVisible] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const { status, loadMore } = active;
  // A callback ref for the sentinel under the list (stable, so React doesn't re-attach it every render).
  const sentinel = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return setVisible(false);
    observer.current = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: "400px" });
    observer.current.observe(node);
  }, []);
  useEffect(() => {
    if (visible && status === "CanLoadMore") loadMore(PAGE);
  }, [visible, status, loadMore, active.results.length]);

  return { results: active.results, status, loadMore, sentinel, searching };
}
