import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { CollectionView } from "./collection-view";

export const metadata = { title: "Collection · Deck Genome" };

export default async function CollectionPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/collection");
  const [{ q }, supabase] = await Promise.all([searchParams, createClient()]);
  // View, group and sort live in profiles.tag_view (key "collection"), next to the deck editor's settings.
  const { data } = await supabase.from("profiles").select("tag_view").eq("id", user.id).maybeSingle();
  return <CollectionView userId={user.id} savedTagView={(data?.tag_view as Record<string, unknown> | null) ?? {}} initialQuery={q ?? ""} />;
}
