"use client";

import { useActionState } from "react";
import { stopCheckins, type CheckinState } from "../actions";

export function StopForm({ u, t }: { u: string; t: string }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(stopCheckins, { ok: false, error: null });
  if (state.ok) return <p className="panel mt-6 p-5">Done. You won&apos;t get check-in emails any more.</p>;
  return (
    <form action={action} className="mt-6 flex flex-wrap items-center gap-3">
      <input type="hidden" name="u" value={u} />
      <input type="hidden" name="t" value={t} />
      <button type="submit" disabled={pending} className="btn btn-gold min-h-11 px-5">
        {pending ? "Stopping…" : "Stop check-in emails"}
      </button>
      <p aria-live="polite" className="text-sm text-red-400">
        {state.error}
      </p>
    </form>
  );
}
