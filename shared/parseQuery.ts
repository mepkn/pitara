// The search box understands `#tag` and `@collection` shortcuts. Names with
// spaces are quoted: `#"to read later"`, `@"My Folder"`. A shortcut must start
// a word, so URLs (`site.com/#top`) and emails (`a@b.com`) stay plain text.

export interface ParsedQuery {
  /** What is left for full-text search, whitespace collapsed. */
  text: string;
  /** Tag names, lower-cased, in order, without duplicates. */
  tags: string[];
  /** Collection names as typed, in order, without duplicates (compare case-insensitively). */
  collections: string[];
}

const SHORTCUT = /(^|\s)([#@])(?:"([^"]*)"|(\S+))/g;

export function parseQuery(input: string): ParsedQuery {
  const tags: string[] = [];
  const collections: string[] = [];
  const text = input
    .replace(SHORTCUT, (whole, lead: string, sigil: string, quoted?: string, bare?: string) => {
      const name = (quoted ?? bare ?? "").trim().replace(/\s+/g, " ");
      if (name === "") return whole; // a lone `#` or `#""` stays as text
      if (sigil === "#") {
        const tag = name.toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
      } else if (!collections.some((c) => c.toLowerCase() === name.toLowerCase())) {
        collections.push(name);
      }
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, tags, collections };
}
