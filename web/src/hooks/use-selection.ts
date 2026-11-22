import { useCallback, useRef, useState } from "react";
import { rangeBetween } from "@/lib/selection";

/** Selected bookmark ids with shift-click ranges over the visible order. */
export function useSelection(orderedIds: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const toggle = useCallback(
    (id: string, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && anchor.current !== null) {
          for (const r of rangeBetween(orderedIds, anchor.current, id)) next.add(r);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!shift) anchor.current = id;
    },
    [orderedIds],
  );
  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const selectAll = useCallback(() => setSelected(new Set(orderedIds)), [orderedIds]);
  return { selected, toggle, clear, selectAll };
}
