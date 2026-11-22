// SSRF guard for the metadata fetch: decides whether an IP address may be
// contacted. Only globally routable unicast addresses pass. Pure functions, no
// Node imports, so they run (and are tested) anywhere.

/** Dotted-quad IPv4 → 4 octets, or null if it isn't one. */
export function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/** IPv6 text (with `::`, an embedded IPv4 tail, optional zone id) → 8 groups, or null. */
export function parseIpv6(input: string): number[] | null {
  let text = input.trim();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":") || /[^0-9a-fA-F:.]/.test(text)) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    text = text.slice(0, lastColon + 1) + "0:0"; // placeholder groups, replaced below
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const groups: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (head === null || rest === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) groups = [...groups.slice(0, 6), ...tail];
  return groups;
}

function blockedIpv4(o: number[]): boolean {
  const [a, b, c] = [o[0]!, o[1]!, o[2]!];
  return (
    a === 0 || // "this" network
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT, also Tailscale
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

function blockedIpv6(g: number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d): judge the IPv4 address inside.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return blockedIpv4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]);
  }
  // Only 2000::/3 is global unicast; this drops ::, ::1, fc00::/7, fe80::/10, ff00::/8.
  if ((g[0]! & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0x0000) return true; // Teredo (embeds an IPv4 address)
  if (g[0] === 0x2002) return true; // 6to4 (embeds an IPv4 address)
  if (g[0] === 0x3fff && (g[1]! & 0xf000) === 0) return true; // documentation (3fff::/20)
  return false;
}

/**
 * True if the address must not be contacted: not an IP at all, or private,
 * loopback, link-local, carrier-grade NAT, multicast, reserved, documentation,
 * or a tunnel format that embeds an IPv4 address.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) return blockedIpv4(v4);
  const v6 = parseIpv6(address);
  if (v6 !== null) return blockedIpv6(v6);
  return true; // fail closed
}

/** `[::1]` → `::1`; other hosts unchanged, lower-cased, without a trailing dot. */
export function bareHost(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

/** Whether a host name is already an IP literal (v4 or v6), which needs no DNS lookup. */
export function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}
