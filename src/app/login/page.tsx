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
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 mb-6 text-sm opacity-70">Your decks are saved to your account and follow you between devices.</p>
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
    </main>
  );
}
