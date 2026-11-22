// Builds dist/: the Vite bundle (popup, options, service worker), manifest.json and the icons.
// Run through scripts/build-extension.sh, which sets VITE_CONVEX_SITE_URL and VITE_COMMIT.
import { Resvg } from "@resvg/resvg-js";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const logo = path.resolve(root, "../web/public/favicon.svg");

const origin = (process.env.VITE_CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(origin)) {
  console.error("VITE_CONVEX_SITE_URL must be the backend's .convex.site origin (use scripts/build-extension.sh).");
  process.exit(1);
}
const commit = process.env.VITE_COMMIT ?? "";
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };

await build({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "warn" });

// Icons 16/32/48/128 from the logo, plus the logo itself for the popup and options headers.
mkdirSync(path.join(dist, "icons"), { recursive: true });
const svg = readFileSync(logo);
const icons: Record<string, string> = {};
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(path.join(dist, "icons", `${size}.png`), png);
  icons[String(size)] = `icons/${size}.png`;
}
copyFileSync(logo, path.join(dist, "favicon.svg"));

// The one host permission is the backend origin. Match patterns have no port: "http://127.0.0.1/*"
// covers the local backend on any port.
const hostPattern = `${new URL(origin).protocol}//${new URL(origin).hostname}/*`;

const manifest = {
  manifest_version: 3,
  name: "Pitara",
  version: pkg.version,
  version_name: commit ? `${pkg.version} (${commit})` : `${pkg.version} (dev)`,
  description: "Save the current page to your private Pitara bookmarks.",
  icons,
  action: { default_title: "Save to Pitara", default_popup: "popup.html", default_icon: icons },
  options_ui: { page: "options.html", open_in_tab: true },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["activeTab", "storage", "contextMenus"],
  host_permissions: [hostPattern],
  commands: {
    _execute_action: {
      suggested_key: { default: "Alt+Shift+P" },
      description: "Save the current page to Pitara",
    },
  },
};
writeFileSync(path.join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built extension ${manifest.version_name} for ${origin}`);
