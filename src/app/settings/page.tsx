import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { readPreviewMode } from "@/lib/tags/layout-prefs";
import { PreviewSetting } from "./preview-setting";

export const metadata = { title: "Settings · Commander Tags" };

export default async function SettingsPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) redirect("/login?next=/settings");

  const { data } = await supabase.from("profiles").select("tag_view").eq("id", user.id).single();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Settings</h1>
      <PreviewSetting userId={user.id} initial={readPreviewMode((data?.tag_view ?? {}) as Record<string, unknown>)} />
    </main>
  );
}
