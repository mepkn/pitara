import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildTree } from "@/lib/tree";

/** Collections as a two-level tree (undefined while loading). */
export function useCollections() {
  const rows = useQuery(api.collections.list);
  const tree = useMemo(() => (rows ? buildTree(rows) : undefined), [rows]);
  return { rows, tree };
}

/** Tags with counts, and an id → name map (lists carry tag ids; writes take names). */
export function useTags() {
  const tags = useQuery(api.tags.list);
  const names = useMemo(() => new Map((tags ?? []).map((t) => [t._id as string, t.name])), [tags]);
  return { tags, names };
}
