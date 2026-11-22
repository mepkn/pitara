// API token format and hashing. A token is `pit_` + 32 random bytes as
// base64url (47 characters). Only its SHA-256 (hex) is stored, so a leaked
// database can't be used to call the API.

export const TOKEN_PREFIX = "pit_";
const TOKEN_LENGTH = TOKEN_PREFIX.length + 43; // 32 bytes → 43 base64url characters
/** How much of a token is kept in clear to tell tokens apart in the list: "pit_" + 4 characters. */
const SHOWN_LENGTH = TOKEN_PREFIX.length + 4;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Uses secure randomness, so call it from an action, not a query or mutation. */
export function generateToken(): string {
  return TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, SHOWN_LENGTH);
}

/** The token in an `Authorization: Bearer ...` header, if it has the right shape. */
export function bearerToken(header: string | null): string | null {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];
  return token !== undefined && token.length === TOKEN_LENGTH && token.startsWith(TOKEN_PREFIX) ? token : null;
}
