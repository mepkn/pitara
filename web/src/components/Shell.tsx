import { useCallback, useEffect, useState } from "react";
import { DndContext, DragOverlay, type DragEndEvent } from "@dnd-kit/core";
import { useMutation } from "convex/react";
import { GripVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { isValidHttpUrl } from "@shared/url";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AddDialog } from "@/components/AddDialog";
import { BookmarkList } from "@/components/BookmarkList";
import { BulkBar } from "@/components/BulkBar";
import { EditDialog } from "@/components/EditDialog";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SettingsPage } from "@/components/SettingsPage";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { useBulk } from "@/hooks/use-bulk";
import { useCollections, useTags } from "@/hooks/use-data";
import { useSelection } from "@/hooks/use-selection";
import { BOOKMARK_PREFIX, COLLECTION_PREFIX, UNSORTED_DROP, collisionDetection, useDragSensors } from "@/lib/dnd";
import { isEditableTarget } from "@/lib/editable";
import { errorMessage } from "@/lib/errors";
import { planCollectionDrop } from "@/lib/moves";
import { readSort, readViewMode, saveSort, saveViewMode, type Sort, type ViewMode } from "@/lib/prefs";
import { routePath, useLocation, type Route } from "@/lib/router";
import { storage } from "@/lib/storage";
import { strings } from "@/lib/strings";

function useTitle(route: Route): string {
  const { rows } = useCollections();
  const { tags } = useTags();
  switch (route.kind) {
    case "collection":
      return rows?.find((r) => r._id === route.id)?.name ?? strings.nav.collections;
    case "tag":
      return tags?.find((t) => t._id === route.id)?.name ?? strings.nav.tags;
    case "settings":
      return strings.settings.title;
    default:
      return strings.nav[route.kind];
  }
}

