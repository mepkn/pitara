import { useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { CheckIcon, CopyIcon, DownloadIcon, Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@shared/limits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTags } from "@/hooks/use-data";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { errorMessage } from "@/lib/errors";
import { collectExport, downloadText, exportHtmlText, exportJsonText, type ExportPage } from "@/lib/exportFile";
import { relativeTime } from "@/lib/format";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

const s = strings.settings;

export function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 md:py-8">
      <h1 className="text-xl font-semibold md:hidden">{s.title}</h1>
      <AccountSection />
      <TagsSection />
      <TokensSection />
      <ImportSection />
      <ExportSection />
      <GetSection />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function AccountSection() {
  const me = useQuery(api.users.me);
  const { preference, setPreference } = useTheme();
  const options: [ThemePreference, string][] = [
    ["light", s.light],
    ["dark", s.dark],
    ["system", s.system],
  ];
  return (
    <Section title={s.account}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0 text-sm">
          <div className="text-muted-foreground">{s.email}</div>
          <div className="truncate font-medium">{me?.email ?? "…"}</div>
        </div>
        <div role="group" aria-label={s.theme} className="flex rounded-lg border p-0.5 text-sm">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={preference === value}
              onClick={() => setPreference(value)}
              className={cn("rounded-md px-3 py-1 text-muted-foreground transition-colors hover:text-foreground", preference === value && "bg-accent text-accent-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function TagsSection() {
  const { tags } = useTags();
  const rename = useMutation(api.tags.rename);
  const remove = useMutation(api.tags.remove);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  async function save() {
    if (!editing) return;
    try {
      await rename({ id: editing.id as Id<"tags">, name: editing.name });
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Section title={s.tags} hint={s.tagsHint}>
      {tags === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : tags.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{s.noTags}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tags.map((t) => (
            <li key={t._id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === t._id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <Input autoFocus aria-label={strings.rename} maxLength={LIMITS.tagNameMax} value={editing.name} onChange={(e) => setEditing({ id: t._id, name: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                  <Button type="submit" size="icon" variant="ghost" aria-label={strings.save}>
                    <CheckIcon />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{s.bookmarkCount(t.count)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`${strings.rename} ${t.name}`} onClick={() => setEditing({ id: t._id, name: t.name })}>
                    <PencilIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${strings.delete} ${t.name}`} className="text-destructive" onClick={() => setDeleting({ id: t._id, name: t.name })}>
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={s.deleteTagTitle(deleting?.name ?? "")}
        description={s.deleteTagDescription}
        confirmLabel={strings.delete}
        onConfirm={() => deleting && void remove({ id: deleting.id as Id<"tags"> }).catch((err: unknown) => toast.error(errorMessage(err)))}
      />
    </Section>
  );
}

function TokensSection() {
  const tokens = useQuery(api.apiTokens.list);
  const create = useAction(api.apiTokens.create);
  const revoke = useMutation(api.apiTokens.revoke);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await create({ name });
      setName("");
      setCopied(false);
      setCreated(res.token); // shown once, in the dialog only; never stored
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={s.tokens} hint={s.tokensHint}>
      <form onSubmit={submit} className="flex gap-2">
        <Input aria-label={s.tokenName} placeholder={s.tokenNamePlaceholder} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {busy ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {s.createToken}
        </Button>
      </form>
      {tokens === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s.noTokens}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {tokens.map((t) => (
            <li key={t._id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  <code>{t.prefix}…</code> · {s.created(relativeTime(t.createdAt))} · {t.lastUsedAt ? s.lastUsed(relativeTime(t.lastUsedAt)) : s.neverUsed}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRevoking({ id: t._id, name: t.name })}>
                {s.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={created !== null} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{s.tokenCreatedTitle}</DialogTitle>
            <DialogDescription>{s.tokenCreatedDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg border bg-muted px-2 py-1.5 text-xs break-all select-all" data-testid="new-token">
              {created}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label={s.copy}
              onClick={() => created && void navigator.clipboard.writeText(created).then(() => setCopied(true))}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{strings.close}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={s.revokeTitle(revoking?.name ?? "")}
        description={s.revokeDescription}
        confirmLabel={s.revoke}
        onConfirm={() => revoking && void revoke({ id: revoking.id as Id<"apiTokens"> }).catch((err: unknown) => toast.error(errorMessage(err)))}
      />
    </Section>
  );
}

type ImportResult = { found: number; created: number; duplicates: number; invalid: number; overLimit: number; collectionsCreated: number; foldersOverLimit: number };

function ImportSection() {
  const generateUploadUrl = useMutation(api.importData.generateUploadUrl);
  const importHtml = useAction(api.importExport.importHtml);
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "importing">("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResult(null);
    setError(null);
    if (file.size > LIMITS.importFileBytes) return setError(s.fileTooBig);
    try {
      setPhase("uploading");
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "text/html" }, body: file });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setPhase("importing");
      setResult(await importHtml({ storageId }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhase("idle");
      if (input.current) input.current.value = "";
    }
  }

  const rows: [string, number][] = result
    ? [
        [s.found, result.found],
        [s.created_, result.created],
        [s.duplicates, result.duplicates],
        [s.invalid, result.invalid],
        [s.collectionsCreated, result.collectionsCreated],
        ...(result.overLimit > 0 ? ([[s.overLimit, result.overLimit]] as [string, number][]) : []),
      ]
    : [];

  return (
    <Section title={s.import} hint={s.importHint}>
      <input ref={input} type="file" accept=".html,.htm,text/html" className="sr-only" aria-label={s.chooseFile} onChange={(e) => void onFile(e.target.files?.[0])} />
      <div>
        <Button variant="outline" disabled={phase !== "idle"} onClick={() => input.current?.click()}>
          {phase === "idle" ? <UploadIcon /> : <Loader2Icon className="animate-spin" />}
          {phase === "uploading" ? s.uploading : phase === "importing" ? s.importing : s.chooseFile}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="rounded-lg border p-3 text-sm">
          <div className="mb-2 font-medium">{s.importResult}</div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
            {rows.map(([label, n]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  );
}

function ExportSection() {
  const exportPage = useAction(api.importExport.exportJson);
  const [busy, setBusy] = useState<"json" | "html" | null>(null);
  const [count, setCount] = useState(0);

  async function run(kind: "json" | "html") {
    setBusy(kind);
    setCount(0);
    try {
      const data = await collectExport((cursor) => exportPage({ cursor }) as Promise<ExportPage>, setCount);
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === "json") downloadText(`pitara-${stamp}.json`, exportJsonText(data), "application/json");
      else downloadText(`pitara-${stamp}.html`, exportHtmlText(data), "text/html");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title={s.export} hint={s.exportHint}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void run("json")}>
          {busy === "json" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {s.exportJson}
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void run("html")}>
          {busy === "html" ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {s.exportHtml}
        </Button>
        {busy && <span className="text-sm text-muted-foreground">{s.exporting(count)}</span>}
      </div>
    </Section>
  );
}

const RELEASE_URL = "https://github.com/mepkn/pitara/releases/latest/download";

function GetSection() {
  return (
    <Section title={s.get} hint={s.getHint}>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" render={<a href={`${RELEASE_URL}/pitara-extension.zip`} />}>
          <DownloadIcon /> {s.extension}
        </Button>
        <Button variant="outline" render={<a href={`${RELEASE_URL}/pitara.apk`} />}>
          <DownloadIcon /> {s.android}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{s.extensionHowTo}</p>
    </Section>
  );
}
