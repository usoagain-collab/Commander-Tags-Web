"use client";

// Email + password accounts (David, Nov 9, 2026: an account on Deck Genome itself, for people who use neither
// Discord nor Google). Supabase Auth stores the password; we never see it. New accounts confirm their email first,
// through the same /auth/callback link the OAuth buttons use.
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "reset";

export function EmailSignIn({ next, startMode }: { next: string; startMode: "signin" | "signup" }) {
  const [mode, setMode] = useState<Mode>(startMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const callback = (to: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(to)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // A full load, so the server-rendered header picks up the new session.
        window.location.assign(next);
        return;
      }
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callback(next), data: { name: name.trim().slice(0, 40) || undefined } },
        });
        if (error) throw error;
        if (data.session) {
          // Email confirmation is off in Supabase: signed in already.
          window.location.assign(next);
          return;
        }
        setSent(`We sent a link to ${email}. Open it to finish creating your account.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback("/auth/new-password") });
        if (error) throw error;
        setSent(`If ${email} has an account, a link to set a new password is on its way.`);
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    }
    setPending(false);
  }

  if (sent) {
    return (
      <div role="status" className="rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
        <p>{sent}</p>
        <button type="button" className="mt-2 underline" onClick={() => { setSent(null); setMode("signin"); }}>
          Back to sign in
        </button>
      </div>
    );
  }

  const field = "min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3";
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {mode === "signup" && (
        <label className="text-sm">
          Your name <span className="opacity-60">(shown on decks you share)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" className={`${field} mt-1`} />
        </label>
      )}
      <label className="text-sm">
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={`${field} mt-1`} />
      </label>
      {mode !== "reset" && (
        <label className="text-sm">
          Password {mode === "signup" && <span className="opacity-60">(at least 8 characters)</span>}
          <input
            type="password"
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={`${field} mt-1`}
          />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={pending} className="btn btn-gold min-h-11 disabled:opacity-60">
        {pending ? "One moment…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
      </button>
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        {mode === "signin" ? (
          <>
            <button type="button" className="min-h-11 underline" onClick={() => setMode("signup")}>Create an account</button>
            <button type="button" className="min-h-11 underline opacity-80" onClick={() => setMode("reset")}>Forgot password?</button>
          </>
        ) : (
          <button type="button" className="min-h-11 underline" onClick={() => setMode("signin")}>
            {mode === "signup" ? "I already have an account" : "Back to sign in"}
          </button>
        )}
      </p>
      {mode === "signup" && (
        <p className="text-xs opacity-70">
          By creating an account you agree to the <Link href="/terms" className="underline">terms</Link> and{" "}
          <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>
      )}
    </form>
  );
}

// Supabase's messages, in plainer words where we know them.
function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(message)) return "Open the link we emailed you first, then sign in.";
  if (/already registered/i.test(message)) return "That email already has an account. Sign in instead.";
  if (/rate limit|too many/i.test(message)) return "Too many tries for now. Wait a few minutes and try again.";
  if (/email.*(disabled|not enabled)|signups not allowed/i.test(message)) return "Email accounts aren't switched on yet. Use Discord or Google for now.";
  return message;
}
