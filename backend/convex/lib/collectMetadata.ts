import { decodeBody, isHtmlContentType, parseHtmlMeta, type PageMeta } from "./htmlMeta";
import { FetchFailure, safeGet, type FetchDeps } from "./safeFetch";

export type MetadataOutcome =
  | { status: "done"; meta: PageMeta }
  /** `retry`: worth trying again later (a timeout or a server error, not a refusal or a 404). */
  | { status: "failed"; retry: boolean };

/** Fetches a page safely and reads its metadata. Never throws. */
export async function collectMetadata(url: string, deps: FetchDeps): Promise<MetadataOutcome> {
  try {
    const page = await safeGet(url, deps);
    // A PDF, an image or a download has no metadata to read; that is not a failure.
    if (page.contentType !== "" && !isHtmlContentType(page.contentType)) return { status: "done", meta: {} };
    return { status: "done", meta: parseHtmlMeta(decodeBody(page.body, page.contentType), page.finalUrl) };
  } catch (err) {
    return { status: "failed", retry: err instanceof FetchFailure ? err.transient : true };
  }
}
