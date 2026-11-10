"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <p role="status">
        Password saved. <Link href="/decks" className="underline">Go to my decks</Link>
      </p>
    );
  }
  const field = "mt-1 min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3";
  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <label className="text-sm">
        New password <span className="opacity-60">(at least 8 characters)</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={field} />
      </label>
      <label className="text-sm">
        Type it again
        <input type="password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" className={field} />
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-gold min-h-11 disabled:opacity-60">
        {busy ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
