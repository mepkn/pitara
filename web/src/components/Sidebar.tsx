import { useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation } from "convex/react";
import {
  BookmarkIcon,
  FolderIcon,
  InboxIcon,
  LibraryIcon,
  UnlinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountMenu } from "@/components/AccountMenu";
import { CollectionDialog, type CollectionDialogState } from "@/components/CollectionDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCollections, useTags } from "@/hooks/use-data";
import { COLLECTION_PREFIX, UNSORTED_DROP } from "@/lib/dnd";
import { errorMessage } from "@/lib/errors";
import { navigate, routePath, sameRoute, type Route } from "@/lib/router";
import { strings } from "@/lib/strings";
import { canNest, type CollectionNode, type CollectionRow } from "@/lib/tree";
import { cn } from "@/lib/utils";

type Props = { route: Route; onNavigate?: () => void };

const ROW =
  "group/row relative flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function Sidebar({ route, onNavigate }: Props) {
  const { tree } = useCollections();
  const { tags } = useTags();
  const [dialog, setDialog] = useState<CollectionDialogState>(null);
  const [deleting, setDeleting] = useState<CollectionRow | null>(null);
  const remove = useMutation(api.collections.remove);

  const go = (r: Route) => {
    navigate(routePath(r));
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Logo className="text-lg" />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4" aria-label={strings.nav.menu}>
        <div className="flex flex-col gap-0.5">
          <NavItem icon={<LibraryIcon />} label={strings.nav.all} active={sameRoute(route, { kind: "all" })} onClick={() => go({ kind: "all" })} />
          <NavItem icon={<InboxIcon />} label={strings.nav.unsorted} active={sameRoute(route, { kind: "unsorted" })} onClick={() => go({ kind: "unsorted" })} dropId={UNSORTED_DROP} />
          <NavItem icon={<StarIcon />} label={strings.nav.favorites} active={sameRoute(route, { kind: "favorites" })} onClick={() => go({ kind: "favorites" })} />
          <NavItem icon={<BookmarkIcon />} label={strings.nav.unread} active={sameRoute(route, { kind: "unread" })} onClick={() => go({ kind: "unread" })} />
          <NavItem icon={<UnlinkIcon />} label={strings.nav.broken} active={sameRoute(route, { kind: "broken" })} onClick={() => go({ kind: "broken" })} />
          <NavItem icon={<Trash2Icon />} label={strings.nav.trash} active={sameRoute(route, { kind: "trash" })} onClick={() => go({ kind: "trash" })} />
        </div>

        <section className="flex flex-col gap-0.5" aria-label={strings.nav.collections}>
          <SectionHeader title={strings.nav.collections} action={
            <Button variant="ghost" size="icon-xs" aria-label={strings.nav.newCollection} title={strings.nav.newCollection} onClick={() => setDialog({ mode: "create", parentId: null })}>
              <PlusIcon />
            </Button>
          } />
          {tree === undefined ? (
            <Skeleton className="h-8 w-full" />
          ) : tree.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">{strings.nav.noCollections}</p>
          ) : (
            <SortableContext items={tree.map((n) => COLLECTION_PREFIX + n._id)} strategy={verticalListSortingStrategy}>
              {tree.map((node) => (
                <div key={node._id} className="flex flex-col gap-0.5">
                  <CollectionItem
                    node={node}
                    tree={tree}
                    depth={0}
                    active={route.kind === "collection" && route.id === node._id}
                    onOpen={() => go({ kind: "collection", id: node._id })}
                    onCreate={() => setDialog({ mode: "create", parentId: node._id })}
                    onRename={() => setDialog({ mode: "rename", id: node._id, name: node.name })}
                    onDelete={() => setDeleting(node)}
                  />
                  {node.children.length > 0 && (
                    <SortableContext items={node.children.map((c) => COLLECTION_PREFIX + c._id)} strategy={verticalListSortingStrategy}>
                      {node.children.map((child) => (
                        <CollectionItem
                          key={child._id}
                          node={{ ...child, children: [] }}
                          tree={tree}
                          depth={1}
                          active={route.kind === "collection" && route.id === child._id}
                          onOpen={() => go({ kind: "collection", id: child._id })}
                          onRename={() => setDialog({ mode: "rename", id: child._id, name: child.name })}
                          onDelete={() => setDeleting(child)}
                        />
                      ))}
                    </SortableContext>
                  )}
                </div>
              ))}
            </SortableContext>
          )}
        </section>

        <section className="flex flex-col gap-0.5" aria-label={strings.nav.tags}>
          <SectionHeader title={strings.nav.tags} />
          {tags === undefined ? (
            <Skeleton className="h-8 w-full" />
          ) : tags.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">{strings.nav.noTags}</p>
          ) : (
            tags.map((t) => (
              <NavItem
                key={t._id}
                icon={<TagIcon />}
                label={t.name}
                count={t.count}
                active={route.kind === "tag" && route.id === t._id}
                onClick={() => go({ kind: "tag", id: t._id })}
              />
            ))
          )}
        </section>
      </nav>
      <div className="flex shrink-0 items-center justify-between border-t border-sidebar-border px-2 py-2">
        <AccountMenu />
        <div className="flex items-center">
          <Button variant="ghost" size="icon" aria-label={strings.account.settings} title={strings.account.settings} onClick={() => go({ kind: "settings" })}>
            <SettingsIcon />
          </Button>
          <ThemeToggle />
        </div>
      </div>

      <CollectionDialog state={dialog} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={strings.nav.deleteCollectionTitle(deleting?.name ?? "")}
        description={strings.nav.deleteCollectionDescription}
        confirmLabel={strings.nav.deleteCollection}
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          if (route.kind === "collection" && route.id === target._id) navigate("/all");
          void remove({ id: target._id as Id<"collections"> }).catch((err: unknown) => toast.error(errorMessage(err)));
        }}
      />
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {action}
    </div>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  dropId,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  dropId?: string;
}) {
  const { setNodeRef, isOver, active: dragging } = useDroppable({ id: dropId ?? `nav:${label}`, disabled: dropId === undefined });
  const dropping = isOver && String(dragging?.id).startsWith("bm:");
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(ROW, "w-full text-left [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground", active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground [&_svg]:text-primary", dropping && "ring-2 ring-primary")}
    >
      {icon}
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span>}
    </button>
  );
}

