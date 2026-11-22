/// <reference types="node" />
import { beforeAll, describe, expect, it } from "vitest";

// router.ts touches `window` when loaded; give it a stub in the node environment.
let mod: typeof import("./router");
beforeAll(async () => {
  (globalThis as unknown as { window: unknown }).window = { addEventListener() {} };
  mod = await import("./router");
});

describe("parseLocation", () => {
  it("parses every route", () => {
    for (const kind of ["all", "unsorted", "favorites", "unread", "trash", "settings"] as const) {
      expect(mod.parseLocation(`/${kind}`, "").route).toEqual({ kind });
    }
    expect(mod.parseLocation("/c/abc123", "").route).toEqual({ kind: "collection", id: "abc123" });
    expect(mod.parseLocation("/tag/t1/", "").route).toEqual({ kind: "tag", id: "t1" });
  });
  it("reads the search and defaults to all", () => {
    expect(mod.parseLocation("/all", "?q=%23rust+%40Work")).toEqual({ route: { kind: "all" }, q: "#rust @Work" });
    expect(mod.parseLocation("/", "").route).toEqual({ kind: "all" });
    expect(mod.parseLocation("/nope", "").route).toEqual({ kind: "all" });
  });
});

describe("buildUrl", () => {
  it("round-trips with parseLocation", () => {
    const route = { kind: "collection", id: "a/b" } as const;
    const url = mod.buildUrl(route, "  #tag word ");
    const [path, search] = url.split("?");
    expect(mod.parseLocation(path!, `?${search}`)).toEqual({ route, q: "#tag word" });
    expect(mod.buildUrl({ kind: "trash" })).toBe("/trash");
    expect(mod.buildUrl({ kind: "all" }, "   ")).toBe("/all");
  });
});
