// Moves the deck built before signing in into the account, then opens it. Signed out, sign in first.
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { SaveGuestDeck } from "./save-guest-deck";

export const metadata = { title: "Saving your deck · Deck Genome" };

export default async function SaveTryPage() {
  if (!(await getCurrentUser())) redirect("/login?next=/try/save&mode=signup");
  return <SaveGuestDeck />;
}
