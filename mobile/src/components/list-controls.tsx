import { Check, SlidersHorizontal } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpDialog } from "@/components/cmp/cmp-dialog";
import { CmpSegmented } from "@/components/cmp/cmp-segmented";
import { CmpText } from "@/components/cmp/cmp-text";
import { usePreferences, type Layout, type Sort } from "@/lib/preferences";
import { strings } from "@/lib/strings";

const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "list", label: strings.bar.list },
  { value: "grid", label: strings.bar.grid },
  { value: "headlines", label: strings.bar.headlines },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: strings.bar.newest },
  { value: "oldest", label: strings.bar.oldest },
  { value: "title", label: strings.bar.title },
  { value: "domain", label: strings.bar.domain },
];

/** One button that opens the layout (List / Grid / Headlines) and sort choices. Both are remembered per device. */
export function ListControls({ sortable = true }: { sortable?: boolean }) {
  const { layout, setLayout, sort, setSort } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <>
      <CmpButton variant="ghost" size="icon" icon={SlidersHorizontal} label={strings.bar.view} onPress={() => setOpen(true)} />
      <CmpDialog open={open} onOpenChange={setOpen} title={strings.bar.view}>
        <CmpSegmented<Layout> value={layout} options={LAYOUTS} onChange={setLayout} />
        <View>
          <CmpText variant="muted" className="pb-1 pt-2">
            {sortable ? strings.bar.sort : strings.bar.sortFixed}
          </CmpText>
          {sortable &&
            SORTS.map((s) => (
              <CmpButton
                key={s.value}
                variant="ghost"
                className="justify-start"
                icon={sort === s.value ? Check : undefined}
                label={s.label}
                accessibilityState={{ selected: sort === s.value }}
                onPress={() => setSort(s.value)}
              />
            ))}
        </View>
        <View className="items-end">
          <CmpButton variant="ghost" label={strings.done} onPress={() => setOpen(false)} />
        </View>
      </CmpDialog>
    </>
  );
}
