# Pitara

Pitara (पिटारा, "treasure basket") is a private bookmark manager: save links from the web, a Chrome extension or an Android share sheet, and find them again with collections, tags and search.

Platforms: web at <https://pitara.pknspace.com>, an Android app and a Chrome extension, all on one Convex backend. The full plan and build steps are in [SPEC.md](SPEC.md); this README describes what exists today (Steps 0–3: backend with bookmark, collection and tag logic, metadata fetch, API tokens and HTTP API, import/export, and the web app).

## Features

- Only allowlisted emails can sign in (`ALLOWED_EMAILS`, checked at sign-up/sign-in and on every request)
- Email + password accounts; sign-up and "Forgot password?" use a 6-digit code by email
- Bookmarks with collections (2 levels), tags, favorites, to-read, duplicate detection, search (`#tag`, `@collection`), five views and four sorts, trash with a 30-day purge, bulk actions
- A saved link gets its title, description, favicon and preview image from the page in the background (SSRF-guarded, retried hourly up to 3 times)
- Personal API tokens and a token-protected HTTP API (`/api/v1`) for the Chrome extension and scripts
- Import of Netscape bookmark HTML (Chrome, Firefox, Raindrop, linkding) and JSON / HTML export, from Settings
- Web app (`web/`): sidebar with a drag-and-drop collection tree and tags, List / Grid / Headlines views, add and edit dialogs, search, bulk select, keyboard shortcuts, light and dark themes, a drawer under 768 px
- Planned (later steps): Chrome extension, Android app with share target

## Stack

Convex · @convex-dev/auth (Password + Resend OTP) · Node actions (metadata fetch, import/export) · TypeScript · Vitest · convex-test · React 19 · Vite · Tailwind v4 · shadcn/ui (Base UI) · dnd-kit · (planned) Expo · Chrome MV3

## Development

Node 22.18+ (`.nvmrc` pins `22`). Dev uses a **local anonymous Convex deployment** on this Mac (no cloud project); its data is in `backend/.convex/` (git-ignored). Without `RESEND_API_KEY` the email codes are only logged in the `convex dev` output. Each part has its own `package.json` and `.env.example`; there is no root `package.json`.

```bash
cd shared && npm install && cd ..
cd backend && npm install
CONVEX_AGENT_MODE=anonymous npx convex dev --once   # first time: creates the local deployment and .env.local
npm run dev                                          # keep running; in another terminal:
npm run setup:auth                                   # JWT_PRIVATE_KEY + JWKS on the local deployment
printf '%s' 'http://localhost:5173' | npx convex env set SITE_URL
printf '%s' 'you@example.com' | npx convex env set ALLOWED_EMAILS
cd ../web && npm install && npm run dev            # http://localhost:5173 (reads ../backend/.env.local)
cd .. && scripts/check.sh
```

Create `backend/.env.local` with empty `VITE_CONVEX_URL=` and `VITE_CONVEX_SITE_URL=` lines before the first `convex dev`, so Convex keeps those names.

## Scripts

| Command | What it does |
|---|---|
| `scripts/check.sh` | Typecheck, lint and tests for every part that has a `package.json` |
| `npm run dev` (in `backend/`) | Run the local Convex backend |
| `npm run dev` / `build` / `check` (in `web/`) | Vite dev server / production build (`dist/`) / typecheck + lint + tests |
| `npm run check` (in `backend/`, `shared/`) | Typecheck + lint + tests |
| `npm run setup:auth` (in `backend/`) | Generate and set `JWT_PRIVATE_KEY` and `JWKS` (`npm run setup:auth -- --prod` for production) |
| `scripts/deploy.sh`, `deploy-backend.sh`, `deploy-web.sh` | Deploy to production (`DRY_RUN=1` previews); see Deployment |

## Deployment

Web is a static Vite build on the VPS at `https://pitara.pknspace.com` (Cloudflare Tunnel → Caddy → `/var/www/pitara`); the backend is the Convex prod deployment of project `pitara` (team `praveen-nirmalkar`). Conventions: `../CLAUDE.md` "Deploy (VPS)" and "Convex".

| Script | What it does |
|---|---|
| `scripts/deploy.sh` | Checks, `convex deploy` (which also builds `web/` with the prod URL), then rsync to the VPS |
| `scripts/deploy-backend.sh` | Checks, then `convex deploy` only |
| `scripts/deploy-web.sh` | Checks, builds with `VITE_CONVEX_URL` from `web/.env.prod.local`, rsyncs to the VPS |

