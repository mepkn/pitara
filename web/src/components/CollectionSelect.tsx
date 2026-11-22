import { flattenTree, type CollectionNode } from "@/lib/tree";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

type Props = {
  tree: CollectionNode[];
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
};

/** A native select: reliable on every device, and the tree is shown indented. */
export function CollectionSelect({ tree, value, onChange, id, disabled, className }: Props) {
  return (
    <select
      id={id}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover",
        className,
      )}
    >
      <option value="">{strings.edit.noCollection}</option>
      {flattenTree(tree).map(({ row, depth }) => (
        <option key={row._id} value={row._id}>
          {depth === 1 ? "   ↳ " : ""}
          {row.name}
        </option>
      ))}
    </select>
  );
}
