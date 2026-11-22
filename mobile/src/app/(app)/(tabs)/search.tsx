import { useState } from "react";
import { View } from "react-native";
import { BookmarkList } from "@/components/bookmark-list";
import { CmpText } from "@/components/cmp/cmp-text";
import { ListControls } from "@/components/list-controls";
import { SearchField } from "@/components/search-field";
import { useDebounced } from "@/lib/use-debounced";
import { strings } from "@/lib/strings";

export default function SearchScreen() {
  const [text, setText] = useState("");
  const q = useDebounced(text, 300).trim();
  return (
    <View className="bg-background flex-1">
      <View className="flex-row items-center">
        <View className="flex-1">
          <SearchField value={text} onChangeText={setText} />
        </View>
        <ListControls sortable={false} />
      </View>
      {q === "" ? (
        <CmpText variant="muted" className="px-8 py-10 text-center">
          {strings.search.hint}
        </CmpText>
      ) : (
        <BookmarkList scope={{ view: "all" }} q={q} empty="search" />
      )}
    </View>
  );
}
