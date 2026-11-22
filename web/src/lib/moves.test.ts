import { describe, expect, it } from "vitest";
import { planCollectionDrop } from "./moves";
import { buildTree, type CollectionRow } from "./tree";

const row = (_id: string, sortOrder: number, parentId?: string): CollectionRow => ({ _id, name: _id, parentId, sortOrder, bookmarkCount: 0 });
const tree = buildTree([row("a", 0), row("b", 1), row("c", 2), row("a1", 0, "a"), row("a2", 1, "a")]);

describe("planCollectionDrop", () => {
  it("reorders among top-level siblings", () => {
    expect(planCollectionDrop(tree, "c", "a")).toEqual({ type: "reorder", parentId: null, ids: ["c", "a", "b"] });
  });
  it("reorders among children", () => {
    expect(planCollectionDrop(tree, "a1", "a2")).toEqual({ type: "reorder", parentId: "a", ids: ["a2", "a1"] });
  });
  it("nests a childless collection into another group's top-level row... via a child's row too", () => {
    expect(planCollectionDrop(tree, "a1", "b")).toEqual({ type: "nest", id: "a1", parentId: "b" });
    expect(planCollectionDrop(tree, "c", "a1")).toEqual({ type: "nest", id: "c", parentId: "a" });
  });
  it("refuses to nest a collection that has children, and drops onto itself or its own parent", () => {
    expect(planCollectionDrop(tree, "a", "a1")).toEqual({ type: "none" });
    expect(planCollectionDrop(tree, "a", "a")).toEqual({ type: "none" });
    expect(planCollectionDrop(tree, "a1", "a")).toEqual({ type: "none" });
    const deeper = buildTree([row("a", 0), row("b", 1), row("b1", 0, "b")]);
    expect(planCollectionDrop(deeper, "a", "b1")).toEqual({ type: "nest", id: "a", parentId: "b" });
    const parentWithChildren = buildTree([row("a", 0), row("a1", 0, "a"), row("b", 1), row("b1", 0, "b")]);
    expect(planCollectionDrop(parentWithChildren, "a", "b1")).toEqual({ type: "invalid" });
  });
});
