# Pitara

Private bookmark manager: web app, Android app and Chrome extension on one Convex backend.
Read `SPEC.md` (build steps and status) and `../CLAUDE.md` (shared conventions) before working.
Parts: `backend/` (Convex), `shared/` (plain TS), `web/`, `extension/`, `mobile/`, `scripts/`.
No root `package.json`; `cd` into a part, or run `scripts/check.sh` for everything.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`backend/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
