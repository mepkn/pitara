import { FetchFailure, safeGet, type FetchDeps } from "./safeFetch";

/**
 * What one check of a URL says:
 *  - ok:      the page answered 2xx (after redirects)
 *  - broken:  the page is gone: 404 or 410, or the host name no longer resolves
 *  - unknown: anything else (a bot wall's 403, a 429 or 5xx, a timeout, a refused
 *             connection, a blocked address): says nothing about the link, so
 *             the stored status is left alone
 * Never throws. The same SSRF rules as the metadata fetch apply (safeGet).
 */
export type LinkVerdict = "ok" | "broken" | "unknown";

export async function checkLink(url: string, deps: FetchDeps): Promise<LinkVerdict> {
  try {
    await safeGet(url, deps);
    return "ok";
  } catch (err) {
    if (!(err instanceof FetchFailure)) return "unknown";
    if (err.kind === "http" && (err.status === 404 || err.status === 410)) return "broken";
    if (err.kind === "network" && err.message === "host not found") return "broken";
    return "unknown";
  }
}