export function Shell() {
  const { route, q } = useLocation();
  const title = useTitle(route);
  const { tree } = useCollections();
  const sensors = useDragSensors();
  const runBulk = useBulk();
  const moveCollection = useMutation(api.collections.move);
  const reorderCollections = useMutation(api.collections.reorder);

  const [mode, setMode] = useState<ViewMode>(readViewMode);
  const [sort, setSort] = useState<Sort>(readSort);
  const [collapsed, setCollapsed] = useState(() => storage.get("pitara.sidebar") === "closed");
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState<{ title: string; count: number } | null>(null);
  const selection = useSelection(ids);
  const { selected, clear } = selection;

  // A new view or search starts with nothing selected.
  const viewKey = `${routePath(route)}?${q}`;
  useEffect(() => clear(), [viewKey, clear]);

  const openAdd = useCallback((url = "") => {
    setAddUrl(url);
    setAddOpen(true);
  }, []);

  // Global keys: `/` search, `a` or Cmd/Ctrl+K add, `?` help, and a pasted link opens Add.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openAdd();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search")?.focus();
      } else if (e.key === "a") {
        e.preventDefault();
        openAdd();
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (e.key === "Escape") clear();
    }
    function onPaste(e: ClipboardEvent) {
      if (isEditableTarget(e.target) || document.querySelector("[role=dialog], [role=alertdialog]")) return;
      const text = e.clipboardData?.getData("text")?.trim() ?? "";
      if (text !== "" && !/\s/.test(text) && isValidHttpUrl(text)) {
        e.preventDefault();
        openAdd(text);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [openAdd, clear]);

  const changeMode = (m: ViewMode) => {
    setMode(m);
    saveViewMode(m);
  };
  const changeSort = (s: Sort) => {
    setSort(s);
    saveSort(s);
  };
  const toggleSidebar = () =>
    setCollapsed((c) => {
      storage.set("pitara.sidebar", c ? "open" : "closed");
      return !c;
    });

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (overId === null) return;
    try {
      if (activeId.startsWith(BOOKMARK_PREFIX)) {
        const target = overId === UNSORTED_DROP ? null : overId.startsWith(COLLECTION_PREFIX) ? overId.slice(COLLECTION_PREFIX.length) : undefined;
        if (target === undefined) return;
        const id = activeId.slice(BOOKMARK_PREFIX.length);
        const moving = selected.has(id) ? [...selected] : [id];
        const changed = await runBulk(moving, { type: "move", collectionId: target as Id<"collections"> | null });
        toast(strings.bulk.done(changed));
        clear();
      } else if (activeId.startsWith(COLLECTION_PREFIX) && overId.startsWith(COLLECTION_PREFIX) && tree) {
        const plan = planCollectionDrop(tree, activeId.slice(COLLECTION_PREFIX.length), overId.slice(COLLECTION_PREFIX.length));
        if (plan.type === "reorder") await reorderCollections({ parentId: plan.parentId as Id<"collections"> | null, ids: plan.ids as Id<"collections">[] });
        else if (plan.type === "nest") await moveCollection({ id: plan.id as Id<"collections">, parentId: plan.parentId as Id<"collections"> | null });
        else if (plan.type === "invalid") toast.error(strings.errors.invalidParent);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const sortDisabled = route.kind === "trash" || route.kind === "broken" || route.kind === "tag" || q.trim() !== "";
  const sidebar = <Sidebar route={route} onNavigate={() => setMenuOpen(false)} />;
  const defaultCollectionId = route.kind === "collection" ? route.id : null;
  const onIdsChange = useCallback((next: string[]) => setIds(next), []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(e) => {
        const id = String(e.active.id);
        if (!id.startsWith(BOOKMARK_PREFIX)) return;
        const el = document.querySelector(`[data-bookmark="${id.slice(BOOKMARK_PREFIX.length)}"] a`);
        setDragging({ title: el?.textContent || strings.list.untitled, count: selected.has(id.slice(BOOKMARK_PREFIX.length)) ? selected.size : 1 });
      }}
      onDragCancel={() => setDragging(null)}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      <div className="flex h-svh bg-background">
        {!collapsed && <aside className="w-64 shrink-0 border-r border-sidebar-border max-md:hidden">{sidebar}</aside>}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-72 gap-0 p-0 md:hidden" showCloseButton={false}>
            <SheetTitle className="sr-only">{strings.nav.menu}</SheetTitle>
            <SheetDescription className="sr-only">{strings.nav.menu}</SheetDescription>
            {sidebar}
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {route.kind === "settings" ? (
            <>
              <TopBar route={route} q="" title={title} mode={mode} sort={sort} sortDisabled onModeChange={changeMode} onSortChange={changeSort} onAdd={() => openAdd()} onOpenMenu={() => setMenuOpen(true)} onToggleSidebar={toggleSidebar} hideSearch />
              <main className="flex-1 overflow-y-auto">
                <SettingsPage />
              </main>
            </>
          ) : (
            <>
              <TopBar route={route} q={q} title={title} mode={mode} sort={sort} sortDisabled={sortDisabled} onModeChange={changeMode} onSortChange={changeSort} onAdd={() => openAdd()} onOpenMenu={() => setMenuOpen(true)} onToggleSidebar={toggleSidebar} />
              <main className="flex-1 overflow-y-auto px-3 py-4 pb-24 md:px-6">
                <div className="mx-auto w-full max-w-5xl">
                  <ErrorBoundary key={viewKey} fallback={(error) => <p className="py-16 text-center text-sm text-muted-foreground">{errorMessage(error)}</p>}>
                    <BookmarkList
                      route={route}
                      q={q}
                      sort={sort}
                      mode={mode}
                      selected={selected}
                      onIdsChange={onIdsChange}
                      onToggleSelect={selection.toggle}
                      onEdit={setEditId}
                    />
                  </ErrorBoundary>
                </div>
              </main>
            </>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="flex max-w-64 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
            <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{dragging.title}</span>
            {dragging.count > 1 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{dragging.count}</span>}
          </div>
        )}
      </DragOverlay>

      <BulkBar selected={selected} total={ids.length} onClear={clear} onSelectAll={selection.selectAll} />
      <AddDialog open={addOpen} onOpenChange={setAddOpen} initialUrl={addUrl} defaultCollectionId={defaultCollectionId} onExisting={setEditId} />
      <EditDialog id={editId} onClose={() => setEditId(null)} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </DndContext>
  );
}

