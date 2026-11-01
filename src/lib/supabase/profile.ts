// The signed-in user's look and picture, for the root layout and the site header. React cache() makes them share
// one small query per request. Signed out, or if the query fails, the site falls back to dark with no picture.
import { cache } from "react";
import { createClient } from "./server";
import { getCurrentUser } from "./user";

export type Theme = "light" | "dark";

export const getProfileLook = cache(async (): Promise<{ theme: Theme; avatarUrl: string | null; name: string | null }> => {
  const user = await getCurrentUser();
  if (!user) return { theme: "dark", avatarUrl: null, name: null };
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("theme, avatar_url, display_name").eq("id", user.id).maybeSingle();
  return { theme: data?.theme === "light" ? "light" : "dark", avatarUrl: data?.avatar_url ?? null, name: data?.display_name ?? null };
});
