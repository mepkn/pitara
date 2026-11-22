import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/tokens";
import { newTest, signedInUser, type Signed, type TestConvex } from "./test.helpers";

let t: TestConvex;
let alice: Signed;
let bob: Signed;

beforeEach(async () => {
  t = newTest();
  alice = await signedInUser(t, "alice@example.com");
  bob = await signedInUser(t, "bob@example.com");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mint(user: Signed, name = "test"): Promise<string> {
  return (await user.as.action(api.apiTokens.create, { name })).token;
}

type Init = { method?: string; body?: unknown; headers?: Record<string, string> };
async function call(token: string | null, path: string, { method = "GET", body, headers = {} }: Init = {}) {
  const res = await t.fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text === "" ? undefined : (JSON.parse(text) as any) }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("API tokens", () => {
  test("a token is shown once; only its SHA-256 and a short prefix are stored", async () => {
    const created = await alice.as.action(api.apiTokens.create, { name: "  My   laptop " });
    expect(created.token).toMatch(/^pit_[A-Za-z0-9_-]{43}$/);
    expect(created.name).toBe("My laptop");
    expect(created.prefix).toBe(created.token.slice(0, 8));

    const rows = await t.run((ctx) => ctx.db.query("apiTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toBe(await hashToken(created.token));
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(created.token);
    expect(JSON.stringify(rows)).not.toContain(created.token.slice(8)); // not even the secret part

    const listed = await alice.as.query(api.apiTokens.list, {});
    expect(listed).toEqual([{ _id: created.id, name: "My laptop", prefix: created.prefix, createdAt: expect.any(Number) }]);
    expect(JSON.stringify(listed)).not.toContain(created.token.slice(8));
  });

  test("every token is different", async () => {
    const tokens = new Set([await mint(alice), await mint(alice), await mint(bob)]);
    expect(tokens.size).toBe(3);
  });

  test("at most 10 per user, and names are checked", async () => {
    for (let i = 0; i < 10; i++) await mint(alice, `t${i}`);
    await expect(mint(alice, "eleventh")).rejects.toThrow("limitReached");
    await mint(bob); // the cap is per user
    await expect(alice.as.action(api.apiTokens.create, { name: "   " })).rejects.toThrow("invalidName");
    await expect(bob.as.action(api.apiTokens.create, { name: "x".repeat(61) })).rejects.toThrow("tooLong");
  });

  test("only allowlisted, signed-in users can create tokens", async () => {
    await expect(t.action(api.apiTokens.create, { name: "x" })).rejects.toThrow("notAuthenticated");
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(mallory.as.action(api.apiTokens.create, { name: "x" })).rejects.toThrow("notAllowed");
    expect(await t.run((ctx) => ctx.db.query("apiTokens").collect())).toEqual([]);
  });

  test("revoking ends access; another user's token can't be revoked or even seen", async () => {
    const token = await mint(alice);
    const [{ _id }] = await alice.as.query(api.apiTokens.list, {});
    expect((await call(token, "/me")).status).toBe(200);

    expect(await bob.as.query(api.apiTokens.list, {})).toEqual([]);
    await expect(bob.as.mutation(api.apiTokens.revoke, { id: _id! })).rejects.toThrow("notFound");
    expect((await call(token, "/me")).status).toBe(200);

    await alice.as.mutation(api.apiTokens.revoke, { id: _id! });
    expect(await call(token, "/me")).toMatchObject({ status: 401, json: { error: "notAuthenticated" } });
    expect(await alice.as.query(api.apiTokens.list, {})).toEqual([]);
  });

  test("lastUsedAt is recorded", async () => {
    vi.useFakeTimers();
    const token = await mint(alice);
    expect((await alice.as.query(api.apiTokens.list, {}))[0]!.lastUsedAt).toBeUndefined();
    await call(token, "/me");
    expect((await alice.as.query(api.apiTokens.list, {}))[0]!.lastUsedAt).toBe(Date.now());
  });
});

describe("authentication and access", () => {
  test("missing, malformed and unknown tokens are refused alike", async () => {
    const real = await mint(alice);
    for (const header of [
      undefined,
      "Basic abc",
      "Bearer",
      "Bearer nonsense",
      `Bearer ${real.slice(0, -1)}`,
      `Bearer ${real}x`,
      `Bearer pit_${"A".repeat(43)}`,
      `Token ${real}`,
    ]) {
      const res = await call(null, "/me", { headers: header === undefined ? {} : { Authorization: header } });
      expect(res).toMatchObject({ status: 401, json: { error: "notAuthenticated" } });
    }
    expect((await call(real, "/me")).status).toBe(200);
  });

  test("a token gives its own user's data, never another's", async () => {
    const a = await mint(alice);
    const b = await mint(bob);
    expect((await call(a, "/me")).json).toEqual({ email: "alice@example.com" });
    expect((await call(b, "/me")).json).toEqual({ email: "bob@example.com" });
  });

  test("removing an email from ALLOWED_EMAILS cuts off its tokens at once", async () => {
    const a = await mint(alice);
    const b = await mint(bob);
    expect((await call(a, "/me")).status).toBe(200);
    vi.stubEnv("ALLOWED_EMAILS", "bob@example.com");
    for (const [method, path, body] of [
      ["GET", "/me"], ["GET", "/collections"], ["GET", "/tags"], ["GET", "/bookmarks?q=x"],
      ["GET", "/bookmarks/check?url=https://example.com"], ["POST", "/bookmarks", { url: "https://example.com" }],
      ["PATCH", "/bookmarks/abc", { title: "x" }], ["DELETE", "/bookmarks/abc"],
    ] as const) {
      expect(await call(a, path, { method, body }), `${method} ${path}`).toMatchObject({ status: 403, json: { error: "notAllowed" } });
    }
    expect((await call(b, "/me")).status).toBe(200);
    // ...and nothing was written for the refused user.
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toEqual([]);
  });

  test("an empty or unset allowlist locks everyone out, tokens included", async () => {
    const a = await mint(alice);
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect((await call(a, "/me")).status).toBe(403);
  });
});

describe("rate limit", () => {
  test("60 calls a minute per token, then 429 with Retry-After; the window then resets", async () => {
    vi.useFakeTimers();
    const a = await mint(alice);
    const b = await mint(bob);
    for (let i = 0; i < 60; i++) expect((await call(a, "/me")).status).toBe(200);
    const limited = await call(a, "/me");
    expect(limited).toMatchObject({ status: 429, json: { error: "tooManyRequests" } });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
    expect((await call(a, "/tags")).status).toBe(429); // every route shares the budget
    expect((await call(b, "/me")).status).toBe(200); // other tokens are not affected

    vi.advanceTimersByTime(30_000);
    expect((await call(a, "/me")).status).toBe(429);
    vi.advanceTimersByTime(30_001);
    expect((await call(a, "/me")).status).toBe(200);
  });

  test("a second token of the same user has its own budget; refused calls don't use it up", async () => {
    vi.useFakeTimers();
    const one = await mint(alice, "one");
    const two = await mint(alice, "two");
    for (let i = 0; i < 70; i++) await call(one, "/me");
    expect((await call(two, "/me")).status).toBe(200);
    const [row] = await t.run((ctx) => ctx.db.query("apiTokens").collect());
    expect(row!.windowCount).toBe(60);
  });
});

describe("bookmarks", () => {
  test("POST saves, tags and files a bookmark; a repeat says it existed", async () => {
    const token = await mint(alice);
    const collection = await alice.as.mutation(api.collections.create, { name: "Reading" });
    const created = await call(token, "/bookmarks", {
      method: "POST",
      body: { url: "https://example.com/a?utm_source=x", title: "A", note: "n", collectionId: collection, tags: ["Rust", " web "], favorite: true, unread: true },
    });
    expect(created).toMatchObject({ status: 201, json: { existed: false } });

    const repeat = await call(token, "/bookmarks", { method: "POST", body: { url: "https://www.example.com/a/" } });
    expect(repeat).toMatchObject({ status: 200, json: { id: created.json.id, existed: true } });

    const stored = await alice.as.query(api.bookmarks.get, { id: created.json.id });
    expect(stored).toMatchObject({ title: "A", note: "n", collectionId: collection, favorite: true, unread: true, metaStatus: "pending" });
    const tags = await alice.as.query(api.tags.list, {});
    expect(tags.map((x) => x.name).sort()).toEqual(["rust", "web"]);
  });

  test("POST validates the body and the URL", async () => {
    const token = await mint(alice);
    const bad = (body: unknown) => call(token, "/bookmarks", { method: "POST", body });
    expect(await bad("not json")).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad("[]")).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({})).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({ url: 5 })).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({ url: "https://a.example", tags: "x" })).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({ url: "https://a.example", tags: [1] })).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({ url: "https://a.example", favorite: "yes" })).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await bad({ url: "javascript:alert(1)" })).toMatchObject({ status: 400, json: { error: "invalidUrl" } });
    expect(await bad({ url: "ftp://example.com/x" })).toMatchObject({ status: 400, json: { error: "invalidUrl" } });
    expect(await bad({ url: "https://a.example/" + "x".repeat(2100) })).toMatchObject({ status: 400, json: { error: "tooLong" } });
    expect(await bad({ url: "https://a.example", title: "x".repeat(501) })).toMatchObject({ status: 400, json: { error: "tooLong" } });
    expect(await bad({ url: "https://a.example", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toMatchObject({ status: 409, json: { error: "limitReached" } });
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toEqual([]);
  });

  test("POST can't file into someone else's, a missing, or a malformed collection", async () => {
    const token = await mint(alice);
    const theirs = await bob.as.mutation(api.collections.create, { name: "Bob's" });
    for (const collectionId of [theirs, "nonsense", "k57abc"]) {
      const res = await call(token, "/bookmarks", { method: "POST", body: { url: "https://a.example", collectionId } });
      expect(res, String(collectionId)).toMatchObject({ status: 404, json: { error: "notFound" } });
    }
    expect(await t.run((ctx) => ctx.db.query("bookmarks").collect())).toEqual([]);
  });

  test("GET /bookmarks/check tells if a URL is saved (after normalization)", async () => {
    const token = await mint(alice);
    const bobToken = await mint(bob);
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/page", title: "P", tags: ["x"] });
    const hit = await call(token, "/bookmarks/check?url=" + encodeURIComponent("https://www.example.com/page/?utm_campaign=z#top"));
    expect(hit).toMatchObject({ status: 200, json: { exists: true, bookmark: { id, title: "P", tags: ["x"], note: "" } } });
    expect((await call(token, "/bookmarks/check?url=" + encodeURIComponent("https://example.com/other"))).json).toEqual({ exists: false });
    expect((await call(bobToken, "/bookmarks/check?url=" + encodeURIComponent("https://example.com/page"))).json).toEqual({ exists: false });

    await alice.as.mutation(api.bookmarks.trash, { id });
    expect((await call(token, "/bookmarks/check?url=" + encodeURIComponent("https://example.com/page"))).json).toEqual({ exists: false });

    expect(await call(token, "/bookmarks/check")).toMatchObject({ status: 400, json: { error: "badRequest" } });
    expect(await call(token, "/bookmarks/check?url=nonsense")).toMatchObject({ status: 400, json: { error: "invalidUrl" } });
  });

  test("GET /bookmarks searches (with #tag and @collection) and is limited to the caller's own", async () => {
    const token = await mint(alice);
    const c = await alice.as.mutation(api.collections.create, { name: "Dev" });
    await alice.as.mutation(api.bookmarks.create, { url: "https://rust-lang.org/", title: "Rust language", tags: ["lang"], collectionId: c });
    await alice.as.mutation(api.bookmarks.create, { url: "https://go.dev/", title: "Go language", tags: ["lang"] });
    await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/", title: "Unrelated" });
    await bob.as.mutation(api.bookmarks.create, { url: "https://bob.example/", title: "Bob language" });

    const titles = async (q: string, extra = "") => {
      const res = await call(token, `/bookmarks?q=${encodeURIComponent(q)}${extra}`);
      expect(res.status).toBe(200);
      return res.json.bookmarks.map((b: { title: string }) => b.title).sort();
    };
    expect(await titles("language")).toEqual(["Go language", "Rust language"]);
    expect(await titles("language #lang @Dev")).toEqual(["Rust language"]);
    expect(await titles("#lang")).toEqual(["Go language", "Rust language"]);
    expect(await titles("language", "&limit=1")).toHaveLength(1);
    expect(await titles("")).toEqual(["Go language", "Rust language", "Unrelated"]); // no q: the newest
    const res = await call(token, "/bookmarks?q=rust");
    expect(res.json.bookmarks[0]).toMatchObject({ domain: "rust-lang.org", tags: ["lang"], hasNote: false });
    expect(res.json.bookmarks[0]).not.toHaveProperty("note");
  });

  test("GET /bookmarks checks the limit", async () => {
    const token = await mint(alice);
    for (const limit of ["0", "51", "-1", "abc", "1.5"]) {
      expect(await call(token, `/bookmarks?q=x&limit=${limit}`), limit).toMatchObject({ status: 400, json: { error: "badRequest" } });
    }
    expect((await call(token, "/bookmarks?q=x&limit=50")).status).toBe(200);
  });

  test("PATCH edits fields, tags and collection; null means Unsorted", async () => {
    const token = await mint(alice);
    const c = await alice.as.mutation(api.collections.create, { name: "Dev" });
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/", title: "Old", tags: ["a"] });
    const res = await call(token, `/bookmarks/${id}`, {
      method: "PATCH",
      body: { title: "New", description: "D", note: "N", tags: ["b", "c"], collectionId: c, favorite: true },
    });
    expect(res).toMatchObject({
      status: 200,
      json: { id, title: "New", description: "D", note: "N", tags: ["b", "c"], collectionId: c, favorite: true },
    });
    const unsorted = await call(token, `/bookmarks/${id}`, { method: "PATCH", body: { collectionId: null } });
    expect(unsorted.json.collectionId).toBeNull();
    expect(await alice.as.query(api.tags.list, {})).toEqual(expect.arrayContaining([expect.objectContaining({ name: "a", count: 0 })]));
  });

  test("PATCH and DELETE treat foreign, missing and malformed ids alike", async () => {
    const token = await mint(alice);
    const { id: bobs } = await bob.as.mutation(api.bookmarks.create, { url: "https://bob.example/", title: "Bob" });
    const gone = await alice.as.mutation(api.bookmarks.create, { url: "https://x.example/" });
    await alice.as.mutation(api.bookmarks.trash, { id: gone.id });
    await alice.as.mutation(api.bookmarks.deleteForever, { id: gone.id });

    for (const id of [bobs, gone.id, "nonsense", "a/b", "check"]) {
      const patch = await call(token, `/bookmarks/${encodeURIComponent(id)}`, { method: "PATCH", body: { title: "pwned" } });
      const del = await call(token, `/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
      expect(patch, `PATCH ${id}`).toMatchObject({ status: 404, json: { error: "notFound" } });
      expect(del, `DELETE ${id}`).toMatchObject({ status: 404, json: { error: "notFound" } });
    }
    expect(await bob.as.query(api.bookmarks.get, { id: bobs })).toMatchObject({ title: "Bob" });
    expect((await bob.as.query(api.bookmarks.get, { id: bobs })).deletedAt).toBeUndefined();
    // moving someone else's collection onto my bookmark is refused too
    const mine = await alice.as.mutation(api.bookmarks.create, { url: "https://mine.example/" });
    const bobsCollection = await bob.as.mutation(api.collections.create, { name: "B" });
    expect(await call(token, `/bookmarks/${mine.id}`, { method: "PATCH", body: { collectionId: bobsCollection } })).toMatchObject({
      status: 404,
    });
  });

  test("PATCH validates, and refuses a trashed bookmark or a URL that is already saved", async () => {
    const token = await mint(alice);
    const a = await alice.as.mutation(api.bookmarks.create, { url: "https://a.example/" });
    const b = await alice.as.mutation(api.bookmarks.create, { url: "https://b.example/" });
    expect(await call(token, `/bookmarks/${a.id}`, { method: "PATCH", body: { title: 5 } })).toMatchObject({ status: 400 });
    expect(await call(token, `/bookmarks/${a.id}`, { method: "PATCH", body: "x" })).toMatchObject({ status: 400 });
    expect(await call(token, `/bookmarks/${a.id}`, { method: "PATCH", body: { url: "https://b.example" } })).toMatchObject({
      status: 409,
      json: { error: "duplicate" },
    });
    await alice.as.mutation(api.bookmarks.trash, { id: b.id });
    expect(await call(token, `/bookmarks/${b.id}`, { method: "PATCH", body: { title: "x" } })).toMatchObject({
      status: 409,
      json: { error: "inTrash" },
    });
  });

  test("DELETE moves to the trash, where it can be restored", async () => {
    const token = await mint(alice);
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/", tags: ["t"] });
    expect(await call(token, `/bookmarks/${id}`, { method: "DELETE" })).toMatchObject({ status: 200, json: { ok: true } });
    expect(await call(token, `/bookmarks/${id}`, { method: "DELETE" })).toMatchObject({ status: 200 }); // already trashed: fine
    const trash = await alice.as.query(api.bookmarks.list, { view: "trash", sort: "newest", paginationOpts: { numItems: 10, cursor: null } });
    expect(trash.page.map((x) => x._id)).toEqual([id]);
    expect((await call(token, "/bookmarks/check?url=https://example.com/")).json).toEqual({ exists: false });
    await alice.as.mutation(api.bookmarks.restore, { id });
    expect((await call(token, "/bookmarks/check?url=https://example.com/")).json.exists).toBe(true);
  });

  test("GET /collections and /tags list only the caller's", async () => {
    const token = await mint(alice);
    const parent = await alice.as.mutation(api.collections.create, { name: "Dev" });
    const child = await alice.as.mutation(api.collections.create, { name: "Rust", parentId: parent });
    await bob.as.mutation(api.collections.create, { name: "Secret" });
    await alice.as.mutation(api.bookmarks.create, { url: "https://a.example/", tags: ["x"], collectionId: child });
    await bob.as.mutation(api.bookmarks.create, { url: "https://b.example/", tags: ["secret"] });

    const collections = (await call(token, "/collections")).json.collections;
    expect(collections.map((c: { name: string }) => c.name).sort()).toEqual(["Dev", "Rust"]);
    expect(collections.find((c: { name: string }) => c.name === "Rust")).toMatchObject({ id: child, parentId: parent, bookmarkCount: 1 });
    expect((await call(token, "/tags")).json).toEqual({ tags: [{ id: expect.any(String), name: "x", count: 1 }] });
  });
});

describe("CORS", () => {
  const ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

  test("preflight needs no token and answers only for the extension and the web app", async () => {
    vi.stubEnv("SITE_URL", "https://pitara.example");
    for (const [origin, allowed] of [[ext, true], ["https://pitara.example", true], ["https://evil.example", false], ["http://localhost:5173", false]] as const) {
      for (const path of ["/me", "/bookmarks", "/bookmarks/check", "/bookmarks/some-id", "/collections", "/tags"]) {
        const res = await call(null, path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } });
        expect(res.status, `${origin} ${path}`).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe(allowed ? origin : null);
        if (allowed) {
          expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
          expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
          expect(res.headers.get("Vary")).toBe("Origin");
        }
      }
    }
  });

  test("answers carry the CORS headers, errors included", async () => {
    const token = await mint(alice);
    const ok = await call(token, "/me", { headers: { Origin: ext } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ext);
    for (const bad of [await call(null, "/me", { headers: { Origin: ext } }), await call(token, "/bookmarks/check", { headers: { Origin: ext } })]) {
      expect(bad.status).toBe(bad.json.error === "notAuthenticated" ? 401 : 400);
      expect(bad.headers.get("Access-Control-Allow-Origin")).toBe(ext);
    }
    expect((await call(token, "/me", { headers: { Origin: "https://evil.example" } })).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
  });
});

test("the Convex Auth routes are still the only other public routes", async () => {
  const res = await t.fetch("/api/v1/nothing-here", { headers: { Authorization: "Bearer x" } });
  expect(res.status).toBe(404);
  expect((await t.fetch("/api/auth/signin/password", { method: "GET" })).status).not.toBe(200);
  const id: Id<"users"> = alice.userId;
  expect(id).toBeDefined();
});
