import "@/global.css";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Stack, ThemeProvider } from "expo-router";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { CmpPortalHost } from "@/components/cmp/cmp-portal-host";
import { convex, secureTokenStorage } from "@/lib/convex";
import { PreferencesProvider, usePreferences } from "@/lib/preferences";
import { NAV_THEME } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

// Keep a shared link while the app is in the background: signing up needs the emailed code, so
// the user leaves for the mail app before the sheet can open. share.tsx clears it on every exit.
const SHARE_OPTIONS = { resetOnBackground: false };

function RootStack() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { ready } = usePreferences();
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";

  useEffect(() => {
    if (!isLoading && ready) void SplashScreen.hideAsync();
  }, [isLoading, ready]);

  if (isLoading || !ready) return null;

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
      <CmpPortalHost />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* The share-intent provider goes before every other provider (its README). While signed out
          it keeps a shared link until the user has signed in; (app)/_layout then opens the sheet. */}
      <ShareIntentProvider options={SHARE_OPTIONS}>
        <KeyboardProvider>
          <ConvexAuthProvider client={convex} storage={secureTokenStorage}>
            <PreferencesProvider>
              <RootStack />
            </PreferencesProvider>
          </ConvexAuthProvider>
        </KeyboardProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
