import { describe, expect, it } from "vitest";
import { chunk, rangeBetween } from "./selection";

const ids = ["a", "b", "c", "d", "e"];

describe("rangeBetween", () => {
  it("selects between anchor and click, either direction", () => {
    expect(rangeBetween(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });
  it("selects just the click without a usable anchor", () => {
    expect(rangeBetween(ids, null, "c")).toEqual(["c"]);
    expect(rangeBetween(ids, "gone", "c")).toEqual(["c"]);
    expect(rangeBetween(ids, "a", "gone")).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
    expect(chunk(Array.from({ length: 120 }, (_, i) => i), 50).map((c) => c.length)).toEqual([50, 50, 20]);
  });
});
