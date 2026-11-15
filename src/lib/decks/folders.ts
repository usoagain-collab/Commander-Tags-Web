// Folders on My decks (V3, migration 0056). Pure helpers; the reads and writes are in src/app/decks.
export type Folder = { id: string; name: string };
export const FOLDER_NAME_MAX = 60;
/** ?folder=none shows the decks in no folder. */
export const NO_FOLDER = "none";

/** Trimmed, inner spaces folded, at most FOLDER_NAME_MAX characters. "" means not a usable name. */
export function cleanFolderName(name: unknown): string {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, FOLDER_NAME_MAX).trim();
}

/** Whether a name is already used by another folder (names are unique per person, ignoring case). */
export function folderNameTaken(folders: Folder[], name: string, exceptId?: string): boolean {
  const key = cleanFolderName(name).toLowerCase();
  return folders.some((f) => f.id !== exceptId && f.name.toLowerCase() === key);
}

/**
 * Which decks a ?folder= value shows: a folder's id shows that folder, "none" the decks in no folder, anything else
 * (or a folder that no longer exists) every deck.
 */
export function pickFolder(param: string | undefined, folders: Folder[]): { id: string | null; noFolder: boolean } {
  if (param === NO_FOLDER) return { id: null, noFolder: true };
  return { id: param && folders.some((f) => f.id === param) ? param : null, noFolder: false };
}

export function inFolder<T extends { folder_id: string | null }>(decks: T[], pick: { id: string | null; noFolder: boolean }): T[] {
  if (pick.noFolder) return decks.filter((d) => !d.folder_id);
  if (pick.id) return decks.filter((d) => d.folder_id === pick.id);
  return decks;
}

/** Deck count per folder id, plus "none" for decks in no folder. */
export function folderCounts(decks: { folder_id: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decks) {
    const k = d.folder_id ?? NO_FOLDER;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function byFolderName(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
