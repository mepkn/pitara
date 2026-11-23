/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "kjs_test-secret";
const ME = "me@example.com";

beforeEach(() => {
  vi.stubEnv("KUNJI_SECRET", SECRET);
  vi.stubEnv("ALLOWED_EMAILS", `${ME},stranger@example.com`);
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: ME, emailVerificationTime: 1 });
    await ctx.db.insert("users", { email: "other@example.com" }); // unverified, not allowlisted
    const strangerId = await ctx.db.insert("users", { email: "stranger@example.com", emailVerificationTime: 1 });
    await ctx.db.insert("collections", { userId, name: "Work", sortOrder: 0, bookmarkCount: 0, updatedAt: 1 });
    return { userId, strangerId };
  });
  return { t, ...ids };
}

const post = (body: unknown, secret = SECRET) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

type T = Awaited<ReturnType<typeof setup>>["t"];
async function call(t: T, tool: string, input: unknown = {}, userEmail = ME) {
  const res = await t.fetch("/kunji/call", post({ tool, input, userEmail }));
  expect(res.status).toBe(200);
  return await res.json();
}

describe("kunji contract", () => {
  it("lists the tools, but only with the secret", async () => {
    const { t } = await setup();
    const ok = await t.fetch("/kunji/tools", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect((await ok.json()).map((x: { name: string }) => x.name)).toEqual(["search_bookmarks", "add_bookmark"]);
    expect((await t.fetch("/kunji/tools", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    expect((await t.fetch("/kunji/tools")).status).toBe(401);
  });

  it("refuses everything when KUNJI_SECRET is unset", async () => {
    const { t } = await setup();
    vi.stubEnv("KUNJI_SECRET", "");
    expect((await t.fetch("/kunji/tools", { headers: { Authorization: "Bearer " } })).status).toBe(401);
  });

  it("reports access: ok, no account, not allowed", async () => {
    const { t } = await setup();
    const status = async (userEmail: string) =>
      (await (await t.fetch("/kunji/access", post({ userEmail }))).json()).status;
    expect(await status(ME)).toBe("ok");
    expect(await status("nobody@example.com")).toBe("no_account");
    expect(await status("other@example.com")).toBe("no_account"); // unverified
    vi.stubEnv("ALLOWED_EMAILS", "someone-else@example.com");
    expect(await status(ME)).toBe("not_allowed");
  });

  it("refuses a call for a removed email", async () => {
    const { t } = await setup();
    vi.stubEnv("ALLOWED_EMAILS", "someone-else@example.com");
    const out = await call(t, "search_bookmarks", { query: "x" });
    expect(out).toMatchObject({ ok: false, error: { code: "not_allowed" } });
  });

  it("rejects bad input", async () => {
    const { t } = await setup();
    expect((await call(t, "add_bookmark", {})).error.code).toBe("bad_input");
    expect((await call(t, "search_bookmarks", { query: "x", extra: 1 })).error.code).toBe("bad_input");
    expect((await call(t, "nope", {})).error.code).toBe("unknown_tool");
  });
});

describe("add_bookmark", () => {
  it("saves with tags and collection, and does not duplicate", async () => {
    const { t, userId } = await setup();
    const first = await call(t, "add_bookmark", {
      url: "https://example.com/a?utm_source=x",
      title: "Example A",
      tags: "Recipes, to-try",
      collection: "work",
    });
    expect(first.ok).toBe(true);
    expect(first.result).toMatchObject({ existed: false, title: "Example A" });
    const again = await call(t, "add_bookmark", { url: "https://www.example.com/a" });
    expect(again.result).toMatchObject({ existed: true, id: first.result.id });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("bookmarks").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.userId).toBe(userId);
      expect(rows[0]!.collectionId).toBeDefined();
      expect(rows[0]!.tagIds).toHaveLength(2);
    });
  });

  it("explains an unknown collection and a bad URL", async () => {
    const { t } = await setup();
    const unknown = await call(t, "add_bookmark", { url: "https://example.com", collection: "Nope" });
    expect(unknown.error.message).toContain("Work");
    const bad = await call(t, "add_bookmark", { url: "ftp://example.com" });
    expect(bad).toMatchObject({ ok: false, error: { code: "tool_error", message: "That isn't a valid http(s) URL." } });
  });
});

describe("search_bookmarks", () => {
  it("finds the user's bookmarks only", async () => {
    const { t } = await setup();
    await call(t, "add_bookmark", { url: "https://example.com/pasta", title: "Pasta recipes", tags: "food" });
    await call(t, "add_bookmark", { url: "https://example.com/other", title: "Something else" });
    await t.run(async (ctx) => {
      const stranger = (await ctx.db.query("users").collect()).find((u) => u.email === "stranger@example.com")!;
      await ctx.db.insert("bookmarks", {
        userId: stranger._id, url: "https://secret.test/pasta", normalizedUrl: "secret.test/pasta", domain: "secret.test",
        title: "Their pasta", description: "", note: "", tagIds: [], favorite: false, unread: false, metaStatus: "done",
        searchText: "Their pasta\nsecret.test/pasta", createdAt: 1, updatedAt: 1,
      });
    });
    const out = await call(t, "search_bookmarks", { query: "pasta" });
    expect(out.result).toHaveLength(1);
    expect(out.result[0]).toMatchObject({ title: "Pasta recipes", url: "https://example.com/pasta", tags: ["food"] });
    const byTag = await call(t, "search_bookmarks", { query: "#food" });
    expect(byTag.result).toHaveLength(1);
  });

  it("validates the query and limit", async () => {
    const { t } = await setup();
    expect((await call(t, "search_bookmarks", { query: "  " })).error.message).toContain("empty");
    expect((await call(t, "search_bookmarks", { query: "x", limit: 99 })).error.message).toContain("limit");
  });
});
