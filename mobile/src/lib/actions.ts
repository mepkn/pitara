import * as Clipboard from "expo-clipboard";
import { Linking, Share, ToastAndroid, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "./errors";
import { usePreferences } from "./preferences";
import { strings } from "./strings";

export function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
}

export function showError(error: unknown): void {
  Alert.alert(errorMessage(error));
}

export type BulkAction = Parameters<ReturnType<typeof useMutation<typeof api.bookmarks.bulk>>>[0]["action"];

/** Bookmark actions shared by every list and the long-press menu. Failures show an alert. */
export function useBookmarkActions() {
  const { openIn } = usePreferences();
  const favorite = useMutation(api.bookmarks.toggleFavorite);
  const unread = useMutation(api.bookmarks.toggleUnread);
  const trash = useMutation(api.bookmarks.trash);
  const restore = useMutation(api.bookmarks.restore);
  const remove = useMutation(api.bookmarks.deleteForever);
  const move = useMutation(api.bookmarks.move);
  const bulk = useMutation(api.bookmarks.bulk);
  const emptyTrash = useMutation(api.bookmarks.emptyTrash);

  // Runs a mutation, alerts on failure; resolves true if it worked.
  const run = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    try {
      await fn();
      if (done) toast(done);
      return true;
    } catch (e) {
      showError(e);
      return false;
    }
  };

  return {
    async open(url: string) {
      try {
        if (openIn === "app") await WebBrowser.openBrowserAsync(url);
        else await Linking.openURL(url);
      } catch {
        toast(strings.somethingWentWrong);
      }
    },
    async copyLink(url: string) {
      await Clipboard.setStringAsync(url);
      toast(strings.menu.linkCopied);
    },
    async share(url: string, title?: string) {
      try {
        await Share.share({ message: url, title });
      } catch {
        // Dismissed or no target: nothing to report.
      }
    },
    toggleFavorite: (id: Id<"bookmarks">) => run(() => favorite({ id })),
    toggleUnread: (id: Id<"bookmarks">) => run(() => unread({ id })),
    trash: (id: Id<"bookmarks">) => run(() => trash({ id }), strings.menu.trashed),
    restore: (id: Id<"bookmarks">) => run(() => restore({ id }), strings.menu.restored),
    deleteForever: (id: Id<"bookmarks">) => run(() => remove({ id }), strings.menu.deleted),
    move: (id: Id<"bookmarks">, collectionId: Id<"collections"> | null) => run(() => move({ id, collectionId })),
    emptyTrash: () => run(() => emptyTrash({})),
    async bulk(ids: Id<"bookmarks">[], action: BulkAction): Promise<boolean> {
      try {
        const { changed } = await bulk({ ids, action });
        toast(strings.bulk.done(changed));
        return true;
      } catch (e) {
        showError(e);
        return false;
      }
    },
  };
}
