import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { Id } from "@convex/_generated/dataModel";
import { BookmarkList } from "@/components/bookmark-list";
import { CmpText } from "@/components/cmp/cmp-text";
import { ListControls } from "@/components/list-controls";
import { SearchField } from "@/components/search-field";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";
import { useDebounced } from "@/lib/use-debounced";

export default function TagScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tags = useTags();
  const [text, setText] = useState("");
  const q = useDebounced(text, 300).trim();
  const name = tags?.byId.get(id);

  if (tags && name === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <CmpText className="text-center">{strings.tags.notFound}</CmpText>
      </View>
    );
  }
  return (
    <View className="bg-background flex-1">
      <Stack.Screen options={{ headerTitle: name ? `#${name}` : strings.tags.title }} />
      <View className="flex-row items-center">
        <View className="flex-1">
          <SearchField value={text} onChangeText={setText} />
        </View>
        {/* A tag lists newest-tagged first: the sort doesn't apply. */}
        <ListControls sortable={false} />
      </View>
      <BookmarkList scope={{ view: "all", tagId: id as Id<"tags"> }} q={q} empty="tag" />
    </View>
  );
}
