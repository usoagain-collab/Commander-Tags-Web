// Try the builder before signing in (V3): the deck editor with one deck kept in this browser. Signed in, there's
// nothing to try, so a deck left in the browser goes straight into the account (/try/save).
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { TryBuilder } from "./try-builder";

export const metadata = {
  title: "Try the builder · Deck Genome",
  description: "Build a Commander deck right now, no account needed. Sign in when you want to keep it.",
};

export default async function TryPage() {
  if (await getCurrentUser()) redirect("/try/save");
  return <TryBuilder />;
}
