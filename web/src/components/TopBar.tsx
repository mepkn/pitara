import { useEffect, useRef, useState } from "react";
import { LayoutGridIcon, ListIcon, MenuIcon, PanelLeftIcon, PlusIcon, RowsIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SORTS, VIEW_MODES, type Sort, type ViewMode } from "@/lib/prefs";
import { buildUrl, navigate, type Route } from "@/lib/router";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

type Props = {
  route: Route;
  q: string;
  title: string;
  mode: ViewMode;
  sort: Sort;
  /** Trash and tag views have a fixed order, and so do search results (relevance). */
  sortDisabled: boolean;
  onModeChange: (m: ViewMode) => void;
  onSortChange: (s: Sort) => void;
  onAdd: () => void;
  onOpenMenu: () => void;
  onToggleSidebar: () => void;
  hideSearch?: boolean;
};

const MODE_ICON = { list: ListIcon, grid: LayoutGridIcon, headlines: RowsIcon } as const;

export function TopBar(p: Props) {
  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={strings.nav.menu} onClick={p.onOpenMenu}>
          <MenuIcon />
        </Button>
        <Button variant="ghost" size="icon" className="max-md:hidden" aria-label={strings.nav.menu} onClick={p.onToggleSidebar}>
          <PanelLeftIcon />
        </Button>
        <h1 className="mr-1 max-w-48 truncate text-base font-semibold max-sm:hidden">{p.title}</h1>
        {p.hideSearch ? <div className="flex-1" /> : <SearchBox key={`${p.route.kind}:${"id" in p.route ? p.route.id : ""}`} route={p.route} initial={p.q} />}
        <div className="ml-auto flex items-center gap-2 max-sm:order-last max-sm:w-full max-sm:justify-between">
          {!p.hideSearch && (<>
          <div role="group" aria-label={strings.bar.view} className="flex rounded-lg border p-0.5">
            {VIEW_MODES.map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={p.mode === m}
                  aria-label={strings.bar[m]}
                  title={strings.bar[m]}
                  onClick={() => p.onModeChange(m)}
                  className={cn("grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground", p.mode === m && "bg-accent text-accent-foreground")}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
          <select
            aria-label={strings.bar.sort}
            title={p.sortDisabled ? strings.bar.sortFixed : strings.bar.sort}
            disabled={p.sortDisabled}
            value={p.sort}
            onChange={(e) => p.onSortChange(e.target.value as Sort)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 [&>option]:bg-popover"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {strings.bar[s]}
              </option>
            ))}
          </select>
          </>)}
          <Button onClick={p.onAdd}>
            <PlusIcon /> {strings.bar.add}
            <Kbd className="ml-1 max-md:hidden">A</Kbd>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** The search box: types into `?q=` after a short pause. Remounts per route (key) so it starts from that URL. */
function SearchBox({ route, initial }: { route: Route; initial: string }) {
  const [text, setText] = useState(initial);
  const timer = useRef<number | undefined>(undefined);

  // Back/forward changes the URL: follow it (adjusting state while rendering, not in an effect).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setText(initial);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function change(next: string) {
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => navigate(buildUrl(route, next), { replace: true }), 250);
  }
  function clear() {
    window.clearTimeout(timer.current);
    setText("");
    navigate(buildUrl(route), { replace: true });
  }

  return (
    <div className="relative min-w-40 flex-1 sm:max-w-md">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id="search"
        type="search"
        value={text}
        placeholder={strings.bar.search}
        aria-label={strings.bar.search}
        autoComplete="off"
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            clear();
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-full rounded-lg border border-input bg-transparent pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {text !== "" && (
        <button type="button" aria-label={strings.bar.clearSearch} onClick={clear} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
