import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2Icon, RotateCcwIcon, StarIcon, BookmarkIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@shared/limits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { CollectionSelect } from "@/components/CollectionSelect";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TagInput } from "@/components/TagInput";
import { useCollections, useTags } from "@/hooks/use-data";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";

type Props = { id: string | null; onClose: () => void };

export function EditDialog({ id, onClose }: Props) {
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      {id !== null && (
        <DialogContent className="sm:max-w-lg">
          <ErrorBoundary
            key={id}
            fallback={(error) => (
              <>
                <DialogHeader>
                  <DialogTitle>{strings.edit.title}</DialogTitle>
                  <DialogDescription>{errorMessage(error)}</DialogDescription>
                </DialogHeader>
              </>
            )}
          >
            <Loader id={id} onClose={onClose} />
          </ErrorBoundary>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Loader({ id, onClose }: { id: string; onClose: () => void }) {
  const bookmark = useQuery(api.bookmarks.get, { id: id as Id<"bookmarks"> });
  const { tags, names } = useTags();
  // Wait for the tag list too: tags are written by name, so saving before it loads would drop them.
  if (bookmark === undefined || tags === undefined) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{strings.edit.title}</DialogTitle>
          <DialogDescription className="sr-only">{strings.list.loading}</DialogDescription>
        </DialogHeader>
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  // Form state starts from the loaded bookmark; the key restarts it for another bookmark.
  return <EditForm key={bookmark._id} bookmark={bookmark} tagNames={bookmark.tagIds.map((t) => names.get(t) ?? "").filter(Boolean)} onClose={onClose} />;
}

type Full = Omit<Doc<"bookmarks">, "searchText" | "normalizedUrl" | "userId">;

function EditForm({ bookmark, tagNames, onClose }: { bookmark: Full; tagNames: string[]; onClose: () => void }) {
  const update = useMutation(api.bookmarks.update);
  const trash = useMutation(api.bookmarks.trash);
  const restore = useMutation(api.bookmarks.restore);
  const { tree } = useCollections();
  const { tags } = useTags();
  const inTrash = bookmark.deletedAt !== undefined;

  const [url, setUrl] = useState(bookmark.url);
  const [title, setTitle] = useState(bookmark.title);
  const [description, setDescription] = useState(bookmark.description);
  const [note, setNote] = useState(bookmark.note);
  const [collectionId, setCollectionId] = useState<string | null>(bookmark.collectionId ?? null);
  const [tagList, setTagList] = useState(tagNames);
  const [favorite, setFavorite] = useState(bookmark.favorite);
  const [unread, setUnread] = useState(bookmark.unread);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      done?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(
      () =>
        update({
          id: bookmark._id,
          url: url.trim() === bookmark.url ? undefined : url.trim(),
          title,
          description,
          note,
          collectionId: collectionId as Id<"collections"> | null,
          tags: tagList,
          favorite,
          unread,
        }),
      () => {
        toast.success(strings.edit.saved);
        onClose();
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{strings.edit.title}</DialogTitle>
        <DialogDescription className={inTrash || bookmark.metaStatus !== "done" ? undefined : "sr-only"}>
          {inTrash ? strings.edit.trashedReadonly : bookmark.metaStatus === "pending" ? strings.edit.metaPending : bookmark.metaStatus === "failed" ? strings.edit.metaFailed : bookmark.domain}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-0.5">
        <fieldset disabled={inTrash || busy} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <div className="grid gap-2">
            <Label htmlFor="edit-url">{strings.edit.url}</Label>
            <Input id="edit-url" maxLength={LIMITS.urlMax} value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-title">{strings.edit.titleField}</Label>
            <Input id="edit-title" maxLength={LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-description">{strings.edit.description}</Label>
            <Textarea id="edit-description" rows={3} maxLength={LIMITS.descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-note">{strings.edit.note}</Label>
            <Textarea id="edit-note" rows={3} maxLength={LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-collection">{strings.edit.collection}</Label>
              <CollectionSelect id="edit-collection" tree={tree ?? []} value={collectionId} onChange={setCollectionId} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-tags">{strings.edit.tags}</Label>
              <TagInput id="edit-tags" value={tagList} onChange={setTagList} suggestions={(tags ?? []).map((t) => t.name)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Toggle variant="outline" size="sm" pressed={favorite} onPressedChange={setFavorite}>
              <StarIcon /> {strings.edit.favorite}
            </Toggle>
            <Toggle variant="outline" size="sm" pressed={unread} onPressedChange={setUnread}>
              <BookmarkIcon /> {strings.edit.unread}
            </Toggle>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="sm:justify-between">
          {inTrash ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => restore({ id: bookmark._id }), () => { toast.success(strings.list.restored); onClose(); })}
            >
              <RotateCcwIcon /> {strings.list.restore}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void run(() => trash({ id: bookmark._id }), () => { toast(strings.list.moved); onClose(); })}
            >
              <Trash2Icon /> {strings.list.trashIt}
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {strings.cancel}
            </Button>
            {!inTrash && (
              <Button type="submit" disabled={busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                {strings.save}
              </Button>
            )}
          </div>
        </DialogFooter>
      </form>
    </>
  );
}
