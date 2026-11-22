import { decodeEntities, parseAttributes } from "../../../shared/html";
import { LIMITS } from "../../../shared/limits";

// Pulls the title, description, preview image and favicon out of a page's HTML.
// No DOM in the Convex runtime, so this scans the <head> with regular expressions.

export interface PageMeta {
  title?: string;
  description?: string;
  imageUrl?: string;
  faviconUrl?: string;
}

const TAGS = /<(meta|link)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;

function clean(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  const one = decodeEntities(text).replace(/\s+/g, " ").trim();
  return one === "" ? undefined : one.slice(0, max);
}

/** An absolute http(s) URL within the length limit, or undefined. */
function httpUrl(raw: string | undefined, base: string): string | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    const url = new URL(raw.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const text = url.toString();
    return text.length <= LIMITS.urlMax ? text : undefined;
  } catch {
    return undefined;
  }
}

/** `baseUrl` is the page's final URL, for relative image and icon links. */
export function parseHtmlMeta(html: string, baseUrl: string): PageMeta {
  // Only the head matters; cutting scripts, styles and comments first keeps
  // strings inside them from being mistaken for tags.
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = (headEnd === -1 ? html : html.slice(0, headEnd))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");

  const meta = new Map<string, string>(); // property / name → content, first one wins
  const icons: { rel: string[]; href: string }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TAGS.source, "gi");
  while ((m = re.exec(head)) !== null) {
    const attrs = parseAttributes(m[2] ?? "");
    if ((m[1] ?? "").toLowerCase() === "meta") {
      const key = (attrs["property"] ?? attrs["name"] ?? "").toLowerCase();
      const content = attrs["content"];
      if (key !== "" && content !== undefined && !meta.has(key)) meta.set(key, content);
    } else if (attrs["href"] !== undefined && attrs["rel"] !== undefined) {
      icons.push({ rel: attrs["rel"].toLowerCase().split(/\s+/), href: attrs["href"] });
    }
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];
  const out: PageMeta = {
    title: clean(meta.get("og:title"), LIMITS.titleMax) ?? clean(titleTag, LIMITS.titleMax),
    description:
      clean(meta.get("og:description"), LIMITS.descriptionMax) ?? clean(meta.get("description"), LIMITS.descriptionMax),
    imageUrl: httpUrl(meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image"), baseUrl),
  };

  const iconLink =
    icons.find((l) => l.rel.includes("icon") && !l.rel.includes("apple-touch-icon") && !l.rel.includes("mask-icon")) ??
    icons.find((l) => l.rel.includes("apple-touch-icon"));
  out.faviconUrl = httpUrl(iconLink?.href, baseUrl) ?? httpUrl("/favicon.ico", baseUrl);
  return out;
}

/** Decodes a response body as text, using the Content-Type charset if the runtime knows it (else UTF-8). */
export function decodeBody(body: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export function isHtmlContentType(contentType: string): boolean {
  return /^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}
