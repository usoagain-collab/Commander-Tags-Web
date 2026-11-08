import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { CollectionView } from "./collection-view";

export const metadata = { title: "Collection · Deck Genome" };

export default async function CollectionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/collection");
  return <CollectionView userId={user.id} />;
}
