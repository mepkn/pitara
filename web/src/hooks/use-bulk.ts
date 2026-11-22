import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BULK_CHUNK, chunk } from "@/lib/selection";

export type BulkAction =
  | { type: "move"; collectionId: Id<"collections"> | null }
  | { type: "addTag"; tag: string }
  | { type: "removeTag"; tag: string }
  | { type: "favorite"; value: boolean }
  | { type: "trash" };

/** Runs a bulk action in batches of 50 (tag-heavy bookmarks can pass the 4,096-read limit with 200) and adds up the result. */
export function useBulk() {
  const bulk = useMutation(api.bookmarks.bulk);
  return async (ids: string[], action: BulkAction): Promise<number> => {
    let changed = 0;
    for (const batch of chunk(ids, BULK_CHUNK)) {
      const res = await bulk({ ids: batch as Id<"bookmarks">[], action });
      changed += res.changed;
    }
    return changed;
  };
}
