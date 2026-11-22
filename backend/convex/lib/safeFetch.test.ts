import { beforeEach, describe, expect, test, vi } from "vitest";
import { FetchFailure, safeGet, MAX_REDIRECTS, type FetchDeps } from "./safeFetch";
import { fakeDeps, fakeNet } from "../test.net";

beforeEach(() => fakeNet.reset());

const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(FetchFailure);
      expect((err as FetchFailure).kind).toBe("refused");
    },
  );

describe("safeGet refuses", () => {
  test.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.com/",
    "http://user:pw@example.com/",
    "not a url",
  ])("%s", async (url) => {
    fakeNet.serve("example.com", "<html></html>");
    await refused(safeGet(url, fakeDeps()));
    expect(fakeNet.requests).toEqual([]);
  });

  test.each([
    "http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://10.0.0.5/", "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", "http://100.100.100.100/", "http://2130706433/", "http://0x7f.1/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://0.0.0.0/",
  ])("%s", async (url) => {
    fakeNet.dns.set("localhost", ["127.0.0.1", "::1"]);
    await refused(safeGet(url, fakeDeps()));
    expect(fakeNet.requests).toEqual([]); // not even a connection attempt
  });

  test("a name that resolves to a private address", async () => {
    fakeNet.serve("internal.example", "secret", { addresses: ["10.1.2.3"] });
    await refused(safeGet("http://internal.example/", fakeDeps()));
    expect(fakeNet.requests).toEqual([]);
  });

  test("a name with one public and one private answer is refused whole", async () => {
    fakeNet.serve("mixed.example", "x", { addresses: ["93.184.216.34", "127.0.0.1"] });
    await refused(safeGet("http://mixed.example/", fakeDeps()));
    expect(fakeNet.requests).toEqual([]);
  });

  test("a redirect to a private IP", async () => {
    fakeNet.redirect("start.example", "/", "http://169.254.169.254/latest/meta-data/");
    await refused(safeGet("http://start.example/", fakeDeps()));
    expect(fakeNet.requests.map((r) => r[1])).toEqual(["http://start.example/"]);
  });

  test("a redirect to a name that resolves to a private address", async () => {
    fakeNet.redirect("start.example", "/", "http://rebind.example/admin");
    fakeNet.serve("rebind.example", "secret", { path: "/admin", addresses: ["192.168.0.10"] });
    await refused(safeGet("http://start.example/", fakeDeps()));
    expect(fakeNet.requests).toHaveLength(1);
  });

  test("a redirect to another scheme", async () => {
    fakeNet.redirect("start.example", "/", "file:///etc/passwd");
    await refused(safeGet("http://start.example/", fakeDeps()));
  });

  test("a relative redirect is resolved, then checked like any other", async () => {
    fakeNet.redirect("start.example", "/a", "//localhost/secret");
    fakeNet.dns.set("localhost", ["127.0.0.1"]);
    await refused(safeGet("http://start.example/a", fakeDeps()));
  });

  test("more than three redirects", async () => {
    fakeNet.redirect("loop.example", "/", "/1");
    fakeNet.redirect("loop.example", "/1", "/2");
    fakeNet.redirect("loop.example", "/2", "/3");
    fakeNet.redirect("loop.example", "/3", "/4");
    fakeNet.serve("loop.example", "end", { path: "/4" });
    await refused(safeGet("http://loop.example/", fakeDeps()));
    expect(fakeNet.requests).toHaveLength(MAX_REDIRECTS + 1);
  });
});

describe("safeGet fetches", () => {
  test("a page, connecting to the checked address", async () => {
    fakeNet.serve("example.com", "<title>Hi</title>", { addresses: ["93.184.216.34", "2606:2800:220:1::1"] });
    const page = await safeGet("https://example.com/", fakeDeps());
    expect(new TextDecoder().decode(page.body)).toBe("<title>Hi</title>");
    expect(page.finalUrl).toBe("https://example.com/");
    expect(fakeNet.requests).toEqual([["93.184.216.34", "https://example.com/"]]);
  });

  test("up to three redirects, relative and absolute, and reports the final URL", async () => {
    fakeNet.redirect("a.example", "/", "/next");
    fakeNet.redirect("a.example", "/next", "https://b.example/page");
    fakeNet.redirect("b.example", "/page", "/final", ["93.184.216.35"], 301);
    fakeNet.serve("b.example", "ok", { path: "/final", addresses: ["93.184.216.35"] });
    const page = await safeGet("http://a.example/", fakeDeps());
    expect(page.finalUrl).toBe("https://b.example/final");
  });

  test("a 404 is a non-transient http failure, a 503 is transient", async () => {
    fakeNet.serve("gone.example", "", { status: 404 });
    fakeNet.serve("busy.example", "", { status: 503 });
    const gone = await safeGet("http://gone.example/", fakeDeps()).catch((e: FetchFailure) => e);
    const busy = await safeGet("http://busy.example/", fakeDeps()).catch((e: FetchFailure) => e);
    expect(gone).toMatchObject({ kind: "http", status: 404, transient: false });
    expect(busy).toMatchObject({ kind: "http", status: 503, transient: true });
  });

  test("an unknown host is a transient network failure", async () => {
    const err = await safeGet("http://nowhere.example/", fakeDeps()).catch((e: FetchFailure) => e);
    expect(err).toMatchObject({ kind: "network", transient: true });
  });
});

describe("safeGet time budget", () => {
  test("one 5 second budget covers every hop, not 5 seconds each", async () => {
    let clock = 0;
    const seen: number[] = [];
    const deps: FetchDeps = {
      now: () => clock,
      resolve: async () => ["93.184.216.34"],
      request: async (url, _address, limits) => {
        seen.push(limits.timeoutMs);
        clock += 2000; // each hop takes 2 s
        return url.pathname === "/" || url.pathname === "/1"
          ? { status: 302, location: url.pathname === "/" ? "/1" : "/2", body: new Uint8Array() }
          : { status: 200, body: new Uint8Array() };
      },
    };
    const err = await safeGet("http://slow.example/", deps).catch((e: FetchFailure) => e);
    expect(seen).toEqual([5000, 3000, 1000]);
    expect(err).toMatchObject({ kind: "timeout", transient: true });
  });

  test("a request that never answers is cut off after 5 seconds", async () => {
    vi.useFakeTimers();
    try {
      const deps: FetchDeps = {
        now: () => Date.now(),
        resolve: async () => ["93.184.216.34"],
        request: () => new Promise(() => {}),
      };
      const result = safeGet("http://hang.example/", deps).catch((e: FetchFailure) => e);
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      void result.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await result).toMatchObject({ kind: "timeout", transient: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
