import { useSyncExternalStore } from "react";

/** A tiny pushState router. Routes: /all /unsorted /c/:id /tag/:id /favorites /unread /broken /trash /settings. Search is `?q=`. */
export type Route =
  | { kind: "all" | "unsorted" | "favorites" | "unread" | "broken" | "trash" | "settings" }
  | { kind: "collection"; id: string }
  | { kind: "tag"; id: string };

export interface Location {
  route: Route;
  q: string;
}

const SIMPLE = ["all", "unsorted", "favorites", "unread", "broken", "trash", "settings"] as const;

export function parseLocation(pathname: string, search: string): Location {
  const q = new URLSearchParams(search).get("q") ?? "";
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const kind of SIMPLE) if (clean === `/${kind}`) return { route: { kind }, q };
  const c = /^\/c\/([^/]+)$/.exec(clean);
  if (c?.[1]) return { route: { kind: "collection", id: decodeURIComponent(c[1]) }, q };
  const t = /^\/tag\/([^/]+)$/.exec(clean);
  if (t?.[1]) return { route: { kind: "tag", id: decodeURIComponent(t[1]) }, q };
  return { route: { kind: "all" }, q }; // "/" and unknown paths show everything
}

export function routePath(route: Route): string {
  switch (route.kind) {
    case "collection":
      return `/c/${encodeURIComponent(route.id)}`;
    case "tag":
      return `/tag/${encodeURIComponent(route.id)}`;
    default:
      return `/${route.kind}`;
  }
}

export function buildUrl(route: Route, q = ""): string {
  const base = routePath(route);
  const trimmed = q.trim();
  return trimmed === "" ? base : `${base}?${new URLSearchParams({ q: trimmed }).toString()}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routePath(a) === routePath(b);
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

function emit() {
  listeners.forEach((l) => l());
}

export function navigate(url: string, { replace = false }: { replace?: boolean } = {}) {
  if (url === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => location.pathname + location.search;

/** The current location. `/` is rewritten to `/all`. */
export function useLocation(): Location {
  const raw = useSyncExternalStore(subscribe, snapshot);
  const at = raw.indexOf("?");
  return parseLocation(at === -1 ? raw : raw.slice(0, at), at === -1 ? "" : raw.slice(at));
}
