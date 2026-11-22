import { FolderInput, Star, Tag, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { normalizeTagName, isValidTagName } from "@shared/tags";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpDialog } from "@/components/cmp/cmp-dialog";
import { CmpConfirmDialog } from "@/components/cmp/cmp-confirm-dialog";
import { CmpInput } from "@/components/cmp/cmp-field";
import { CmpText } from "@/components/cmp/cmp-text";
import { CollectionPicker } from "@/components/collection-picker";
import type { BulkAction } from "@/lib/actions";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";

interface Props {
  count: number;
  onCancel: () => void;
  /** Runs one bulk action; resolves true if it worked (the selection is then cleared). */
  onRun: (action: BulkAction) => Promise<boolean>;
}

function TagDialog({ open, onOpenChange, onRun }: { open: boolean; onOpenChange: (o: boolean) => void; onRun: Props["onRun"] }) {
  const [text, setText] = useState("");
  const tags = useTags();
  const name = normalizeTagName(text);
  const valid = isValidTagName(name);
  async function run(type: "addTag" | "removeTag") {
    if (await onRun({ type, tag: name })) onOpenChange(false);
  }
  const suggestions = (tags?.rows ?? []).filter((t) => name === "" || t.name.includes(name)).slice(0, 8);
  return (
    <CmpDialog open={open} onOpenChange={onOpenChange} title={strings.bulk.tagName}>
      <CmpInput value={text} onChangeText={setText} placeholder={strings.bulk.tagPlaceholder} autoCapitalize="none" autoCorrect={false} autoFocus />
      {suggestions.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {suggestions.map((t) => (
            <Pressable key={t._id} onPress={() => setText(t.name)} accessibilityRole="button" className="border-border active:bg-accent rounded-full border px-3 py-1">
              <CmpText className="text-sm">#{t.name}</CmpText>
            </Pressable>
          ))}
        </View>
      )}
      <View className="flex-row justify-end gap-2">
        <CmpButton variant="outline" label={strings.bulk.removeTag} disabled={!valid} onPress={() => void run("removeTag")} />
        <CmpButton label={strings.bulk.addTag} disabled={!valid} onPress={() => void run("addTag")} />
      </View>
    </CmpDialog>
  );
}

/** The floating action bar shown while bookmarks are selected. */
export function BulkBar({ count, onCancel, onRun }: Props) {
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const b = strings.bulk;
  return (
    <View className="border-border bg-card absolute inset-x-3 bottom-4 flex-row items-center gap-1 rounded-2xl border px-2 py-1.5 shadow-lg shadow-black/20">
      <CmpButton variant="ghost" size="icon" icon={X} label={b.cancel} onPress={onCancel} />
      <CmpText className="flex-1 font-semibold">{b.selected(count)}</CmpText>
      <CmpButton variant="ghost" size="icon" icon={FolderInput} label={b.move} onPress={() => setMoving(true)} />
      <CmpButton variant="ghost" size="icon" icon={Star} label={b.favorite} onPress={() => void onRun({ type: "favorite", value: true })} />
      <CmpButton variant="ghost" size="icon" icon={Tag} label={b.addTag} onPress={() => setTagging(true)} />
      <CmpButton variant="ghost" size="icon" icon={Trash2} tone="destructive" label={b.trash} onPress={() => setTrashing(true)} />
      <CollectionPicker open={moving} onOpenChange={setMoving} value={null} title={b.move} onPick={(id) => void onRun({ type: "move", collectionId: id })} />
      {tagging && <TagDialog open={tagging} onOpenChange={setTagging} onRun={onRun} />}
      <CmpConfirmDialog
        open={trashing}
        onOpenChange={setTrashing}
        title={b.trashTitle(count)}
        confirmLabel={b.trash}
        cancelLabel={strings.cancel}
        destructive
        onConfirm={() => void onRun({ type: "trash" })}
      />
    </View>
  );
}
