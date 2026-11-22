import { useMutation, useQuery } from "convex/react";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { isValidHttpUrl } from "@shared/url";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { BookmarkForm, type BookmarkDraft } from "@/components/bookmark-form";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpKeyboardAwareScrollView } from "@/components/cmp/cmp-keyboard-aware-scroll-view";
import { CmpText } from "@/components/cmp/cmp-text";
import { showError, toast } from "@/lib/actions";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";
import { useTags } from "@/lib/use-data";
import type { FunctionReturnType } from "convex/server";

type Full = FunctionReturnType<typeof api.bookmarks.get>;

function EditForm({ bookmark, tagNames }: { bookmark: Full; tagNames: string[] }) {
  const update = useMutation(api.bookmarks.update);
  const [draft, setDraft] = useState<BookmarkDraft>({
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description,
    note: bookmark.note,
    collectionId: bookmark.collectionId ?? null,
    tags: tagNames,
    favorite: bookmark.favorite,
    unread: bookmark.unread,
  });
  const [urlError, setUrlError] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const url = draft.url.trim();
    setError(undefined);
    if (!isValidHttpUrl(url)) {
      setUrlError(strings.add.invalidUrl);
      return;
    }
    setUrlError(undefined);
    setSubmitting(true);
    try {
      await update({
        id: bookmark._id,
        url,
        title: draft.title.trim(),
        description: draft.description.trim(),
        note: draft.note.trim(),
        collectionId: draft.collectionId,
        tags: draft.tags,
        favorite: draft.favorite,
        unread: draft.unread,
      });
      toast(strings.edit.saved);
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CmpKeyboardAwareScrollView className="bg-background flex-1" contentContainerClassName="mx-auto w-full max-w-xl gap-4 p-4 pb-12">
      {bookmark.metaStatus === "pending" && <CmpText variant="muted">{strings.form.metaPending}</CmpText>}
      {bookmark.metaStatus === "failed" && <CmpText variant="muted">{strings.form.metaFailed}</CmpText>}
      <BookmarkForm
        draft={draft}
        onChange={setDraft}
        full
        urlError={urlError}
        error={error}
        submitLabel={strings.save}
        submitting={submitting}
        disabled={draft.url.trim() === ""}
        onSubmit={() => void submit()}
      />
    </CmpKeyboardAwareScrollView>
  );
}

export default function EditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookmark = useQuery(api.bookmarks.get, { id: id as Id<"bookmarks"> });
  const tags = useTags();
  const restore = useMutation(api.bookmarks.restore);

  if (bookmark === undefined || tags === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }
  if (bookmark.deletedAt !== undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
        <CmpText className="text-center">{strings.form.trashedReadonly}</CmpText>
        <CmpButton label={strings.menu.restore} onPress={() => restore({ id: bookmark._id }).catch(showError)} />
      </View>
    );
  }
  const names = bookmark.tagIds.map((t) => tags.byId.get(t)).filter((n): n is string => n !== undefined);
  // Mounted once the bookmark and tags are in, so the form starts from them.
  return <EditForm key={bookmark._id} bookmark={bookmark} tagNames={names} />;
}
