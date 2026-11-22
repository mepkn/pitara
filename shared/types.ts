// Shapes of the HTTP API under /api/v1 (backend/convex/lib/apiRoutes.ts),
// shared by the backend and the Chrome extension. Ids are plain strings here;
// timestamps are milliseconds since the epoch.

export type MetaStatus = "pending" | "done" | "failed";

export interface ApiBookmark {
  id: string;
  url: string;
  domain: string;
  title: string;
  description: string;
  /** Left out of search results (which carry `hasNote` instead). */
  note?: string;
  hasNote: boolean;
  collectionId: string | null;
  /** Tag names, lower-case. */
  tags: string[];
  favorite: boolean;
  unread: boolean;
  faviconUrl: string | null;
  imageUrl: string | null;
  metaStatus: MetaStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ApiCollection {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  bookmarkCount: number;
}

export interface ApiTag {
  id: string;
  name: string;
  count: number;
}

/** POST /bookmarks */
export interface ApiCreateBookmark {
  url: string;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: string;
  tags?: string[];
  favorite?: boolean;
  unread?: boolean;
}

/** PATCH /bookmarks/:id. `collectionId: null` moves it to Unsorted; `tags` replaces the tags. */
export interface ApiUpdateBookmark {
  url?: string;
  title?: string;
  description?: string;
  note?: string;
  collectionId?: string | null;
  tags?: string[];
  favorite?: boolean;
  unread?: boolean;
}

export interface ApiMe {
  email: string;
}
export interface ApiCreateResult {
  id: string;
  existed: boolean;
}
export interface ApiCheckResult {
  exists: boolean;
  bookmark?: ApiBookmark;
}
export interface ApiError {
  /** One of the codes: notAuthenticated, notAllowed, notFound, invalidUrl, tooLong, limitReached, tooManyRequests, badRequest, ... */
  error: string;
}
