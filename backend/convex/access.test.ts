import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { getOwnedBookmark, getOwnedCollection, getOwnedTag } from "./lib/access";
import { newTest, signedInUser } from "./test.helpers";

afterEach(() => vi.restoreAllMocks());

describe("allowlist", () => {
  test("a non-allowlisted email can't sign up or sign in", async () => {
    const t = newTest();
    for (const flow of ["signUp", "signIn"] as const) {
      await expect(
        t.action(api.auth.signIn, {
          provider: "password",
          params: { email: "mallory@example.com", password: "password123", flow },
        }),
      ).rejects.toThrow("notAllowed");
    }
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toEqual([]);
  });

  test("an unset or empty list allows nobody", async () => {
    const t = newTest();
    vi.stubEnv("ALLOWED_EMAILS", "");
    await expect(
      t.action(api.auth.signIn, {
        provider: "password",
        params: { email: "alice@example.com", password: "password123", flow: "signUp" },
      }),
    ).rejects.toThrow("notAllowed");
    const alice = await signedInUser(t, "alice@example.com");
    await expect(alice.as.query(api.users.me, {})).rejects.toThrow("notAllowed");
  });

  test("an allowlisted user is let in, case-insensitively", async () => {
    const t = newTest();
    const bob = await signedInUser(t, "bob@example.com");
    expect(await bob.as.query(api.users.me, {})).toEqual({ email: "bob@example.com" });
    const upper = await signedInUser(t, "BOB@EXAMPLE.COM");
    expect(await upper.as.query(api.users.me, {})).toEqual({ email: "BOB@EXAMPLE.COM" });
  });

  test("removing an email cuts off an existing session", async () => {
    const t = newTest();
    const alice = await signedInUser(t, "alice@example.com");
    expect(await alice.as.query(api.users.me, {})).toEqual({ email: "alice@example.com" });
    vi.stubEnv("ALLOWED_EMAILS", "bob@example.com");
    await expect(alice.as.query(api.users.me, {})).rejects.toThrow("notAllowed");
  });

  test("a signed-in user whose email isn't allowed is refused", async () => {
    const t = newTest();
    const mallory = await signedInUser(t, "mallory@example.com");
    await expect(mallory.as.query(api.users.me, {})).rejects.toThrow("notAllowed");
  });

  test("anonymous callers are refused", async () => {
    const t = newTest();
    await expect(t.query(api.users.me, {})).rejects.toThrow("notAuthenticated");
  });
});

describe("email codes (OTP)", () => {
  test("sign-up sends a 6-digit code; without a Resend key it is logged", async () => {
    const t = newTest();
    vi.stubEnv("RESEND_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { email: "alice@example.com", password: "password123", flow: "signUp" },
      })
      .catch(() => {}); // token minting needs JWT keys, which tests don't set
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[otp] alice@example.com"));
    expect(line).toMatch(/Pitara verification code is \d{6}\./);
  });

  test("the code is not sent to a non-allowlisted email", async () => {
    const t = newTest();
    vi.stubEnv("RESEND_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { email: "mallory@example.com", password: "password123", flow: "signUp" },
      })
      .catch(() => {});
    expect(log.mock.calls.some((c) => String(c[0]).startsWith("[otp]"))).toBe(false);
  });

  test("forgot password sends a reset code to an allowlisted account", async () => {
    const t = newTest();
    vi.stubEnv("RESEND_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The reset flow needs an existing password account.
    await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { email: "alice@example.com", password: "password123", flow: "signUp" },
      })
      .catch(() => {});
    log.mockClear();
    await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { email: "alice@example.com", flow: "reset" },
      })
      .catch(() => {});
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("reset code"));
    expect(line).toMatch(/Pitara password reset code is \d{6}\./);
  });
});

describe("ownership helpers", () => {
  test("missing and foreign ids give the same notFound error", async () => {
    const t = newTest();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const now = Date.now();
    const { collectionId, tagId, bookmarkId } = await t.run(async (ctx) => {
      const collectionId = await ctx.db.insert("collections", {
        userId: alice.userId, name: "c", sortOrder: 0, bookmarkCount: 0, updatedAt: now,
      });
      const tagId = await ctx.db.insert("tags", { userId: alice.userId, name: "t", bookmarkCount: 0 });
      const bookmarkId = await ctx.db.insert("bookmarks", {
        userId: alice.userId, url: "https://example.com", normalizedUrl: "https://example.com",
        domain: "example.com", title: "", description: "", note: "", tagIds: [],
        favorite: false, unread: false, metaStatus: "pending", searchText: "",
        createdAt: now, updatedAt: now,
      });
      return { collectionId, tagId, bookmarkId };
    });
    await t.run(async (ctx) => {
      expect((await getOwnedBookmark(ctx, alice.userId, bookmarkId))._id).toBe(bookmarkId);
      expect((await getOwnedCollection(ctx, alice.userId, collectionId))._id).toBe(collectionId);
      expect((await getOwnedTag(ctx, alice.userId, tagId))._id).toBe(tagId);
      await expect(getOwnedBookmark(ctx, bob.userId, bookmarkId)).rejects.toThrow("notFound");
      await expect(getOwnedCollection(ctx, bob.userId, collectionId)).rejects.toThrow("notFound");
      await expect(getOwnedTag(ctx, bob.userId, tagId)).rejects.toThrow("notFound");
      await ctx.db.delete("tags", tagId);
      await expect(getOwnedTag(ctx, alice.userId, tagId)).rejects.toThrow("notFound");
    });
  });
});
