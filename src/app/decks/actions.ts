"use server";

// Server actions for the "My decks" page. They run on the server as the signed-in user,
// so row-level security still decides what each one may touch.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/decks");
  return { supabase, user };
}

export async function createDeck(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Untitled deck";
  // Target bracket (Phase 5b), 1-5; anything else falls back to the default, 3 (Upgraded).
  const bracket = Number(formData.get("bracket"));
  const target_bracket = Number.isInteger(bracket) && bracket >= 1 && bracket <= 5 ? bracket : 3;

  // New decks start from the user's saved default targets, falling back to the app defaults.
  const { data: profile } = await supabase
    .from("profiles")
    .select("default_role_targets, custom_roles")
    .eq("id", user.id)
    .single();

  const { data, error } = await supabase
    .from("decks")
    .insert({
      name,
      target_bracket,
      role_targets: { ...DEFAULT_ROLE_TARGETS, ...(profile?.default_role_targets ?? {}) },
      custom_roles: profile?.custom_roles ?? [],
    })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't create the deck: ${error.message}`);

  revalidatePath("/decks");
  redirect(`/decks/${data.id}`);
}

export async function renameDeck(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) return;
  const { error } = await supabase.from("decks").update({ name }).eq("id", id);
  if (error) throw new Error(`Couldn't rename the deck: ${error.message}`);
  revalidatePath("/decks");
  revalidatePath(`/decks/${id}`);
}

export async function deleteDeck(formData: FormData) {
  const { supabase } = await requireUser();
  const id = String(formData.get("id"));
  const { error } = await supabase.from("decks").delete().eq("id", id);
  if (error) throw new Error(`Couldn't delete the deck: ${error.message}`);
  revalidatePath("/decks");
}
