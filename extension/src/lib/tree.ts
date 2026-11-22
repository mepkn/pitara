import type { ApiCollection } from "@shared/types";

// Two no-break spaces: <option> text collapses ordinary leading spaces.
const INDENT = String.fromCharCode(0xa0, 0xa0);

export interface CollectionOption {
  id: string;
  label: string;
}

/** Flat collection list → options in tree order (parents first, children indented one level). */
export function collectionOptions(collections: ApiCollection[]): CollectionOption[] {
  const bySort = (a: ApiCollection, b: ApiCollection) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const ids = new Set(collections.map((c) => c.id));
  // A child whose parent is missing is shown at the top level rather than dropped.
  const tops = collections.filter((c) => c.parentId === null || !ids.has(c.parentId)).sort(bySort);
  const out: CollectionOption[] = [];
  for (const top of tops) {
    out.push({ id: top.id, label: top.name });
    for (const child of collections.filter((c) => c.parentId === top.id).sort(bySort)) {
      out.push({ id: child.id, label: `${INDENT}${child.name}` });
    }
  }
  return out;
}