`DRY_RUN=1` on any of them previews without deploying or uploading. They read `backend/.env.prod.local` (`CONVEX_DEPLOY_KEY`) and `web/.env.prod.local` (`DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_DIR`, and for `deploy-web.sh` `VITE_CONVEX_URL`); both are git-ignored, mode 600, read line by line and never sourced. Each part's `.env.example` lists the names.

One-time setup (the new-project steps in `../CLAUDE.md`), run in `backend/`:

```bash
npx convex project create pitara --team praveen-nirmalkar
npx convex deployment create praveen-nirmalkar:pitara:production --type prod --default
npx convex deployment token create pitara-deploy --deployment praveen-nirmalkar:pitara:production --save-env .env.prod.local
# prod env vars: load CONVEX_DEPLOY_KEY from .env.prod.local, `unset CONVEX_DEPLOYMENT`, then
npm run setup:auth -- --prod   # JWT_PRIVATE_KEY + JWKS
npx convex env set SITE_URL https://pitara.pknspace.com   # and ALLOWED_EMAILS
scripts/set-resend-key.sh pitara                          # from ../, key named pitara-api-key
```

On the VPS: `mkdir /var/www/pitara` and add `/etc/caddy/sites/pitara.caddy` (the standard SPA block from `../CLAUDE.md`), then reload Caddy. The `pitara` subdomain / tunnel hostname is created by hand in Cloudflare.

## How it works

- **Access control:** `backend/convex/auth.ts` rejects non-allowlisted emails in `profile()` (sign-up, sign-in and reset) with `notAllowed`. `backend/convex/lib/access.ts` `requireUserId` re-checks the allowlist on every call, so removing an email cuts off live sessions. Unset or empty `ALLOWED_EMAILS` allows nobody. `getOwnedBookmark`/`getOwnedCollection`/`getOwnedTag` give `notFound` for missing and foreign ids alike.
- **Convex env vars (each deployment):** `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`, `ALLOWED_EMAILS`, `RESEND_API_KEY`.
- **Code map:** `backend/convex/{schema,auth,otp,users,http,bookmarks,collections,tags,crons,metadata,metadataFetch,apiTokens,apiV1,importData,importExport}.ts`, `backend/convex/lib/{access,allowlist,env,bookmarkWrites,tokens,apiBody,apiRoutes,ssrf,safeFetch,htmlMeta,collectMetadata,nodeTransport,importConfig}.ts`, tests beside them (`test.net.ts` + `test.setup.ts` fake the network); `shared/{limits,url,tags,parseQuery,html,netscape,types}.ts` and `shared/fixtures/` (limits, URL normalization, tag names, `#tag`/`@collection` parsing, HTML helpers, Netscape parser and writer, API shapes, with tests). The backend imports `shared/` by relative path (`../../shared/...`), which Convex's bundler and vitest both resolve.
- **One write path:** every change to a bookmark's collection, tags or trash state goes through `lib/bookmarkWrites.ts` (`applyChanges`, `addBookmark`, `removeBookmark`). It keeps `collections.bookmarkCount` and `tags.bookmarkCount` (live bookmarks only), the `bookmarkTags` join rows, `bookmarks.searchText` and `userStats.bookmarkCount` (all bookmarks, for the 100,000 cap) in step. Tests call `expectConsistent` (in `test.helpers.ts`) to recompute all of it from the rows.
- **Bookmarks API behaviour:**
  - Tags are passed and returned by name where they are written (`tags: string[]`, created inline, normalized lower-case) and by id in lists.
  - `list` takes `view` (all, unsorted, collection, favorites, unread, trash), `sort` (newest, oldest, title, domain; title and domain are plain code-point order) and an optional `tagId`. A collection's view shows only the bookmarks directly in it, not its children's. Trash ignores `sort` and shows the most recently trashed first. A tag view ignores `view` and `sort`, shows most recently tagged first, and skips trashed bookmarks (a page can be short, so keep paging until `isDone`).
  - `search` works inside a `view` / `collectionId` / `tagId`. The words go through the search index; `#tag` and `@collection` (quoted if they contain spaces) narrow the result further and match only the caller's own names. With only shortcuts and no words it lists newest first. Some filters (favorites, unread, tag, trash) apply after the index, so pages can be short: keep paging until `isDone`.
  - `create` on a URL that already exists (after normalization) returns `{ id, existed: true }` and changes nothing; if the existing one was in the trash it is restored. Metadata stays `pending` until Step 2 schedules the fetch (marked in `insertBookmark`).
  - Trashed bookmarks can't be edited (`inTrash`); `bulk` skips them. Deleting a collection moves its children to the top level and its bookmarks (trashed ones too) to Unsorted. Renaming a tag to an existing name merges the two; renaming rewrites the search text of its bookmarks in batches. Big operations (empty trash, tag delete/merge/rename, collection delete) continue in scheduled batches.
  - Counts: `collections.list` and `tags.list` return live-bookmark counts from the stored counters.
