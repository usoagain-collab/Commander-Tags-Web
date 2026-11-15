"use server";

// Folders on My decks (V3, migration 0056). Run as the signed-in user, so row-level security keeps every folder
// to its owner, and a trigger keeps a deck out of anyone else's folder.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanFolderName } from "@/lib/decks/folders";

type Result = { error: string } | { ok: true; id?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

const taken = (message: string) => /duplicate|unique/i.test(message);

export async function createFolder(name: string): Promise<Result> {
  const supabase = await signedIn();
  if (!supabase) return { error: "Sign in first." };
  const clean = cleanFolderName(name);
  if (!clean) return { error: "A folder needs a name." };
  const { data, error } = await supabase.from("deck_folders").insert({ name: clean }).select("id").single();
  if (error) return { error: taken(error.message) ? `You already have a folder called ${clean}.` : error.message };
  revalidatePath("/decks");
  return { ok: true, id: data.id as string };
}

export async function renameFolder(id: string, name: string): Promise<Result> {
  const supabase = await signedIn();
  if (!supabase) return { error: "Sign in first." };
  const clean = cleanFolderName(name);
  if (!clean) return { error: "A folder needs a name." };
  if (!UUID.test(id)) return { error: "That folder wasn't found." };
  const { error } = await supabase.from("deck_folders").update({ name: clean }).eq("id", id);
  if (error) return { error: taken(error.message) ? `You already have a folder called ${clean}.` : error.message };
  revalidatePath("/decks");
  return { ok: true };
}

/** Removes the folder only; its decks stay and go back to no folder. */
export async function deleteFolder(id: string): Promise<Result> {
  const supabase = await signedIn();
  if (!supabase) return { error: "Sign in first." };
  if (!UUID.test(id)) return { error: "That folder wasn't found." };
  const { error } = await supabase.from("deck_folders").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/decks");
  return { ok: true };
}

/** Puts a deck in a folder, or in none with null. */
export async function moveDeckToFolder(deckId: string, folderId: string | null): Promise<Result> {
  const supabase = await signedIn();
  if (!supabase) return { error: "Sign in first." };
  if (!UUID.test(deckId) || (folderId !== null && !UUID.test(folderId))) return { error: "That deck or folder wasn't found." };
  const { error } = await supabase.from("decks").update({ folder_id: folderId }).eq("id", deckId);
  if (error) return { error: error.message };
  revalidatePath("/decks");
  return { ok: true };
}
