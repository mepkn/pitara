// Build-time settings (scripts/build-extension.sh sets them; vite.config.ts documents them).
export const API_ORIGIN: string = (import.meta.env.VITE_CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
export const COMMIT: string = import.meta.env.VITE_COMMIT ?? "";
export const DEFAULT_WEB_URL = "https://pitara.pknspace.com";
export const RELEASES_API = "https://api.github.com/repos/mepkn/pitara/releases/latest";
export const RELEASES_PAGE = "https://github.com/mepkn/pitara/releases/latest";
export const EXTENSION_ZIP_URL = `${RELEASES_PAGE}/download/pitara-extension.zip`;
