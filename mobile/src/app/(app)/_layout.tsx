import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";
import { strings } from "@/lib/strings";
import { useUpdateCheck } from "@/lib/use-update-check";

export default function AppLayout() {
  useUpdateCheck();
  const { hasShareIntent } = useShareIntentContext();

  // A link shared from another app (also one shared while signed out, once signed in).
  useEffect(() => {
    if (hasShareIntent) router.push("/share");
  }, [hasShareIntent]);

  return (
    <Stack screenOptions={{ headerTitleAlign: "left" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ headerTitle: strings.add.title, presentation: "modal" }} />
      <Stack.Screen name="share" options={{ headerShown: false, presentation: "transparentModal", animation: "fade" }} />
      <Stack.Screen name="edit/[id]" options={{ headerTitle: strings.edit.title }} />
      <Stack.Screen name="collection/[id]" options={{ headerTitle: strings.collections.title }} />
      <Stack.Screen name="tag/[id]" options={{ headerTitle: strings.tags.title }} />
      <Stack.Screen name="settings" options={{ headerTitle: strings.settings.title }} />
    </Stack>
  );
}

// Catches query errors from every app screen, e.g. notAllowed after the
// signed-in email is removed from ALLOWED_EMAILS.
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorScreen {...props} />;
}
