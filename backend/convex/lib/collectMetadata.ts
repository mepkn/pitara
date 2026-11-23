import { decodeBody, isHtmlContentType, parseHtmlMeta, type PageMeta } from "./htmlMeta";
import { fetchOembed } from "./oembed";
import { FetchFailure, safeGet, type FetchDeps } from "./safeFetch";

export type MetadataOutcome =
  | { status: "done"; meta: PageMeta }
  /** `retry`: worth trying again later (a timeout or a server error, not a refusal or a 404). */
  | { status: "failed"; retry: boolean };

/**
 * Fetches a page safely and reads its metadata. Never throws. For sites that
 * block scrapers (an error status, or a page with no title) a known oEmbed
 * provider is asked instead (lib/oembed.ts); what the page itself gave wins.
 */
export async function collectMetadata(url: string, deps: FetchDeps): Promise<MetadataOutcome> {
  try {
    const page = await safeGet(url, deps);
    // A PDF, an image or a download has no metadata to read; that is not a failure.
    if (page.contentType !== "" && !isHtmlContentType(page.contentType)) return { status: "done", meta: {} };
    const meta = parseHtmlMeta(decodeBody(page.body, page.contentType), page.finalUrl);
    if (meta.title !== undefined) return { status: "done", meta };
    const embed = await fetchOembed(url, deps);
    return { status: "done", meta: embed === undefined ? meta : { ...embed, ...definedOnly(meta) } };
  } catch (err) {
    const failure = err instanceof FetchFailure ? err : undefined;
    // A refusal (private address, bad scheme) is never worked around.
    if (failure?.kind !== "refused") {
      const embed = await fetchOembed(url, deps);
      if (embed?.title !== undefined) return { status: "done", meta: embed };
    }
    return { status: "failed", retry: failure ? failure.transient : true };
  }
}

function definedOnly(meta: PageMeta): PageMeta {
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
}
