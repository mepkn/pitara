import { useMutation } from "convex/react";
import { router } from "expo-router";
import { ArrowDown, ArrowUp, ChevronRight, FolderClosed, FolderInput, FolderPlus, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { api } from "@convex/_generated/api";
import { LIMITS } from "@shared/limits";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpConfirmDialog } from "@/components/cmp/cmp-confirm-dialog";
import { CmpDialog } from "@/components/cmp/cmp-dialog";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpPromptDialog } from "@/components/cmp/cmp-prompt-dialog";
import { CmpText } from "@/components/cmp/cmp-text";
import { CollectionPicker } from "@/components/collection-picker";
import { showError } from "@/lib/actions";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";
import type { CollectionNode, CollectionRow } from "@/lib/tree";
import { useCollections, type CollectionId } from "@/lib/use-data";
import type { LucideIcon } from "lucide-react-native";

const c = strings.collections;

type Editing = { kind: "create"; parentId?: CollectionId } | { kind: "rename"; row: CollectionRow };

function MenuItem({ icon, label, tone, onPress }: { icon: LucideIcon; label: string; tone?: "destructive"; onPress: () => void }) {
  return <CmpButton variant="ghost" className="justify-start" icon={icon} label={label} tone={tone} onPress={onPress} />;
}

export default function CollectionsScreen() {
  const data = useCollections();
  const create = useMutation(api.collections.create);
  const rename = useMutation(api.collections.rename);
  const move = useMutation(api.collections.move);
  const reorder = useMutation(api.collections.reorder);
  const remove = useMutation(api.collections.remove);

  const [menu, setMenu] = useState<CollectionRow>();
  const [editing, setEditing] = useState<Editing>();
  const [dialogError, setDialogError] = useState<string>();
  const [moving, setMoving] = useState<CollectionRow>();
  const [deleting, setDeleting] = useState<CollectionRow>();

  const rows = useMemo(() => data?.flat ?? [], [data]);
  const atLimit = (data?.rows.length ?? 0) >= LIMITS.collectionsPerUser;

  /** Siblings of a row in display order, and the row's place among them. */
  function siblings(row: CollectionRow): { ids: string[]; index: number; parentId: CollectionId | null } {
    if (!data) return { ids: [], index: -1, parentId: null };
    const list: CollectionRow[] = row.parentId == null ? data.tree : (data.tree.find((n) => n._id === row.parentId)?.children ?? []);
    const ids = list.map((r) => r._id);
    return { ids, index: ids.indexOf(row._id), parentId: (row.parentId ?? null) as CollectionId | null };
  }

  async function shift(row: CollectionRow, by: -1 | 1) {
    const { ids, index, parentId } = siblings(row);
    const to = index + by;
    if (index < 0 || to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      await reorder({ parentId, ids: ids as CollectionId[] });
    } catch (e) {
      showError(e);
    }
  }

  async function save(name: string) {
    if (!editing) return;
    setDialogError(undefined);
    try {
      if (editing.kind === "create") await create({ name, parentId: editing.parentId });
      else await rename({ id: editing.row._id as CollectionId, name });
      setEditing(undefined);
    } catch (e) {
      setDialogError(errorMessage(e));
    }
  }

  function openEditor(next: Editing) {
    setDialogError(undefined);
    setEditing(next);
  }

  const menuInfo = menu ? siblings(menu) : undefined;
  const menuIsTop = menu ? menu.parentId == null : true;
  const menuNode: CollectionNode | undefined = menu ? data?.tree.find((n) => n._id === menu._id) : undefined;
  const canNest = menuIsTop && (menuNode?.children.length ?? 0) === 0;

  return (
    <View className="bg-background flex-1">
      {data === undefined ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.row._id}
          contentContainerClassName="pb-28"
          ListEmptyComponent={
            <CmpText variant="muted" className="px-8 py-16 text-center">
              {c.empty}
            </CmpText>
          }
          ItemSeparatorComponent={() => <View className="bg-border h-hairline" />}
          renderItem={({ item: { row, depth } }) => (
            <View className="bg-background flex-row items-center pr-1" style={{ paddingLeft: 16 + depth * 24 }}>
              <Pressable
                className="active:bg-accent flex-1 flex-row items-center gap-3 py-3.5"
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/collection/[id]", params: { id: row._id } })}
                onLongPress={() => setMenu(row)}>
                <CmpIcon as={FolderClosed} size={20} className="text-brand" />
                <View className="flex-1">
                  <CmpText className="font-medium" numberOfLines={1}>
                    {row.name}
                  </CmpText>
                  <CmpText variant="muted" className="text-xs">
                    {c.count(row.bookmarkCount)}
                  </CmpText>
                </View>
                <CmpIcon as={ChevronRight} size={16} className="text-muted-foreground" />
              </Pressable>
              <CmpButton variant="ghost" size="icon" icon={MoreVertical} label={c.actions} onPress={() => setMenu(row)} />
            </View>
          )}
        />
      )}

      <View className="absolute bottom-6 right-6" pointerEvents="box-none">
        <CmpButton
          size="icon"
          icon={Plus}
          label={c.new}
          disabled={data === undefined || atLimit}
          className="size-14 rounded-full shadow-lg shadow-black/20 sm:size-14"
          onPress={() => openEditor({ kind: "create" })}
        />
      </View>

      <CmpDialog open={menu !== undefined} onOpenChange={(o) => !o && setMenu(undefined)} title={menu?.name ?? ""}>
        {menu && menuInfo && (
          <View>
            <MenuItem
              icon={Pencil}
              label={strings.rename}
              onPress={() => {
                setMenu(undefined);
                openEditor({ kind: "rename", row: menu });
              }}
            />
            {menuIsTop && !atLimit && (
              <MenuItem
                icon={FolderPlus}
                label={c.newSub}
                onPress={() => {
                  setMenu(undefined);
                  openEditor({ kind: "create", parentId: menu._id as CollectionId });
                }}
              />
            )}
            {menuInfo.index > 0 && (
              <MenuItem
                icon={ArrowUp}
                label={c.moveUp}
                onPress={() => {
                  setMenu(undefined);
                  void shift(menu, -1);
                }}
              />
            )}
            {menuInfo.index >= 0 && menuInfo.index < menuInfo.ids.length - 1 && (
              <MenuItem
                icon={ArrowDown}
                label={c.moveDown}
                onPress={() => {
                  setMenu(undefined);
                  void shift(menu, 1);
                }}
              />
            )}
            {!menuIsTop && (
              <MenuItem
                icon={FolderInput}
                label={c.moveTop}
                onPress={() => {
                  setMenu(undefined);
                  move({ id: menu._id as CollectionId, parentId: null }).catch(showError);
                }}
              />
            )}
            {canNest && (data?.tree.length ?? 0) > 1 && (
              <MenuItem
                icon={FolderInput}
                label={c.moveTo}
                onPress={() => {
                  setMenu(undefined);
                  setMoving(menu);
                }}
              />
            )}
            <MenuItem
              icon={Trash2}
              label={strings.delete}
              tone="destructive"
              onPress={() => {
                setMenu(undefined);
                setDeleting(menu);
              }}
            />
          </View>
        )}
      </CmpDialog>

      <CmpPromptDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing?.kind === "rename" ? c.renameTitle : editing?.parentId ? c.newSub : c.new}
        initialValue={editing?.kind === "rename" ? editing.row.name : ""}
        placeholder={c.namePlaceholder}
        error={dialogError}
        submitLabel={strings.save}
        cancelLabel={strings.cancel}
        onSubmit={(name) => void save(name)}
      />
      {/* Only top-level collections without children can be a parent target; two levels at most. */}
      <CollectionPicker
        open={moving !== undefined}
        onOpenChange={(open) => !open && setMoving(undefined)}
        value={null}
        allowNone={false}
        title={c.pickParent}
        disabled={(id) => id === moving?._id || (data?.byId.get(id)?.parentId ?? null) !== null}
        onPick={(parent) => {
          if (moving && parent) move({ id: moving._id as CollectionId, parentId: parent }).catch(showError);
        }}
      />
      <CmpConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={deleting ? c.deleteTitle(deleting.name) : ""}
        description={c.deleteDescription}
        confirmLabel={strings.delete}
        cancelLabel={strings.cancel}
        destructive
        onConfirm={() => deleting && remove({ id: deleting._id as CollectionId }).catch(showError)}
      />
    </View>
  );
}
