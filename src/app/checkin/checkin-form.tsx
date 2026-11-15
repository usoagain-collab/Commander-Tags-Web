"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { NOTE_MAX, QUESTIONS, type CheckinAnswer, type QuestionKey } from "@/lib/checkin/checkin";
import { saveCheckin, type CheckinState } from "./actions";

export function CheckinForm({ u, t, initial }: { u: string; t: string; initial: CheckinAnswer | null }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(saveCheckin, { ok: false, error: null });
  const [picked, setPicked] = useState<Record<QuestionKey, number | null>>({
    liked: initial?.liked ?? null,
    easy: initial?.easy ?? null,
    better: initial?.better ?? null,
  });

  if (state.ok)
    return (
      <div className="panel mt-6 p-5">
        <p className="font-medium">Thanks! Your answers are saved.</p>
        <p className="mt-1 text-sm opacity-80">You can change them any time this month from the same link.</p>
        <Link href="/decks" className="btn mt-4 inline-flex min-h-11 items-center px-4">
          Back to my decks
        </Link>
      </div>
    );

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="u" value={u} />
      <input type="hidden" name="t" value={t} />
      {QUESTIONS.map((q, i) => (
        <fieldset key={q.key} className="panel p-4">
          <legend className="px-1 font-medium">
            {i + 1}. {q.text}
          </legend>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={`btn min-h-11 min-w-11 cursor-pointer justify-center px-3 ${picked[q.key] === n ? "border-gold" : ""}`}>
                <input
                  type="radio"
                  name={q.key}
                  value={n}
                  checked={picked[q.key] === n}
                  onChange={() => setPicked((p) => ({ ...p, [q.key]: n }))}
                  className="sr-only"
                />
                {n}
              </label>
            ))}
          </div>
          <p className="mt-2 flex justify-between text-xs opacity-70">
            <span>1 = {q.low}</span>
            <span>5 = {q.high}</span>
          </p>
        </fieldset>
      ))}
      <label className="block">
        <span className="font-medium">Anything else? What&apos;s working, what&apos;s not (optional)</span>
        <textarea name="note" maxLength={NOTE_MAX} rows={4} defaultValue={initial?.note ?? ""} className="mt-2 w-full rounded-md border border-foreground/20 bg-transparent p-2" />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-gold min-h-11 px-5">
          {pending ? "Saving…" : "Send my answers"}
        </button>
        <p aria-live="polite" className="text-sm text-red-400">
          {state.error}
        </p>
      </div>
    </form>
  );
}
