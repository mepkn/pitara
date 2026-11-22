import { useCallback, useEffect, useState } from "react";
import type { ApiBookmark, ApiCollection, ApiTag } from "@shared/types";
import { noteSaved } from "@/lib/badge";
import { errorMessage, isTokenProblem } from "@/lib/errors";
import { isSavableUrl } from "@/lib/page";
import { getApi, loadSettings } from "@/lib/settings";
import { SaveForm } from "./SaveForm";
import { SearchTab } from "./SearchTab";

interface TabInfo {
  id: number | undefined;
  url: string;
  title: string;
}

type Load =
  | { state: "loading" }
  | { state: "setup" }
  | { state: "ready"; tab: TabInfo | null; existing: ApiBookmark | null; collections: ApiCollection[]; tags: ApiTag[]; defaultCollectionId: string | null }
  | { state: "error"; message: string; token: boolean };

export function openOptions() {
  void chrome.runtime.openOptionsPage();
}

export function Popup() {
  const [tab, setTab] = useState<"save" | "search">("save");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await loadSettings();
      if (settings.token === "") return !cancelled && setLoad({ state: "setup" });
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const info: TabInfo | null =
        active && isSavableUrl(active.url) ? { id: active.id, url: active.url, title: active.title ?? "" } : null;
      const { api } = await getApi();
      // The pickers are nice to have; only the check and a valid token matter for showing the form.
      const [collections, tags, check] = await Promise.all([
        api.collections().catch(() => [] as ApiCollection[]),
        api.tags().catch(() => [] as ApiTag[]),
        info ? api.check(info.url) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setLoad({
        state: "ready", tab: info, existing: check?.exists ? (check.bookmark ?? null) : null,
        collections, tags, defaultCollectionId: settings.defaultCollectionId,
      });
      if (info?.id !== undefined && check) void noteSaved(info.id, info.url, check.exists);
    })().catch((err) => {
      if (!cancelled) setLoad({ state: "error", message: errorMessage(err), token: isTokenProblem(err) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const removed = useCallback(() => {
    setLoad((l) => (l.state === "ready" ? { ...l, existing: null } : l));
  }, []);

  return (
    <>
      <div className="bar">
        <span className="brand">
          <img src="favicon.svg" alt="" />
          Pitara
        </span>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "save"} onClick={() => setTab("save")}>Save</button>
          <button role="tab" aria-selected={tab === "search"} onClick={() => setTab("search")}>Search</button>
        </div>
      </div>
      <div className="body">
        {load.state === "loading" && <p className="muted">Loading…</p>}
        {load.state === "setup" && (
          <div className="notice">
            <p>Add your API token to start saving.</p>
            <button className="primary" onClick={openOptions}>Open options</button>
          </div>
        )}
        {load.state === "error" && (
          <div>
            <p className="error">{load.message}</p>
            {load.token && <button onClick={openOptions}>Open options</button>}
          </div>
        )}
        {load.state === "ready" && tab === "save" &&
          (load.tab ? (
            <SaveForm
              tab={load.tab}
              existing={load.existing}
              collections={load.collections}
              tags={load.tags}
              defaultCollectionId={load.defaultCollectionId}
              onRemoved={removed}
            />
          ) : (
            <p className="muted">This page can't be saved. Open a regular web page (http or https), or use Search.</p>
          ))}
        {load.state === "ready" && tab === "search" && <SearchTab />}
      </div>
    </>
  );
}
