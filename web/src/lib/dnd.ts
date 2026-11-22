import { KeyboardSensor, PointerSensor, closestCenter, pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/** Drag starts after a few pixels, so clicks on a bookmark still open it. */
export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

export const BOOKMARK_PREFIX = "bm:";
export const COLLECTION_PREFIX = "col:";
export const UNSORTED_DROP = "nav:unsorted";

/** A bookmark is dropped where the pointer is; a collection is reordered among collections only. */
export const collisionDetection: CollisionDetection = (args) => {
  if (String(args.active.id).startsWith(BOOKMARK_PREFIX)) {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  }
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(COLLECTION_PREFIX)),
  });
};