function CollectionItem({
  node,
  tree,
  depth,
  active,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  node: CollectionNode;
  tree: CollectionNode[];
  depth: 0 | 1;
  active: boolean;
  onOpen: () => void;
  onCreate?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active: dragging } = useSortable({
    id: COLLECTION_PREFIX + node._id,
  });
  const move = useMutation(api.collections.move);
  const reorder = useMutation(api.collections.reorder);
  const dropping = isOver && String(dragging?.id).startsWith("bm:");

  const fail = (err: unknown) => void toast.error(errorMessage(err));
  const parents = tree.filter((p) => canNest(tree, node._id, p._id) && p._id !== node.parentId);
  const siblings = depth === 0 ? tree : (tree.find((p) => p._id === node.parentId)?.children ?? []);
  const index = siblings.findIndex((s) => s._id === node._id);
  const shift = (by: -1 | 1) => {
    const ids = siblings.map((s) => s._id as Id<"collections">);
    const [item] = ids.splice(index, 1);
    ids.splice(index + by, 0, item!);
    void reorder({ parentId: (node.parentId ?? null) as Id<"collections"> | null, ids }).catch(fail);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      tabIndex={-1}
      className={cn(ROW, depth === 1 && "ml-4", active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground", dropping && "ring-2 ring-primary", isDragging && "z-10 opacity-60")}
    >
      <button type="button" onClick={onOpen} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline">
        <FolderIcon className={cn("size-4 shrink-0 text-muted-foreground", active && "text-primary")} />
        <span className="truncate">{node.name}</span>
      </button>
      <span className="text-xs text-muted-foreground tabular-nums group-hover/row:hidden">{node.bookmarkCount}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label={strings.nav.collectionActions} className="hidden group-hover/row:inline-flex data-popup-open:inline-flex" onPointerDown={(e) => e.stopPropagation()} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {onCreate && <DropdownMenuItem onClick={onCreate}>{strings.nav.newSubcollection}</DropdownMenuItem>}
          <DropdownMenuItem onClick={onRename}>{strings.nav.renameCollection}</DropdownMenuItem>
          {index > 0 && <DropdownMenuItem onClick={() => shift(-1)}>{strings.nav.moveUp}</DropdownMenuItem>}
          {index !== -1 && index < siblings.length - 1 && <DropdownMenuItem onClick={() => shift(1)}>{strings.nav.moveDown}</DropdownMenuItem>}
          {(parents.length > 0 || node.parentId) && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{strings.edit.collection}…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {node.parentId && (
                  <DropdownMenuItem onClick={() => void move({ id: node._id as Id<"collections">, parentId: null }).catch(fail)}>{strings.nav.moveToTop}</DropdownMenuItem>
                )}
                {parents.map((p) => (
                  <DropdownMenuItem key={p._id} onClick={() => void move({ id: node._id as Id<"collections">, parentId: p._id as Id<"collections"> }).catch(fail)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {strings.nav.deleteCollection}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
