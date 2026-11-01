import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { safeNext } from "@/lib/safe-next";
import { devLoginEnabled } from "@/lib/dev-login";
import { SignInButtons } from "./sign-in-buttons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeNext(next);

  const user = await getCurrentUser();
  if (user) redirect(target);

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <div className="panel relative overflow-hidden p-6 sm:p-8">
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-gold/15 to-transparent" />
      <div className="relative">
      <h1 className="display text-3xl">Start building</h1>
      <p className="mt-2 mb-6 opacity-85">Save decks, share links with friends, and pick up on any device.</p>
      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          Sign-in didn&apos;t complete. Please try again.
        </p>
      )}
      <SignInButtons next={target} />
      {devLoginEnabled() && (
        <a
          href={`/auth/dev-login?next=${encodeURIComponent(target)}`}
          className="mt-3 block rounded-md border border-dashed border-foreground/30 px-4 py-2.5 text-center font-medium hover:bg-foreground/5"
        >
          Test account (local only)
        </a>
      )}
      </div>
      </div>
    </main>
  );
}
