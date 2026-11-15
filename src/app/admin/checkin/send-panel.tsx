"use client";

import { useActionState } from "react";
import { sendCheckinBatch, sendCheckinTest, type SendState } from "./actions";

const empty: SendState = { message: null, error: null };

export function SendPanel({ ready, waiting, batch }: { ready: boolean; waiting: number; batch: number }) {
  const [test, testAction, testing] = useActionState(sendCheckinTest, empty);
  const [send, sendAction, sending] = useActionState(sendCheckinBatch, empty);
  return (
    <section className="panel mt-6 p-4">
      <h2 className="display text-xl">Send this month&apos;s check-in</h2>
      {!ready && <p className="mt-2 text-sm">Sending is off until an email service is set up (EMAIL_API_KEY and EMAIL_FROM on Vercel).</p>}
      <p className="mt-2 text-sm opacity-80">
        {waiting} {waiting === 1 ? "person hasn't" : "people haven't"} had this month&apos;s email. Each press sends up to {batch}.
      </p>
      <form action={testAction} className="mt-3">
        <button type="submit" disabled={!ready || testing} className="btn min-h-11 px-4">
          {testing ? "Sending…" : "Send a test to me"}
        </button>
        <p aria-live="polite" className="mt-1 min-h-5 text-sm opacity-80">{test.error ?? test.message}</p>
      </form>
      <form action={sendAction} className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" value="yes" className="h-4 w-4 accent-gold" />
          Email the next {Math.min(waiting, batch)} {Math.min(waiting, batch) === 1 ? "person" : "people"} now
        </label>
        <button type="submit" disabled={!ready || sending || waiting === 0} className="btn btn-gold min-h-11 px-4">
          {sending ? "Sending…" : "Send"}
        </button>
        <p aria-live="polite" className="min-h-5 text-sm opacity-80">{send.error ?? send.message}</p>
      </form>
    </section>
  );
}
