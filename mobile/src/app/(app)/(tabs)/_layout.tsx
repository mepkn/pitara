import { router, Tabs } from "expo-router";
import { Bookmark, FolderClosed, Plus, Search, Settings, Tag } from "lucide-react-native";
import { View } from "react-native";
import { CmpButton } from "@/components/cmp/cmp-button";
import { strings } from "@/lib/strings";

function HeaderButtons({ add }: { add?: boolean }) {
  return (
    <View className="flex-row">
      {add && <CmpButton variant="ghost" size="icon" icon={Plus} label={strings.bar.add} onPress={() => router.push("/add")} />}
      <CmpButton variant="ghost" size="icon" icon={Settings} label={strings.bar.settings} onPress={() => router.push("/settings")} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerTitleAlign: "left", headerRightContainerStyle: { paddingRight: 4 } }}>
      <Tabs.Screen
        name="index"
        options={{
          headerTitle: strings.appName,
          headerRight: () => <HeaderButtons add />,
          tabBarLabel: strings.tabs.bookmarks,
          tabBarIcon: ({ color, size }) => <Bookmark color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="collections"
        options={{
          headerTitle: strings.tabs.collections,
          headerRight: () => <HeaderButtons />,
          tabBarLabel: strings.tabs.collections,
          tabBarIcon: ({ color, size }) => <FolderClosed color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tags"
        options={{
          headerTitle: strings.tabs.tags,
          headerRight: () => <HeaderButtons />,
          tabBarLabel: strings.tabs.tags,
          tabBarIcon: ({ color, size }) => <Tag color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          headerTitle: strings.tabs.search,
          headerRight: () => <HeaderButtons />,
          tabBarLabel: strings.tabs.search,
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
