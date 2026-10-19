"use client";

// Bulk edit (step 3g): the bar at the bottom of the screen while selecting. Every action is one edit:
// one save and one Ctrl+Z. Buttons are at least 44px tall so the bar works on phones.
import { useState } from "react";
import type { Board } from "@/lib/deck/model";
import type { MyTag } from "@/lib/tags/my-tags";

type Props = {
  count: number;
  total: number;
  tags: MyTag[];
  canSetCopies: boolean;
  onMove: (to: Board) => void;
  onTag: (tag: MyTag, on: boolean) => void;
  onCopies: (n: number) => void;
  onRemove: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
};

export function BulkBar(props: Props) {
  const { count, total, tags, canSetCopies } = props;
  const [copies, setCopies] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const none = count === 0;

  return (
    <div
      role="toolbar"
      aria-label="Bulk edit"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-foreground/15 bg-background/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.15)] backdrop-blur"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 text-sm">
        <span className="mr-1 font-semibold" aria-live="polite">
          {count} selected
        </span>
        <BarButton onClick={count === total ? props.onClear : props.onSelectAll}>{count === total && total > 0 ? "Select none" : "Select all"}</BarButton>

        <span className="mx-1 hidden h-6 border-l border-foreground/15 sm:block" />

        <BarButton disabled={none} onClick={() => props.onMove("main")}>
          → Mainboard
        </BarButton>
        <BarButton disabled={none} onClick={() => props.onMove("maybe")}>
          → Maybeboard
        </BarButton>

        {tags.length > 0 && (
          <select
            disabled={none}
            value=""
            aria-label="Add or remove a My tag"
            onChange={(e) => {
              const [mode, id] = e.target.value.split(":");
              const tag = tags.find((t) => t.id === id);
              if (tag) props.onTag(tag, mode === "on");
            }}
            className="min-h-11 rounded-lg border border-foreground/20 bg-background px-2 disabled:opacity-40"
          >
            <option value="">Tag…</option>
            <optgroup label="Add tag">
              {tags.map((t) => (
                <option key={`on:${t.id}`} value={`on:${t.id}`}>
                  + {t.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Remove tag">
              {tags.map((t) => (
                <option key={`off:${t.id}`} value={`off:${t.id}`}>
                  − {t.name}
                </option>
              ))}
            </optgroup>
          </select>
        )}

        {canSetCopies && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(copies);
              if (Number.isFinite(n) && n >= 1) props.onCopies(n);
              setCopies("");
            }}
          >
            <input
              value={copies}
              onChange={(e) => setCopies(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Copies"
              aria-label="Set number of copies"
              disabled={none}
              className="min-h-11 w-20 rounded-lg border border-foreground/20 bg-background px-2 disabled:opacity-40"
            />
            <BarButton disabled={none || !copies} type="submit">
              Set
            </BarButton>
          </form>
        )}

        {confirmRemove ? (
          <span className="flex items-center gap-1">
            <BarButton
              danger
              onClick={() => {
                setConfirmRemove(false);
                props.onRemove();
              }}
            >
              Remove {count}
            </BarButton>
            <BarButton onClick={() => setConfirmRemove(false)}>Keep</BarButton>
          </span>
        ) : (
          <BarButton danger disabled={none} onClick={() => setConfirmRemove(true)}>
            Remove…
          </BarButton>
        )}

        <BarButton className="ml-auto" onClick={props.onDone}>
          Done
        </BarButton>
      </div>
      <p className="mx-auto mt-1 hidden max-w-7xl text-xs opacity-60 sm:block">
        Tap cards to select them · Shift-click selects a range · Esc to finish · Ctrl+Z undoes each action
      </p>
    </div>
  );
}

function BarButton({
  onClick,
  disabled,
  danger,
  type = "button",
  className = "",
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  type?: "button" | "submit";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-lg border px-3 font-medium disabled:opacity-40 ${
        danger ? "border-red-600/40 text-red-600 hover:bg-red-600/10" : "border-foreground/20 hover:bg-foreground/10"
      } ${className}`}
    >
      {children}
    </button>
  );
}
