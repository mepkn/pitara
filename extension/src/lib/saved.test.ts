import { describe, expect, it } from "vitest";
import { CACHE_TTL_MS, MAX_CACHED_TABS, forget, lookup, remember, type CacheMap } from "./saved";

describe("saved cache", () => {
  it("returns the stored answer for the same tab and URL", () => {
    const map = remember({}, 1, "https://example.com/a", true, 1000);
    expect(lookup(map, 1, "https://example.com/a", 1001)).toBe(true);
  });

  it("matches URLs the way the server does (fragment, utm_*, www, trailing slash)", () => {
    const map = remember({}, 1, "https://www.example.com/a/?utm_source=x#top", false, 1000);
    expect(lookup(map, 1, "https://example.com/a", 1001)).toBe(false);
  });

  it("misses for another URL, another tab, or an old entry", () => {
    const map = remember({}, 1, "https://example.com/a", true, 1000);
    expect(lookup(map, 1, "https://example.com/b", 1001)).toBeUndefined();
    expect(lookup(map, 2, "https://example.com/a", 1001)).toBeUndefined();
    expect(lookup(map, 1, "https://example.com/a", 1000 + CACHE_TTL_MS + 1)).toBeUndefined();
  });

  it("overwrites when a tab navigates", () => {
    let map = remember({}, 1, "https://example.com/a", true, 1000);
    map = remember(map, 1, "https://example.com/b", false, 2000);
    expect(lookup(map, 1, "https://example.com/a", 2001)).toBeUndefined();
    expect(lookup(map, 1, "https://example.com/b", 2001)).toBe(false);
  });

  it("forgets a closed tab", () => {
    const map = forget(remember({}, 7, "https://example.com", true, 1), 7);
    expect(lookup(map, 7, "https://example.com", 2)).toBeUndefined();
  });

  it("keeps the newest entries when over the cap", () => {
    let map: CacheMap = {};
    for (let i = 0; i < MAX_CACHED_TABS + 5; i++) map = remember(map, i, `https://example.com/${i}`, true, i);
    expect(Object.keys(map)).toHaveLength(MAX_CACHED_TABS);
    expect(lookup(map, 0, "https://example.com/0", 10)).toBeUndefined();
    expect(lookup(map, MAX_CACHED_TABS + 4, `https://example.com/${MAX_CACHED_TABS + 4}`, 10_000)).toBe(true);
  });
});
