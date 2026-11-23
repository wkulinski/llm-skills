// Shared identity for immutable entries, without coupling domain validation to filesystem codecs.
export const storedEntries = new WeakMap();
export function isStoredEntry(entry) { return storedEntries.has(entry); }
export function storedEntryMetrics(entry) { return storedEntries.get(entry)?.record ?? null; }
