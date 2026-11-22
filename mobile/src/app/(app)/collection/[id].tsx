import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { Id } from "@convex/_generated/dataModel";
import { BookmarkList } from "@/components/bookmark-list";
import { CmpText } from "@/components/cmp/cmp-text";
import { ListControls } from "@/components/list-controls";
import { SearchField } from "@/components/search-field";
import { strings } from "@/lib/strings";
import { useCollections } from "@/lib/use-data";
import { useDebounced } from "@/lib/use-debounced";

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const collections = useCollections();
  const [text, setText] = useState("");
  const q = useDebounced(text, 300).trim();
  const name = collections?.byId.get(id)?.name;

  if (collections && name === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <CmpText className="text-center">{strings.collections.notFound}</CmpText>
      </View>
    );
  }
  return (
    <View className="bg-background flex-1">
      <Stack.Screen options={{ headerTitle: name ?? strings.collections.title }} />
      <View className="flex-row items-center">
        <View className="flex-1">
          <SearchField value={text} onChangeText={setText} />
        </View>
        <ListControls />
      </View>
      <BookmarkList scope={{ view: "collection", collectionId: id as Id<"collections"> }} q={q} empty="collection" />
    </View>
  );
}
