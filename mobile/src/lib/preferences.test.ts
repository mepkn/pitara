import { describe, expect, it, vi } from "vitest";

// preferences.tsx imports React Native modules; only the pure helper is under test.
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("nativewind", () => ({ colorScheme: { set: () => {} } }));

const { pick } = await import("./preferences");

describe("pick", () => {
  it("keeps an allowed stored value", () => expect(pick("grid", ["list", "grid"] as const, "list")).toBe("grid"));
  it("falls back for a missing or unknown value", () => {
    expect(pick(null, ["list", "grid"] as const, "list")).toBe("list");
    expect(pick("masonry", ["list", "grid"] as const, "list")).toBe("list");
  });
});
