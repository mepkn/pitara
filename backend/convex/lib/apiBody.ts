import { LIMITS } from "../../../shared/limits";

// Validation of JSON request bodies for the HTTP API. A body is `unknown`
// until it passes here; the limits on lengths and counts are enforced later
// by the same functions the app uses, so only the shape is checked.

export interface BookmarkFields {
  url?: string;
  title?: string;
  description?: string;
  note?: string;
  /** A collection id as text (checked later), or null for Unsorted (updates only). */
  collectionId?: string | null;
  tags?: string[];
  favorite?: boolean;
  unread?: boolean;
}

const MAX_TAGS_IN_BODY = 100; // far above the real limit of 20: just bounds the work

type Parsed = { ok: true; value: BookmarkFields } | { ok: false };

function parse(body: unknown, { create }: { create: boolean }): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;
  const out: BookmarkFields = {};

  for (const key of ["url", "title", "description", "note"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return { ok: false };
    out[key] = value;
  }
  if (create && out.url === undefined) return { ok: false };

  const collectionId = input["collectionId"];
  if (collectionId !== undefined) {
    if (typeof collectionId === "string") out.collectionId = collectionId;
    else if (collectionId === null && !create) out.collectionId = null;
    else if (collectionId === null) out.collectionId = undefined; // creating "with no collection"
    else return { ok: false };
  }

  const tags = input["tags"];
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length > MAX_TAGS_IN_BODY || !tags.every((t) => typeof t === "string")) {
      return { ok: false };
    }
    out.tags = tags as string[];
  }

  for (const key of ["favorite", "unread"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return { ok: false };
    out[key] = value;
  }
  return { ok: true, value: out };
}

export const parseCreateBody = (body: unknown): Parsed => parse(body, { create: true });
export const parseUpdateBody = (body: unknown): Parsed => parse(body, { create: false });

/** `?limit=`: 1 to 50, default 20; null for anything else. */
export function parseLimit(raw: string | null): number | null {
  if (raw === null) return 20;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= LIMITS.apiSearchMax ? n : null;
}
