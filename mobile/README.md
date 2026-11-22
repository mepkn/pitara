# mobile

The Pitara Android app (Expo SDK 57, Expo Router, NativeWind, React Native Reusables; Android only; app id `com.pknspace.pitara`, scheme `pitara`). It talks to the same Convex backend as the web app and imports `@convex` (`../backend/convex`) and `@shared` (`../shared`) by alias.

```bash
cd backend && npx convex dev          # local backend (leave it running)
cd ../mobile && npm install
adb reverse tcp:3210 tcp:3210 && adb reverse tcp:3211 tcp:3211   # emulator or USB phone -> this Mac
npm run android                       # prebuild + Gradle build + install the dev client, then Metro
npm start                             # later runs: Metro only (dev client already installed)
npm run check                         # typecheck + lint + tests
```

`scripts/expo.mjs` runs the Expo CLI with `EXPO_PUBLIC_CONVEX_URL` taken from `../backend/.env.local` (`VITE_CONVEX_URL`), so there is one dev env file. It is a development build, not Expo Go (the share target is native code). See the repo README for the app's behaviour and releases.
