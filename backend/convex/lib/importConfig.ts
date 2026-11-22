// Tuning for the importer and exporter (importExport.ts, importData.ts).

/** Imported links written per transaction. */
export const IMPORT_CHUNK = 50;
/** Imported bookmarks get their metadata fetched one every this many ms, so 20,000 links don't hit the network at once. */
export const IMPORT_FETCH_SPACING_MS = 300;
/** Bookmarks per export page. */
export const EXPORT_PAGE_MAX = 100;
