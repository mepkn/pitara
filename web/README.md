# web

The Pitara web app (Vite + React 19 + Tailwind v4 + shadcn/ui on Base UI), built in Step 3 of `../SPEC.md`. See the root `README.md` ("How it works") for the code map and behaviour.

```bash
npm install
npm run dev     # http://localhost:5173, uses ../backend/.env.local (run the backend first)
npm run check   # typecheck + lint + tests
npm run build   # tsc -b && vite build -> dist/
```

`public/favicon.svg` is the logo (reference it as `/favicon.svg?v=2`). Production deploy settings go in `.env.prod.local` (see `.env.example`; Step 4).
