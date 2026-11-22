import { router } from "expo-router";
import { Star, Trash2, RotateCcw } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Id } from "@convex/_generated/dataModel";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpConfirmDialog } from "@/components/cmp/cmp-confirm-dialog";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpText } from "@/components/cmp/cmp-text";
import { BookmarkMenu, type MenuAction } from "@/components/bookmark-menu";
import { BookmarkRow } from "@/components/bookmark-row";
import { BulkBar } from "@/components/bulk-bar";
import { CollectionPicker } from "@/components/collection-picker";
import { useBookmarkActions, type BulkAction } from "@/lib/actions";
import { usePreferences } from "@/lib/preferences";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";
import { useBookmarkList, type Bookmark, type Scope } from "@/lib/use-bookmark-list";

interface Props {
  scope: Scope;
  /** Search text; empty = the plain list. */
  q?: string;
  empty: keyof typeof strings.list.empty;
  /** Shown above the first row (not in selection mode). */
  header?: ReactElement | null;
  /** Called when the selection starts or ends, so a screen can hide its own floating button. */
  onSelecting?: (selecting: boolean) => void;
}

function SwipeAction({ side, trashView }: { side: "left" | "right"; trashView: boolean }) {
  const left = side === "left";
  return (
    <View className={`flex-1 justify-center px-6 ${left ? "bg-primary items-start" : trashView ? "bg-secondary items-end" : "bg-destructive items-end"}`}>
      <CmpIcon as={left ? (trashView ? RotateCcw : Star) : Trash2} size={22} className={left ? "text-primary-foreground" : trashView ? "text-foreground" : "text-white"} />
    </View>
  );
}

/** Swipe right to star (restore in the trash), left to trash. The row springs back after the action. */
function SwipeRow({
  trashView,
  onStarOrRestore,
  onTrash,
  children,
}: {
  trashView: boolean;
  onStarOrRestore: () => void;
  onTrash: () => void;
  children: ReactNode;
}) {
  const ref = useRef<ComponentRef<typeof ReanimatedSwipeable>>(null);
  return (
    <ReanimatedSwipeable
      ref={ref}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => <SwipeAction side="left" trashView={trashView} />}
      renderRightActions={() => (trashView ? null : <SwipeAction side="right" trashView={false} />)}
      onSwipeableOpen={(direction) => {
        ref.current?.close();
        // `direction` is the way the row was swiped: right opens the left panel (star / restore).
        if (direction === "right") onStarOrRestore();
        else if (!trashView) onTrash();
      }}>
      {children}
    </ReanimatedSwipeable>
  );
}

/**
 * A paginated, searchable list of bookmarks with swipe actions, a long-press menu and bulk
 * selection. Pull down to refresh: queries are live, so this restarts the list from its first page.
 */
export function BookmarkList(props: Props) {
  const [run, setRun] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    setRun((n) => n + 1);
    setTimeout(() => setRefreshing(false), 700);
  }, []);
  return <BookmarkListBody key={run} {...props} refreshing={refreshing} onRefresh={refresh} />;
}

