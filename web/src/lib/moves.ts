import { arrayMove } from "@dnd-kit/sortable";
import { canNest, type CollectionNode } from "./tree";

export type CollectionMove =
  | { type: "reorder"; parentId: string | null; ids: string[] }
  | { type: "nest"; id: string; parentId: string | null }
  | { type: "invalid" }
  | { type: "none" };

/**
 * What dropping collection `activeId` on collection `overId` means, checked against the two-level
 * rule before any call: same parent → reorder; onto a top-level collection of another group →
 * nest into it; onto a child → join that child's group. Anything illegal is "invalid".
 */
export function planCollectionDrop(tree: CollectionNode[], activeId: string, overId: string): CollectionMove {
  if (activeId === overId) return { type: "none" };
  const flat = tree.flatMap((n) => [n, ...n.children]);
  const a = flat.find((c) => c._id === activeId);
  const o = flat.find((c) => c._id === overId);
  if (!a || !o) return { type: "none" };
  const aParent = a.parentId ?? null;
  const oParent = o.parentId ?? null;

  if (aParent === oParent) {
    const siblings = (aParent === null ? tree : (tree.find((n) => n._id === aParent)?.children ?? [])).map((c) => c._id);
    const from = siblings.indexOf(activeId);
    const to = siblings.indexOf(overId);
    if (from === -1 || to === -1) return { type: "none" };
    return { type: "reorder", parentId: aParent, ids: arrayMove(siblings, from, to) };
  }
  const target = oParent === null ? o._id : oParent;
  if (aParent === target || activeId === target) return { type: "none" };
  return canNest(tree, activeId, target) ? { type: "nest", id: activeId, parentId: target } : { type: "invalid" };
}
