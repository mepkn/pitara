import { useState } from "react";
import { ScrollView, View } from "react-native";
import { BookmarkList } from "@/components/bookmark-list";
import { CmpChip } from "@/components/cmp/cmp-chip";
import { ListControls } from "@/components/list-controls";
import { strings } from "@/lib/strings";
import type { View as ViewName } from "@/lib/use-bookmark-list";

const VIEWS = ["all", "unsorted", "favorites", "unread", "trash"] as const satisfies readonly ViewName[];
type HomeView = (typeof VIEWS)[number];

export default function BookmarksScreen() {
  const [view, setView] = useState<HomeView>("all");
  return (
    <View className="bg-background flex-1">
      <View className="border-border flex-row items-center border-b">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-2 px-4 py-2" className="flex-1">
          {VIEWS.map((v) => (
            <CmpChip key={v} label={strings.views[v]} selected={view === v} onPress={() => setView(v)} />
          ))}
        </ScrollView>
        <ListControls sortable={view !== "trash"} />
      </View>
      {/* A new view is a new list: keyed so the previous one's selection and pages go away. */}
      <BookmarkList key={view} scope={{ view }} empty={view} />
    </View>
  );
}
