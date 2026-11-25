import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfileLook } from "@/lib/supabase/profile";
import { getCurrentUser } from "@/lib/supabase/user";
import { readPreviewMode } from "@/lib/tags/layout-prefs";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets, withoutBracketTargets } from "@/lib/tags/role-settings";
import { AccountSetting } from "./account-setting";
import { AvatarSetting } from "./avatar-setting";
import { CheckinSetting } from "./checkin-setting";
import { CutterSetting } from "./cutter-setting";
import { NameSetting } from "./name-setting";
import { PreviewSetting } from "./preview-setting";
import { CardLanguageSetting } from "./card-language-setting";
import { readCardLang } from "@/lib/deck/card-language";
import { RolesSetting } from "./roles-setting";
import { PriceSetting } from "./price-setting";
import { OwnedPrintingSetting } from "./owned-printing-setting";
import { readOwnedPrintings } from "@/lib/deck/owned-printing";
import { readPriceSource } from "@/lib/deck/store-prices";
import { ThemeSetting } from "./theme-setting";
import { SettingsGroup, SettingsNav } from "./settings-groups";

export const metadata = { title: "Settings · Deck Genome" };

export default async function SettingsPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) redirect("/login?next=/settings");

  const [{ data }, look, { data: auth }, checkin] = await Promise.all([
    supabase.from("profiles").select("tag_view, cutter_prefs, default_role_targets, custom_roles").eq("id", user.id).single(),
    getProfileLook(),
    supabase.auth.getUser(),
    // Read on its own: before migration 0063 the column is missing and the switch stays hidden.
    supabase.from("profiles").select("checkin_emails").eq("id", user.id).maybeSingle(),
  ]);
  const hasPassword = (auth.user?.identities ?? []).some((i) => i.provider === "email");

  const tagView = (data?.tag_view ?? {}) as Record<string, unknown>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Settings</h1>
      <div className="mt-4 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 max-w-2xl">
          <SettingsGroup id="profile" title="Profile">
            <NameSetting userId={user.id} initial={look.name} />
            <AvatarSetting userId={user.id} name={look.name} initial={look.avatarUrl} />
          </SettingsGroup>
          <SettingsGroup id="look" title="Look">
            <ThemeSetting userId={user.id} initial={look.theme} />
            <PreviewSetting userId={user.id} initial={readPreviewMode(tagView)} />
            <CardLanguageSetting userId={user.id} initial={readCardLang(tagView)} />
          </SettingsGroup>
          <SettingsGroup id="deck-building" title="Deck building">
            <RolesSetting
              userId={user.id}
              initialTargets={withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS, ...readTargets(data?.default_role_targets) })}
              initialCustom={readCustomRoles(data?.custom_roles)}
            />
            <CutterSetting userId={user.id} initial={data?.cutter_prefs} />
            <OwnedPrintingSetting userId={user.id} initial={readOwnedPrintings(tagView)} />
          </SettingsGroup>
          <SettingsGroup id="prices" title="Prices">
            <PriceSetting userId={user.id} initial={readPriceSource(tagView)} />
          </SettingsGroup>
          <SettingsGroup id="account" title="Email and account">
            <CheckinSetting userId={user.id} initial={checkin.error ? null : checkin.data?.checkin_emails === true} />
            <AccountSetting hasPassword={hasPassword} />
          </SettingsGroup>
        </div>
      </div>
    </main>
  );
}
