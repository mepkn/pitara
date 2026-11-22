# extension

The Pitara Chrome extension (Manifest V3, Vite + React). Built in Step 5 of `../SPEC.md`; how it works and what was checked is in `../README.md` ("Chrome extension").

```bash
npm install
npm run check                          # typecheck + lint + tests
cd .. && scripts/build-extension.sh    # production build -> extension/dist + pitara-extension.zip
cd .. && EXT_ENV=dev scripts/build-extension.sh   # against the local backend, no zip
```

Load `extension/dist` from `chrome://extensions` (Developer mode → Load unpacked), then open the extension's options and paste an API token from Pitara → Settings → API tokens.

Icons 16/32/48/128 are generated from `../web/public/favicon.svg` at build time.
