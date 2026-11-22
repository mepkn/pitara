import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_RETRIES } from "./metadata";
import { fakeNet } from "./test.net";
import { expectConsistent, newTest, signedInUser, type Signed, type TestConvex } from "./test.helpers";

let t: TestConvex;
let alice: Signed;

beforeEach(async () => {
  vi.useFakeTimers();
  fakeNet.reset();
  t = newTest();
  alice = await signedInUser(t, "alice@example.com");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
const get = (id: Id<"bookmarks">) => alice.as.query(api.bookmarks.get, { id });
const PAGE = `<html><head><title>Example Domain</title>
  <meta name="description" content="For use in illustrative examples.">
  <meta property="og:image" content="/cover.png">
  <link rel="icon" href="/icon.png"></head><body></body></html>`;

describe("metadata fetch", () => {
  test("a new bookmark is saved at once, pending, and filled in by the background fetch", async () => {
    fakeNet.serve("example.com", PAGE);
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/" });
    expect(await get(id)).toMatchObject({ title: "", metaStatus: "pending" });
    expect(fakeNet.requests).toEqual([]); // nobody waited for the network

    await settle();
    expect(await get(id)).toMatchObject({
      title: "Example Domain",
      description: "For use in illustrative examples.",
      imageUrl: "https://example.com/cover.png",
      faviconUrl: "https://example.com/icon.png",
      metaStatus: "done",
    });
    expect(fakeNet.requests).toEqual([["93.184.216.34", "https://example.com/"]]);
    // The fetched title is searchable.
    const hits = await alice.as.query(api.bookmarks.search, { query: "illustrative", paginationOpts: { numItems: 10, cursor: null } });
    expect(hits.page.map((b) => b._id)).toEqual([id]);
    await expectConsistent(t);
  });

  test("never overwrites a title or description the user typed", async () => {
    fakeNet.serve("example.com", PAGE);
    const { id } = await alice.as.mutation(api.bookmarks.create, {
      url: "https://example.com/",
      title: "My title",
      description: "Mine",
    });
    await settle();
    expect(await get(id)).toMatchObject({ title: "My title", description: "Mine", metaStatus: "done", faviconUrl: "https://example.com/icon.png" });
  });

  test("a user's title typed while the fetch is running is kept", async () => {
    fakeNet.serve("example.com", PAGE);
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/" });
    await alice.as.mutation(api.bookmarks.update, { id, title: "Typed in the meantime" });
    await settle();
    expect((await get(id)).title).toBe("Typed in the meantime");
  });

  test("long titles and descriptions are cut, not rejected", async () => {
    fakeNet.serve(
      "long.example",
      `<head><title>${"t".repeat(700)}</title><meta name="description" content="${"d".repeat(2500)}"></head>`,
    );
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://long.example/" });
    await settle();
    const b = await get(id);
    expect(b.title).toHaveLength(500);
    expect(b.description).toHaveLength(2000);
    expect(b.metaStatus).toBe("done");
  });

  test("a PDF or image has no metadata, and that is not a failure", async () => {
    fakeNet.serve("files.example", "%PDF-1.7", { path: "/a.pdf", contentType: "application/pdf" });
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://files.example/a.pdf" });
    await settle();
    expect(await get(id)).toMatchObject({ title: "", metaStatus: "done" });
  });

  test("editing the URL fetches the new page", async () => {
    fakeNet.serve("one.example", "<title>One</title>");
    fakeNet.serve("two.example", "<title>Two</title>");
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://one.example/", title: "" });
    await settle();
    expect((await get(id)).title).toBe("One");
    await alice.as.mutation(api.bookmarks.update, { id, url: "https://two.example/", title: "" });
    expect(await get(id)).toMatchObject({ metaStatus: "pending" });
    await settle();
    expect(await get(id)).toMatchObject({ title: "Two", metaStatus: "done" });
  });

  test("a result for a URL that has since been replaced is ignored", async () => {
    fakeNet.serve("one.example", "<title>One</title>");
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://one.example/" });
    await alice.as.mutation(api.bookmarks.update, { id, url: "https://two.example/" });
    await t.mutation(internal.metadata.finish, {
      bookmarkId: id,
      normalizedUrl: "https://one.example",
      attempt: 0,
      outcome: { status: "done", title: "Stale" },
    });
    expect((await get(id)).title).toBe("");
  });

  test("a trashed bookmark is not fetched", async () => {
    fakeNet.serve("example.com", PAGE);
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/" });
    await alice.as.mutation(api.bookmarks.trash, { id });
    await settle();
    expect(fakeNet.requests).toEqual([]);
    expect(await get(id)).toMatchObject({ metaStatus: "pending", title: "" });
  });

  test("a deleted bookmark is not a problem", async () => {
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://example.com/" });
    await alice.as.mutation(api.bookmarks.trash, { id });
    await alice.as.mutation(api.bookmarks.deleteForever, { id });
    await settle();
    await expectConsistent(t);
  });
});

describe("failures and retries", () => {
  test("a host that can't be reached is retried once an hour, three times, then left failed", async () => {
    const resolve = vi.spyOn(fakeNet.dns, "get");
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://down.example/" });
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1 + MAX_RETRIES);
    expect(await get(id)).toMatchObject({ metaStatus: "failed", title: "" });
  });

  test("a retry that works fills the bookmark in", async () => {
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://flaky.example/" });
    await vi.advanceTimersByTimeAsync(1000); // the first attempt only, not the hourly retries
    await t.finishInProgressScheduledFunctions();
    expect((await get(id)).metaStatus).toBe("failed");
    fakeNet.serve("flaky.example", "<title>Back up</title>");
    await settle();
    expect(await get(id)).toMatchObject({ metaStatus: "done", title: "Back up" });
  });

  test("a 404 or a refused address is not retried", async () => {
    fakeNet.serve("gone.example", "", { status: 404 });
    fakeNet.serve("lan.example", "secret", { addresses: ["192.168.1.1"] });
    const spy = vi.spyOn(fakeNet.dns, "get");
    const a = await alice.as.mutation(api.bookmarks.create, { url: "https://gone.example/" });
    const b = await alice.as.mutation(api.bookmarks.create, { url: "https://lan.example/" });
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await get(a.id)).metaStatus).toBe("failed");
    expect((await get(b.id)).metaStatus).toBe("failed");
    expect(fakeNet.requests.map((r) => r[1])).toEqual(["https://gone.example/"]); // nothing was sent to the LAN address
  });

  test("a redirect into the private network is refused, and the private page is never requested", async () => {
    fakeNet.redirect("front.example", "/", "http://169.254.169.254/latest/meta-data/");
    const { id } = await alice.as.mutation(api.bookmarks.create, { url: "https://front.example/" });
    await settle();
    expect((await get(id)).metaStatus).toBe("failed");
    expect(fakeNet.requests.map((r) => r[1])).toEqual(["https://front.example/"]);
  });
});

