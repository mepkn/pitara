import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { buildTree, flattenTree } from "./tree";

/** Collections as stored, the two-level tree and a flat list for pickers. `undefined` while loading. */
export function useCollections() {
  const rows = useQuery(api.collections.list);
  return useMemo(() => {
    if (rows === undefined) return undefined;
    const tree = buildTree(rows);
    return { rows, tree, flat: flattenTree(tree), byId: new Map(rows.map((r) => [r._id as string, r])) };
  }, [rows]);
}

/** Tags with counts and a lookup from id to name (bookmarks carry tag ids). `undefined` while loading. */
export function useTags() {
  const rows = useQuery(api.tags.list);
  return useMemo(() => {
    if (rows === undefined) return undefined;
    return { rows, byId: new Map<string, string>(rows.map((t) => [t._id, t.name])) };
  }, [rows]);
}

export type CollectionId = Id<"collections">;
