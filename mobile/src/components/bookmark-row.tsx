import { Image } from "expo-image";
import { Globe, Star, BookOpen, Check } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, View, useColorScheme } from "react-native";
import { CmpText } from "@/components/cmp/cmp-text";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { relativeTime } from "@/lib/format";
import type { Layout } from "@/lib/preferences";
import { strings } from "@/lib/strings";
import { THEME } from "@/lib/theme";
import type { Bookmark } from "@/lib/use-bookmark-list";
import { cn } from "@/lib/utils";

export interface RowProps {
  bookmark: Bookmark;
  layout: Layout;
  /** Tag names for this bookmark, already resolved. */
  tags: string[];
  selecting: boolean;
  selected: boolean;
  onPress: (b: Bookmark) => void;
  onLongPress: (b: Bookmark) => void;
}

function Favicon({ uri, size = 18 }: { uri?: string; size?: number }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  // A favicon that fails to load (many sites have none at /favicon.ico) falls back to the globe.
  const [failed, setFailed] = useState<string>();
  if (!uri || failed === uri) return <Globe size={size} color={THEME[scheme].muted} />;
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: 4 }}
      contentFit="contain"
      recyclingKey={uri}
      onError={() => setFailed(uri)}
    />
  );
}

/** The title to show: the saved one, else the domain while the server is still fetching it. */
export function displayTitle(b: Bookmark): string {
  return b.title.trim() || b.domain || b.url;
}

function Title({ b, lines }: { b: Bookmark; lines: number }) {
  // Pending with no title yet: a skeleton bar instead of the bare address.
  if (b.title.trim() === "" && b.metaStatus === "pending") {
    return <View className="bg-muted my-1 h-4 w-3/5 rounded" accessibilityLabel={strings.list.fetching} />;
  }
  return (
    <CmpText className="text-base font-semibold leading-5" numberOfLines={lines}>
      {displayTitle(b)}
    </CmpText>
  );
}

function Flags({ b }: { b: Bookmark }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return (
    <>
      {b.favorite && <Star size={13} color={THEME[scheme].fill} fill={THEME[scheme].fill} />}
      {b.unread && <BookOpen size={13} color={THEME[scheme].muted} />}
    </>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 3);
  return (
    <View className="flex-row flex-wrap gap-1">
      {shown.map((t) => (
        <View key={t} className="bg-secondary rounded-full px-2 py-0.5">
          <CmpText className="text-secondary-foreground text-xs">#{t}</CmpText>
        </View>
      ))}
      {tags.length > shown.length && <CmpText variant="muted" className="text-xs">+{tags.length - shown.length}</CmpText>}
    </View>
  );
}

function Checkmark({ selected }: { selected: boolean }) {
  return (
    <View
      className={cn(
        "size-6 items-center justify-center rounded-full border",
        selected ? "bg-primary border-primary" : "bg-background/80 border-input",
      )}>
      {selected && <CmpIcon as={Check} size={14} className="text-primary-foreground" />}
    </View>
  );
}

function ListRow({ bookmark: b, tags, selecting, selected, onPress, onLongPress }: RowProps) {
  return (
    <Pressable
      onPress={() => onPress(b)}
      onLongPress={() => onLongPress(b)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={displayTitle(b)}
      accessibilityState={{ selected }}
      className={cn("bg-background active:bg-accent flex-row gap-3 px-4 py-3", selected && "bg-accent")}>
      {selecting && (
        <View className="justify-center">
          <Checkmark selected={selected} />
        </View>
      )}
      <View className="flex-1 gap-1">
        <View className="flex-row items-center gap-2">
          <Favicon uri={b.faviconUrl} />
          <CmpText variant="muted" className="flex-1 text-xs" numberOfLines={1}>
            {b.domain} · {relativeTime(b.createdAt)}
          </CmpText>
          <Flags b={b} />
        </View>
        <Title b={b} lines={2} />
        {b.description !== "" && (
          <CmpText variant="muted" numberOfLines={2}>
            {b.description}
          </CmpText>
        )}
        <Tags tags={tags} />
      </View>
      {b.imageUrl && (
        <Image source={{ uri: b.imageUrl }} style={{ width: 72, height: 72, borderRadius: 8 }} contentFit="cover" recyclingKey={b.imageUrl} />
      )}
    </Pressable>
  );
}

function HeadlineRow({ bookmark: b, selecting, selected, onPress, onLongPress }: RowProps) {
  return (
    <Pressable
      onPress={() => onPress(b)}
      onLongPress={() => onLongPress(b)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={displayTitle(b)}
      accessibilityState={{ selected }}
      className={cn("bg-background active:bg-accent flex-row items-center gap-3 px-4 py-2.5", selected && "bg-accent")}>
      {selecting && <Checkmark selected={selected} />}
      <Favicon uri={b.faviconUrl} />
      <View className="flex-1">
        <Title b={b} lines={1} />
      </View>
      <CmpText variant="muted" className="max-w-[35%] text-xs" numberOfLines={1}>
        {b.domain}
      </CmpText>
      <Flags b={b} />
    </Pressable>
  );
}

function GridCard({ bookmark: b, tags, selecting, selected, onPress, onLongPress }: RowProps) {
  return (
    <Pressable
      onPress={() => onPress(b)}
      onLongPress={() => onLongPress(b)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={displayTitle(b)}
      accessibilityState={{ selected }}
      className={cn(
        "border-border bg-card active:bg-accent m-1.5 flex-1 overflow-hidden rounded-xl border",
        selected && "border-primary",
      )}>
      <View className="bg-muted aspect-[16/10] items-center justify-center">
        {b.imageUrl ? (
          <Image source={{ uri: b.imageUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" recyclingKey={b.imageUrl} />
        ) : (
          <Favicon uri={b.faviconUrl} size={28} />
        )}
        {selecting && (
          <View className="absolute left-2 top-2">
            <Checkmark selected={selected} />
          </View>
        )}
        <View className="absolute right-2 top-2 flex-row gap-1">
          <Flags b={b} />
        </View>
      </View>
      <View className="gap-1 p-2.5">
        <Title b={b} lines={2} />
        <View className="flex-row items-center gap-1.5">
          <Favicon uri={b.faviconUrl} size={12} />
          <CmpText variant="muted" className="flex-1 text-xs" numberOfLines={1}>
            {b.domain}
          </CmpText>
        </View>
        <Tags tags={tags.slice(0, 2)} />
      </View>
    </Pressable>
  );
}

function BookmarkRowBase(props: RowProps) {
  if (props.layout === "grid") return <GridCard {...props} />;
  if (props.layout === "headlines") return <HeadlineRow {...props} />;
  return <ListRow {...props} />;
}

export const BookmarkRow = memo(BookmarkRowBase);