describe("stuck pending bookmarks", () => {
  async function pending(email: string, url: string, patch: Record<string, unknown> = {}) {
    const user = await signedInUser(t, email);
    const id = await t.run((ctx) =>
      ctx.db.insert("bookmarks", {
        userId: user.userId, url, normalizedUrl: url, domain: "x", title: "", description: "", note: "",
        tagIds: [], favorite: false, unread: false, metaStatus: "pending", searchText: url,
        createdAt: Date.now(), updatedAt: Date.now(), ...patch,
      }),
    );
    return id;
  }

  test("the hourly job queues bookmarks that stayed pending for over an hour", async () => {
    fakeNet.serve("stuck.example", "<title>Unstuck</title>");
    fakeNet.serve("fresh.example", "<title>Fresh</title>");
    const stuck = await pending("alice@example.com", "https://stuck.example/", { updatedAt: Date.now() - 2 * 3600_000 });
    const fresh = await pending("bob@example.com", "https://fresh.example/");
    await t.mutation(internal.metadata.retryStuck, {});
    await settle();
    expect(await t.run((ctx) => ctx.db.get("bookmarks", stuck))).toMatchObject({ metaStatus: "done", title: "Unstuck" });
    expect(await t.run((ctx) => ctx.db.get("bookmarks", fresh))).toMatchObject({ metaStatus: "pending" });
  });

  test("trashed ones wait, and a bookmark isn't queued twice", async () => {
    const old = Date.now() - 2 * 3600_000;
    await pending("alice@example.com", "https://t.example/", { updatedAt: old, deletedAt: old });
    const stuck = await pending("bob@example.com", "https://s.example/", { updatedAt: old });
    await t.mutation(internal.metadata.retryStuck, {});
    await t.mutation(internal.metadata.retryStuck, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]!.args[0]).toMatchObject({ bookmarkId: stuck });
  });

  test("a pile of old trashed pending bookmarks can't starve the live ones", async () => {
    const old = Date.now() - 3 * 3600_000;
    for (let i = 0; i < 60; i++) {
      await pending("alice@example.com", `https://trashed.example/${i}`, { updatedAt: old - i, deletedAt: old });
    }
    const live = await pending("bob@example.com", "https://live.example/", { updatedAt: Date.now() - 2 * 3600_000 });
    await t.mutation(internal.metadata.retryStuck, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((s) => (s.args[0] as { bookmarkId: string }).bookmarkId)).toEqual([live]);
  });
});
