import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { Loader2Icon, StarIcon, BookmarkIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@shared/limits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { CollectionSelect } from "@/components/CollectionSelect";
import { TagInput } from "@/components/TagInput";
import { useCollections, useTags } from "@/hooks/use-data";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl: string;
  /** The collection of the page the user is on, preselected. */
  defaultCollectionId: string | null;
  /** Opens a bookmark's edit dialog (used when the link was already saved). */
  onExisting: (id: string) => void;
};

export function AddDialog(props: Props) {
  // Remount on every open so the form always starts fresh.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <AddForm {...props} />}
    </Dialog>
  );
}

function AddForm({ onOpenChange, initialUrl, defaultCollectionId, onExisting }: Props) {
  const create = useMutation(api.bookmarks.create);
  const { tree } = useCollections();
  const { tags } = useTags();
  const [url, setUrl] = useState(initialUrl);
  const [note, setNote] = useState("");
  const [collectionId, setCollectionId] = useState<string | null>(defaultCollectionId);
  const [tagList, setTagList] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [unread, setUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await create({
        url: url.trim(),
        note: note.trim() === "" ? undefined : note,
        collectionId: (collectionId ?? undefined) as Id<"collections"> | undefined,
        tags: tagList,
        favorite,
        unread,
      });
      onOpenChange(false);
      if (res.existed) {
        toast.info(strings.add.alreadySaved);
        onExisting(res.id);
      } else {
        toast.success(strings.add.saved);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{strings.add.title}</DialogTitle>
        <DialogDescription>{strings.add.description}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="add-url">{strings.add.url}</Label>
          <Input
            id="add-url"
            type="text"
            inputMode="url"
            autoFocus
            required
            maxLength={LIMITS.urlMax}
            placeholder={strings.add.urlPlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="add-collection">{strings.add.collection}</Label>
            <CollectionSelect id="add-collection" tree={tree ?? []} value={collectionId} onChange={setCollectionId} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="add-tags">{strings.add.tags}</Label>
            <TagInput id="add-tags" value={tagList} onChange={setTagList} suggestions={(tags ?? []).map((t) => t.name)} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="add-note">{strings.add.note}</Label>
          <Textarea id="add-note" rows={2} maxLength={LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Toggle variant="outline" size="sm" pressed={favorite} onPressedChange={setFavorite}>
            <StarIcon /> {strings.add.favorite}
          </Toggle>
          <Toggle variant="outline" size="sm" pressed={unread} onPressedChange={setUnread}>
            <BookmarkIcon /> {strings.add.unread}
          </Toggle>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {strings.cancel}
          </Button>
          <Button type="submit" disabled={busy || url.trim() === ""}>
            {busy && <Loader2Icon className="animate-spin" />}
            {strings.add.submit}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
