import { useState } from "react";
import { FolderInputIcon, StarIcon, StarOffIcon, TagIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TagInput } from "@/components/TagInput";
import { useBulk, type BulkAction } from "@/hooks/use-bulk";
import { useCollections, useTags } from "@/hooks/use-data";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";
import { flattenTree } from "@/lib/tree";

type Props = { selected: Set<string>; total: number; onClear: () => void; onSelectAll: () => void };

export function BulkBar({ selected, total, onClear, onSelectAll }: Props) {
  const runBulk = useBulk();
  const { tree } = useCollections();
  const [tagDialog, setTagDialog] = useState<"addTag" | "removeTag" | null>(null);
  const [busy, setBusy] = useState(false);
  const count = selected.size;
  if (count === 0) return null;

  async function run(action: BulkAction) {
    setBusy(true);
    try {
      const changed = await runBulk([...selected], action);
      toast(action.type === "trash" ? strings.bulk.trashed(changed) : strings.bulk.done(changed));
      onClear();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="toolbar" aria-label={strings.bulk.selected(count)} className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
      <span className="px-2 text-sm font-medium">{strings.bulk.selected(count)}</span>
      {count < total && (
        <Button variant="ghost" size="sm" onClick={onSelectAll}>
          {strings.bulk.selectAll}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={busy} />}>
          <FolderInputIcon /> {strings.bulk.move}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="max-h-72 w-52 overflow-y-auto">
          <DropdownMenuItem onClick={() => void run({ type: "move", collectionId: null })}>{strings.edit.noCollection}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {flattenTree(tree ?? []).map(({ row, depth }) => (
            <DropdownMenuItem key={row._id} className={depth === 1 ? "pl-6" : undefined} onClick={() => void run({ type: "move", collectionId: row._id as Id<"collections"> })}>
              {row.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setTagDialog("addTag")}>
        <TagIcon /> {strings.bulk.addTag}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setTagDialog("removeTag")}>
        <TagIcon /> {strings.bulk.removeTag}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run({ type: "favorite", value: true })}>
        <StarIcon /> {strings.bulk.favorite}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run({ type: "favorite", value: false })}>
        <StarOffIcon /> {strings.bulk.unfavorite}
      </Button>
      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void run({ type: "trash" })}>
        <Trash2Icon /> {strings.bulk.trash}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={strings.bulk.clear} title={strings.bulk.clear} onClick={onClear}>
        <XIcon />
      </Button>
      <TagDialog mode={tagDialog} onClose={() => setTagDialog(null)} onSubmit={(tag) => run({ type: tagDialog!, tag })} />
    </div>
  );
}

function TagDialog({ mode, onClose, onSubmit }: { mode: "addTag" | "removeTag" | null; onClose: () => void; onSubmit: (tag: string) => Promise<void> }) {
  const { tags } = useTags();
  const [value, setValue] = useState<string[]>([]);
  const tag = value[0];
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) {
          setValue([]);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "removeTag" ? strings.bulk.removeTag : strings.bulk.addTag}</DialogTitle>
        </DialogHeader>
        <TagInput value={value} onChange={(next) => setValue(next.slice(-1))} suggestions={(tags ?? []).map((t) => t.name)} autoFocus />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {strings.cancel}
          </Button>
          <Button
            disabled={tag === undefined}
            onClick={() => {
              if (tag === undefined) return;
              void onSubmit(tag).then(() => {
                setValue([]);
                onClose();
              });
            }}
          >
            {mode === "removeTag" ? strings.bulk.removeTag : strings.bulk.addTag}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
