import { LIMITS } from "./limits";

/** Tag names are stored lower-cased with single spaces and no leading `#`. */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True for a name that is non-empty and within the limit once normalized. */
export function isValidTagName(raw: string): boolean {
  const name = normalizeTagName(raw);
  return name.length > 0 && name.length <= LIMITS.tagNameMax;
}
