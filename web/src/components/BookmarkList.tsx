import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookmarkItem } from "@/components/BookmarkItem";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useBookmarkList } from "@/hooks/use-bookmark-list";
import { useTags } from "@/hooks/use-data";
import { isEditableTarget } from "@/lib/editable";
import { errorMessage } from "@/lib/errors";
import type { Sort, ViewMode } from "@/lib/prefs";
import type { Route } from "@/lib/router";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

type Props = {
  route: Route;
  q: string;
  sort: Sort;
  mode: ViewMode;
  selected: Set<string>;
  onIdsChange: (ids: string[]) => void;
  onToggleSelect: (id: string, shift: boolean) => void;
  onEdit: (id: string) => void;
};

function emptyText(route: Route, searching: boolean): string {
  if (searching) return strings.list.empty.search;
  return strings.list.empty[route.kind === "settings" ? "all" : route.kind];
}

export function BookmarkList({ route, q, sort, mode, selected, onIdsChange, onToggleSelect, onEdit }: Props) {
  const { results, status, sentinel, searching, loadMore } = useBookmarkList(route, q, sort);
  const { names } = useTags();
  const toggleFavorite = useMutation(api.bookmarks.toggleFavorite);
  const trash = useMutation(api.bookmarks.trash);
  const emptyTrash = useMutation(api.bookmarks.emptyTrash);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const inTrash = route.kind === "trash";

  const ids = useMemo(() => results.map((r) => r._id as string), [results]);
  useEffect(() => onIdsChange(ids), [ids, onIdsChange]);
  // A bookmark that left the list (trashed, moved) can't stay focused.
  const focused = focusedId !== null && ids.includes(focusedId) ? focusedId : null;

  // j/k move, Enter opens, e edits, s stars, Delete trashes. Single keys never fire while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      const at = focused === null ? -1 : ids.indexOf(focused);
      const move = (to: number) => {
        const id = ids[Math.max(0, Math.min(ids.length - 1, to))];
        if (id === undefined) return;
        setFocusedId(id);
        document.querySelector(`[data-bookmark="${id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const current = focused !== null ? results.find((r) => r._id === focused) : undefined;
      if (e.key === "j") move(at + 1);
      else if (e.key === "k") move(at === -1 ? 0 : at - 1);
      else if (current && e.key === "Enter") window.open(current.url, "_blank", "noopener,noreferrer");
      else if (current && !inTrash && e.key === "e") onEdit(current._id);
      else if (current && !inTrash && e.key === "s") void toggleFavorite({ id: current._id as Id<"bookmarks"> }).catch((err: unknown) => toast.error(errorMessage(err)));
      else if (current && !inTrash && (e.key === "Delete" || e.key === "Backspace")) {
        void trash({ id: current._id as Id<"bookmarks"> }).then(
          () => toast(strings.list.moved),
          (err: unknown) => toast.error(errorMessage(err)),
        );
        move(at + 1 < ids.length ? at : at - 1);
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused, ids, results, inTrash, onEdit, toggleFavorite, trash]);

  if (status === "LoadingFirstPage") return <ListSkeleton mode={mode} />;

  const loading = status === "LoadingMore" || status === "CanLoadMore";
  return (
    <div className="flex flex-col gap-3">
      {searching && <p className="text-sm text-muted-foreground">{strings.list.searchResults(q.trim())}</p>}
      {inTrash && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <span>{strings.list.trashHint}</span>
          {results.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setConfirmEmpty(true)}>
              {strings.list.emptyTrash}
            </Button>
          )}
        </div>
      )}
      {results.length === 0 && status === "Exhausted" ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{emptyText(route, searching)}</p>
      ) : (
        <div
          role="list"
          className={cn(
            mode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" : "flex flex-col",
            mode === "list" && "divide-y divide-border/50",
          )}
        >
          {results.map((b) => (
            <BookmarkItem
              key={b._id}
              bookmark={b}
              mode={mode}
              tagNames={b.tagIds.map((t) => names.get(t)).filter((n): n is string => n !== undefined)}
              inTrash={inTrash}
              selected={selected.has(b._id)}
              selecting={selected.size > 0}
              focused={focused === b._id}
              onSelect={onToggleSelect}
              onEdit={onEdit}
              onFocus={setFocusedId}
            />
          ))}
        </div>
      )}
      {loading && (
        <div ref={sentinel} className="flex justify-center py-4">
          {status === "LoadingMore" ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
              {strings.loadMore}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title={strings.list.emptyTrashTitle}
        description={strings.list.emptyTrashDescription}
        confirmLabel={strings.list.emptyTrash}
        onConfirm={() =>
          void emptyTrash().then(
            () => toast(strings.list.trashEmptied),
            (err: unknown) => toast.error(errorMessage(err)),
          )
        }
      />
    </div>
  );
}

function ListSkeleton({ mode }: { mode: ViewMode }) {
  const n = mode === "grid" ? 8 : 6;
  return (
    <div className={mode === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" : "flex flex-col gap-2"}>
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className={mode === "grid" ? "h-56" : mode === "list" ? "h-16" : "h-8"} />
      ))}
    </div>
  );
}
