import { refreshBadge, forgetTab, showBadge, noteSaved } from "@/lib/badge";
import { ApiError, errorMessage } from "@/lib/errors";
import { isSavableUrl, usefulTitle } from "@/lib/page";
import { BADGE, failedBadge } from "@/lib/saved";
import { getApi } from "@/lib/settings";

// Service worker: toolbar badge, context-menu quick save. No content scripts, no page access:
// only the active tab's URL and title (activeTab) and the link the user right-clicked.

const MENU_LINK = "save-link";
const MENU_PAGE = "save-page";
const RESTORE_AFTER_MS = 3000;

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_LINK, title: "Save link to Pitara", contexts: ["link"] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Save page to Pitara", contexts: ["page"] });
  });
}

async function quickSave(url: string, title: string | undefined, tab: chrome.tabs.Tab | undefined, isPage: boolean) {
  const tabId = tab?.id;
  try {
    if (!isSavableUrl(url)) throw new ApiError("invalidUrl");
    const { api, settings } = await getApi();
    const body = { url, ...(title ? { title } : {}) };
    let result;
    try {
      result = await api.create({ ...body, ...(settings.defaultCollectionId ? { collectionId: settings.defaultCollectionId } : {}) });
    } catch (err) {
      // The default collection may have been deleted: save to Unsorted instead of failing.
      if (settings.defaultCollectionId && err instanceof ApiError && err.code === "notFound") result = await api.create(body);
      else throw err;
    }
    if (tabId === undefined) return;
    if (isPage) {
      await noteSaved(tabId, url, true);
      await showBadge(tabId, result.existed ? BADGE.saved : BADGE.justSaved);
    } else {
      await showBadge(tabId, { ...BADGE.linkSaved, title: result.existed ? "Pitara: link was already saved" : BADGE.linkSaved.title });
      setTimeout(() => void refreshBadge(tab ?? {}), RESTORE_AFTER_MS);
    }
  } catch (err) {
    if (tabId === undefined) return;
    await showBadge(tabId, failedBadge(errorMessage(err)));
    setTimeout(() => void refreshBadge(tab ?? {}), 6000);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
  void chrome.tabs.query({ active: true }).then((tabs) => tabs.forEach((t) => void refreshBadge(t)));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_LINK && info.linkUrl) void quickSave(info.linkUrl, undefined, tab, false);
  else if (info.menuItemId === MENU_PAGE) {
    const url = info.pageUrl ?? tab?.url ?? "";
    void quickSave(url, usefulTitle(tab?.title, url), tab, true);
  }
});

chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (change.status === "complete" || change.url) void refreshBadge(tab);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs.get(tabId).then(refreshBadge, () => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId));

// A new token in the options page: re-check the current tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    void chrome.tabs.query({ active: true }).then((tabs) => tabs.forEach((t) => void refreshBadge(t)));
  }
});
