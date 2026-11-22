import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Three entries: the popup and options pages (HTML) and the service worker, which must keep a
// fixed file name because manifest.json points at it. scripts/build.mts runs this build, then
// writes manifest.json and the icons into dist/.
//
// Build env (set by scripts/build-extension.sh):
//   VITE_CONVEX_SITE_URL  the backend's .convex.site origin: API calls and the only host permission
//   VITE_COMMIT           short commit SHA, for "Check for updates"
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Not the backend's .env.local: the build script passes the API origin explicitly so a stray
  // local file can never point a release build at the dev backend.
  envDir: path.resolve(import.meta.dirname, "env-none"),
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "../shared"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: path.resolve(import.meta.dirname, "popup.html"),
        options: path.resolve(import.meta.dirname, "options.html"),
        background: path.resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
