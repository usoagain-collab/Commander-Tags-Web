import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileLook } from "@/lib/supabase/profile";
import { getCurrentUser } from "@/lib/supabase/user";
import { readPreviewMode } from "@/lib/tags/layout-prefs";
import { AvatarSetting } from "./avatar-setting";
import { CutterSetting } from "./cutter-setting";
import { PreviewSetting } from "./preview-setting";
import { ThemeSetting } from "./theme-setting";

export const metadata = { title: "Settings · Deck Genome" };

export default async function SettingsPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) redirect("/login?next=/settings");

  const [{ data }, look] = await Promise.all([supabase.from("profiles").select("tag_view, cutter_prefs").eq("id", user.id).single(), getProfileLook()]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Settings</h1>
      <AvatarSetting userId={user.id} name={look.name} initial={look.avatarUrl} />
      <ThemeSetting userId={user.id} initial={look.theme} />
      <PreviewSetting userId={user.id} initial={readPreviewMode((data?.tag_view ?? {}) as Record<string, unknown>)} />
      <CutterSetting userId={user.id} initial={data?.cutter_prefs} />
    </main>
  );
}
