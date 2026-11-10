import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/user";
import { safeNext } from "@/lib/safe-next";
import { devLoginEnabled } from "@/lib/dev-login";
import Link from "next/link";
import { SignInButtons } from "./sign-in-buttons";
import { EmailSignIn } from "./email-sign-in";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return { title: mode === "signup" ? "Create an account · Deck Genome" : "Sign in · Deck Genome" };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mode?: string }>;
}) {
  const { next, error, mode } = await searchParams;
  // "Start building" on the home page asks for a new account; the header's Sign in (and redirects) for a returning one.
  const signup = mode === "signup";
  const target = safeNext(next);

  const user = await getCurrentUser();
  if (user) redirect(target);

  return (
    <main className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <div className="panel relative overflow-hidden p-6 sm:p-8">
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-gold/15 to-transparent" />
      <div className="relative">
      <h1 className="display text-3xl">{signup ? "Start building" : "Sign in"}</h1>
      <p className="mt-2 mb-6 opacity-85">
        {signup ? "Make a free account to save decks, share links with friends, and pick up on any device." : "Welcome back. Your decks are waiting."}
      </p>
      {error && (
        <p className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
          Sign-in didn&apos;t complete. Please try again.
        </p>
      )}
      <SignInButtons next={target} />
      <p className="mt-3 text-xs opacity-75">
        We only use your name, email and picture from Discord or Google. We never post for you or see your password.
      </p>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide opacity-60">
        <span className="h-px flex-1 bg-foreground/20" /> or with email <span className="h-px flex-1 bg-foreground/20" />
      </div>
      <EmailSignIn next={target} startMode={signup ? "signup" : "signin"} />
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
      <p className="mt-4 text-center text-xs opacity-70">
        <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link>
      </p>
    </main>
  );
}
