"use client";

// Settings → Your account: password, download my data, delete my account.
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteAccount } from "./account-actions";

export function AccountSetting({ hasPassword }: { hasPassword: boolean }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      const result = await deleteAccount(typed);
      if ("error" in result) setError(result.error);
      // A full load, so the header forgets the deleted session.
      else window.location.assign("/?deleted=1");
    });
  }

  return (
    <section className="mt-10 border-t border-foreground/10 pt-8">
      <h2 className="display text-xl">Your account</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href="/api/account/export" download className="btn min-h-11 px-4">
          Download my data
        </a>
        <Link href="/auth/new-password" className="btn min-h-11 px-4">
          {hasPassword ? "Change password" : "Add a password"}
        </Link>
      </div>
      <p className="mt-2 text-sm opacity-80">
        The download is a text file with every deck list (ready to paste into Import here, Moxfield or Archidekt), your tags, wish list and
        collection.{!hasPassword && " A password lets you sign in with your email as well as Discord or Google."}
      </p>

      <div className="mt-6 rounded-lg border border-red-500/30 p-4">
        <h3 className="font-semibold text-red-400">Delete my account</h3>
        <p className="mt-1 text-sm opacity-85">
          Deletes your decks, versions, tags, wish list, collection and settings for good. Shared links to your decks stop working. This
          can&apos;t be undone, so download your data first if you might want it.
        </p>
        {!asking ? (
          <button type="button" onClick={() => setAsking(true)} className="btn mt-3 min-h-11 border-red-500/50 px-4 text-red-400">
            Delete my account…
          </button>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm">
              Type <strong>DELETE</strong> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                className="ml-2 min-h-11 w-32 rounded-md border border-foreground/20 bg-transparent px-3"
              />
            </label>
            <button
              type="button"
              onClick={remove}
              disabled={pending || typed.trim().toUpperCase() !== "DELETE"}
              className="min-h-11 rounded-md bg-red-600 px-4 font-medium text-white disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete forever"}
            </button>
            <button type="button" onClick={() => { setAsking(false); setTyped(""); }} className="min-h-11 px-3 underline">
              Cancel
            </button>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    </section>
  );
}
