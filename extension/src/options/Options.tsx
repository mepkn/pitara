import { useEffect, useState } from "react";
import type { ApiCollection } from "@shared/types";
import { API_ORIGIN, COMMIT, EXTENSION_ZIP_URL } from "@/lib/config";
import { ApiError, errorMessage } from "@/lib/errors";
import { apiFor, cleanWebUrl, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "@/lib/settings";
import { collectionOptions } from "@/lib/tree";
import { checkForUpdate, type UpdateStatus } from "@/lib/update";

type Msg = { kind: "ok" | "error"; text: string } | null;

export function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [collections, setCollections] = useState<ApiCollection[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [testMsg, setTestMsg] = useState<Msg>(null);
  const [updateMsg, setUpdateMsg] = useState<{ status?: UpdateStatus; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const version = chrome.runtime.getManifest().version;

  useEffect(() => {
    void loadSettings().then(async (loaded) => {
      setS(loaded);
      if (loaded.token) await loadCollections(loaded);
    });
  }, []);

  async function loadCollections(settings: Settings) {
    try {
      setCollections(await apiFor(settings).collections());
    } catch {
      setCollections([]);
    }
  }

  if (!s) return null;
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  async function test() {
    if (!s) return;
    setBusy(true);
    setTestMsg(null);
    try {
      const me = await apiFor(s).me();
      setTestMsg({ kind: "ok", text: `Connected as ${me.email}.` });
      await loadCollections(s);
    } catch (err) {
      setTestMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!s) return;
    const clean: Settings = { ...s, webUrl: cleanWebUrl(s.webUrl || DEFAULT_SETTINGS.webUrl) };
    await saveSettings(clean);
    setS(clean);
    setMsg({ kind: "ok", text: "Saved." });
    if (clean.token) await loadCollections(clean);
  }

  async function update() {
    setUpdateMsg(null);
    try {
      setUpdateMsg({ status: await checkForUpdate() });
    } catch (err) {
      setUpdateMsg({ error: err instanceof ApiError ? errorMessage(err) : err instanceof Error ? err.message : "Could not check." });
    }
  }

  const options = collectionOptions(collections);
  const tokenSettingsUrl = `${cleanWebUrl(s.webUrl)}/settings`;

  return (
    <>
      <h1><img src="favicon.svg" alt="" />Pitara options</h1>
      <p className="muted">Save pages to your Pitara from the toolbar, the right-click menu, or <kbd>Alt+Shift+P</kbd>.</p>

      <h2>Connection</h2>
      <label htmlFor="web">Pitara URL</label>
      <input id="web" type="url" value={s.webUrl} onChange={(e) => set({ webUrl: e.target.value })} />
      <p className="muted">Used for links to your Pitara. Saving always goes to the server this extension was built for.</p>

      <label htmlFor="token">API token</label>
      <input id="token" type="password" autoComplete="off" spellCheck={false} value={s.token} onChange={(e) => set({ token: e.target.value })} placeholder="pit_…" />
      <p className="muted">
        Create one in <a href={tokenSettingsUrl} target="_blank" rel="noreferrer">Pitara → Settings → API tokens</a>. It is stored on this device only.
      </p>
      <div className="row">
        <button onClick={test} disabled={busy || s.token.trim() === ""}>Test</button>
        <span className={testMsg?.kind === "ok" ? "ok" : "error"} role="status" style={{ margin: 0 }}>{testMsg?.text}</span>
      </div>

      <label htmlFor="collection">Default collection</label>
      <select id="collection" value={s.defaultCollectionId ?? ""} onChange={(e) => set({ defaultCollectionId: e.target.value || null })}>
        <option value="">Unsorted</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <p className="muted">Where right-click saves go, and the popup's starting choice. Test the token to load your collections.</p>

      <div className="actions">
        <button className="primary" onClick={() => void save()}>Save settings</button>
        <span className={msg?.kind === "ok" ? "ok" : "error"} role="status">{msg?.text}</span>
      </div>

      <h2>About</h2>
      <p>Version {version}{COMMIT ? ` (${COMMIT})` : " (development build)"}{API_ORIGIN ? "" : " · no backend configured in this build"}</p>
      <button onClick={() => void update()}>Check for updates</button>
      {updateMsg?.error && <p className="error" role="status">{updateMsg.error}</p>}
      {updateMsg?.status?.kind === "upToDate" && <p className="ok" role="status">You're up to date.</p>}
      {updateMsg?.status?.kind === "dev" && <p className="muted" role="status">Development builds don't check for updates.</p>}
      {updateMsg?.status?.kind === "available" && (
        <p role="status">
          A newer version is available. <a href={EXTENSION_ZIP_URL} target="_blank" rel="noreferrer">Download pitara-extension.zip</a>, unzip over the old folder, then reload the extension on <code>chrome://extensions</code>.
        </p>
      )}
    </>
  );
}
