import { describe, expect, it } from "vitest";
import { checkForUpdate, compareRelease } from "./update";

describe("compareRelease", () => {
  it("is up to date when the tag is the build's SHA", () => {
    expect(compareRelease("9736579", "9736579")).toEqual({ kind: "upToDate", tag: "9736579" });
    expect(compareRelease("9736579", "9736579abcdef")).toMatchObject({ kind: "upToDate" });
  });
  it("offers an update for a different tag", () => {
    expect(compareRelease("9736579", "aa4356b")).toEqual({ kind: "available", tag: "aa4356b" });
  });
  it("skips dev builds without a SHA", () => {
    expect(compareRelease("", "aa4356b")).toEqual({ kind: "dev" });
  });
});

describe("checkForUpdate", () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  it("reads the latest tag", async () => {
    expect(await checkForUpdate(ok({ tag_name: "aa4356b" }), "9736579")).toEqual({ kind: "available", tag: "aa4356b" });
  });
  it("does not call GitHub for a dev build", async () => {
    let called = false;
    await checkForUpdate((async () => { called = true; return new Response("{}"); }) as typeof fetch, "");
    expect(called).toBe(false);
  });
  it("explains errors", async () => {
    await expect(checkForUpdate(ok({}, 404), "9736579")).rejects.toThrow(/no release/i);
    await expect(checkForUpdate(ok({}, 500), "9736579")).rejects.toThrow(/500/);
    await expect(checkForUpdate((async () => { throw new TypeError("x"); }) as typeof fetch, "9736579")).rejects.toThrow(/reach/i);
  });
});
