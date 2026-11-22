// Which tabs can be saved, and what we send for them.

export function isSavableUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** A tab title worth sending: the page's own title, unless it is empty or just the address. */
export function usefulTitle(title: string | undefined | null, url: string): string | undefined {
  const t = (title ?? "").trim();
  if (t === "" || t === url || t === url.replace(/^https?:\/\//, "")) return undefined;
  return t;
}

/** Splits "a, b  c" style tag input into clean lower-case names, no repeats. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.trim().replace(/^#/, "").toLowerCase();
    if (tag !== "" && !out.includes(tag)) out.push(tag);
  }
  return out;
}
