"use server";

// Saves the deck built before signing in (V3) as a new deck: the deck row, then every card in one
// apply_deck_changes call, which checks the cards as it does for any edit. If the cards fail, the empty deck is
// removed again so a retry doesn't leave a spare one behind.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { withoutBracketTargets } from "@/lib/tags/role-settings";
import type { SavePayload } from "@/lib/deck/model";

export async function saveGuestDeck(name: string, payload: SavePayload): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  if (!Array.isArray(payload?.rows) || payload.rows.length === 0 || payload.rows.length > 400) return { error: "That deck looks empty." };

  const { data: profile } = await supabase.from("profiles").select("default_role_targets, custom_roles").eq("id", user.id).single();
  const { data, error } = await supabase
    .from("decks")
    .insert({
      name: String(name ?? "").trim().slice(0, 120) || "My first deck",
      target_bracket: 3,
      visibility: "public",
      role_targets: withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS, ...(profile?.default_role_targets ?? {}) }),
      custom_roles: profile?.custom_roles ?? [],
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { error: cardsError } = await supabase.rpc("apply_deck_changes", {
    p_deck: data.id,
    p_changes: payload.rows,
    p_categories: payload.categories ?? [],
    p_tag_cards: [],
    p_snapshot_name: null,
    p_printings: payload.printings ?? [],
  });
  if (cardsError) {
    await supabase.from("decks").delete().eq("id", data.id);
    return { error: cardsError.message };
  }
  revalidatePath("/decks");
  return { id: data.id as string };
}
