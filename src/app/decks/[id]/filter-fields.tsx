"use client";

// Guided Scryfall filters (v2, Nov 8, 2026), shared by the Search panel's Filters drawer and the Suggest panel.
// Each field writes syntax through filterSyntax (src/lib/search/filters.ts), shown under the fields as it's built.
import type { ReactNode } from "react";
import { FILTER_TYPES, type ColorMode, type FilterForm } from "@/lib/search/filters";

export type FilterField = "colors" | "types" | "text" | "mv" | "price" | "keyword" | "set" | "since" | "noReserved" | "instantSpeed";

const COLORS: { c: string; name: string }[] = [
  { c: "W", name: "White" },
  { c: "U", name: "Blue" },
  { c: "B", name: "Black" },
  { c: "R", name: "Red" },
  { c: "G", name: "Green" },
  { c: "C", name: "Colorless" },
];
const MV_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const THIS_YEAR = new Date().getFullYear();

const chip = (on: boolean) =>
  `min-h-11 rounded-lg border px-3 text-sm ${on ? "border-gold bg-gold font-medium text-gold-ink" : "border-foreground/20 hover:bg-foreground/10"}`;
const input = "min-h-11 min-w-0 rounded-lg border border-foreground/20 bg-transparent px-3 text-sm";

/**
 * The filter fields. `onChange(next, immediate)`: immediate is true for buttons, checkboxes and menus, false while
 * typing, so a caller can wait for Enter before searching.
 */
export function FilterFields({
  value,
  onChange,
  fields,
}: {
  value: FilterForm;
  onChange: (next: FilterForm, immediate: boolean) => void;
  fields: FilterField[];
}) {
  const has = (f: FilterField) => fields.includes(f);
  const set = (patch: Partial<FilterForm>, immediate = true) => onChange({ ...value, ...patch }, immediate);
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

  return (
    <div className="grid gap-3 text-sm">
      {has("types") && (
        <Row label="Type">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Card types">
            {FILTER_TYPES.map((t) => (
              <button key={t} type="button" aria-pressed={value.types.includes(t)} onClick={() => set({ types: toggle(value.types, t) })} className={chip(value.types.includes(t))}>
                {t}
              </button>
            ))}
          </div>
        </Row>
      )}
      {has("colors") && (
        <Row label="Colors">
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map(({ c, name }) => (
              <button
                key={c}
                type="button"
                aria-pressed={value.colors.includes(c)}
                title={name}
                onClick={() => set({ colors: toggle(value.colors, c) })}
                className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border ${value.colors.includes(c) ? "border-gold bg-gold/20" : "border-foreground/20 hover:bg-foreground/10"}`}
              >
                <img src={`https://svgs.scryfall.io/card-symbols/${c}.svg`} alt={name} width={22} height={22} className="max-w-none shrink-0" />
              </button>
            ))}
            <select
              value={value.colorMode}
              onChange={(e) => set({ colorMode: e.target.value as ColorMode })}
              aria-label="How colors match"
              className={`${input} bg-background`}
            >
              <option value="including">including these</option>
              <option value="at-most">at most these</option>
              <option value="exactly">exactly these</option>
            </select>
          </div>
        </Row>
      )}
      {has("text") && (
        <Row label="Rules text">
          <input
            value={value.text}
            onChange={(e) => set({ text: e.target.value }, false)}
            placeholder='e.g. ward, or "~ deals" (~ = the card)'
            aria-label="Rules text contains"
            className={`${input} w-full`}
          />
        </Row>
      )}
      {has("mv") && (
        <Row label="Mana value">
          <div className="flex items-center gap-2">
            <MvSelect label="Lowest mana value" value={value.mvMin} onChange={(v) => set({ mvMin: v })} empty="any" />
            <span className="opacity-60">to</span>
            <MvSelect label="Highest mana value" value={value.mvMax} onChange={(v) => set({ mvMax: v })} empty="any" />
          </div>
        </Row>
      )}
      {has("price") && (
        <Row label="Price up to (TCGplayer)">
          <div className="flex items-center gap-1">
            <span className="opacity-60">$</span>
            <input
              type="number"
              min={0}
              step="0.5"
              inputMode="decimal"
              value={value.priceMax ?? ""}
              onChange={(e) => set({ priceMax: num(e.target.value) }, false)}
              placeholder="any"
              aria-label="Highest price in US dollars"
              className={`${input} w-24`}
            />
          </div>
        </Row>
      )}
      {has("keyword") && (
        <Row label="Keyword">
          <input value={value.keyword} onChange={(e) => set({ keyword: e.target.value }, false)} placeholder="e.g. flying, ward" aria-label="Keyword" className={`${input} w-full sm:w-56`} />
        </Row>
      )}
      {has("set") && (
        <Row label="Set code">
          <input value={value.set} onChange={(e) => set({ set: e.target.value }, false)} placeholder="e.g. dsk" aria-label="Set code" className={`${input} w-28`} />
        </Row>
      )}
      {(has("since") || has("noReserved") || has("instantSpeed")) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {has("since") && (
            <label className="flex min-h-11 items-center gap-2" title="Only cards first printed in this year or later: new cards, not reprints">
              <input type="checkbox" checked={value.sinceYear != null} onChange={(e) => set({ sinceYear: e.target.checked ? THIS_YEAR - 2 : null })} />
              New cards only, since
              <input
                type="number"
                min={1993}
                max={THIS_YEAR + 1}
                value={value.sinceYear ?? THIS_YEAR - 2}
                disabled={value.sinceYear == null}
                onChange={(e) => set({ sinceYear: num(e.target.value) }, false)}
                aria-label="First printed in or after this year"
                className={`${input} w-24 disabled:opacity-40`}
              />
            </label>
          )}
          {has("instantSpeed") && (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={value.instantSpeed} onChange={(e) => set({ instantSpeed: e.target.checked })} />
              Instant speed (instants and flash)
            </label>
          )}
          {has("noReserved") && (
            <label className="flex min-h-11 items-center gap-2" title="Leave out Reserved List cards, which are never reprinted and often expensive">
              <input type="checkbox" checked={value.noReserved} onChange={(e) => set({ noReserved: e.target.checked })} />
              No Reserved List
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-xs font-medium opacity-70 sm:text-sm">{label}</span>
      {children}
    </div>
  );
}

function MvSelect({ label, value, onChange, empty }: { label: string; value: number | null; onChange: (v: number | null) => void; empty: string }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      aria-label={label}
      className={`${input} bg-background`}
    >
      <option value="">{empty}</option>
      {MV_OPTIONS.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}
