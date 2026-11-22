import { describe, expect, it } from "vitest";
import { buildTree, canNest, collectionPath, flattenTree, type CollectionRow } from "./tree";

const row = (_id: string, sortOrder: number, parentId?: string): CollectionRow => ({ _id, name: _id.toUpperCase(), parentId, sortOrder, bookmarkCount: 0 });
const rows = [row("b", 1), row("a", 0), row("a2", 1, "a"), row("a1", 0, "a"), row("c", 2)];

describe("buildTree", () => {
  it("orders by sortOrder and nests children", () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n._id)).toEqual(["a", "b", "c"]);
    expect(tree[0]!.children.map((c) => c._id)).toEqual(["a1", "a2"]);
  });
  it("lifts orphans to the top level", () => {
    expect(buildTree([row("x", 0, "gone")]).map((n) => n._id)).toEqual(["x"]);
  });
  it("flattens in tree order with depth", () => {
    expect(flattenTree(buildTree(rows)).map((f) => `${f.depth}${f.row._id}`)).toEqual(["0a", "1a1", "1a2", "0b", "0c"]);
  });
  it("names a nested collection with its parent", () => {
    expect(collectionPath(rows, "a1")).toBe("A / A1");
    expect(collectionPath(rows, "b")).toBe("B");
  });
});

describe("canNest", () => {
  const tree = buildTree(rows);
  it("allows a childless collection under a top-level one", () => {
    expect(canNest(tree, "c", "b")).toBe(true);
    expect(canNest(tree, "a1", "b")).toBe(true);
  });
  it("blocks a collection with children, itself, and anything under a child", () => {
    expect(canNest(tree, "a", "b")).toBe(false);
    expect(canNest(tree, "b", "b")).toBe(false);
    expect(canNest(tree, "c", "a1")).toBe(false);
  });
});
