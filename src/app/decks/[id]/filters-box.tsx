"use client";

// Find cards (Nov 11, 2026): one Filters box for both tabs. Suggested keeps the filter on and narrows its picks;
// Search adds the syntax to the search box and searches. Same look, same fields, same buttons.
import { useState, type ReactNode } from "react";
import { FilterFields, type FilterField } from "./filter-fields";
import { appendSyntax, filterSyntax, type FilterForm } from "@/lib/search/filters";

export function FiltersBox(props: {
  fields: FilterField[];
  draft: FilterForm;
  onDraft: (next: FilterForm, immediate: boolean) => void;
  /** Suggested only: a box for any Scryfall syntax (Search has its own box for that). */
  own?: { value: string; onChange: (v: string) => void };
  /** What's on now (Suggested), for the "on" note; Search applies once and keeps nothing. */
  applied?: string;
  applyLabel: string;
  hint: string;
  onApply: () => void;
  onClear: () => void;
  /** Under the box while a filter is on: the syntax and how many cards match. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const built = appendSyntax(filterSyntax(props.draft), props.own?.value ?? "");
  const pending = props.applied === undefined ? !!built : built !== props.applied;
  return (
    <div className="mt-3 rounded-lg border border-foreground/15">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm">
        <span>
          <span className="font-medium">Filters</span>
          <span className="ml-2 opacity-60">{props.applied ? "on" : props.hint}</span>
        </span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <form
          className="border-t border-foreground/10 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            props.onApply();
          }}
        >
          <FilterFields value={props.draft} onChange={props.onDraft} fields={props.fields} />
          {props.own && (
            <label className="mt-3 grid gap-1 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
              <span className="text-xs font-medium opacity-70 sm:text-sm">Your own filter</span>
              <input
                value={props.own.value}
                onChange={(e) => props.own!.onChange(e.target.value)}
                placeholder="any Scryfall syntax, e.g. kw:ward t:equipment"
                aria-label="Your own Scryfall filter"
                spellCheck={false}
                className="min-h-11 min-w-0 rounded-lg border border-foreground/20 bg-transparent px-3 font-mono text-sm"
              />
            </label>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!pending} className="btn btn-gold min-h-11 px-4 disabled:opacity-50">
              {props.applyLabel}
            </button>
            {(props.applied || built) && (
              <button type="button" onClick={props.onClear} className="min-h-11 rounded-lg px-3 text-sm opacity-70 hover:opacity-100">
                Clear
              </button>
            )}
            {built && props.applied === undefined && <code className="min-w-0 break-all font-mono text-xs opacity-70">{built}</code>}
          </div>
        </form>
      )}
      {props.footer}
    </div>
  );
}
