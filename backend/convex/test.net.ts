import type { FetchDeps, HopResponse } from "./lib/safeFetch";

// A fake network for tests (installed by test.setup.ts in place of
// lib/nodeTransport.ts): host names resolve through `dnsTable`, and requests
// are answered from `pages` by "host/path" (or "ip/path" for IP literals).
// Anything not listed is a network failure, so no test touches the internet.

export const fakeNet = {
  dns: new Map<string, string[]>(),
  pages: new Map<string, Partial<HopResponse> & { html?: string }>(),
  /** Every request that reached the transport: [address, url]. */
  requests: [] as [string, string][],
  reset() {
    this.dns.clear();
    this.pages.clear();
    this.requests.length = 0;
  },
  /** Makes `host` resolve to `addresses` and serve `html` at its root (or `page` at `path`). */
  serve(host: string, html: string, { path = "/", addresses = ["93.184.216.34"], status = 200, contentType = "text/html; charset=utf-8" } = {}) {
    this.dns.set(host, addresses);
    this.pages.set(`${host}${path}`, { status, contentType, html });
  },
  redirect(host: string, path: string, location: string, addresses = ["93.184.216.34"], status = 302) {
    this.dns.set(host, addresses);
    this.pages.set(`${host}${path}`, { status, location });
  },
};

export function fakeDeps(): FetchDeps {
  return {
    now: () => Date.now(),
    resolve: async (host) => {
      const addresses = fakeNet.dns.get(host);
      if (addresses === undefined) throw new Error("ENOTFOUND");
      return addresses;
    },
    request: async (url, address) => {
      fakeNet.requests.push([address, url.toString()]);
      const page = fakeNet.pages.get(`${url.hostname.replace(/^\[|\]$/g, "")}${url.pathname}`);
      if (page === undefined) throw new Error("ECONNREFUSED");
      return {
        status: page.status ?? 200,
        location: page.location,
        contentType: page.contentType,
        body: new TextEncoder().encode(page.html ?? ""),
      };
    },
  };
}
