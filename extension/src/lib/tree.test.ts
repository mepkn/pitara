import { describe, expect, it } from "vitest";
import type { ApiCollection } from "@shared/types";
import { collectionOptions } from "./tree";

const c = (id: string, name: string, parentId: string | null, sortOrder: number): ApiCollection => ({
  id, name, parentId, sortOrder, bookmarkCount: 0,
});

describe("collectionOptions", () => {
  it("orders parents by sortOrder with children indented beneath them", () => {
    const out = collectionOptions([c("b", "B", null, 2), c("a1", "A child", "a", 0), c("a", "A", null, 1)]);
    expect(out.map((o) => o.id)).toEqual(["a", "a1", "b"]);
    expect(out[1]!.label.trim()).toBe("A child");
    expect(out[1]!.label).not.toBe("A child");
  });
  it("shows an orphaned child at the top level", () => {
    expect(collectionOptions([c("x", "X", "gone", 0)]).map((o) => o.id)).toEqual(["x"]);
  });
});
