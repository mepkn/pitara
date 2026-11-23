import { LIMITS } from "../../../shared/limits";
import type { PageMeta } from "./htmlMeta";
import { safeGet, type FetchDeps } from "./safeFetch";

// oEmbed fallback for sites that block scrapers (a 403 or a bot wall, or a
// page with no readable <title>): a few providers answer a plain JSON request
// with the title and a thumbnail. Only the endpoints listed here are ever
// called, never one a page points to, and each goes through safeGet like any
// other fetch.

interface Provider {
  /** Host names (without www.) whose URLs this provider embeds. */
  hosts: string[];
  endpoint: string;
}

const PROVIDERS: Provider[] = [
  { hosts: ["youtube.com", "m.youtube.com", "youtu.be"], endpoint: "https://www.youtube.com/oembed" },
  { hosts: ["vimeo.com"], endpoint: "https://vimeo.com/api/oembed.json" },
  { hosts: ["soundcloud.com"], endpoint: "https://soundcloud.com/oembed" },
  { hosts: ["open.spotify.com"], endpoint: "https://open.spotify.com/oembed" },
  { hosts: ["tiktok.com"], endpoint: "https://www.tiktok.com/oembed" },
  { hosts: ["twitter.com", "x.com"], endpoint: "https://publish.twitter.com/oembed" },
  { hosts: ["flickr.com"], endpoint: "https://www.flickr.com/services/oembed/" },
  { hosts: ["reddit.com", "old.reddit.com"], endpoint: "https://www.reddit.com/oembed" },
];

/** The oEmbed request URL for a page URL, or null when no provider handles it. */
export function oembedEndpoint(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const provider = PROVIDERS.find((p) => p.hosts.includes(host));
  if (provider === undefined) return null;
  const endpoint = new URL(provider.endpoint);
  endpoint.searchParams.set("url", url.toString());
  endpoint.searchParams.set("format", "json");
  return endpoint.toString();
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const one = value.replace(/\s+/g, " ").trim();
  return one === "" ? undefined : one.slice(0, max);
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && value.length <= LIMITS.urlMax ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Reads an oEmbed JSON answer. A tweet has no title, so it gets "Author on X"-style text from the author. */
export function parseOembed(json: unknown, provider: string): PageMeta {
  if (typeof json !== "object" || json === null) return {};
  const o = json as Record<string, unknown>;
  const author = text(o["author_name"], 100);
  let title = text(o["title"], LIMITS.titleMax);
  if (title === undefined && author !== undefined) title = `${author} on ${provider}`;
  return {
    title,
    description: title !== undefined && author !== undefined && !title.includes(author) ? `By ${author}` : undefined,
    imageUrl: httpUrl(o["thumbnail_url"]),
  };
}

/** Title, description and image from the page's oEmbed provider; undefined if there is none or it has nothing. */
export async function fetchOembed(pageUrl: string, deps: FetchDeps): Promise<PageMeta | undefined> {
  const endpoint = oembedEndpoint(pageUrl);
  if (endpoint === null) return undefined;
  try {
    const page = await safeGet(endpoint, deps);
    const json: unknown = JSON.parse(new TextDecoder().decode(page.body));
    const host = new URL(endpoint).hostname.replace(/^www\./, "");
    const meta = parseOembed(json, host.startsWith("publish.twitter") ? "X" : host.split(".")[0]!);
    return meta.title === undefined && meta.imageUrl === undefined ? undefined : meta;
  } catch {
    return undefined; // the fallback never turns a result into an error
  }
}