- **Error codes** (plain-string `ConvexError`, for the clients' `errors.ts`): `notAuthenticated`, `notAllowed`, `notFound`, `invalidUrl`, `tooLong` (every length cap), `limitReached` (every count cap), plus `invalidName` (empty name), `invalidParent` (collection nesting rule), `duplicate` (editing a URL to one already saved), `inTrash`, `notInTrash`. `tooManyRequests` and `badRequest` (a malformed request body) come from the HTTP API (Step 2), where they are `429` and `400`.

- **Metadata fetch** (`metadata.ts`, `metadataFetch.ts`, `lib/{safeFetch,ssrf,htmlMeta,collectMetadata,nodeTransport}.ts`): `insertBookmark` (and an edit that changes the URL) schedules `internal.metadataFetch.run`, so saving never waits. The action is a Node action because it needs DNS and sockets. Rules, all in plain TS and tested without a network (the real transport is swapped for `test.net.ts` by `test.setup.ts`): http(s) only, no credentials in the URL, every host name resolved and **every** answer must be a public address (private, loopback, link-local, CGNAT/Tailscale `100.64/10`, multicast, reserved, documentation, 6to4/Teredo/NAT64 and IPv4-mapped IPv6 are refused), and the connection goes to the checked address (so a second DNS answer can't swap in a private one) with the real name as `Host`/SNI. At most 3 redirects, each re-checked from scratch; one 5 s budget for the whole walk; at most 1 MB read (gzip/deflate/br are decoded under the same cap). The result is written by `metadata.finish`, which re-reads the bookmark and ignores it if it was deleted, trashed or its URL changed meanwhile; it fills title and description only while they are empty (typed text is never overwritten), cuts over-long text instead of failing, and sets `faviconUrl` (falling back to `/favicon.ico`) and `imageUrl`. Failures: `metaStatus` becomes `failed`; timeouts, network errors, 408/429 and 5xx are retried once an hour, at most 3 times; refusals and other 4xx are not. A non-HTML page (PDF, image) is `done` with nothing filled. The hourly cron `retryStuck` re-queues bookmarks left `pending` for over an hour (trashed ones wait until restored). Imported links are queued 300 ms apart.
- **API tokens** (`apiTokens.ts`, `lib/tokens.ts`): `create` is an action (secure randomness; mutations are deterministic) that returns `pit_` + 32 random bytes as base64url **once**; only the SHA-256 (hex) and the first 8 characters are stored. Max 10 per user, names up to 60 characters. `list` shows name, prefix, created and last used; `revoke` deletes. `authenticate` (internal) maps a hash to a user, re-checks `ALLOWED_EMAILS`, and counts the call: **60 per token per one-minute window** (a counter on the token row inside the same transaction, so it can't race; refused calls aren't counted; `lastUsedAt` is written at most once a minute). Over the limit gives `429` with `Retry-After`.
- **HTTP API** (`lib/apiRoutes.ts`, `apiV1.ts`, `lib/apiBody.ts`; shapes in `shared/types.ts`): all under `/api/v1`, `Authorization: Bearer <token>`, JSON. The user always comes from the token and every internal function re-checks the allowlist. Ids from the URL or body go through `normalizeId`, so a malformed, missing or foreign id is the same `404 notFound`.

  | Route | Does |
  |---|---|
  | `GET /me` | `{ email }` |
  | `GET /bookmarks/check?url=` | `{ exists, bookmark? }` (normalized match; trashed counts as not saved) |
  | `GET /bookmarks?q=&limit=` | search (`#tag`, `@collection`), 1–50, default 20; without `q` the newest. Hits carry `hasNote`, not the note |
  | `POST /bookmarks` | `{ url, title?, description?, note?, collectionId?, tags?, favorite?, unread? }` → `201 { id, existed: false }`, or `200 { id, existed: true }` for a duplicate |
  | `PATCH /bookmarks/:id` | any of those fields; `collectionId: null` = Unsorted; `tags` replaces; returns the bookmark |
  | `DELETE /bookmarks/:id` | moves to the trash (`{ ok: true }`) |
  | `GET /collections`, `GET /tags` | `{ collections }`, `{ tags }` |

  Errors are `{ "error": code }`: `401 notAuthenticated` (no or unknown token), `403 notAllowed`, `404 notFound`, `400 invalidUrl | tooLong | invalidName | badRequest`, `409 limitReached | duplicate | inTrash`, `429 tooManyRequests`, `500 serverError` (nothing else is revealed). CORS: `OPTIONS` preflights need no token; `Access-Control-Allow-Origin` is echoed only for `chrome-extension://*` and `SITE_URL`, on errors too.
- **Import / export** (`importExport.ts` Node actions, `importData.ts` writes, `shared/netscape.ts`): the web app uploads the bookmark file to Convex storage (`importData.generateUploadUrl` gives the one-time URL; POST the file to it), then calls `importHtml({ storageId })` (10 MB, 20,000 links). Storage, not an argument, because **Node actions accept arguments of 5 MiB at most** (Convex limits page) and the file limit is 10 MB; the upload is deleted when the import ends, whatever the result. The file is parsed, then written 50 links per transaction (fewer if `ctx.meta.getTransactionMetrics()` says the transaction is running short), so one chunk is never half-written and running the same file again only adds what is missing. Mapping: folders become collections, **two levels at most** (links deeper than that go in the second-level folder); a browser's root folder (anything with `PERSONAL_TOOLBAR_FOLDER` / `UNFILED_BOOKMARKS_FOLDER`, or named Bookmarks bar / toolbar / menu, Other bookmarks, Mobile bookmarks, Favorites bar) is **not** a collection: its links are Unsorted and its subfolders become top-level collections. Folder names, titles and descriptions are cut to their limits. `TAGS` become tags (first 20), `TOREAD="1"` (linkding) is To read, `ADD_DATE` is the creation time (ignored if in the future), `<DD>` is the description. Links that aren't http(s) (`javascript:`, `place:`, `file:`), are too long or have no URL are skipped and counted; links already saved (any spelling of the URL, **trashed ones too, which are not restored**) are counted as duplicates. Over the caps it still imports what fits: collections beyond 100 put the link one level up or in Unsorted, tags beyond 1,000 are dropped from the link, bookmarks beyond 100,000 are counted as `overLimit`. The result is `{ found, created, duplicates, invalid, overLimit, collectionsCreated, foldersOverLimit }`. `exportJson({ cursor, numItems? })` returns one page (at most 100 bookmarks, trash last): a whole library doesn't fit one return value, so the client calls it with `cursor: null` and then each `continueCursor` until `isDone`; the first page also carries `collections` and `tags`. The web app joins the pages into the JSON file, and passes them to `writeNetscape` for the HTML export (the note is appended to the description there, since the format has one text field). Anyone allowlisted who learns another user's `storageId` could import that file into their own account; ids are unguessable and the file is deleted right after its import, so this was left as is.
- **Fixtures** in `shared/fixtures/` (Chrome, Firefox, Raindrop, linkding) are **written by hand** to follow what each program's export looks like (nesting, attributes, unclosed `<DT>`/`<p>`); they are not real exports. Drop a real export in and add a test when you have one.
- **Checked on a real local backend** (not only in convex-test, which enforces none of Convex's limits): token create / use / revoke with `--identity`, a 10.09 MB import through storage (2,000 links) and a 10.85 MB one refused as `tooLong`, 900 + 1,000 links with 1,900 distinct new tags (the 1,000 tag cap held), 120 links with 20 new tags each, an export page, and saving `example.com` and `http://github.com` through the HTTP API (titles fetched; `169.254.169.254`, `127.0.0.1`, `localhost` and `[::1]` refused). **Not checked live:** the whole thing on a Convex cloud deployment (Step 4), and a redirect from a public site into the private network on the real network (the httpbin attempt failed, but that could be a refusal or httpbin being unreachable; it is covered by unit tests with a fake network).
- **Limits worth knowing** (Convex limits page, verified against the local backend): a function may make 4,096 database reads and 8,192 writes. `importChunk` stays well inside (a 20-tag link costs about 50 reads), but `bookmarks.bulk` on 200 tag-heavy bookmarks (about 40 reads each) can pass 4,096; keep that in mind in Step 3 (send smaller batches) or lower `LIMITS.bulkIds`.
- **Notes for Step 3:** `backend/convex/tsconfig.json` now lists `"types": ["node"]` (TypeScript 6 loads no `@types` on its own) for the Node actions; the web app imports `@convex/_generated/api`, which pulls in those files, so `web/` needs `@types/node` and `"node"` in its `types`. `tsc` there also needs `backend/` installed.

- **Web app** (`web/`, Vite + React 19 + Tailwind v4 + shadcn/ui on Base UI; copied from tippani and suchi): `src/components/` (`Shell` holds the layout, drag-and-drop context, global keys and selection; `Sidebar`, `TopBar`, `BookmarkList` / `BookmarkItem`, `AddDialog`, `EditDialog`, `BulkBar`, `SettingsPage`, `SignInPage`), `src/hooks/` (`use-bookmark-list` paging, `use-selection`, `use-bulk`, `use-data`, `use-theme`), `src/lib/` (pure logic with tests: `router`, `tree`, `moves`, `selection`, `exportFile`, `errors`; `strings.ts` holds every UI string). It imports `@convex` (`../backend/convex`) and `@shared` (`../shared`) by alias and reads `backend/.env.local` (`envDir`). `tsconfig.app.json` sets `erasableSyntaxOnly: false` because the typecheck follows imports into backend code that uses constructor parameter properties.
  - **Behaviour worth knowing:** routes are `/all /unsorted /c/:id /tag/:id /favorites /unread /trash /settings`, search is `?q=` (debounced). View and sort are kept in `localStorage` per device; sort is disabled in Trash, tag views and search (fixed order). Lists need no "load more" click: while the backend says `CanLoadMore` and the sentinel is visible, the next page is requested (short pages are normal). Lists carry tag ids, so `tags.list` is loaded once to show names; writes send names. Bulk actions go out in batches of 50 and the `changed` counts are added up. Dragging a bookmark (or the whole selection) onto a collection or Unsorted moves it; collections reorder among siblings by drag, nest by dropping onto another group's top-level row, and "Move to…" / "Move up/down" in the collection menu do the same without dragging. `lib/moves.ts` checks the two-level rule before any call. Single-key shortcuts and paste-to-add ignore events while typing or while a dialog is open. A pasted token is shown once, in a dialog, and never stored. Import uploads the file to storage first (`importData.generateUploadUrl`), then `importHtml`. Export pages through `exportJson` and builds the files in the browser.
  - **Checked in a real browser against the local backend:** sign-up with the emailed code, add, duplicate (the URL with a fragment opened the existing bookmark), background title fetch, edit with tag and collection, `#tag @collection` search, import of `shared/fixtures/chrome.html`, drag a bookmark onto a collection, shift-click range select, bulk trash, restore, empty trash, token create and revoke, grid view, light and dark themes, 390 px width and the drawer. **Not checked live:** "Forgot password?" and the reset code step (same code as tippani's), JSON / HTML download buttons (the assembly is unit-tested), drag-to-nest and drag-to-reorder of collections (the planner is unit-tested), the `j k Enter e s Del ? /` shortcuts and paste-to-add, the Move-to menu, and keyboard drag.
  - **Browser testing notes:** a password-manager overlay can sit over the top bar and swallow real clicks on Add (the app is fine: use `A` or Cmd+K). dnd-kit needs real pointer movement, so a one-step scripted drag does nothing.

### Look and feel

Warm "basket" feel: saffron/terracotta primary on warm neutrals. Logo: `web/public/favicon.svg` (lidded woven basket, readable at 16 px).

| Token | Light | Dark |
|---|---|---|
| primary | `#D9822B` | `#E8963F` |
| primary-foreground | `#FFF8EE` | `#2A1A08` |
| background | `#FBF7F1` | `#1C1814` |
| card | `#FFFFFF` | `#25201A` |
| foreground | `#2B2218` | `#F1E9DD` |
| muted | `#F1E9DD` | `#2F2820` |
| muted-foreground | `#7C6E5C` | `#A89A87` |
| border | `#E6DBCB` | `#3A3128` |
| destructive | `#C2410C` | `#F97316` |
