import { isValidHttpUrl } from "@shared/url";

/** What `expo-share-intent` hands over (only the fields used here). */
export interface SharedContent {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string | null } | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
// Sentence punctuation that is not part of a link when it ends one: "see https://a.com/x."
const TRAILING = /[.,;:!?)\]}>'"”’]/;

const count = (s: string, ch: string) => s.split(ch).length - 1;

function trimLink(link: string): string {
  let s = link;
  for (;;) {
    const last = s.at(-1);
    if (last === undefined || !TRAILING.test(last)) return s;
    // A ")" that closes a "(" inside the link stays (Wikipedia-style addresses).
    if (last === ")" && count(s, "(") >= count(s, ")")) return s;
    s = s.slice(0, -1);
  }
}

/** The first savable http(s) link in a piece of text, or null. */
export function findUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const candidate = trimLink(match[0]);
    if (isValidHttpUrl(candidate)) return candidate;
  }
  return null;
}

/** The link and (if the sharing app sent one) the page title from a share. */
export function readShare(share: SharedContent): { url: string; title: string } | null {
  // The text is parsed here first: the share-intent library's own `webUrl` stops at "(" and
  // other characters that are legal in a link. It is only the fallback.
  const url = findUrl(share.text) ?? (share.webUrl && isValidHttpUrl(share.webUrl) ? share.webUrl : null);
  if (!url) return null;
  const title = share.meta?.title?.trim() ?? "";
  // A title that is only the address says nothing; the server fetches the real one.
  return { url, title: title === url ? "" : title };
}
