import { getApi } from "./settings";
import { ApiError } from "./errors";
import { isSavableUrl } from "./page";
import { BADGE, forget, lookup, remember, type BadgeView, type CacheMap } from "./saved";

// The toolbar badge: ✓ when the tab's URL is already saved. Answers are cached per tab in
// chrome.storage.session (the service worker can be stopped at any time).

const CACHE_KEY = "savedCache";

// Cache updates are read-modify-write; run them one at a time so tab events don't lose each other's entries.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

async function readCache(): Promise<CacheMap> {
  const stored = await chrome.storage.session.get(CACHE_KEY);
  return (stored[CACHE_KEY] as CacheMap | undefined) ?? {};
}
const writeCache = (map: CacheMap) => chrome.storage.session.set({ [CACHE_KEY]: map });

export async function showBadge(tabId: number, view: BadgeView): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: view.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: view.color });
    await chrome.action.setTitle({ tabId, title: view.title });
  } catch {
    // the tab was closed meanwhile
  }
}

/** Records what we now know about a tab (after a save or remove) and shows it. */
export function noteSaved(tabId: number, url: string, exists: boolean): Promise<void> {
  return serial(async () => {
    await writeCache(remember(await readCache(), tabId, url, exists, Date.now()));
    await showBadge(tabId, exists ? BADGE.saved : BADGE.none);
  });
}

export function forgetTab(tabId: number): Promise<void> {
  return serial(async () => writeCache(forget(await readCache(), tabId)));
}

/** Shows the right badge for a tab, asking the API only when the cache has no answer. */
export function refreshBadge(tab: { id?: number; url?: string }): Promise<void> {
  const { id, url } = tab;
  if (id === undefined) return Promise.resolve();
  if (!isSavableUrl(url)) return showBadge(id, BADGE.none);
  return serial(async () => {
    const cached = lookup(await readCache(), id, url, Date.now());
    if (cached !== undefined) return showBadge(id, cached ? BADGE.saved : BADGE.none);
    try {
      const { api } = await getApi();
      const { exists } = await api.check(url);
      await writeCache(remember(await readCache(), id, url, exists, Date.now()));
      await showBadge(id, exists ? BADGE.saved : BADGE.none);
    } catch (err) {
      // Not configured yet: stay quiet. A bad token is worth a "!"; other failures (offline, rate
      // limit) just leave no badge rather than nagging on every page.
      if (err instanceof ApiError && err.code === "notAuthenticated") await showBadge(id, BADGE.tokenProblem);
      else await showBadge(id, BADGE.none);
    }
  });
}

