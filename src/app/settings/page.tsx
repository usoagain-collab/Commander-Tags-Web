import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileLook } from "@/lib/supabase/profile";
import { getCurrentUser } from "@/lib/supabase/user";
import { readPreviewMode } from "@/lib/tags/layout-prefs";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets, withoutBracketTargets } from "@/lib/tags/role-settings";
import { AccountSetting } from "./account-setting";
import { AvatarSetting } from "./avatar-setting";
import { CutterSetting } from "./cutter-setting";
import { NameSetting } from "./name-setting";
import { PreviewSetting } from "./preview-setting";
import { CardLanguageSetting } from "./card-language-setting";
import { readCardLang } from "@/lib/deck/card-language";
import { RolesSetting } from "./roles-setting";
import { PriceSetting } from "./price-setting";
import { readPriceSource } from "@/lib/deck/store-prices";
import { ThemeSetting } from "./theme-setting";

export const metadata = { title: "Settings · Deck Genome" };

export default async function SettingsPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) redirect("/login?next=/settings");

  const [{ data }, look, { data: auth }] = await Promise.all([
    supabase.from("profiles").select("tag_view, cutter_prefs, default_role_targets, custom_roles").eq("id", user.id).single(),
    getProfileLook(),
    supabase.auth.getUser(),
  ]);
  const hasPassword = (auth.user?.identities ?? []).some((i) => i.provider === "email");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Settings</h1>
      <NameSetting userId={user.id} initial={look.name} />
      <AvatarSetting userId={user.id} name={look.name} initial={look.avatarUrl} />
      <ThemeSetting userId={user.id} initial={look.theme} />
      <PreviewSetting userId={user.id} initial={readPreviewMode((data?.tag_view ?? {}) as Record<string, unknown>)} />
      <CardLanguageSetting userId={user.id} initial={readCardLang((data?.tag_view ?? {}) as Record<string, unknown>)} />
      <PriceSetting userId={user.id} initial={readPriceSource((data?.tag_view ?? {}) as Record<string, unknown>)} />
      <RolesSetting
        userId={user.id}
        initialTargets={withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS, ...readTargets(data?.default_role_targets) })}
        initialCustom={readCustomRoles(data?.custom_roles)}
      />
      <CutterSetting userId={user.id} initial={data?.cutter_prefs} />
      <AccountSetting hasPassword={hasPassword} />
    </main>
  );
}
