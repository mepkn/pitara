import { decodeEntities, escapeHtml, parseAttributes } from "./html";
import { LIMITS } from "./limits";
import { normalizeTagName } from "./tags";
import { isValidHttpUrl } from "./url";

// Parser and writer for the Netscape bookmark file format that Chrome, Firefox,
// Raindrop and linkding all export. No DOM: the format is a loose tag soup
// (`<DT>` and `<p>` are never closed), so this is a forgiving tokenizer.
//
// Mapping:
//   - a folder becomes a collection, at most 2 levels: a bookmark in
//     A/B/C/D lands in B (under A), and A/B/C's own links too
//   - a browser's root folder (Chrome's "Bookmarks bar", Firefox's "Bookmarks
//     Menu", "Other bookmarks" ...) is not a collection: its links are Unsorted
//     and its subfolders become top-level collections
//   - TAGS="a,b" are tags, TOREAD="1" (linkding) is "To read", ADD_DATE is
//     the creation time, `<DD>` text is the description

export interface NetscapeBookmark {
  url: string;
  title: string;
  description: string;
  tags: string[];
  unread: boolean;
  /** Milliseconds since the epoch, from ADD_DATE. */
  addDate?: number;
  /** Folder names from the top: [] = no folder, at most 2 entries. */
  folder: string[];
}

export interface NetscapeParseResult {
  bookmarks: NetscapeBookmark[];
  /** Links left out: not http(s) (javascript:, place:, file:), too long, or without a URL. */
  skipped: number;
}

/** Root folders of the browsers' exports. Others are told apart by their attributes. */
const ROOT_FOLDER_NAMES = new Set([
  "bookmarks bar", "bookmarks toolbar", "bookmarks menu", "other bookmarks",
  "mobile bookmarks", "favorites bar", "bookmarks",
]);

interface Folder {
  name: string;
  /** True for a browser's root folder, which doesn't become a collection. */
  root: boolean;
}

