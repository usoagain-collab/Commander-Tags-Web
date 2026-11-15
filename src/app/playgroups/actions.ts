"use server";

// Playgroups (V3, migration 0062): making and joining one. Both run as the signed-in user through the playgroup
// functions in the database, which check everything again.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { playgroupError } from "@/lib/playgroups/playgroups";

export async function createPlaygroup(formData: FormData) {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const { data, error } = await supabase.rpc("create_playgroup", { p_name: name });
  if (error) redirect(`/playgroups?error=${encodeURIComponent(playgroupError(error.message, "Couldn't make the playgroup."))}`);
  redirect(`/playgroups/${data as string}`);
}

export async function joinPlaygroup(formData: FormData) {
  const supabase = await createClient();
  const code = String(formData.get("code") ?? "").slice(0, 64);
  const { data, error } = await supabase.rpc("join_playgroup", { p_code: code });
  if (error) redirect(`/playgroups/join/${encodeURIComponent(code)}?error=${encodeURIComponent(playgroupError(error.message, "Couldn't join the playgroup."))}`);
  redirect(`/playgroups/${data as string}`);
}
