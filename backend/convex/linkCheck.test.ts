import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { checkLink } from "./lib/linkVerdict";
import { BATCH, CONFIRM_AFTER, RECHECK_AFTER } from "./linkCheck";
import { fakeDeps, fakeNet } from "./test.net";
import { allPages, newTest, signedInUser, type Signed, type TestConvex } from "./test.helpers";

let t: TestConvex;
let alice: Signed;
let bob: Signed;

beforeEach(async () => {
  vi.useFakeTimers();
  fakeNet.reset();
  t = newTest();
  alice = await signedInUser(t, "alice@example.com");
  bob = await signedInUser(t, "bob@example.com");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
const row = (id: Id<"bookmarks">) => t.run((ctx) => ctx.db.get("bookmarks", id));

async function save(who: Signed, url: string, extra: Record<string, unknown> = {}) {
  const { id } = await who.as.mutation(api.bookmarks.create, { url, title: "T" });
  await settle(); // the metadata fetch (not found on the fake net: stays `failed`, harmless)
  if (Object.keys(extra).length > 0) await t.run((ctx) => ctx.db.patch("bookmarks", id, extra));
  return id;
}

describe("checkLink verdicts", () => {
  test("2xx is ok, 404 and 410 are broken", async () => {
    fakeNet.serve("a.example", "hi");
    fakeNet.serve("a.example", "gone", { path: "/old", status: 404 });
    fakeNet.serve("a.example", "gone", { path: "/older", status: 410 });
    expect(await checkLink("https://a.example/", fakeDeps())).toBe("ok");
    expect(await checkLink("https://a.example/old", fakeDeps())).toBe("broken");
    expect(await checkLink("https://a.example/older", fakeDeps())).toBe("broken");
  });
  test("a host that no longer resolves is broken", async () => {
    expect(await checkLink("https://nowhere.example/", fakeDeps())).toBe("broken");
  });
  test.each([403, 401, 429, 500, 503])("status %i says nothing", async (status) => {
    fakeNet.serve("b.example", "x", { status });
    expect(await checkLink("https://b.example/", fakeDeps())).toBe("unknown");
  });
  test("a refused connection, a private address and a bad scheme say nothing", async () => {
    fakeNet.dns.set("c.example", ["93.184.216.34"]); // resolves, nothing listens
    fakeNet.serve("internal.example", "x", { addresses: ["10.0.0.1"] });
    expect(await checkLink("https://c.example/", fakeDeps())).toBe("unknown");
    expect(await checkLink("https://internal.example/", fakeDeps())).toBe("unknown");
    expect(await checkLink("ftp://c.example/", fakeDeps())).toBe("unknown");
    expect(fakeNet.requests.filter(([a]) => a.startsWith("10."))).toEqual([]);
  });
});

describe("the daily check", () => {
  test("a live page is marked ok", async () => {
    fakeNet.serve("live.example", "hi");
    const id = await save(alice, "https://live.example/");
    await t.mutation(internal.linkCheck.checkDue, {});
    await settle();
    expect(await row(id)).toMatchObject({ linkStatus: "ok" });
  });

  test("a gone page is confirmed a day later, not marked on the first miss", async () => {
    fakeNet.serve("gone.example", "no", { status: 404 });
    const id = await save(alice, "https://gone.example/");
    const updatedAt = (await row(id))!.updatedAt;
    await t.mutation(internal.linkCheck.checkDue, {});
    await vi.advanceTimersByTimeAsync(5000); // the check runs; the confirmation waits a day
    expect((await row(id))!.linkStatus).toBeUndefined();
    expect((await row(id))!.linkCheckedAt).toBeDefined();
    await vi.advanceTimersByTimeAsync(CONFIRM_AFTER + 1000);
    await settle();
    expect(await row(id)).toMatchObject({ linkStatus: "broken", updatedAt }); // a check is not an edit
  });

  test("one bad answer followed by a good one is never marked", async () => {
    fakeNet.serve("blip.example", "no", { status: 404 });
    const id = await save(alice, "https://blip.example/");
    await t.mutation(internal.linkCheck.checkDue, {});
    await vi.advanceTimersByTimeAsync(5000);
    fakeNet.serve("blip.example", "back"); // recovered before the confirmation
    await vi.advanceTimersByTimeAsync(CONFIRM_AFTER + 1000);
    await settle();
    expect((await row(id))!.linkStatus).toBe("ok");
  });

  test("an unknown answer leaves a broken mark and a clean one alone", async () => {
    fakeNet.serve("flaky.example", "slow", { status: 503 });
    const broken = await save(alice, "https://flaky.example/a", { linkStatus: "broken", linkCheckedAt: 1 });
    const fine = await save(alice, "https://flaky.example/b", { linkStatus: "ok", linkCheckedAt: 1 });
    await t.mutation(internal.linkCheck.checkDue, {});
    await settle();
    expect((await row(broken))!.linkStatus).toBe("broken");
    expect((await row(fine))!.linkStatus).toBe("ok");
  });

  test("only bookmarks not checked for a week are queued, trash excluded, and not twice", async () => {
    for (const path of ["/recent", "/old", "/never", "/trashed"]) fakeNet.serve("live.example", "hi", { path });
    const recent = await save(alice, "https://live.example/recent", { linkCheckedAt: Date.now() - RECHECK_AFTER / 2 });
    const old = await save(alice, "https://live.example/old", { linkStatus: "ok", linkCheckedAt: Date.now() - RECHECK_AFTER - 1000 });
    const never = await save(alice, "https://live.example/never");
    const trashed = await save(alice, "https://live.example/trashed");
    await alice.as.mutation(api.bookmarks.trash, { id: trashed });
    expect(await t.mutation(internal.linkCheck.checkDue, {})).toBe(2);
    expect(await t.mutation(internal.linkCheck.checkDue, {})).toBe(0); // already marked
    await settle();
    expect((await row(recent))!.linkStatus).toBeUndefined();
    expect((await row(old))!.linkStatus).toBe("ok");
    expect((await row(never))!.linkStatus).toBe("ok");
    expect((await row(trashed))!.linkStatus).toBeUndefined();
  });

  test("a batch is capped", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < BATCH + 5; i++) {
        await ctx.db.insert("bookmarks", {
          userId: alice.userId, url: `https://x.example/${i}`, normalizedUrl: `x.example/${i}`, domain: "x.example",
          title: "", description: "", note: "", tagIds: [], favorite: false, unread: false, metaStatus: "done",
          searchText: "", createdAt: i, updatedAt: i,
        });
      }
    });
    expect(await t.mutation(internal.linkCheck.checkDue, {})).toBe(BATCH);
    expect(await t.mutation(internal.linkCheck.checkDue, {})).toBe(5);
  });

  test("a result for a bookmark that changed or went away is dropped", async () => {
    const id = await save(alice, "https://live.example/");
    const normalizedUrl = (await row(id))!.normalizedUrl;
    await t.mutation(internal.linkCheck.record, { bookmarkId: id, normalizedUrl: "other.example/", attempt: 1, verdict: "broken" });
    expect((await row(id))!.linkStatus).toBeUndefined();
    await alice.as.mutation(api.bookmarks.trash, { id });
    await t.mutation(internal.linkCheck.record, { bookmarkId: id, normalizedUrl, attempt: 1, verdict: "broken" });
    expect((await row(id))!.linkStatus).toBeUndefined();
  });

  test("editing the URL clears the mark", async () => {
    const id = await save(alice, "https://live.example/", { linkStatus: "broken", linkCheckedAt: 5 });
    await alice.as.mutation(api.bookmarks.update, { id, title: "Renamed" });
    expect((await row(id))!.linkStatus).toBe("broken");
    await alice.as.mutation(api.bookmarks.update, { id, url: "https://live.example/new" });
    const after = await row(id);
    expect(after!.linkStatus).toBeUndefined();
    expect(after!.linkCheckedAt).toBeUndefined();
  });
});

