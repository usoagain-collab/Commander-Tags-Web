"use client";

// Feedback button (Phase 7a, for the friend test): a short message plus the page it was sent from, saved to the
// feedback table (migration 0020). David reads them in the Supabase dashboard.
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function FeedbackButton() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | string>("idle");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setStatus("sending");
    const { error } = await createClient().from("feedback").insert({ message: text.trim(), page: path });
    if (error) setStatus(`Couldn't send: ${error.message}`);
    else {
      setStatus("sent");
      setText("");
      setTimeout(() => {
        setOpen(false);
        setStatus("idle");
      }, 1500);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="opacity-70 hover:opacity-100">
        Feedback
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={() => setOpen(false)}>
          <form onSubmit={send} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-2xl bg-background p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Send feedback</h2>
            <p className="text-sm opacity-70">What worked, what didn&apos;t, what you expected. It goes straight to David, with the page you&apos;re on.</p>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              rows={5}
              aria-label="Feedback"
              className="w-full rounded-md border border-foreground/20 bg-background p-3 text-sm"
            />
            {status !== "idle" && status !== "sending" && (
              <p className={`text-sm ${status === "sent" ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{status === "sent" ? "Thanks! Sent." : status}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-foreground/20 px-4 text-sm">
                Cancel
              </button>
              <button type="submit" disabled={!text.trim() || status === "sending"} className="min-h-11 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">
                {status === "sending" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
