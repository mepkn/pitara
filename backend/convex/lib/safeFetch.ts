import { bareHost, isBlockedAddress, isIpLiteral } from "./ssrf";

// Fetches one page for the metadata action, safely: http(s) only, every host
// name resolved and every address checked before connecting (and the
// connection is made to that checked address, so a second DNS answer can't
// swap in a private one), at most 3 redirects with each hop checked again, one
// 5 s budget for the whole walk, at most 1 MB read. No Node imports: the
// resolver and the single-request transport are injected, so the redirect and
// refusal logic is tested without a network (the real ones are in
// nodeTransport.ts).

export const MAX_REDIRECTS = 3;
export const TOTAL_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 1024 * 1024;

export type FetchFailureKind =
  | "refused" // a rule said no (bad scheme, private address, too many redirects): retrying won't help
  | "timeout"
  | "network"
  | "http"; // a final status that isn't 2xx

export class FetchFailure extends Error {
  constructor(
    readonly kind: FetchFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchFailure";
  }
  /** Worth another attempt later. */
  get transient(): boolean {
    if (this.kind === "timeout" || this.kind === "network") return true;
    return this.kind === "http" && (this.status === 408 || this.status === 429 || (this.status ?? 0) >= 500);
  }
}

export interface HopResponse {
  status: number;
  /** The Location header of a redirect. */
  location?: string;
  contentType?: string;
  /** At most `maxBytes` of the (decompressed) body. */
  body: Uint8Array;
}

export interface FetchDeps {
  /** All addresses of a host name (A and AAAA). Rejects if it doesn't resolve. */
  resolve(host: string): Promise<string[]>;
  /** One GET to `address`, with the URL's host as Host / SNI. Must give up after `timeoutMs` and stop reading at `maxBytes`. */
  request(url: URL, address: string, limits: { timeoutMs: number; maxBytes: number }): Promise<HopResponse>;
  now(): number;
}

export interface FetchedPage {
  /** Where the redirects ended; relative links in the page resolve against it. */
  finalUrl: string;
  contentType: string;
  body: Uint8Array;
}

function withinBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return Promise.reject(new FetchFailure("timeout", "timed out"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FetchFailure("timeout", "timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The address to connect to for this URL, after checking all of them. */
async function checkedAddress(url: URL, deps: FetchDeps, budgetMs: number): Promise<string> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchFailure("refused", "only http(s) is allowed");
  if (url.username !== "" || url.password !== "") throw new FetchFailure("refused", "credentials in the URL");
  const host = bareHost(url.hostname);
  if (host === "") throw new FetchFailure("refused", "no host");

  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) throw new FetchFailure("refused", "address not allowed");
    return host;
  }
  let addresses: string[];
  try {
    addresses = await withinBudget(deps.resolve(host), budgetMs);
  } catch (err) {
    if (err instanceof FetchFailure) throw err;
    throw new FetchFailure("network", "host not found");
  }
  if (addresses.length === 0) throw new FetchFailure("network", "host not found");
  // One private address among the answers is enough to refuse: nothing else is safe to trust.
  if (addresses.some((a) => isBlockedAddress(a))) throw new FetchFailure("refused", "address not allowed");
  return addresses[0]!;
}

export async function safeGet(startUrl: string, deps: FetchDeps): Promise<FetchedPage> {
  const deadline = deps.now() + TOTAL_TIMEOUT_MS;
  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    throw new FetchFailure("refused", "invalid URL");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const address = await checkedAddress(url, deps, deadline - deps.now());
    let response: HopResponse;
    try {
      response = await withinBudget(
        deps.request(url, address, { timeoutMs: deadline - deps.now(), maxBytes: MAX_BODY_BYTES }),
        deadline - deps.now(),
      );
    } catch (err) {
      if (err instanceof FetchFailure) throw err;
      throw new FetchFailure("network", "request failed");
    }

    if (response.status >= 300 && response.status < 400 && response.location !== undefined) {
      if (hop === MAX_REDIRECTS) throw new FetchFailure("refused", "too many redirects");
      try {
        url = new URL(response.location, url); // relative Locations resolve against this hop
      } catch {
        throw new FetchFailure("refused", "invalid redirect");
      }
      continue; // the next loop re-checks scheme, host and addresses
    }
    if (response.status < 200 || response.status >= 300) {
      throw new FetchFailure("http", `status ${response.status}`, response.status);
    }
    return { finalUrl: url.toString(), contentType: response.contentType ?? "", body: response.body };
  }
  throw new FetchFailure("refused", "too many redirects");
}