function BookmarkListBody({
  scope,
  q = "",
  empty,
  header,
  onSelecting,
  refreshing,
  onRefresh,
}: Props & { refreshing: boolean; onRefresh: () => void }) {
  const { layout, sort } = usePreferences();
  const list = useBookmarkList(scope, q, sort);
  const tags = useTags();
  const actions = useBookmarkActions();
  const trashView = scope.view === "trash";

  const [menu, setMenu] = useState<Bookmark>();
  const [moving, setMoving] = useState<Bookmark>();
  const [deleting, setDeleting] = useState<Bookmark>();
  const [emptying, setEmptying] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selecting = selected.size > 0;
  // Selection mode is "something is ticked": the menu's "Select" ticks the row it came from,
  // and un-ticking the last one leaves the mode.
  const setSelection = useCallback(
    (next: ReadonlySet<string>) => {
      setSelected(next);
      onSelecting?.(next.size > 0);
    },
    [onSelecting],
  );
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (!next.delete(id)) next.add(id);
      setSelection(next);
    },
    [selected, setSelection],
  );

  const onPress = useCallback(
    (b: Bookmark) => {
      if (selecting) toggle(b._id);
      else void actions.open(b.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selecting, toggle, actions.open],
  );
  const onLongPress = useCallback((b: Bookmark) => (selecting ? toggle(b._id) : setMenu(b)), [selecting, toggle]);

  function handleMenu(action: MenuAction, b: Bookmark) {
    setMenu(undefined);
    switch (action) {
      case "open":
        void actions.open(b.url);
        break;
      case "edit":
        router.push({ pathname: "/edit/[id]", params: { id: b._id } });
        break;
      case "select":
        setSelection(new Set([b._id]));
        break;
      case "favorite":
        void actions.toggleFavorite(b._id);
        break;
      case "unread":
        void actions.toggleUnread(b._id);
        break;
      case "move":
        setMoving(b);
        break;
      case "copy":
        void actions.copyLink(b.url);
        break;
      case "share":
        void actions.share(b.url, b.title);
        break;
      case "trash":
        void actions.trash(b._id);
        break;
      case "restore":
        void actions.restore(b._id);
        break;
      case "deleteForever":
        setDeleting(b);
        break;
    }
  }

  async function runBulk(action: BulkAction): Promise<boolean> {
    const ok = await actions.bulk([...selected] as Id<"bookmarks">[], action);
    if (ok) setSelection(new Set());
    return ok;
  }

  const tagNames = useCallback(
    (b: Bookmark) => (tags ? b.tagIds.map((id) => tags.byId.get(id)).filter((n): n is string => n !== undefined) : []),
    [tags],
  );

  const renderItem = useCallback(
    ({ item }: { item: Bookmark }) => {
      const row = (
        <BookmarkRow
          bookmark={item}
          layout={layout}
          tags={tagNames(item)}
          selecting={selecting}
          selected={selected.has(item._id)}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      );
      if (layout === "grid" || selecting) return row;
      return (
        <SwipeRow
          trashView={trashView}
          onStarOrRestore={() => void (trashView ? actions.restore(item._id) : actions.toggleFavorite(item._id))}
          onTrash={() => void actions.trash(item._id)}>
          {row}
        </SwipeRow>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, tagNames, selecting, selected, onPress, onLongPress, trashView, actions.restore, actions.toggleFavorite, actions.trash],
  );

  const listHeader = useMemo(() => {
    if (selecting) return null;
    return (
      <View>
        {header}
        {trashView && !list.searching && (
          <View className="border-border flex-row items-center gap-3 border-b px-4 py-2">
            <CmpText variant="muted" className="flex-1 text-xs">
              {strings.list.trashHint}
            </CmpText>
            {list.results.length > 0 && (
              <CmpButton size="sm" variant="outline" tone="destructive" label={strings.list.emptyTrash} onPress={() => setEmptying(true)} />
            )}
          </View>
        )}
      </View>
    );
  }, [header, selecting, trashView, list.searching, list.results.length]);

  return (
    <View className="bg-background flex-1">
      <FlatList
        // numColumns can't change on a mounted list.
        key={layout === "grid" ? "grid" : "rows"}
        data={list.results}
        keyExtractor={(b) => b._id}
        numColumns={layout === "grid" ? 2 : 1}
        renderItem={renderItem}
        extraData={selected}
        ItemSeparatorComponent={layout === "grid" ? null : () => <View className="bg-border h-hairline" />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          list.loading ? (
            <View className="items-center py-16">
              <ActivityIndicator />
            </View>
          ) : list.canLoadMore || list.loadingMore ? null : (
            <CmpText variant="muted" className="px-8 py-16 text-center">
              {list.searching ? strings.list.empty.search : strings.list.empty[empty]}
            </CmpText>
          )
        }
        ListFooterComponent={list.loadingMore ? <ActivityIndicator className="py-4" /> : null}
        contentContainerClassName={layout === "grid" ? "p-1.5 pb-28" : "pb-28"}
        onEndReachedThreshold={0.6}
        onEndReached={() => list.canLoadMore && list.loadMore()}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />

      {selecting && selected.size > 0 && <BulkBar count={selected.size} onCancel={() => setSelection(new Set())} onRun={runBulk} />}

      <BookmarkMenu bookmark={menu} onClose={() => setMenu(undefined)} onAction={handleMenu} />
      <CollectionPicker
        open={moving !== undefined}
        onOpenChange={(open) => !open && setMoving(undefined)}
        value={(moving?.collectionId as Id<"collections"> | undefined) ?? null}
        title={strings.menu.move}
        onPick={(id) => moving && void actions.move(moving._id, id)}
      />
      <CmpConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={strings.menu.deleteForeverTitle}
        description={strings.menu.deleteForeverDescription}
        confirmLabel={strings.menu.deleteForever}
        cancelLabel={strings.cancel}
        destructive
        onConfirm={() => deleting && void actions.deleteForever(deleting._id)}
      />
      <CmpConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title={strings.list.emptyTrashTitle}
        description={strings.list.emptyTrashDescription}
        confirmLabel={strings.list.emptyTrash}
        cancelLabel={strings.cancel}
        destructive
        onConfirm={() => void actions.emptyTrash()}
      />
    </View>
  );
}
