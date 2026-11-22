import { writeNetscape, type NetscapeWriteBookmark } from "@shared/netscape";

export interface ExportPage {
  bookmarks: {
    url: string;
    title: string;
    description: string;
    note: string;
    collectionId: string | null;
    tags: string[];
    favorite: boolean;
    unread: boolean;
    faviconUrl: string | null;
    imageUrl: string | null;
    createdAt: number;
    updatedAt: number;
    deletedAt: number | null;
  }[];
  isDone: boolean;
  continueCursor: string;
  collections?: { id: string; name: string; parentId: string | null; sortOrder: number }[];
  tags?: { name: string; count: number }[];
}

export interface ExportData {
  exportedAt: string;
  collections: NonNullable<ExportPage["collections"]>;
  tags: NonNullable<ExportPage["tags"]>;
  bookmarks: ExportPage["bookmarks"];
}

/** Calls `fetchPage` from cursor null until isDone and joins the pages (the first one carries collections and tags). */
export async function collectExport(
  fetchPage: (cursor: string | null) => Promise<ExportPage>,
  onProgress?: (count: number) => void,
): Promise<ExportData> {
  const data: ExportData = { exportedAt: new Date().toISOString(), collections: [], tags: [], bookmarks: [] };
  let cursor: string | null = null;
  for (;;) {
    const page = await fetchPage(cursor);
    if (page.collections) data.collections = page.collections;
    if (page.tags) data.tags = page.tags;
    data.bookmarks.push(...page.bookmarks);
    onProgress?.(data.bookmarks.length);
    if (page.isDone) return data;
    cursor = page.continueCursor;
  }
}

export function exportJsonText(data: ExportData): string {
  return JSON.stringify(data, null, 2);
}

/** Netscape HTML of the live bookmarks (the trash isn't exported). */
export function exportHtmlText(data: ExportData): string {
  const bookmarks: NetscapeWriteBookmark[] = data.bookmarks
    .filter((b) => b.deletedAt === null)
    .map((b) => ({
      url: b.url,
      title: b.title,
      description: b.description,
      note: b.note,
      tags: b.tags,
      unread: b.unread,
      createdAt: b.createdAt,
      collectionId: b.collectionId ?? undefined,
    }));
  const collections = [...data.collections].sort((a, b) => a.sortOrder - b.sortOrder);
  // Top-level collections first so a parent is always written before its children.
  const ordered = [...collections.filter((c) => c.parentId === null), ...collections.filter((c) => c.parentId !== null)];
  return writeNetscape({ collections: ordered, bookmarks });
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
