import type {
  ApiBookmark,
  ApiCheckResult,
  ApiCollection,
  ApiCreateBookmark,
  ApiCreateResult,
  ApiMe,
  ApiTag,
  ApiUpdateBookmark,
} from "@shared/types";
import { ApiError } from "./errors";

// Client for the token-protected HTTP API (backend/convex/lib/apiRoutes.ts). The token goes in the
// Authorization header and nowhere else: not in URLs, not in logs, not in error messages.

const TIMEOUT_MS = 15_000;

export interface ApiClientOptions {
  /** The backend's .convex.site origin. */
  origin: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createApi({ origin, token, fetch: fetchFn = fetch, timeoutMs = TIMEOUT_MS }: ApiClientOptions) {
  const base = `${origin.replace(/\/+$/, "")}/api/v1`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (token.trim() === "" || origin === "") throw new ApiError("notConfigured");
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ApiError("timeout");
      }
      throw new ApiError("offline");
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // not JSON: handled below
    }
    if (!response.ok) {
      const code =
        typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
          ? (data as { error: string }).error
          : response.status >= 500
            ? "serverError"
            : "badRequest";
      throw new ApiError(code, response.status);
    }
    if (data === null) throw new ApiError("serverError", response.status);
    return data as T;
  }

  const id = (value: string) => encodeURIComponent(value);

  return {
    me: () => call<ApiMe>("GET", "/me"),
    check: (url: string) => call<ApiCheckResult>("GET", `/bookmarks/check?url=${encodeURIComponent(url)}`),
    create: (input: ApiCreateBookmark) => call<ApiCreateResult>("POST", "/bookmarks", input),
    update: (bookmarkId: string, input: ApiUpdateBookmark) =>
      call<ApiBookmark>("PATCH", `/bookmarks/${id(bookmarkId)}`, input),
    remove: (bookmarkId: string) => call<{ ok: true }>("DELETE", `/bookmarks/${id(bookmarkId)}`),
    collections: async () => (await call<{ collections: ApiCollection[] }>("GET", "/collections")).collections,
    tags: async () => (await call<{ tags: ApiTag[] }>("GET", "/tags")).tags,
    search: async (q: string, limit = 20) =>
      (await call<{ bookmarks: ApiBookmark[] }>("GET", `/bookmarks?q=${encodeURIComponent(q)}&limit=${limit}`))
        .bookmarks,
  };
}

export type Api = ReturnType<typeof createApi>;
