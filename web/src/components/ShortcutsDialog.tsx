import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { strings } from "@/lib/strings";

type Row = [keys: string[], label: string];

// Keep in step with the handlers: Shell.tsx (global keys) and BookmarkList.tsx (the highlighted bookmark).
const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: strings.shortcuts.anywhere,
    rows: [
      [["/"], strings.shortcuts.search],
      [["a"], strings.shortcuts.add],
      [["⌘ / Ctrl", "K"], strings.shortcuts.addAlt],
      [["Esc"], strings.shortcuts.clear],
      [["?"], strings.shortcuts.help],
    ],
  },
  {
    title: strings.shortcuts.onBookmark,
    rows: [
      [["j"], strings.shortcuts.next],
      [["k"], strings.shortcuts.prev],
      [["Enter"], strings.shortcuts.open],
      [["e"], strings.shortcuts.edit],
      [["s"], strings.shortcuts.star],
      [["Del"], strings.shortcuts.trash],
    ],
  },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{strings.shortcuts.title}</DialogTitle>
          <DialogDescription className="sr-only">{strings.shortcuts.paste}</DialogDescription>
        </DialogHeader>
        {SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.title}</h3>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
              {section.rows.map(([keys, label]) => (
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
          </section>
        ))}
        <p className="text-xs text-muted-foreground">{strings.shortcuts.paste}</p>
      </DialogContent>
    </Dialog>
  );
}
