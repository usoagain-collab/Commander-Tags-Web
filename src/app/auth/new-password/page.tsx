import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { NewPasswordForm } from "./new-password-form";

export const metadata = { title: "Set a password · Deck Genome" };

// The password reset email lands here through /auth/callback, which has already signed the user in.
// Signed-in users can also come here from Settings to change (or add) a password.
export default async function NewPasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/auth/new-password");
  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <div className="panel p-6 sm:p-8">
        <h1 className="display text-3xl">Set a password</h1>
        <p className="mt-2 mb-6 opacity-85">Use it with your email address to sign in from now on.</p>
        <NewPasswordForm />
      </div>
    </main>
  );
}
