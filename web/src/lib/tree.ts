export interface CollectionRow {
  _id: string;
  name: string;
  parentId?: string | null;
  sortOrder: number;
  bookmarkCount: number;
}

export interface CollectionNode extends CollectionRow {
  children: CollectionRow[];
}

/** Top level first, each group by sortOrder; children whose parent is missing go to the top level. */
export function buildTree(rows: CollectionRow[]): CollectionNode[] {
  const ids = new Set(rows.map((r) => r._id));
  const byOrder = (a: CollectionRow, b: CollectionRow) => a.sortOrder - b.sortOrder;
  const isTop = (r: CollectionRow) => r.parentId == null || !ids.has(r.parentId);
  return rows
    .filter(isTop)
    .sort(byOrder)
    .map((top) => ({ ...top, children: rows.filter((r) => r.parentId === top._id).sort(byOrder) }));
}

/** Where a collection may be dropped. Two levels only: a parent with children can't be nested; nothing goes under a child. */
export function canNest(tree: CollectionNode[], movingId: string, targetParentId: string): boolean {
  if (movingId === targetParentId) return false;
  const target = tree.find((n) => n._id === targetParentId);
  if (!target) return false; // the target is itself a child (or unknown)
  const moving = tree.find((n) => n._id === movingId);
  if (moving && moving.children.length > 0) return false;
  return true;
}

export function collectionName(rows: CollectionRow[], id: string | null | undefined): string | null {
  if (id == null) return null;
  return rows.find((r) => r._id === id)?.name ?? null;
}

/** "Parent / Child" for pickers. */
export function collectionPath(rows: CollectionRow[], id: string): string {
  const row = rows.find((r) => r._id === id);
  if (!row) return "";
  const parent = row.parentId == null ? null : rows.find((r) => r._id === row.parentId);
  return parent ? `${parent.name} / ${row.name}` : row.name;
}

/** Collections in tree order with their depth, for pickers. */
export function flattenTree(tree: CollectionNode[]): { row: CollectionRow; depth: 0 | 1 }[] {
  return tree.flatMap((n) => [{ row: n as CollectionRow, depth: 0 as const }, ...n.children.map((c) => ({ row: c, depth: 1 as const }))]);
}
