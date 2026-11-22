import { API_ORIGIN, DEFAULT_WEB_URL } from "./config";
import { createApi, type Api } from "./api";
import { ApiError } from "./errors";

// Settings live in chrome.storage.local, never in sync storage (the token must not leave this
// device) and never in logs.

export interface Settings {
  token: string;
  webUrl: string;
  defaultCollectionId: string | null;
}

export const DEFAULT_SETTINGS: Settings = { token: "", webUrl: DEFAULT_WEB_URL, defaultCollectionId: null };

const KEY = "settings";

/** Keeps only http(s) origins; anything else falls back to the default. */
export function cleanWebUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_WEB_URL;
    return url.origin;
  } catch {
    return DEFAULT_WEB_URL;
  }
}

export function normalizeSettings(raw: unknown): Settings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    token: typeof r.token === "string" ? r.token.trim() : "",
    webUrl: typeof r.webUrl === "string" && r.webUrl !== "" ? cleanWebUrl(r.webUrl) : DEFAULT_WEB_URL,
    defaultCollectionId: typeof r.defaultCollectionId === "string" && r.defaultCollectionId !== "" ? r.defaultCollectionId : null,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: normalizeSettings(settings) });
}

export function apiFor(settings: Settings): Api {
  return createApi({ origin: API_ORIGIN, token: settings.token });
}

/** The API client for the stored token; throws `notConfigured` when there is none. */
export async function getApi(): Promise<{ api: Api; settings: Settings }> {
  const settings = await loadSettings();
  if (settings.token === "") throw new ApiError("notConfigured");
  return { api: apiFor(settings), settings };
}
