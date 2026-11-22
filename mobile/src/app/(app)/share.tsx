import { useMutation } from "convex/react";
import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { Check, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, View } from "react-native";
import { api } from "@convex/_generated/api";
import { getDomain } from "@shared/url";
import { BookmarkForm, EMPTY_DRAFT, type BookmarkDraft } from "@/components/bookmark-form";
import { CmpButton } from "@/components/cmp/cmp-button";
import { CmpIcon } from "@/components/cmp/cmp-icon";
import { CmpKeyboardAwareScrollView } from "@/components/cmp/cmp-keyboard-aware-scroll-view";
import { CmpText } from "@/components/cmp/cmp-text";
import { errorMessage } from "@/lib/errors";
import { readShare } from "@/lib/share";
import { strings } from "@/lib/strings";

const s = strings.share;
const AUTO_CLOSE_MS = 1500;

type Result = { id: string; existed: boolean };

/**
 * The "Save to Pitara" sheet that opens when a link is shared from another app. It keeps its own
 * copy of what was shared: the share-intent state is cleared when the app goes to the background.
 */
export default function ShareScreen() {
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const create = useMutation(api.bookmarks.create);
  // Read once; later changes to the share-intent state (it resets on background) don't matter.
  const [shared] = useState(() => readShare(shareIntent));
  const [draft, setDraft] = useState<BookmarkDraft>({ ...EMPTY_DRAFT, url: shared?.url ?? "", title: shared?.title ?? "" });
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** Back to the app that shared the link. The route is dismissed first, so opening Pitara later shows the list. */
  function finish() {
    clearTimeout(timer.current);
    resetShareIntent();
    router.dismissTo("/");
    BackHandler.exitApp();
  }

  /** Stay in Pitara instead. */
  function openApp(then?: () => void) {
    clearTimeout(timer.current);
    resetShareIntent();
    router.dismissTo("/");
    then?.();
  }

  // Whatever way the sheet ends (also the Android back button), the shared link is forgotten, so the
  // next share is a fresh one and the old one doesn't come back when the app is reopened.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      resetShareIntent();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function save() {
    setError(undefined);
    setSubmitting(true);
    try {
      const r = await create({
        url: draft.url,
        title: draft.title.trim() || undefined,
        note: draft.note.trim() || undefined,
        collectionId: draft.collectionId ?? undefined,
        tags: draft.tags,
        favorite: draft.favorite || undefined,
        unread: draft.unread || undefined,
      });
      setResult(r);
      // A new link closes by itself (like the browser extension's popup); a duplicate waits.
      if (!r.existed) timer.current = setTimeout(finish, AUTO_CLOSE_MS);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 justify-end bg-black/50">
      <Pressable className="flex-1" accessibilityLabel={s.close} onPress={result ? () => openApp() : finish} />
      <View className="bg-background max-h-[90%] rounded-t-3xl">
        <View className="flex-row items-center gap-2 px-4 pb-1 pt-3">
          <CmpText className="flex-1 text-lg font-semibold">{s.title}</CmpText>
          <CmpButton variant="ghost" size="icon" icon={X} label={s.close} onPress={finish} />
        </View>

        {result ? (
          <View className="gap-4 px-4 pb-8 pt-2">
            <View className="flex-row items-center gap-3">
              <View className="bg-primary size-9 items-center justify-center rounded-full">
                <CmpIcon as={Check} size={20} className="text-primary-foreground" />
              </View>
              <View className="flex-1">
                <CmpText className="font-semibold">{result.existed ? s.alreadySaved : s.saved}</CmpText>
                <CmpText variant="muted" numberOfLines={1}>
                  {getDomain(draft.url)}
                </CmpText>
              </View>
            </View>
            <View className="flex-row gap-2">
              <CmpButton variant="outline" className="flex-1" label={s.saveAnother} onPress={finish} />
              <CmpButton
                className="flex-1"
                label={result.existed ? s.open : s.openApp}
                onPress={() =>
                  openApp(result.existed ? () => router.push({ pathname: "/edit/[id]", params: { id: result.id } }) : undefined)
                }
              />
            </View>
          </View>
        ) : shared === null ? (
          <View className="gap-4 px-4 pb-8 pt-2">
            <CmpText>{s.noLink}</CmpText>
            <CmpText variant="muted">{s.noLinkHint}</CmpText>
            <CmpButton variant="outline" label={s.close} onPress={finish} />
          </View>
        ) : (
          <CmpKeyboardAwareScrollView className="flex-grow-0" contentContainerClassName="gap-3 px-4 pb-6 pt-1">
            <View className="bg-muted gap-0.5 rounded-lg px-3 py-2">
              <CmpText className="text-sm font-medium" numberOfLines={1}>
                {shared.title || getDomain(shared.url)}
              </CmpText>
              <CmpText variant="muted" className="text-xs" numberOfLines={1}>
                {shared.url}
              </CmpText>
            </View>
            <BookmarkForm
              draft={draft}
              onChange={setDraft}
              editableUrl={false}
              error={error}
              submitLabel={s.save}
              submitting={submitting}
              onSubmit={() => void save()}
            />
          </CmpKeyboardAwareScrollView>
        )}
      </View>
    </View>
  );
}
