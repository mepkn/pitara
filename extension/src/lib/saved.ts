import { normalizeUrl } from "@shared/url";

// "Is this tab's URL already saved?" with a small per-tab cache, so the toolbar badge costs one
// /bookmarks/check call per page, not one per tab event (the API allows 60 calls a minute).

export interface CacheEntry {
  /** normalizeUrl() of the page the answer is for. */
  key: string;
  exists: boolean;
  at: number;
}
export type CacheMap = Record<string, CacheEntry>;

export const CACHE_TTL_MS = 5 * 60_000;
export const MAX_CACHED_TABS = 200;

export function cacheKey(url: string): string {
  return normalizeUrl(url) ?? url;
}

/** The cached answer for this tab and URL, or undefined when missing, for another URL, or old. */
export function lookup(map: CacheMap, tabId: number, url: string, now: number): boolean | undefined {
  const entry = map[String(tabId)];
  if (!entry || entry.key !== cacheKey(url) || now - entry.at > CACHE_TTL_MS) return undefined;
  return entry.exists;
}

/** Returns a new map with the answer stored, dropping the oldest entries past the cap. */
export function remember(map: CacheMap, tabId: number, url: string, exists: boolean, now: number): CacheMap {
  const next: CacheMap = { ...map, [String(tabId)]: { key: cacheKey(url), exists, at: now } };
  const ids = Object.keys(next);
  if (ids.length > MAX_CACHED_TABS) {
    ids
      .sort((a, b) => next[a]!.at - next[b]!.at)
      .slice(0, ids.length - MAX_CACHED_TABS)
      .forEach((id) => delete next[id]);
  }
  return next;
}

export function forget(map: CacheMap, tabId: number): CacheMap {
  const { [String(tabId)]: _gone, ...rest } = map;
  return rest;
}

export interface BadgeView {
  text: string;
  title: string;
  color: string;
}

export const BADGE = {
  saved: { text: "✓", title: "Pitara: already saved", color: "#2F7D4F" },
  none: { text: "", title: "Save to Pitara", color: "#2F7D4F" },
  justSaved: { text: "✓", title: "Pitara: saved", color: "#2F7D4F" },
  linkSaved: { text: "+", title: "Pitara: link saved", color: "#2F7D4F" },
  tokenProblem: { text: "!", title: "Pitara: check your API token in the options", color: "#B3261E" },
} satisfies Record<string, BadgeView>;

export function failedBadge(message: string): BadgeView {
  return { text: "!", title: `Pitara: ${message}`, color: "#B3261E" };
}
