import { memo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useMutation } from "convex/react";
import { BookmarkIcon, CheckIcon, CopyIcon, GlobeIcon, PencilIcon, RefreshCwIcon, RotateCcwIcon, StarIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { errorMessage } from "@/lib/errors";
import { relativeTime, dateTime } from "@/lib/format";
import type { ViewMode } from "@/lib/prefs";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

export type BookmarkSummary = Omit<Doc<"bookmarks">, "searchText" | "normalizedUrl" | "userId" | "note"> & { hasNote: boolean };

type Props = {
  bookmark: BookmarkSummary;
  mode: ViewMode;
  tagNames: string[];
  inTrash: boolean;
  selected: boolean;
  /** Any bookmark is selected: checkboxes stay visible. */
  selecting: boolean;
  focused: boolean;
  onSelect: (id: string, shift: boolean) => void;
  onEdit: (id: string) => void;
  onFocus: (id: string) => void;
};

function Favicon({ url, className }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <GlobeIcon className={cn("shrink-0 text-muted-foreground", className)} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-sm object-contain", className)}
    />
  );
}

function PreviewImage({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="size-full object-cover"
    />
  );
}

export const BookmarkItem = memo(function BookmarkItem(props: Props) {
  const { bookmark: b, mode, tagNames, inTrash, selected, selecting, focused, onSelect, onEdit, onFocus } = props;
  const toggleFavorite = useMutation(api.bookmarks.toggleFavorite);
  const toggleUnread = useMutation(api.bookmarks.toggleUnread);
  const trash = useMutation(api.bookmarks.trash);
  const restore = useMutation(api.bookmarks.restore);
  const deleteForever = useMutation(api.bookmarks.deleteForever);
  const recheck = useMutation(api.linkCheck.recheck);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `bm:${b._id}`, disabled: inTrash });

  const id = b._id as Id<"bookmarks">;
  const broken = b.linkStatus === "broken";
  const pending = b.metaStatus === "pending" && b.title === "";
  const title = b.title || (pending ? "" : b.domain || b.url);
  const attempt = (action: () => Promise<unknown>, success?: string) =>
    action().then(
      () => success && toast(success),
      (err: unknown) => void toast.error(errorMessage(err)),
    );

  const actions = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 transition-opacity",
        mode === "grid" ? "absolute top-1.5 right-1.5 rounded-lg bg-card/90 p-0.5 shadow-sm backdrop-blur" : "",
        focused ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 max-md:opacity-100",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {inTrash ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label={strings.list.restore} title={strings.list.restore} onClick={() => void attempt(() => restore({ id }), strings.list.restored)}>
            <RotateCcwIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={strings.list.deleteForever} title={strings.list.deleteForever} className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <XIcon />
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="icon-sm" aria-pressed={b.favorite} aria-label={b.favorite ? strings.list.unstar : strings.list.star} title={b.favorite ? strings.list.unstar : strings.list.star} onClick={() => void attempt(() => toggleFavorite({ id }))}>
            <StarIcon className={cn(b.favorite && "fill-primary text-primary")} />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-pressed={b.unread} aria-label={b.unread ? strings.list.markRead : strings.list.markUnread} title={b.unread ? strings.list.markRead : strings.list.markUnread} onClick={() => void attempt(() => toggleUnread({ id }))}>
            <BookmarkIcon className={cn(b.unread && "fill-primary text-primary")} />
          </Button>
          {broken && (
            <Button variant="ghost" size="icon-sm" aria-label={strings.list.recheck} title={strings.list.recheck} onClick={() => void attempt(() => recheck({ id }), strings.list.rechecking)}>
              <RefreshCwIcon />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label={strings.list.copyLink} title={strings.list.copyLink} onClick={() => void navigator.clipboard.writeText(b.url).then(() => toast(strings.list.linkCopied))}>
            <CopyIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={strings.list.edit} title={strings.list.edit} onClick={() => onEdit(b._id)}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={strings.list.trashIt} title={strings.list.trashIt} onClick={() => void attempt(() => trash({ id }), strings.list.moved)}>
            <Trash2Icon />
          </Button>
        </>
      )}
    </div>
  );

  const check = inTrash ? null : (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={strings.list.select}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => onSelect(b._id, e.shiftKey)}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md border border-input bg-background text-primary-foreground transition",
        selected && "border-primary bg-primary",
        mode === "grid" ? "absolute top-1.5 left-1.5 z-10 shadow-sm" : "",
        selected || selecting || focused ? "opacity-100" : "opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
      )}
    >
      {selected && <CheckIcon className="size-3.5" />}
    </button>
  );

  const titleLink = (
    <a
      href={b.url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      className="min-w-0 truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {pending ? <Skeleton className="inline-block h-4 w-48 max-w-full align-middle" /> : title}
    </a>
  );

  const tagBadges = tagNames.length > 0 && (
    <span className="flex min-w-0 flex-wrap gap-1">
      {tagNames.slice(0, 5).map((t) => (
        <Badge key={t} variant="secondary" className="font-normal">
          {t}
        </Badge>
      ))}
      {tagNames.length > 5 && <Badge variant="secondary">+{tagNames.length - 5}</Badge>}
    </span>
  );

  const flags = (
    <>
      {broken && (
        <Badge variant="destructive" className="shrink-0 font-normal" title={strings.list.brokenHint}>
          {strings.list.broken}
        </Badge>
      )}
      {b.favorite && <StarIcon className="size-3.5 shrink-0 fill-primary text-primary" aria-label="Favorite" />}
      {b.unread && <BookmarkIcon className="size-3.5 shrink-0 fill-primary text-primary" aria-label="To read" />}
    </>
  );

  const base = cn(
    "group/item relative rounded-lg border border-transparent outline-none transition-colors",
    selected ? "bg-accent" : "hover:bg-muted/60",
    focused && "border-ring ring-2 ring-ring/40",
    isDragging && "opacity-40",
  );

  const confirm = (
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      title={strings.list.deleteForeverTitle}
      description={strings.list.deleteForeverDescription}
      confirmLabel={strings.list.deleteForever}
      onConfirm={() => void attempt(() => deleteForever({ id }), strings.list.deleted)}
    />
  );

  const dragProps = { ref: setNodeRef, ...attributes, ...listeners, role: "listitem", tabIndex: -1, onMouseDown: () => onFocus(b._id) };

  if (mode === "headlines") {
    return (
      <div {...dragProps} data-bookmark={b._id} className={cn(base, "flex items-center gap-2 px-2 py-1.5 text-sm")}>
        {check}
        <Favicon url={b.faviconUrl} className="size-4" />
        {titleLink}
        {flags}
        <span className="ml-auto hidden shrink-0 truncate text-xs text-muted-foreground sm:block sm:max-w-40">{b.domain}</span>
        {actions}
        {confirm}
      </div>
    );
  }

  if (mode === "grid") {
    return (
      <div {...dragProps} data-bookmark={b._id} className={cn(base, "flex flex-col overflow-hidden border-border bg-card text-sm shadow-xs")}>
        {check}
        {actions}
        <div className="grid aspect-[16/9] place-items-center overflow-hidden bg-muted">
          {b.imageUrl ? <PreviewImage url={b.imageUrl} /> : <Favicon url={b.faviconUrl} className="size-8" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Favicon url={b.faviconUrl} className="size-4" />
            {titleLink}
            {flags}
          </div>
          <span className="truncate text-xs text-muted-foreground">{b.domain}</span>
          {b.description && <p className="line-clamp-2 text-muted-foreground">{b.description}</p>}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            {tagBadges}
            <span className="ml-auto text-xs text-muted-foreground" title={dateTime(b.createdAt)}>
              {relativeTime(b.createdAt)}
            </span>
          </div>
        </div>
        {confirm}
      </div>
    );
  }

  return (
    <div {...dragProps} data-bookmark={b._id} className={cn(base, "flex items-start gap-3 px-2 py-2.5 text-sm")}>
      <div className="mt-0.5 flex items-center gap-2">
        {check}
        <Favicon url={b.faviconUrl} className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {titleLink}
          {flags}
          <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block sm:max-w-48">{b.domain}</span>
        </div>
        {b.description && <p className="line-clamp-1 text-muted-foreground">{b.description}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {tagBadges}
          <span className="text-xs text-muted-foreground" title={dateTime(b.createdAt)}>
            {relativeTime(b.createdAt)}
          </span>
        </div>
      </div>
      {actions}
      {confirm}
    </div>
  );
});