describe("recheck", () => {
  test("a fixed link clears its Broken mark at once; a still-gone one stays", async () => {
    fakeNet.serve("fixed.example", "back");
    fakeNet.serve("still.example", "no", { status: 404 });
    const fixed = await save(alice, "https://fixed.example/", { linkStatus: "broken", linkCheckedAt: 1 });
    const still = await save(alice, "https://still.example/", { linkStatus: "broken", linkCheckedAt: 1 });
    await alice.as.mutation(api.linkCheck.recheck, { id: fixed });
    await alice.as.mutation(api.linkCheck.recheck, { id: still });
    await settle();
    expect((await row(fixed))!.linkStatus).toBe("ok");
    expect((await row(still))!.linkStatus).toBe("broken");
  });

  test("only the owner can ask", async () => {
    const id = await save(alice, "https://live.example/");
    await expect(bob.as.mutation(api.linkCheck.recheck, { id })).rejects.toThrow("notFound");
  });
});

describe("the Broken view", () => {
  const page = (who: Signed, args: Record<string, unknown>) =>
    allPages<{ _id: Id<"bookmarks"> }>((paginationOpts) =>
      who.as.query(api.bookmarks.list, { view: "broken", sort: "newest", ...args, paginationOpts } as never),
    );

  test("lists the user's live broken bookmarks only, and search stays inside it", async () => {
    const a = await save(alice, "https://one.example/", { linkStatus: "broken" });
    await save(alice, "https://two.example/", { linkStatus: "ok" });
    await save(alice, "https://three.example/");
    const trashed = await save(alice, "https://four.example/", { linkStatus: "broken" });
    await alice.as.mutation(api.bookmarks.trash, { id: trashed });
    await save(bob, "https://five.example/", { linkStatus: "broken" });
    expect((await page(alice, {})).map((b) => b._id)).toEqual([a]);
    expect((await page(bob, {})).length).toBe(1);

    const search = (query: string) =>
      allPages<{ _id: Id<"bookmarks"> }>((paginationOpts) =>
        alice.as.query(api.bookmarks.search, { query, view: "broken", paginationOpts }),
      );
    expect((await search("one")).map((b) => b._id)).toEqual([a]);
    expect(await search("two")).toEqual([]);
  });

  test("the API shows the status", async () => {
    const id = await save(alice, "https://one.example/", { linkStatus: "broken" });
    const hit = await t.query(internal.apiV1.check, { userId: alice.userId, url: "https://one.example/" });
    expect(hit).toMatchObject({ id, linkStatus: "broken" });
  });
});
