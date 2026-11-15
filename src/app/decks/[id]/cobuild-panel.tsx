"use client";

// Build together (V3, migration 0064): the owner makes an invite link for friends to build this deck with them,
// sees who builds it, and can take someone out or turn the link off. A co-builder sees who builds it and can leave.
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { builderName, cobuildLink, COBUILDERS_MAX } from "@/lib/deck/cobuild";
import { useCobuild } from "@/lib/deck/use-cobuild";
import { Panel } from "./deck-text-panel";

export function CobuildPanel({
  deckId,
  onClose,
  onLeft,
  onChanged,
}: {
  deckId: string;
  onClose: () => void;
  onLeft: () => void;
  /** The link or the builders changed, so the editor knows whether to listen for others' edits. */
  onChanged?: () => void;
}) {
  const cobuild = useCobuild(deckId, true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const info = cobuild.info;

  async function act(run: () => Promise<string | null>) {
    setBusy(true);
    const problem = await run();
    setBusy(false);
    setError(problem);
    if (!problem) onChanged?.();
    return problem;
  }

  const link = info?.code && typeof window !== "undefined" ? cobuildLink(info.code, window.location.origin) : null;
  const full = (info?.builders.length ?? 0) >= COBUILDERS_MAX;

  return (
    <Panel title="Build together" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {cobuild.available === null ? (
          <p className="opacity-70">Loading…</p>
        ) : !info ? (
          <p className="opacity-80">Building together isn&apos;t switched on yet.</p>
        ) : (
          <>
            <p className="opacity-85">
              {info.isOwner
                ? `Friends you invite can add, cut and move this deck's cards, the same way you do. The deck's name, image, sharing, roles, bracket and notes stay yours. Up to ${COBUILDERS_MAX} co-builders.`
                : "You can add, cut and move this deck's cards. Its name, image, sharing, roles, bracket and notes stay with its owner."}{" "}
              Changes save as you make them, and what others change shows up here a moment after they save it.
            </p>

            <ul className="space-y-2">
              <li className="flex items-center gap-2">
                <Avatar url={info.owner.avatar_url} name={builderName(info.owner.name)} size={24} />
                <span className="font-semibold">{info.isOwner ? "You" : builderName(info.owner.name)}</span>
                <span className="text-xs opacity-70">Owner</span>
              </li>
              {info.builders.map((b) => (
                <li key={b.user_id} className="flex flex-wrap items-center gap-2">
                  <Avatar url={b.avatar_url} name={builderName(b.name)} size={24} />
                  <span className="font-semibold">{b.me ? "You" : builderName(b.name)}</span>
                  <span className="text-xs opacity-70">Co-builder</span>
                  {info.isOwner && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => cobuild.remove(b.user_id))}
                      className="ml-auto min-h-9 rounded-md border border-foreground/20 px-2 text-xs hover:bg-foreground/10"
                    >
                      Take off this deck
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {info.isOwner ? (
              <div className="space-y-2 border-t border-foreground/10 pt-3">
                {link ? (
                  <>
                    <p className="eyebrow">Invite link</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        readOnly
                        value={link}
                        aria-label="Invite link"
                        className="min-h-11 min-w-0 flex-1 rounded-md border border-foreground/20 bg-background px-3"
                        onFocus={(e) => e.target.select()}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(link);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="min-h-11 rounded-lg bg-gold px-4 font-medium text-gold-ink"
                      >
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                    <p className="text-xs opacity-75">Anyone signed in who opens this link can edit the cards, so send it only to people you build with.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={() => act(cobuild.newLink)} className="min-h-10 rounded-md border border-foreground/20 px-3 hover:bg-foreground/10">
                        New link
                      </button>
                      <button type="button" disabled={busy} onClick={() => act(cobuild.stopLink)} className="min-h-10 rounded-md border border-foreground/20 px-3 hover:bg-foreground/10">
                        Turn link off
                      </button>
                    </div>
                    <p className="text-xs opacity-60">A new link stops the old one working. People already building keep their place.</p>
                  </>
                ) : (
                  <button type="button" disabled={busy || full} onClick={() => act(cobuild.newLink)} className="btn btn-gold min-h-11 px-4">
                    {full ? `${COBUILDERS_MAX} co-builders already` : "Make an invite link"}
                  </button>
                )}
              </div>
            ) : (
              <div className="border-t border-foreground/10 pt-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("Stop building this deck? You'll need a new invite link to come back.")) return;
                    if (!(await act(cobuild.leave))) onLeft();
                  }}
                  className="min-h-10 rounded-md border border-foreground/20 px-3 hover:bg-foreground/10"
                >
                  Leave this deck
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-red-400">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
