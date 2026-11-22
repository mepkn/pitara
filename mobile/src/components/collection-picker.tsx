import { Check, Inbox } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpDialog } from "@/components/cmp/cmp-dialog";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpText } from "@/components/cmp/cmp-text";
import type { CollectionId } from "@/lib/use-data";
import { useCollections } from "@/lib/use-data";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current choice; null = Unsorted. */
  value: CollectionId | null;
  onPick: (id: CollectionId | null) => void;
  title?: string;
  /** Offer "Unsorted" (default true). */
  allowNone?: boolean;
  noneLabel?: string;
  /** Collections that cannot be chosen (e.g. the one being moved, or any with children). */
  disabled?: (id: string) => boolean;
}

function Item({ label, depth, selected, disabled, onPress, icon }: { label: string; depth: number; selected: boolean; disabled?: boolean; onPress: () => void; icon?: boolean }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      className={cn("active:bg-accent flex-row items-center gap-2 rounded-md px-3 py-3", disabled && "opacity-40")}
      style={{ paddingLeft: 12 + depth * 20 }}>
      {icon && <CmpIcon as={Inbox} size={16} className="text-muted-foreground" />}
      <CmpText className="flex-1" numberOfLines={1}>
        {label}
      </CmpText>
      {selected && <CmpIcon as={Check} size={16} className="text-brand" />}
    </Pressable>
  );
}

/** A dialog listing the collection tree (two levels) to choose one from. */
export function CollectionPicker({ open, onOpenChange, value, onPick, title, allowNone = true, noneLabel, disabled }: Props) {
  const data = useCollections();
  const pick = (id: CollectionId | null) => {
    onPick(id);
    onOpenChange(false);
  };
  return (
    <CmpDialog open={open} onOpenChange={onOpenChange} title={title ?? strings.collections.pick}>
      <ScrollView className="max-h-96" keyboardShouldPersistTaps="handled">
        {allowNone && (
          <Item label={noneLabel ?? strings.form.unsorted} depth={0} icon selected={value === null} onPress={() => pick(null)} />
        )}
        {data?.flat.map(({ row, depth }) => (
          <Item
            key={row._id}
            label={row.name}
            depth={depth}
            selected={value === row._id}
            disabled={disabled?.(row._id)}
            onPress={() => pick(row._id as CollectionId)}
          />
        ))}
        {data && data.flat.length === 0 && !allowNone && (
          <CmpText variant="muted" className="p-3">
            {strings.collections.empty}
          </CmpText>
        )}
      </ScrollView>
      <View className="items-end">
        <CmpButton variant="ghost" label={strings.cancel} onPress={() => onOpenChange(false)} />
      </View>
    </CmpDialog>
  );
}
