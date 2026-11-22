import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApiBookmark, ApiCollection, ApiTag } from "@shared/types";
import { noteSaved } from "@/lib/badge";
import { errorMessage } from "@/lib/errors";
import { parseTags, usefulTitle } from "@/lib/page";
import { getApi } from "@/lib/settings";
import { collectionOptions } from "@/lib/tree";

interface Props {
  tab: { id: number | undefined; url: string; title: string };
  existing: ApiBookmark | null;
  collections: ApiCollection[];
  tags: ApiTag[];
  defaultCollectionId: string | null;
  onRemoved: () => void;
}

const CLOSE_AFTER_MS = 1000;

export function SaveForm({ tab, existing, collections, tags, defaultCollectionId, onRemoved }: Props) {
  // "view": the Already saved card; "form": new bookmark or editing the saved one.
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = existing;
  const [url, setUrl] = useState(base?.url ?? tab.url);
  const [title, setTitle] = useState(base?.title ?? tab.title);
  const [note, setNote] = useState(base?.note ?? "");
  const [tagText, setTagText] = useState(base?.tags.join(", ") ?? "");
  const [favorite, setFavorite] = useState(base?.favorite ?? false);
  const [unread, setUnread] = useState(base?.unread ?? false);
  const knownIds = useMemo(() => new Set(collections.map((c) => c.id)), [collections]);
  const initialCollection = base ? (base.collectionId ?? "") : defaultCollectionId && knownIds.has(defaultCollectionId) ? defaultCollectionId : "";
  const [collectionId, setCollectionId] = useState(initialCollection);
  const options = useMemo(() => collectionOptions(collections), [collections]);
  const selected = parseTags(tagText);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const finish = (message: string) => {
    setDone(message);
    closeTimer.current = window.setTimeout(() => window.close(), CLOSE_AFTER_MS);
  };

  const toggleTag = (name: string) => {
    const next = selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name];
    setTagText(next.join(", "));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { api } = await getApi();
      if (base) {
        await api.update(base.id, { url, title, note, tags: selected, collectionId: collectionId || null, favorite, unread });
        finish("Changes saved");
      } else {
        const chosenTitle = title === tab.title ? usefulTitle(title, url) : title.trim() || undefined;
        const result = await api.create({
          url, ...(chosenTitle ? { title: chosenTitle } : {}), ...(note ? { note } : {}),
          ...(collectionId ? { collectionId } : {}), ...(selected.length ? { tags: selected } : {}),
          ...(favorite ? { favorite } : {}), ...(unread ? { unread } : {}),
        });
        finish(result.existed ? "Already saved" : "Saved");
      }
      if (tab.id !== undefined) void noteSaved(tab.id, tab.url, true);
    } catch (err) {
      // Keep the form as it is so nothing typed is lost.
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!base) return;
    setBusy(true);
    setError(null);
    try {
      const { api } = await getApi();
      await api.remove(base.id);
      if (tab.id !== undefined) void noteSaved(tab.id, tab.url, false);
      onRemoved();
      finish("Moved to Trash");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="ok" role="status"><strong>{done}</strong></p>;

  if (base && !editing) {
    return (
      <div className="saved-card">
        <p className="ok" role="status"><strong>✓ Already saved</strong></p>
        <div className="t">{base.title || base.url}</div>
        <div className="u">{base.domain}</div>
        <div className="actions">
          <button className="primary" onClick={() => setEditing(true)} disabled={busy}>Edit</button>
          <button className="danger" onClick={remove} disabled={busy}>Remove</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  const suggestions = tags.filter((t) => !selected.includes(t.name)).sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <form onSubmit={save}>
      <label htmlFor="title">Title</label>
      <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="Filled in by Pitara if left empty" />
      <label htmlFor="url">Address</label>
      <input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048} required />
      <label htmlFor="collection">Collection</label>
      <select id="collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
        <option value="">Unsorted</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <label htmlFor="tags">Tags</label>
      <input id="tags" type="text" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="comma, separated" list="tag-suggestions" autoComplete="off" />
      <datalist id="tag-suggestions">
        {tags.map((t) => <option key={t.id} value={t.name} />)}
      </datalist>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((t) => (
            <button type="button" key={t.id} className="chip" onClick={() => toggleTag(t.name)}>#{t.name}</button>
          ))}
        </div>
      )}
      <label htmlFor="note">Note</label>
      <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={20000} />
      <div className="toggles">
        <button type="button" className="toggle" aria-pressed={favorite} onClick={() => setFavorite(!favorite)}>
          {favorite ? "★" : "☆"} Favorite
        </button>
        <button type="button" className="toggle" aria-pressed={unread} onClick={() => setUnread(!unread)}>
          To read
        </button>
      </div>
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || url.trim() === ""}>
          {busy ? "Saving…" : base ? "Save changes" : "Save"}
        </button>
        {base && <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
