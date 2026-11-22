import { useEffect, useState } from "react";
import type { ApiBookmark } from "@shared/types";
import { errorMessage } from "@/lib/errors";
import { getApi } from "@/lib/settings";

const DEBOUNCE_MS = 250;

export function SearchTab() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ApiBookmark[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { api } = await getApi();
        // Empty search lists the newest bookmarks.
        const found = await api.search(q.trim(), 20);
        if (!cancelled) {
          setResults(found);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    }, q === "" ? 0 : DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const open = (url: string) => {
    void chrome.tabs.create({ url });
    window.close();
  };

  return (
    <div>
      <label htmlFor="q" style={{ position: "absolute", left: -9999 }}>Search bookmarks</label>
      <input id="q" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved bookmarks (#tag, @collection)" style={{ marginTop: 10 }} />
      {error && <p className="error" role="alert">{error}</p>}
      {results && results.length === 0 && !error && <p className="muted">{q ? "Nothing found." : "No bookmarks yet."}</p>}
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((b) => (
            <li key={b.id}>
              <button onClick={() => open(b.url)} title={b.url}>
                <img src={b.faviconUrl ?? "favicon.svg"} alt="" onError={(e) => { e.currentTarget.src = "favicon.svg"; }} />
                <span className="text">
                  <div className="t">{b.title || b.url}</div>
                  <div className="d">{b.domain}</div>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
