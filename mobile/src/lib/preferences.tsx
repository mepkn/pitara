import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Layout = "list" | "grid" | "headlines";
export type Sort = "newest" | "oldest" | "title" | "domain";
export type OpenIn = "app" | "external";

type Preferences = {
  ready: boolean;
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  /** The list layout and sort are remembered per device. */
  layout: Layout;
  setLayout: (layout: Layout) => void;
  sort: Sort;
  setSort: (sort: Sort) => void;
  openIn: OpenIn;
  setOpenIn: (openIn: OpenIn) => void;
};

const KEYS = { theme: "pref.theme", layout: "pref.layout", sort: "pref.sort", openIn: "pref.openIn" } as const;

const THEMES: readonly ThemePref[] = ["light", "dark", "system"];
const LAYOUTS: readonly Layout[] = ["list", "grid", "headlines"];
const SORTS: readonly Sort[] = ["newest", "oldest", "title", "domain"];
const OPEN_IN: readonly OpenIn[] = ["app", "external"];

/** The stored string if it is one of the allowed values, else the fallback. */
export function pick<T extends string>(stored: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(stored as T) ? (stored as T) : fallback;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [layout, setLayoutState] = useState<Layout>("list");
  const [sort, setSortState] = useState<Sort>("newest");
  const [openIn, setOpenInState] = useState<OpenIn>("app");

  useEffect(() => {
    void (async () => {
      try {
        const [t, l, s, o] = await Promise.all(Object.values(KEYS).map((k) => AsyncStorage.getItem(k)));
        const storedTheme = pick(t, THEMES, "system");
        setThemeState(storedTheme);
        colorScheme.set(storedTheme);
        setLayoutState(pick(l, LAYOUTS, "list"));
        setSortState(pick(s, SORTS, "newest"));
        setOpenInState(pick(o, OPEN_IN, "app"));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setTheme = useCallback((next: ThemePref) => {
    setThemeState(next);
    colorScheme.set(next);
    void AsyncStorage.setItem(KEYS.theme, next);
  }, []);
  const setLayout = useCallback((next: Layout) => {
    setLayoutState(next);
    void AsyncStorage.setItem(KEYS.layout, next);
  }, []);
  const setSort = useCallback((next: Sort) => {
    setSortState(next);
    void AsyncStorage.setItem(KEYS.sort, next);
  }, []);
  const setOpenIn = useCallback((next: OpenIn) => {
    setOpenInState(next);
    void AsyncStorage.setItem(KEYS.openIn, next);
  }, []);

  const value = useMemo(
    () => ({ ready, theme, setTheme, layout, setLayout, sort, setSort, openIn, setOpenIn }),
    [ready, theme, setTheme, layout, setLayout, sort, setSort, openIn, setOpenIn],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
  return value;
}
