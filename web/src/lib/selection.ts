/** Click on an item with shift: select the range between the anchor and the clicked item. */
export function rangeBetween(ids: string[], anchor: string | null, clicked: string): string[] {
  const to = ids.indexOf(clicked);
  if (to === -1) return [];
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  if (from === -1) return [clicked];
  const [a, b] = from < to ? [from, to] : [to, from];
  return ids.slice(a, b + 1);
}

/** Splits ids into batches. `bulk` accepts 200 ids, but tag-heavy bookmarks can pass the 4,096-read limit. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const BULK_CHUNK = 50;
