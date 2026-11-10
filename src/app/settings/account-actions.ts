"use server";

// Delete my account (David, Nov 9, 2026). Deleting the sign-in row removes everything else: profiles, decks,
// deck cards, versions, my tags, wish list, collection and default printings all cascade from it. Feedback the
// user sent stays, with its user id cleared. Uploaded profile pictures live in Storage, outside the database, so
// they are removed first.
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function deleteAccount(confirm: string): Promise<{ error: string } | { ok: true }> {
  if (confirm.trim().toUpperCase() !== "DELETE") return { error: "Type DELETE to confirm." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (typeof uid !== "string") return { error: "You're signed out. Sign in again first." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "Account deletion isn't set up on this server yet. Use Feedback and we'll delete it for you." };

  const admin = createAdminClient();
  const { data: files } = await admin.storage.from("avatars").list(uid);
  if (files?.length) await admin.storage.from("avatars").remove(files.map((f) => `${uid}/${f.name}`));
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return { error: `Couldn't delete the account: ${error.message}` };
  // The session's tokens now point at a deleted user; clear the cookies.
  await supabase.auth.signOut();
  return { ok: true };
}
