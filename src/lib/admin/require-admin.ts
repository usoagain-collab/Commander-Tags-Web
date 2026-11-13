// The gate for admin pages: anyone who isn't a listed admin (signed out included) gets the ordinary
// "page not found", so the page doesn't even show that it exists.
import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { isAdmin } from "./access";

export async function requireAdmin(): Promise<{ id: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.id)) notFound();
  return user;
}