const TAG = /<(\/?)([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const STRUCTURAL = /<\/?(?:dt|dl|dd|h3|a|p)\b/i;

function plainText(raw: string): string {
  return decodeEntities(raw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
}

function toMillis(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n > 1e14) return Math.round(n / 1000); // microseconds
  if (n > 1e11) return Math.round(n); // already milliseconds
  return Math.round(n * 1000); // seconds, the usual case
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const tags: string[] = [];
  for (const piece of raw.split(",")) {
    const name = normalizeTagName(piece);
    if (name !== "" && name.length <= LIMITS.tagNameMax && !tags.includes(name)) tags.push(name);
  }
  return tags.slice(0, LIMITS.tagsPerBookmark);
}

function folderPath(stack: (Folder | null)[]): string[] {
  const names: string[] = [];
  stack.forEach((folder, depth) => {
    // stack[0] is the file's outer list; a browser root sits right inside it.
    if (folder === null || (folder.root && depth === 1)) return;
    if (folder.name !== "") names.push(folder.name);
  });
  return names.slice(0, 2);
}

export function parseNetscape(html: string): NetscapeParseResult {
  const bookmarks: NetscapeBookmark[] = [];
  let skipped = 0;
  const stack: (Folder | null)[] = [];
  let pending: Folder | null = null;
  let last: NetscapeBookmark | null = null;

  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const lower = source.toLowerCase();
  const re = new RegExp(TAG.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const afterTag = m.index + m[0].length;

    if (name === "dl") {
      if (closing) {
        stack.pop();
      } else {
        stack.push(pending);
        pending = null;
      }
      last = null;
    } else if (name === "h3" && !closing) {
      const end = lower.indexOf("</h3", afterTag);
      const inner = source.slice(afterTag, end === -1 ? source.indexOf("<", afterTag) : end);
      const attrs = parseAttributes(m[3] ?? "");
      const folderName = plainText(inner).replace(/\s+/g, " ").trim();
      pending = {
        name: folderName,
        root:
          attrs["personal_toolbar_folder"] === "true" ||
          attrs["unfiled_bookmarks_folder"] === "true" ||
          ROOT_FOLDER_NAMES.has(folderName.toLowerCase()),
      };
      last = null;
      if (end !== -1) re.lastIndex = end;
    } else if (name === "a" && !closing) {
      let end = lower.indexOf("</a", afterTag);
      // A link that is never closed ends where the next one starts.
      const nextLink = lower.slice(afterTag).search(/<a[\s>]/);
      if (nextLink !== -1 && (end === -1 || afterTag + nextLink < end)) end = -1;
      const stop = end !== -1 ? end : nextLink !== -1 ? afterTag + nextLink : source.indexOf("<", afterTag);
      const inner = source.slice(afterTag, stop === -1 ? source.length : stop);
      const attrs = parseAttributes(m[3] ?? "");
      const url = (attrs["href"] ?? "").trim();
      if (url === "" || !isValidHttpUrl(url)) {
        skipped += 1;
        last = null;
      } else {
        last = {
          url,
          title: plainText(inner).replace(/\s+/g, " ").trim(),
          description: "",
          tags: parseTags(attrs["tags"]),
          unread: attrs["toread"] === "1",
          addDate: toMillis(attrs["add_date"]),
          folder: folderPath(stack),
        };
        bookmarks.push(last);
      }
      if (end !== -1) re.lastIndex = end;
    } else if (name === "dd" && !closing) {
      const rest = source.slice(afterTag);
      const stop = rest.search(STRUCTURAL);
      const raw = stop === -1 ? rest : rest.slice(0, stop);
      if (last !== null) last.description = plainText(raw).replace(/[ \t]+\n/g, "\n").trim();
      re.lastIndex = afterTag + raw.length;
    }
  }
  return { bookmarks, skipped };
}

// ---- writer ----------------------------------------------------------------

export interface NetscapeWriteCollection {
  id: string;
  name: string;
  /** The id of the top-level collection this one is in; none or null for a top-level one. */
  parentId?: string | null;
}

export interface NetscapeWriteBookmark {
  url: string;
  title: string;
  description: string;
  note: string;
  tags: string[];
  unread: boolean;
  createdAt: number;
  collectionId?: string;
}

/**
 * Writes the bookmarks as a Netscape bookmark file. Collections become nested
 * folders (list them in the order you want them shown); bookmarks without a
 * collection go at the top. The note is appended to the description, since the
 * format has one text field.
 */
export function writeNetscape(input: {
  collections: NetscapeWriteCollection[];
  bookmarks: NetscapeWriteBookmark[];
}): string {
  const known = new Set(input.collections.map((c) => c.id));
  const byCollection = new Map<string | undefined, NetscapeWriteBookmark[]>();
  for (const b of input.bookmarks) {
    // A bookmark whose collection isn't listed goes to the top rather than vanishing.
    const key = b.collectionId !== undefined && known.has(b.collectionId) ? b.collectionId : undefined;
    const list = byCollection.get(key) ?? [];
    list.push(b);
    byCollection.set(key, list);
  }

  const out: string[] = [];
  const link = (b: NetscapeWriteBookmark, pad: string) => {
    const attrs = [`HREF="${escapeHtml(b.url)}"`];
    if (b.createdAt > 0) attrs.push(`ADD_DATE="${Math.floor(b.createdAt / 1000)}"`);
    if (b.tags.length > 0) attrs.push(`TAGS="${escapeHtml(b.tags.join(","))}"`);
    if (b.unread) attrs.push(`TOREAD="1"`);
    out.push(`${pad}<DT><A ${attrs.join(" ")}>${escapeHtml(b.title || b.url)}</A>`);
    const text = [b.description, b.note].filter((s) => s.trim() !== "").join("\n\n");
    if (text !== "") out.push(`${pad}<DD>${escapeHtml(text)}`);
  };
  const folder = (c: NetscapeWriteCollection, depth: number) => {
    const pad = "    ".repeat(depth);
    out.push(`${pad}<DT><H3>${escapeHtml(c.name)}</H3>`);
    out.push(`${pad}<DL><p>`);
    for (const child of input.collections.filter((x) => x.parentId === c.id)) folder(child, depth + 1);
    for (const b of byCollection.get(c.id) ?? []) link(b, pad + "    ");
    out.push(`${pad}</DL><p>`);
  };

  out.push(
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Pitara</TITLE>",
    "<H1>Pitara</H1>",
    "<DL><p>",
  );
  for (const b of byCollection.get(undefined) ?? []) link(b, "    ");
  for (const c of input.collections) {
    if (c.parentId == null || !known.has(c.parentId)) folder(c, 1);
  }
  out.push("</DL><p>", "");
  return out.join("\n");
}
