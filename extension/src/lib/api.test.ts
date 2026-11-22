import { describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import { ApiError, errorMessage, isTokenProblem } from "./errors";

const ORIGIN = "https://x.convex.site";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function client(fetchFn: typeof fetch, token = "pit_secret") {
  return createApi({ origin: ORIGIN, token, fetch: fetchFn });
}

describe("api client", () => {
  it("sends the bearer token in the header only, never in the URL or body", async () => {
    const fetchFn = vi.fn(async () => json({ email: "a@b.c" }));
    await client(fetchFn as unknown as typeof fetch).me();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}/api/v1/me`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pit_secret");
    expect(url).not.toContain("pit_secret");
    expect(init.body).toBeUndefined();
  });

  it("encodes the URL in check() and posts JSON in create()", async () => {
    const fetchFn = vi.fn(async () => json({ exists: false }));
    const api = client(fetchFn as unknown as typeof fetch);
    await api.check("https://a.com/x?y=1&z=2#f");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(
      `${ORIGIN}/api/v1/bookmarks/check?url=${encodeURIComponent("https://a.com/x?y=1&z=2#f")}`,
    );
    fetchFn.mockResolvedValueOnce(json({ id: "1", existed: false }, 201));
    await api.create({ url: "https://a.com", tags: ["t"] });
    const init = (fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ url: "https://a.com", tags: ["t"] });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("builds PATCH, DELETE and search requests", async () => {
    const fetchFn = vi.fn(async () => json({ ok: true, bookmarks: [] }));
    const api = client(fetchFn as unknown as typeof fetch);
    await api.update("a/b", { favorite: true });
    await api.remove("a/b");
    await api.search("#t cats", 5);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe(`${ORIGIN}/api/v1/bookmarks/a%2Fb`);
    expect(calls[0]![1].method).toBe("PATCH");
    expect(calls[1]![1].method).toBe("DELETE");
    expect(calls[2]![0]).toBe(`${ORIGIN}/api/v1/bookmarks?q=${encodeURIComponent("#t cats")}&limit=5`);
  });

  it("refuses without a token and does not call the network", async () => {
    const fetchFn = vi.fn();
    await expect(client(fetchFn as unknown as typeof fetch, "  ").me()).rejects.toMatchObject({ code: "notConfigured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("turns API errors into ApiError with the server's code", async () => {
    const api = client((async () => json({ error: "notAuthenticated" }, 401)) as typeof fetch);
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "notAuthenticated", status: 401 });
    expect(isTokenProblem(err)).toBe(true);
    expect(errorMessage(err)).toMatch(/token/i);
  });

  it("maps a rate limit, a non-JSON 500 and an offline failure", async () => {
    expect(await client((async () => json({ error: "tooManyRequests" }, 429)) as typeof fetch).me().catch((e) => e.code)).toBe("tooManyRequests");
    expect(await client((async () => new Response("<html>", { status: 502 })) as typeof fetch).me().catch((e) => e.code)).toBe("serverError");
    expect(await client((async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch).me().catch((e) => e.code)).toBe("offline");
    expect(errorMessage(new ApiError("offline"))).toMatch(/connection/i);
  });

  it("maps a timeout", async () => {
    const api = client((async () => { throw new DOMException("t", "TimeoutError"); }) as typeof fetch);
    expect(await api.me().catch((e) => e.code)).toBe("timeout");
  });

  it("never puts the token in an error message", async () => {
    const api = client((async () => json({ error: "notAuthenticated" }, 401)) as typeof fetch, "pit_topsecret");
    const err = (await api.me().catch((e) => e)) as Error;
    expect(`${err.message} ${errorMessage(err)}`).not.toContain("pit_topsecret");
  });
});
