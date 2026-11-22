# Pitara — Build Spec

**Pitara** (पिटारा, "treasure basket") is a private bookmark manager with a web app at
`https://pitara.pknspace.com`, an Android app, and a Chrome extension. All three talk to one
Convex backend. Only allowlisted emails can sign in.

Inspiration: [Raindrop.io](https://raindrop.io) (collections, visual cards, share-sheet and
extension saving) and [linkding](https://linkding.link) (fast, minimal, tags, search, API,
import/export). Take Raindrop's polish and linkding's speed and simplicity. No bloat.

## How to use this file

This spec is built one **step** at a time, **each in a new Claude session** (see "Build steps").
Every step lists what to read first, what to build and how to know it's done. A session should:

1. Read `/Users/resiliencesoft/Desktop/praveen/personal/CLAUDE.md` (shared conventions, deploy, Convex, layout)
   and this whole file.
2. Do only its step. Don't start the next one.
3. Update the README and the "Status" table at the bottom of this file when done.

Sibling projects to copy from (read them, don't trust memory). Where this spec is silent,
**copy the sibling**:

| For | Copy from |
|---|---|
| Repo layout, scripts, `scripts/check.sh`, `deploy.sh` | `../tippani` (Expo + web + backend), `../chayan` (web + backend) |
| Auth, allowlist, OTP email codes, `access.ts` | `../tippani/backend/convex`, `../karya/backend/convex/otp.ts` |
| Tags + join-table pattern, search index, trash + daily cron, pagination | `../tippani/backend/convex/{notes,tags,crons}.ts` |
| Web app shell, sidebar, sign-in page, shadcn setup | `../tippani/web`, `../suchi/web` |
| Expo app, `cmp-*` wrappers, update check, EAS/Android scripts | `../tippani/mobile`, `../suchna/mobile` |
| Release workflow (Android) | `../alp/.github/workflows/release.yml` |
| kunji tools (optional, last step) | `../tippani/backend/convex/{kunji.ts,lib/kunji.ts}`, `../kunji/README.md` |

## Product

A bookmark is a saved URL with a title, description, note, tags and an optional collection.

- **Save fast** from everywhere: paste a URL on web, click the extension, or share a link from
  any Android app. A saved bookmark gets its title, description, favicon and preview image
  filled in by the server in the background; the user never waits for that.
- **Collections:** named folders, up to **2 levels** deep (a collection can have child collections,
  children can't). Every bookmark is in at most one collection; none = **Unsorted**.
- **Tags:** per user, many per bookmark, created inline. Rename and delete in Settings → Tags.
  Deleting a tag removes it from its bookmarks and leaves the bookmarks alone.
- **Favorites** (star) and **To read** (unread flag, like linkding's "unread"). Filters in the sidebar.
- **Duplicates:** saving a URL that already exists (after normalization) doesn't create a second
  one: it opens the existing bookmark and says so. The extension shows "Already saved" right away.
- **Search:** server-side, over title, description, note, URL and tag names; works inside the
  current collection/tag/filter. Supports `#tag` and `@collection` shortcuts in the box.
- **Views:** List, Grid (cards with image), Headlines (title only). Sort by newest / oldest /
  title / domain. The choice is remembered per device.
- **Trash:** delete moves to Trash; restore or delete forever (confirm). Daily cron removes items
  older than 30 days. "Empty trash" with confirm.
- **Bulk actions** (web): select many, then move to collection, add or remove tag, favorite, trash.
- **Import / export** (web, Settings): Netscape bookmark HTML (Chrome, Firefox, Raindrop, linkding
  all export it; folders become collections, tags from `TAGS=`), plus a JSON export of everything.
- **Not in v1:** public/shared collections, page snapshots and offline reading, browser
  bookmark sync, highlights, reminders, iOS and Firefox/Safari extensions, teams, i18n.

### Limits (enforced on the server)

URL 2,048 chars · title 500 · description 2,000 · note 20,000 · 20 tags per bookmark ·
tag name 50 · collection name 100 · 100 collections and 1,000 tags per user · 100,000
bookmarks per user · import file 10 MB / 20,000 links per import.

## Access control (most important part)

Same as tippani and the rest:

- Convex Auth, **Password** provider, with **email verification by 6-digit code at sign-up and
  "Forgot password?" by code** (Resend, `Pitara <noreply@send.pknspace.com>`; copy `otp.ts`).
- **`ALLOWED_EMAILS`** (comma-separated, case-insensitive): checked in `profile()` at sign-up and
  sign-in, and again on **every** query, mutation and HTTP API call in `requireUserId`. Unset or
  empty means nobody gets in. Generic `ConvexError("notAllowed")`; never reveal who is on the list.
  **Ask me which email to use; don't put it in the repo.**
- Every row is owned by a `userId`. The server takes the user from `getAuthUserId` (or the API
  token) and checks ownership of every id passed in (`getOwnedBookmark`, `getOwnedCollection`,
  `getOwnedTag`). Missing and foreign ids give the same error.
- **No public queries.** The only public HTTP routes are Convex Auth's and `/api/v1/*`, which need
  a token (below).

### API tokens (for the extension and scripts)

The Chrome extension doesn't use the Convex Auth session. It uses a **personal API token**, which
keeps it simple, revocable and useful for scripts (linkding-style API).

- Created in the web app: Settings → API tokens → "Create token" with a name. The token is shown
  **once** (`pit_` + 32 random bytes, base64url); only its SHA-256 hash and a short prefix are stored.
- List tokens (name, prefix, created, last used), revoke. Max 10 per user.
- `Authorization: Bearer <token>` on the HTTP API. The token resolves to a `userId`, then the same
  `ALLOWED_EMAILS` check runs.
- Rate limit the API: 60 requests per minute per token.

## Data model

```ts
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  parentId: v.optional(v.id("collections")),   // one level of nesting only
  sortOrder: v.number(),
  bookmarkCount: v.number(),                   // live bookmarks directly in it (stored counter)
  updatedAt: v.number(),
}).index("by_user_parent", ["userId", "parentId", "sortOrder"]),

bookmarks: defineTable({
  userId: v.id("users"),
  url: v.string(),                       // as the user saved it
  normalizedUrl: v.string(),             // for duplicate detection (see shared/url.ts)
  domain: v.string(),
  title: v.string(),
  description: v.string(),
  note: v.string(),                      // the user's own note
  collectionId: v.optional(v.id("collections")),
  tagIds: v.array(v.id("tags")),
  favorite: v.boolean(),
  unread: v.boolean(),
  faviconUrl: v.optional(v.string()),
  imageUrl: v.optional(v.string()),      // og:image, stored as a URL, not downloaded
  metaStatus: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
  searchText: v.string(),                // title, description, note, url, tag names; keep in sync
  deletedAt: v.optional(v.number()),     // set = in trash
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_created", ["userId", "deletedAt", "createdAt"])
  .index("by_user_collection", ["userId", "collectionId", "deletedAt", "createdAt"])
  .index("by_user_favorite", ["userId", "favorite", "deletedAt", "createdAt"])
  .index("by_user_unread", ["userId", "unread", "deletedAt", "createdAt"])
  .index("by_user_url", ["userId", "normalizedUrl"])
  // title / domain sorts: sort key last, one copy per view that supports them
  .index("by_user_title", ["userId", "deletedAt", "title"])
  .index("by_user_domain", ["userId", "deletedAt", "domain"])
  .index("by_user_collection_title", ["userId", "collectionId", "deletedAt", "title"])
  .index("by_user_collection_domain", ["userId", "collectionId", "deletedAt", "domain"])
  .index("by_user_favorite_title", ["userId", "favorite", "deletedAt", "title"])
  .index("by_user_favorite_domain", ["userId", "favorite", "deletedAt", "domain"])
  .index("by_user_unread_title", ["userId", "unread", "deletedAt", "title"])
  .index("by_user_unread_domain", ["userId", "unread", "deletedAt", "domain"])
  // title / domain sorts: sort key last, one copy per view that supports them
  .index("by_user_title", ["userId", "deletedAt", "title"])
  .index("by_user_domain", ["userId", "deletedAt", "domain"])
  .index("by_user_collection_title", ["userId", "collectionId", "deletedAt", "title"])
  .index("by_user_collection_domain", ["userId", "collectionId", "deletedAt", "domain"])
  .index("by_user_favorite_title", ["userId", "favorite", "deletedAt", "title"])
  .index("by_user_favorite_domain", ["userId", "favorite", "deletedAt", "domain"])
  .index("by_user_unread_title", ["userId", "unread", "deletedAt", "title"])
  .index("by_user_unread_domain", ["userId", "unread", "deletedAt", "domain"])
  .index("by_deleted", ["deletedAt"])
  .searchIndex("search_text", { searchField: "searchText", filterFields: ["userId", "deletedAt", "collectionId"] }),

tags: defineTable({
  userId: v.id("users"), name: v.string(),   // name lower-cased, unique per user
  bookmarkCount: v.number(),                 // live bookmarks with the tag (stored counter)
}).index("by_user_name", ["userId", "name"]),

userStats: defineTable({                     // total bookmarks incl. trashed, for the 100,000 cap
  userId: v.id("users"), bookmarkCount: v.number(),
}).index("by_user", ["userId"]),

bookmarkTags: defineTable({                                          // mirrors bookmarks.tagIds
  userId: v.id("users"), bookmarkId: v.id("bookmarks"), tagId: v.id("tags"),
}).index("by_tag", ["tagId"]).index("by_bookmark", ["bookmarkId"]),

apiTokens: defineTable({
  userId: v.id("users"), name: v.string(), prefix: v.string(),
  hash: v.string(), createdAt: v.number(), lastUsedAt: v.optional(v.number()),
}).index("by_hash", ["hash"]).index("by_user", ["userId"]),
```

Use `_id` and `_creationTime` where they fit. Index every query; no table scans, no `.filter()`
over big ranges. Lists are paginated (`usePaginatedQuery`). **Read `convex/_generated/ai/guidelines.md`
before writing Convex code.**

## Backend API (Convex functions)

- `bookmarks`: `list` (paginated; args: view = all | unsorted | collection | favorites | unread |
  trash, `collectionId?`, `tagId?`, `sort`), `search` (paginated), `get`, `create`
  (normalizes, dedupes, schedules metadata fetch, returns `{id, existed}`), `update`, `setTags`,
  `move`, `toggleFavorite`, `toggleUnread`, `trash`, `restore`, `deleteForever`, `emptyTrash`,
  `bulk` (one mutation for move / tag / favorite / trash on up to 200 ids), `findByUrl`.
- `collections`: `list` (flat, the client builds the tree, with bookmark counts), `create`, `rename`,
  `move`, `reorder`, `remove` (children move to top level, bookmarks go to Unsorted; confirm in UI).
- `tags`: `list` (with counts), `rename` (merges if the name exists), `remove`.
- `metadata`: an **internal action** that fetches the page and fills title, description,
  favicon and image, then patches the bookmark (`metaStatus` → `done` / `failed`). Rules:
  - **SSRF-safe:** http(s) only, resolve the host and refuse private, loopback and link-local
    ranges, follow at most 3 redirects (re-checking each), 5 s timeout, read at most 1 MB.
  - Parse `<title>`, `og:title`, `og:description`, `meta description`, `og:image`, `link rel=icon`;
    resolve relative URLs; never overwrite a title or description the user already typed.
  - Retry a failed fetch once an hour, at most 3 times (scheduler), then leave `failed`.
- `importExport`: `importHtml` (action: parses the Netscape HTML in chunks, creates collections
  and bookmarks, skips duplicates, returns counts), `exportJson` (action, all rows, streamed in pages).
- `apiTokens`: `create`, `list`, `revoke`.
- `users.me()`, `crons.ts` (trash purge daily, stuck-`pending` metadata retry).
- Errors are plain-string `ConvexError` codes (`notAuthenticated`, `notAllowed`, `notFound`,
  `invalidUrl`, `tooLong`, `limitReached`, `tooManyRequests`), translated on the client like
  tippani's `lib/errors.ts`.

### HTTP API (`backend/convex/http.ts`, for the extension and scripts)

All under `/api/v1`, bearer token, JSON, CORS allowed for `chrome-extension://*` and the web origin.

| Route | Does |
|---|---|
| `GET /me` | `{ email }`, used by the extension to validate a token |
| `GET /bookmarks/check?url=` | `{ exists, bookmark? }` (normalized match) |
| `POST /bookmarks` | `{ url, title?, description?, note?, collectionId?, tags?: string[], favorite?, unread? }` → `{ id, existed }` |
| `PATCH /bookmarks/:id` | edit fields, `tags`, `collectionId` |
| `DELETE /bookmarks/:id` | move to trash |
| `GET /collections`, `GET /tags` | for the extension's pickers |
| `GET /bookmarks?q=&limit=` | search (max 50), for the extension's search box |

## `shared/` (plain TS, no React, own `package.json` and tests)

Used by backend, web, mobile and extension through the `@shared` alias:
- `url.ts`: `normalizeUrl` (lower-case host, drop `#fragment`, `utm_*`/`fbclid`/`gclid` params,
  trailing slash, default ports, `www.`; keep other query params), `getDomain`, `isValidHttpUrl`.
- `limits.ts`: the limits above. `types.ts`: API shapes. `parseQuery.ts`: `#tag` / `@collection` in search.
- `netscape.ts`: parser and writer for the bookmark HTML format, with fixture files from
  Chrome, Firefox and Raindrop exports in the tests.

## Web app (`web/`)

Designed like the other web apps (React 19, Vite, Tailwind v4, shadcn/ui Base UI), not a port of
mobile. Layout like Raindrop but quieter:

- **Left sidebar** (collapsible, drawer under 768px): All bookmarks · Unsorted · Favorites · To read ·
  Trash; the collection tree (drag to reorder or nest, with dnd-kit; counts; `+` to add); Tags
  list. Account menu and theme toggle at the bottom.
- **Main:** a top bar with the search box, view switcher (List / Grid / Headlines), sort, and a
  big **Add** button. The list is paginated with infinite scroll.
- **Add bookmark:** a dialog (also `a` or `Cmd+K` then paste). Paste a URL; title appears when
  fetched; pick collection and tags; Enter saves. Pasting a URL anywhere on the page opens it.
- **Bookmark row/card:** favicon, title, domain, description snippet, tags, relative date; hover
  actions (star, to-read, edit, trash, open). Click opens the URL in a new tab. A bookmark still
  `pending` shows a small skeleton for the title.
- **Edit bookmark:** a dialog or side panel with every field.
- **Drag a bookmark onto a collection** in the sidebar to move it.
- **Bulk select:** checkbox on hover, shift-click for ranges, a floating action bar.
- **Keyboard:** `/` search, `a` add, `j`/`k` move, `Enter` open, `e` edit, `s` star, `Del` trash, `?` help.
- **Settings:** account email, theme (light / dark / system), tags (rename/delete), **API tokens**,
  import (file picker, progress, result counts), export (JSON, HTML), and a "get the Chrome
  extension / Android app" section with links.
- Routes: `/` redirects to `/all`; `/all`, `/unsorted`, `/c/:id`, `/tag/:id`, `/favorites`,
  `/unread`, `/trash`, `/settings`, `/sign-in`. Search is a `?q=` param.
- Title `Pitara`; `public/favicon.svg` is the logo (use `/favicon.svg?v=2`).

## Chrome extension (`extension/`)

Manifest V3, TypeScript, React for the popup and options page, built with Vite (multi-entry,
a small build script writes `manifest.json`; no heavy framework). Own `package.json`, `tsconfig`,
eslint, vitest. Output `extension/dist/` (load unpacked) and `pitara-extension.zip`.

- **Permissions:** `activeTab`, `storage`, `contextMenus`, `commands`, and host permission only for
  the backend's `.convex.site` origin (set at build time from `VITE_CONVEX_SITE_URL`). No
  `<all_urls>`, no content scripts. Don't read page content beyond the active tab's URL and title.
- **Popup** (toolbar click or `Alt+Shift+P`): shows the current tab's title and URL (editable), a
  collection picker, a tag input with suggestions, a note field, ☆ favorite and "To read" toggles,
  and **Save**. If the URL is already saved it says "Already saved" with Edit and Remove. A "Search"
  tab searches saved bookmarks and opens one. After saving it closes by itself after a second.
- **Context menu:** "Save link to Pitara" on links and "Save page to Pitara" on pages: quick save
  with no popup and a badge/notification showing the result.
- **Toolbar badge:** a ✓ when the current tab's URL is already saved (via `/bookmarks/check`, cached
  per tab).
- **Options page:** the Pitara URL (default `https://pitara.pknspace.com`; the API origin is derived
  from the build), the **API token** field with a "Test" button (`/me`), default collection, the
  extension version, and **Check for updates** (compares the build's commit SHA with
  `https://api.github.com/repos/mepkn/pitara/releases/latest`; for the sideloaded zip it only shows a
  link to the download, it can't self-install).
- The token lives in `chrome.storage.local`, never in sync storage and never logged.
- Works offline-gracefully: a failed save shows the error and keeps the form; no silent queue in v1.
- Name `Pitara`, icons 16/32/48/128 generated from the logo.
- Distribution v1: GitHub Release asset `pitara-extension.zip` (load unpacked). Chrome Web Store is a later, separate task.

## Android app (`mobile/`)

Expo (latest SDK, read the versioned docs) + Expo Router + NativeWind + React Native Reusables,
exactly like tippani/panna: `cmp-*` wrappers, `react-native-keyboard-controller`, strings in
`src/lib/strings.ts`, `@/` → `src/`, `@convex/` and `@shared/` aliases via Metro `watchFolders`.
Android only. Development build, not Expo Go. App id `com.pknspace.pitara`, scheme `pitara`.

- **Share target (core, not optional):** sharing a link or text containing a URL from any app opens a
  small "Save to Pitara" sheet (collection, tags, note) and saves. Use a maintained Expo
  share-intent library; check its Expo SDK compatibility first. If the app is signed out, sign in,
  then continue the save.
- **Tabs:** Bookmarks, Collections, Tags, Search; settings is a header gear.
- **Bookmarks list:** same views as web (List / Grid / Headlines), pull to refresh, infinite scroll,
  swipe to star or trash, long-press for bulk select. Tap opens the link in the browser (Android
  custom tab via `expo-web-browser`); long-press menu has Edit, Copy link, Share, Move.
- **Add bookmark** (+ button): paste field prefilled from the clipboard if it holds a URL.
- **Edit screen**, **Trash**, **Favorites**, **To read** like web.
- **Settings:** email, theme, log out, app version, **Check for updates** (copy suchna's
  `update.ts` + `use-update-check.ts`, `EXPO_PUBLIC_COMMIT`, `REQUEST_INSTALL_PACKAGES`).
- Sign-in, sign-up with the 6-digit code, and Forgot password: copy tippani's auth form and the
  code steps.
- No import/export or API tokens on mobile in v1 (web only).

## Stack and conventions

Match the sibling repos (see CLAUDE.md "Stack" and "Repo layout"):

```
pitara/
  backend/    Convex (+ @convex-dev/auth), tests with convex-test
  shared/     plain TS: url normalization, limits, types, Netscape parser (own package.json, tests)
  web/        Vite + React 19 + Tailwind v4 + shadcn/ui (Base UI)
  extension/  Chrome MV3, Vite + React
  mobile/     Expo, Android only
  scripts/    check.sh, deploy.sh, deploy-backend.sh, deploy-web.sh, eas.sh, build-android.sh,
              build-extension.sh, load-env.sh
  .github/workflows/release.yml   Android APK + extension zip
  README.md, SPEC.md, CLAUDE.md, AGENTS.md, LICENSE, .gitignore, .nvmrc (22)
```

- No root `package.json`; separate installs per part; `check` (typecheck + lint + tests) in every part;
  `scripts/check.sh` runs them all.
- Convex dev is a **local anonymous** deployment; prod project `pitara` in team `praveen-nirmalkar`.
- Env vars on each deployment: `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `ALLOWED_EMAILS`,
  `RESEND_API_KEY` (key named `pitara-api-key`, set by the user with `scripts/set-resend-key.sh pitara`).
- Colour and look: warm, friendly "basket" feel. Primary a saffron/terracotta (`#D9822B`-ish) on
  warm neutrals, with a good dark theme. Logo: a simple woven basket / lidded round basket glyph in
  SVG, readable at 16 px. Choose the exact palette in step 0 and write it in the README.
- Tests (convex-test + Vitest) must cover: non-allowlisted sign-in rejected; removed email loses
  access (also via API token); user A can't read, move, tag or delete user B's data; duplicate
  detection and URL normalization; limits enforced; trash/restore/purge; search scoping;
  tag rename-merge; collection depth rule and delete behaviour; token create/revoke/hash-only
  storage and rate limit; SSRF refusals (private IPs, redirects to private IPs); Netscape import
  round-trip.

## Deployment

- Web: `https://pitara.pknspace.com`, `/var/www/pitara`, standard SPA Caddy block (CLAUDE.md).
  **I create the subdomain / Cloudflare hostname myself; ask me when it's needed.**
- Backend: Convex prod deployment `pitara` + deploy key in `backend/.env.prod.local`.
- Android and extension: one **Release** workflow (manual only), job `android` (copy alp's) and job
  `extension` (build, zip as `pitara-extension.zip`); `publish` attaches `pitara.apk` and
  `pitara-extension.zip` to a release tagged with the short SHA.
- After going live, add Pitara on the dashboard (`https://dash.pknspace.com/edit`) with web, APK,
  extension and source links.
- GitHub: `mepkn/pitara`, public, set About + topics (CLAUDE.md "GitHub").

## Rules for every session

- No AI attribution or `Co-Authored-By` lines in commits or PRs. Commit prefixes `feat:` / `fix:` / `chore:` ...
- Never print secrets: deploy keys, tokens, `.env*.local` values, VPS details. Never write the VPS
  host, IP or port into tracked files.
- **Commit, push, deploy, create GitHub repos or Convex prod projects only when I ask.**
- Things only I can do (sudo, Cloudflare hostname, Resend key, sign-ins): list them for me, and add
  each with `ghostex needs-you add`. Never ask me to paste a secret in chat.
- Run `scripts/check.sh` before saying a step is done. Say plainly what you verified and what you didn't.
- Read the installed versions' docs for Expo, Convex, shadcn and any new library; don't trust memory.

---

## Build steps

Each step is one new session. Start it with: *"Read `pitara/SPEC.md` and the shared `CLAUDE.md`, then do Step N."*
Steps 0–2 must go in order. After Step 3, steps 4, 5 and 6 can go in any order, but do 4 (deploy)
before testing the extension or mobile against production.

### Step 0: Scaffold the repo and backend skeleton

Read first: tippani's `backend/`, `scripts/`, README; karya's `otp.ts`.
Build: `pitara/` repo layout (all folders, empty parts get a README stub), `git init` on `main`,
`.gitignore`, `.nvmrc`, LICENSE, AGENTS.md/CLAUDE.md for the project, **backend only**: Convex with
password auth, OTP verify and reset, `ALLOWED_EMAILS` (profile + `requireUserId`), `users.me`, the
full `schema.ts` above, `scripts/check.sh`, `setup:auth`, local anonymous deployment running. `shared/`
package with `limits.ts` and `url.ts` + tests. Decide the palette and logo (SVG).
Done when: `scripts/check.sh` passes; allowlist and OTP tests pass; `npx convex dev --once` works in `backend/`;
README follows the CLAUDE.md section order.

### Step 1: Bookmarks, collections, tags (backend logic)

Read first: tippani's `notes.ts`, `tags.ts`, `lib/tagLinks.ts`, `crons.ts`, and their tests.
Build: everything under "Backend API" except `metadata`, `importExport` and `apiTokens`; trash cron;
`shared/` `parseQuery`; the tests listed under Stack for these parts. Create with metadata `pending`
(the fetch lands in step 2).
Done when: all functions exist with tests for ownership, duplicates, limits, trash, search, tags,
collection depth; `scripts/check.sh` passes.

### Step 2: Metadata fetch, API tokens, HTTP API, import/export

Read first: tippani's `http.ts` and `kunji.ts` (HTTP action patterns).
Build: the `metadata` action with SSRF protection and retries, `apiTokens`, `/api/v1/*` routes
with CORS and rate limiting, `shared/netscape.ts` + `importExport`, remaining tests (with fixtures).
Done when: tests pass including SSRF and token cases; a local `curl` with a created token saves and
fetches a real page's metadata (use `example.com`); `scripts/check.sh` passes.

### Step 3: Web app

Read first: tippani's `web/`, suchi's `web/` (shadcn setup), shared `CLAUDE.md` web notes.
Build: the whole "Web app" section: shell, sidebar, three views, add/edit dialogs, search, bulk actions,
drag to move, keyboard shortcuts, settings (tags, tokens, import/export), sign-in with OTP steps.
Verify in the browser against the local backend (screenshots of light, dark, mobile width).
Done when: `scripts/check.sh` and `npm --prefix web run build` pass and I can use it daily locally.

### Step 4: Deploy backend + web

Read first: chayan's and tippani's `scripts/deploy*.sh`, CLAUDE.md "Deploy" and "Convex".
Build: `scripts/deploy.sh` / `deploy-backend.sh` / `deploy-web.sh` (+ `DRY_RUN`), `.env.example` files, README
Deployment section. With my go-ahead: create the Convex prod project and deployment, deploy key,
env vars, GitHub repo `mepkn/pitara` (+ About). Give me the **needs-you** list: subdomain/tunnel,
Resend key, `ALLOWED_EMAILS`. Then deploy and test sign-up, sign-in, reset on prod.
Done when: `https://pitara.pknspace.com` works end to end on prod.

### Step 5: Chrome extension

Read first: this spec's "Chrome extension" section, the HTTP API table, Chrome MV3 docs (current).
Build: the `extension/` part, `scripts/build-extension.sh`, tests for the API client, token handling and
tab-URL logic. Load it unpacked in Chrome and test save, duplicate, context menu, badge, shortcut, options,
bad token, offline. Prod URL is the default; allow a dev URL via build env.
Done when: `npm --prefix extension run check` passes and the manual checks above are shown to work.

### Step 6: Android app

Read first: tippani's and suchna's `mobile/`, their READMEs and `update.ts`.
Build: the whole "Android app" section, including the share target and the update check; `scripts/eas.sh`,
`build-android.sh`; an installed development build on a device or emulator, tested against the backend.
Done when: `npm --prefix mobile run check` passes; I can share a link from Chrome into Pitara and see it on the web.

### Step 7: Release workflow, update checks, dashboard

Read first: alp's `release.yml`, CLAUDE.md "Deploy (VPS)" release notes.
Build: `.github/workflows/release.yml` with `android` and `extension` jobs and `publish`, the
`EXPO_PUBLIC_COMMIT` wiring, the extension's update check against the real release, README links. With my go-ahead:
run the first release and add Pitara to the dashboard (guide me on what I do by hand).
Done when: the latest-release links work: `.../releases/latest/download/pitara.apk` and `pitara-extension.zip`.

### Step 8: Polish and extras (pick what I ask for)

Candidates, each its own small session: kunji tools (`search_bookmarks`, `add_bookmark`);
dead-link checker (weekly cron, "broken" filter); public share link for a collection; page snapshots
(archive the readable text); Chrome Web Store listing; Firefox build; pasted-URL title fallback via
`oEmbed` for sites that block scrapers; keyboard shortcut help; performance pass with 20k bookmarks.

---

## Status

| Step | Status |
|---|---|
| 0 Scaffold + backend skeleton | done (2026-11-22) |
| 1 Bookmarks, collections, tags | done (2026-11-22). Schema grew counters, `userStats` and sort indexes; backend imports `shared/` by relative path; see README "How it works" for list/search/trash behaviour and error codes |
| 2 Metadata, tokens, HTTP API, import/export | done (2026-11-22). Schema grew `by_meta_status` index and `windowStart`/`windowCount` on `apiTokens`; `exportJson` is client-paged (a full library exceeds one return value); `importHtml` takes a `storageId` (upload first via `importData.generateUploadUrl`) because Node actions accept 5 MiB of arguments; import/export actions are Node actions; see README "How it works" |
| 3 Web app | done (2026-11-22). `web/` copied from suchi/tippani; see README "How it works" for behaviour and what was and wasn't checked in a browser (forgot/reset, download buttons, collection drag-to-nest/reorder and most keyboard shortcuts were not exercised live). Extension / Android links in Settings say "Coming soon" until Step 7. `web/tsconfig.app.json` has `erasableSyntaxOnly: false` |
| 4 Deploy backend + web | done (2026-11-22). Convex prod project `pitara` (deployment `capable-orca-588`), `scripts/deploy.sh` / `deploy-backend.sh` / `deploy-web.sh` (`DRY_RUN=1`), live at `https://pitara.pknspace.com`; sign-up, sign-in and reset tested on prod. GitHub repo `mepkn/pitara` and first commit still to do on request |
| 5 Chrome extension | todo |
| 6 Android app | todo |
| 7 Release workflow + dashboard | todo |
| 8 Polish and extras | todo |
