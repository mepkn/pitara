import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { strings } from "@/lib/strings";

const ROWS: [string[], string][] = [
  [["/"], strings.shortcuts.search],
  [["a"], strings.shortcuts.add],
  [["j"], strings.shortcuts.next],
  [["k"], strings.shortcuts.prev],
  [["Enter"], strings.shortcuts.open],
  [["e"], strings.shortcuts.edit],
  [["s"], strings.shortcuts.star],
  [["Del"], strings.shortcuts.trash],
  [["?"], strings.shortcuts.help],
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{strings.shortcuts.title}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {ROWS.map(([keys, label]) => (
            <div key={label} className="contents">
              <dt className="flex gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{strings.shortcuts.paste}</p>
      </DialogContent>
    </Dialog>
  );
}
