import { storage } from "./storage";

export const VIEW_MODES = ["list", "grid", "headlines"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];
export const SORTS = ["newest", "oldest", "title", "domain"] as const;
export type Sort = (typeof SORTS)[number];

export function readViewMode(): ViewMode {
  const v = storage.get("pitara.view");
  return VIEW_MODES.find((m) => m === v) ?? "list";
}
export function readSort(): Sort {
  const v = storage.get("pitara.sort");
  return SORTS.find((m) => m === v) ?? "newest";
}
export function saveViewMode(v: ViewMode) {
  storage.set("pitara.view", v);
}
export function saveSort(s: Sort) {
  storage.set("pitara.sort", s);
}
