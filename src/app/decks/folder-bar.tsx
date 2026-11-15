"use client";

// Folders on My decks (V3): All decks, each folder, and No folder, as links (?folder=), with New folder, and
// Rename and Delete for the open folder.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FOLDER_NAME_MAX, NO_FOLDER, folderNameTaken, type Folder } from "@/lib/decks/folders";
import { createFolder, deleteFolder, renameFolder } from "./folder-actions";

type Props = { folders: Folder[]; counts: Record<string, number>; total: number; current: string | null; noFolder: boolean };

export function FolderBar({ folders, counts, total, current, noFolder }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "new" | "rename" | "delete">("view");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = folders.find((f) => f.id === current) ?? null;

  const chip = (href: string, label: string, n: number, on: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={on ? "page" : undefined}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm ${on ? "border-gold bg-gold/15 font-medium" : "border-foreground/20 hover:border-foreground/40"}`}
    >
      {label}
      <span className="opacity-60">{n}</span>
    </Link>
  );

  const submitName = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    if (folderNameTaken(folders, name, mode === "rename" ? open?.id : undefined)) return setError("You already have a folder with that name.");
    start(async () => {
      const res = mode === "rename" && open ? await renameFolder(open.id, name) : await createFolder(name);
      if ("error" in res) return setError(res.error);
      setError(null);
      setMode("view");
      if (mode === "new" && res.id) router.push(`/decks?folder=${res.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="mt-4">
      <nav aria-label="Folders" className="flex flex-wrap items-center gap-2">
        {chip("/decks", "All decks", total, !current && !noFolder)}
        {folders.map((f) => chip(`/decks?folder=${f.id}`, f.name, counts[f.id] ?? 0, f.id === current))}
        {folders.length > 0 && chip(`/decks?folder=${NO_FOLDER}`, "No folder", counts[NO_FOLDER] ?? 0, noFolder)}
        {mode === "view" && (
          <button type="button" onClick={() => setMode("new")} className="min-h-10 rounded-full border border-dashed border-foreground/30 px-3 text-sm opacity-80 hover:opacity-100">
            + New folder
          </button>
        )}
        {open && mode === "view" && (
          <span className="ml-auto flex gap-1 text-sm">
            <button type="button" onClick={() => setMode("rename")} className="min-h-10 px-2 opacity-75 hover:opacity-100">
              Rename folder
            </button>
            <button type="button" onClick={() => setMode("delete")} className="min-h-10 px-2 text-red-400 opacity-90 hover:opacity-100">
              Delete folder
            </button>
          </span>
        )}
      </nav>

      {(mode === "new" || mode === "rename") && (
        <form onSubmit={submitName} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="name"
            aria-label={mode === "new" ? "New folder name" : "Folder name"}
            defaultValue={mode === "rename" ? open?.name : ""}
            placeholder="Folder name, like Casual or For the kids"
            maxLength={FOLDER_NAME_MAX}
            required
            autoFocus
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 sm:max-w-80"
          />
          <button className="btn btn-gold min-h-11" disabled={pending}>
            {mode === "new" ? "Make folder" : "Save"}
          </button>
          <button type="button" onClick={() => { setMode("view"); setError(null); }} className="min-h-11 px-2 text-sm opacity-75">
            Cancel
          </button>
        </form>
      )}

      {mode === "delete" && open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Delete the folder {open.name}? Its {counts[open.id] ?? 0} {(counts[open.id] ?? 0) === 1 ? "deck stays" : "decks stay"}, in no folder.
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteFolder(open.id);
                if ("error" in res) return setError(res.error);
                setMode("view");
                router.push("/decks");
              })
            }
            className="min-h-10 rounded-lg bg-red-600 px-3 font-medium text-white"
          >
            Delete folder
          </button>
          <button type="button" onClick={() => setMode("view")} className="min-h-10 px-2 opacity-80">
            Keep it
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-amber-400">{error}</p>}
    </div>
  );
}
