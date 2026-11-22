import { useMutation } from "convex/react";
import { router } from "expo-router";
import { Pencil, Tag, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpConfirmDialog } from "@/components/cmp/cmp-confirm-dialog";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpPromptDialog } from "@/components/cmp/cmp-prompt-dialog";
import { CmpText } from "@/components/cmp/cmp-text";
import { showError } from "@/lib/actions";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";

const t = strings.tags;

type TagRow = { _id: Id<"tags">; name: string; count: number };

export default function TagsScreen() {
  const tags = useTags();
  const rename = useMutation(api.tags.rename);
  const remove = useMutation(api.tags.remove);
  const [editing, setEditing] = useState<TagRow>();
  const [dialogError, setDialogError] = useState<string>();
  const [deleting, setDeleting] = useState<TagRow>();

  async function save(name: string) {
    if (!editing) return;
    setDialogError(undefined);
    try {
      await rename({ id: editing._id, name });
      setEditing(undefined);
    } catch (e) {
      setDialogError(errorMessage(e));
    }
  }

  return (
    <View className="bg-background flex-1">
      {tags === undefined ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={tags.rows}
          keyExtractor={(tag) => tag._id}
          contentContainerClassName="pb-12"
          ItemSeparatorComponent={() => <View className="bg-border h-hairline" />}
          ListEmptyComponent={
            <CmpText variant="muted" className="px-8 py-16 text-center">
              {t.empty}
            </CmpText>
          }
          renderItem={({ item: tag }) => (
            <View className="bg-background flex-row items-center pl-4 pr-1">
              <Pressable
                className="active:bg-accent flex-1 flex-row items-center gap-3 py-3.5"
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/tag/[id]", params: { id: tag._id } })}>
                <CmpIcon as={Tag} size={18} className="text-brand" />
                <View className="flex-1">
                  <CmpText className="font-medium" numberOfLines={1}>
                    #{tag.name}
                  </CmpText>
                  <CmpText variant="muted" className="text-xs">
                    {t.count(tag.count)}
                  </CmpText>
                </View>
              </Pressable>
              <CmpButton
                variant="ghost"
                size="icon"
                icon={Pencil}
                label={strings.rename}
                onPress={() => {
                  setDialogError(undefined);
                  setEditing(tag);
                }}
              />
              <CmpButton variant="ghost" size="icon" icon={Trash2} tone="destructive" label={strings.delete} onPress={() => setDeleting(tag)} />
            </View>
          )}
        />
      )}
      <CmpPromptDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={t.renameTitle}
        initialValue={editing?.name}
        placeholder={t.namePlaceholder}
        error={dialogError}
        submitLabel={strings.save}
        cancelLabel={strings.cancel}
        onSubmit={(name) => void save(name)}
      />
      <CmpConfirmDialog
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={deleting ? t.deleteTitle(deleting.name) : ""}
        description={t.deleteDescription}
        confirmLabel={strings.delete}
        cancelLabel={strings.cancel}
        destructive
        onConfirm={() => deleting && remove({ id: deleting._id }).catch(showError)}
      />
    </View>
  );
}
