import { COMMIT, RELEASES_API } from "./config";

// "Check for updates": releases are tagged with the short commit SHA of the build (see
// ../CLAUDE.md "Every released app checks for updates"), so a different tag means a newer build.
// A sideloaded zip cannot install itself; the options page only links to the download.

export type UpdateStatus =
  | { kind: "dev" } // a build without a commit SHA
  | { kind: "upToDate"; tag: string }
  | { kind: "available"; tag: string };

export function compareRelease(commit: string, latestTag: string): UpdateStatus {
  const current = commit.trim().toLowerCase();
  const tag = latestTag.trim();
  if (current === "") return { kind: "dev" };
  const t = tag.toLowerCase();
  // The tag is the 7-character SHA; accept a longer or shorter prefix on either side.
  return t.startsWith(current) || current.startsWith(t) ? { kind: "upToDate", tag } : { kind: "available", tag };
}

export async function checkForUpdate(fetchFn: typeof fetch = fetch, commit = COMMIT): Promise<UpdateStatus> {
  if (commit.trim() === "") return { kind: "dev" };
  let response: Response;
  try {
    response = await fetchFn(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new Error("Can't reach GitHub. Check your connection.");
  }
  if (response.status === 404) throw new Error("No release has been published yet.");
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const data = (await response.json()) as { tag_name?: unknown };
  if (typeof data.tag_name !== "string" || data.tag_name === "") throw new Error("The latest release has no tag.");
  return compareRelease(commit, data.tag_name);
}
