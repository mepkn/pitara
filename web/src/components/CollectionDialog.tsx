import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { Loader2Icon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@shared/limits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { navigate } from "@/lib/router";
import { strings } from "@/lib/strings";

export type CollectionDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; id: string; name: string }
  | null;

export function CollectionDialog({ state, onClose }: { state: CollectionDialogState; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {state && <Form state={state} onClose={onClose} />}
    </Dialog>
  );
}

function Form({ state, onClose }: { state: NonNullable<CollectionDialogState>; onClose: () => void }) {
  const create = useMutation(api.collections.create);
  const rename = useMutation(api.collections.rename);
  const [name, setName] = useState(state.mode === "rename" ? state.name : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (state.mode === "create") {
        const id = await create({ name, parentId: (state.parentId ?? undefined) as Id<"collections"> | undefined });
        navigate(`/c/${id}`);
      } else {
        await rename({ id: state.id as Id<"collections">, name });
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = state.mode === "rename" ? strings.nav.renameCollection : state.parentId ? strings.nav.newSubcollection : strings.nav.newCollection;
  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          autoFocus
          required
          aria-label={strings.nav.collectionName}
          placeholder={strings.nav.collectionName}
          maxLength={LIMITS.collectionNameMax}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {strings.cancel}
          </Button>
          <Button type="submit" disabled={busy || name.trim() === ""}>
            {busy && <Loader2Icon className="animate-spin" />}
            {state.mode === "rename" ? strings.rename : strings.save}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
