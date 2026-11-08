"use server";

// Server actions for the "My decks" page. They run on the server as the signed-in user,
// so row-level security still decides what each one may touch.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { withoutBracketTargets } from "@/lib/tags/role-settings";

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
      // No Tutors number: a new deck follows its bracket for that one.
      role_targets: withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS, ...(profile?.default_role_targets ?? {}) }),
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

type SharedRow = {
  oracle_id: string;
  board: string;
  quantity: number;
  category: string | null;
  printing: ({ id: string; foil?: boolean } & Record<string, unknown>) | null;
};

/**
 * Copy to my decks (v2): a private copy of any deck you can open (yours, unlisted or public), with its cards,
 * printings, categories, role targets and bracket. My tags, flags and suggestion settings stay with the original.
 * shared_deck decides what you may read, so a private deck of someone else can't be copied.
 */
export async function copyDeck(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}`)}`);

  const { data: shared, error: readError } = await supabase.rpc("shared_deck", { p_id: id });
  if (readError || !shared) throw new Error(`Couldn't read that deck${readError ? `: ${readError.message}` : "."}`);
  const src = shared.deck as { name: string; owner_id: string; role_targets: unknown; custom_roles: unknown; target_bracket: number | null; cover_oracle_id: string | null; mana_values?: unknown };
  const rows = (shared.rows ?? []) as SharedRow[];

  const name = (src.owner_id === user.id ? `${src.name} (copy)` : src.name).slice(0, 120);
  const { data: deck, error } = await supabase
    .from("decks")
    .insert({
      name,
      target_bracket: src.target_bracket ?? 3,
      role_targets: src.role_targets ?? {},
      custom_roles: src.custom_roles ?? [],
      cover_oracle_id: src.cover_oracle_id,
      ...(src.mana_values && Object.keys(src.mana_values).length ? { mana_values: src.mana_values } : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Couldn't copy the deck: ${error.message}`);

  if (rows.length > 0) {
    const { error: rowsError } = await supabase.from("deck_cards").insert(
      rows.map((r) => {
        const { id: printingId, foil, ...info } = r.printing ?? { id: null };
        return {
          deck_id: deck.id,
          oracle_id: r.oracle_id,
          board: r.board,
          quantity: r.quantity,
          category: r.category,
          printing_id: printingId,
          foil: r.printing ? foil === true : false,
          printing_info: r.printing ? info : null,
        };
      }),
    );
    if (rowsError) {
      // Leave no half-copied deck behind.
      await supabase.from("decks").delete().eq("id", deck.id);
      throw new Error(`Couldn't copy the cards: ${rowsError.message}`);
    }
  }

  revalidatePath("/decks");
  redirect(`/decks/${deck.id}`);
}
