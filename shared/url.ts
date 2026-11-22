import { LIMITS } from "./limits";

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid)$/i;
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

function parse(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > LIMITS.urlMax) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "") return null;
    return url;
  } catch {
    return null;
  }
}

/** http(s) only, at most 2,048 characters. */
export function isValidHttpUrl(input: string): boolean {
  return parse(input) !== null;
}

/** Lower-cased host without `www.`, or "" if the URL is invalid. */
export function getDomain(input: string): string {
  const url = parse(input);
  return url ? url.hostname.toLowerCase().replace(/^www\./, "") : "";
}

/**
 * The key used to detect duplicates: lower-cased host, no `www.`, no #fragment,
 * no utm_* / fbclid / gclid params, no default port, no trailing slash.
 * Other query params are kept. Returns null for an invalid URL.
 */
export function normalizeUrl(input: string): string | null {
  const url = parse(input);
  if (!url) return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.port === DEFAULT_PORTS[url.protocol]) url.port = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  if (url.search === "?") url.search = "";

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (path === "") path = "/";
  url.pathname = path;

  let out = url.toString();
  // A bare origin ends with "/" in URL.toString(); drop it so example.com/ == example.com.
  if (url.pathname === "/" && url.search === "") out = out.replace(/\/$/, "");
  return out;
}
