import { useMutation } from "convex/react";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { isValidHttpUrl } from "@shared/url";
import { api } from "@convex/_generated/api";
import { BookmarkForm, EMPTY_DRAFT, type BookmarkDraft } from "@/components/bookmark-form";
import { CmpKeyboardAwareScrollView } from "@/components/cmp/cmp-keyboard-aware-scroll-view";
import { toast } from "@/lib/actions";
import { errorMessage } from "@/lib/errors";
import { strings } from "@/lib/strings";
import { findUrl } from "@/lib/share";

export default function AddScreen() {
  const create = useMutation(api.bookmarks.create);
  const [draft, setDraft] = useState<BookmarkDraft>(EMPTY_DRAFT);
  const [urlError, setUrlError] = useState<string>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Prefill from the clipboard when it holds a link (only if nothing was typed meanwhile).
  useEffect(() => {
    let live = true;
    void Clipboard.getStringAsync()
      .then((text) => {
        const url = findUrl(text);
        if (live && url) {
          setDraft((d) => (d.url === "" ? { ...d, url } : d));
          toast(strings.add.pasted);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

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
      const { id, existed } = await create({
        url,
        title: draft.title.trim() || undefined,
        description: draft.description.trim() || undefined,
        note: draft.note.trim() || undefined,
        collectionId: draft.collectionId ?? undefined,
        tags: draft.tags,
        favorite: draft.favorite || undefined,
        unread: draft.unread || undefined,
      });
      if (existed) {
        // A duplicate doesn't create a second bookmark: open the existing one.
        toast(strings.add.alreadySaved);
        router.replace({ pathname: "/edit/[id]", params: { id } });
      } else {
        toast(strings.add.saved);
        router.back();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CmpKeyboardAwareScrollView className="bg-background flex-1" contentContainerClassName="mx-auto w-full max-w-xl p-4 pb-12">
      <BookmarkForm
        draft={draft}
        onChange={setDraft}
        urlError={urlError}
        error={error}
        submitLabel={strings.add.submit}
        submitting={submitting}
        disabled={draft.url.trim() === ""}
        onSubmit={() => void submit()}
      />
    </CmpKeyboardAwareScrollView>
  );
}
