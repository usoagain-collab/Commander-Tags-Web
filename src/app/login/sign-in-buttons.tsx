"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Provider = "discord" | "google";

export function SignInButtons({ next }: { next: string }) {
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setPending(provider);
    setError(null);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) {
      setError(error.message);
      setPending(null);
    }
    // On success the browser is already leaving for Discord/Google.
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => signIn("discord")}
        disabled={pending !== null}
        className="rounded-md bg-[#5865F2] px-4 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {pending === "discord" ? "Opening Discord…" : "Continue with Discord"}
      </button>
      <button
        onClick={() => signIn("google")}
        disabled={pending !== null}
        className="rounded-md border border-foreground/20 px-4 py-2.5 font-medium hover:bg-foreground/5 disabled:opacity-60"
      >
        {pending === "google" ? "Opening Google…" : "Continue with Google"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
