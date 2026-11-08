"use client";

import type { Splits } from "@/lib/deck/splits";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BOARD_LABELS, BOARDS, type CardSummary, type Change, type Entries, type Printings } from "@/lib/deck/model";
import { foilFor } from "@/lib/deck/printing";
import { fetchPrintingsByRef, printingRef } from "@/lib/scryfall/printings";
import {
  EXPORT_FORMATS,
  EXPORT_NOTES,
  exportDeck,
  parseDeckText,
  planImport,
  type ExportFormat,
  type IgnoredLine,
  type ImportReport,
} from "@/lib/deck/text-format";

type ImportProps = {
  entries: Entries;
  printings: Printings;
  onApply: (change: Change, cards: CardSummary[]) => void;
  onClose: () => void;
};

type Preview = {
  change: Change;
  report: ImportReport;
  ignored: IgnoredLine[];
  cards: CardSummary[];
  printingsFailed: boolean;
};

export function ImportPanel({ entries, printings, onApply, onClose }: ImportProps) {
  const supabase = useMemo(() => createClient(), []);
  const deckHasCards = Object.keys(entries).length > 0;
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"add" | "replace">(deckHasCards ? "add" : "replace");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    const { lines, ignored } = parseDeckText(text);
    const names = [...new Set(lines.map((l) => l.name))];
    const { data, error } = await supabase.rpc("resolve_card_names", { names });
    if (error) {
      setBusy(false);
      setError(`Couldn't look up the cards: ${error.message}`);
      return;
    }
    // Printings named in the list. If Scryfall can't answer, the cards still import with their default printing.
    const named = lines.flatMap((l) => (l.set && l.number ? [{ set: l.set, number: l.number }] : []));
    const prints = named.length ? await fetchPrintingsByRef(named).catch(() => null) : new Map();
    setBusy(false);
    const found: Record<string, CardSummary> = {};
    for (const { input, card } of (data ?? []) as { input: string; card: CardSummary }[]) found[input.toLowerCase()] = card;
    const { change, report } = planImport(entries, lines, found, mode, {
      current: printings,
      printingOf: (l, card) => {
        const hit = l.set && l.number ? prints?.get(printingRef(l.set, l.number)) : undefined;
        if (!hit || hit.oracleId !== card.oracle_id) return null;
        return { ...hit.printing, foil: foilFor(hit.printing.finishes, !!l.foil) };
      },
    });
    setPreview({ change, report, ignored, cards: Object.values(found), printingsFailed: named.length > 0 && !prints });
  }

  const total = preview ? Object.values(preview.report.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Panel title="Import a list" onClose={onClose}>
      <p className="text-sm opacity-70">
        Paste a list from Moxfield, Archidekt, MTGO, Arena or anywhere else: one card per line, like
        &nbsp;<code>1 Sol Ring</code>. Set codes, <code>1x</code>, and headings like <code>Commander</code> or{" "}
        <code>Maybeboard</code> are understood.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={10}
        spellCheck={false}
        placeholder={"Commander\n1 Meren of Clan Nel Toth\n\nDeck\n1 Sol Ring\n30 Forest"}
        className="mt-3 w-full rounded-md border border-foreground/20 bg-transparent p-3 font-mono text-sm"
      />
      <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Import mode</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "add"} onChange={() => (setMode("add"), setPreview(null))} />
          Add to this deck
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "replace"} onChange={() => (setMode("replace"), setPreview(null))} />
          Replace this deck&apos;s cards
        </label>
      </fieldset>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {preview && (
        <div className="mt-4 rounded-md border border-foreground/15 p-3 text-sm">
          <p className="font-medium">
            {total} cards after import:{" "}
            {BOARDS.filter((b) => preview.report.counts[b] > 0)
              .map((b) => `${BOARD_LABELS[b]} ${preview.report.counts[b]}`)
              .join(" · ") || "nothing"}
          </p>
          {preview.printingsFailed && <p className="mt-1 opacity-70">Scryfall didn&apos;t answer, so set codes are ignored: cards use their default printing.</p>}
          {preview.report.commanderFromLayout && (
            <p className="mt-1 opacity-70">The card(s) after the last blank line were read as your commander.</p>
          )}
          {mode === "replace" && deckHasCards && (
            <p className="mt-1 opacity-70">This replaces the current cards. You can undo it with Ctrl+Z.</p>
          )}
          {preview.report.notFound.length > 0 && (
            <Problem title={`Not found (${preview.report.notFound.length}), will be skipped`}>
              {preview.report.notFound.map((l) => (
                <li key={l.lineNo}>
                  Line {l.lineNo}: {l.name}
                </li>
              ))}
            </Problem>
          )}
          {preview.report.trimmed.length > 0 && (
            <Problem title="Extra copies trimmed to Commander rules">
              {preview.report.trimmed.map((t, i) => (
                <li key={i}>
                  {t.name}: kept {t.kept} of {t.wanted}
                </li>
              ))}
            </Problem>
          )}
          {preview.ignored.length > 0 && (
            <Problem title="Lines that couldn't be read">
              {preview.ignored.map((l) => (
                <li key={l.lineNo}>
                  Line {l.lineNo}: {l.raw}
                </li>
              ))}
            </Problem>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-3">
        {!preview ? (
          <button
            onClick={check}
            disabled={busy || !text.trim()}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-gold-ink disabled:opacity-50"
          >
            {busy ? "Looking up cards…" : "Check list"}
          </button>
        ) : (
          <button
            onClick={() => onApply(preview.change, preview.cards)}
            disabled={preview.change.rows.length === 0 && !preview.change.printings?.length}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-gold-ink disabled:opacity-50"
          >
            {preview.change.rows.length === 0 && !preview.change.printings?.length ? "Nothing to change" : mode === "replace" ? "Replace deck" : "Add cards"}
          </button>
        )}
        <button onClick={onClose} className="text-sm opacity-70">
          Cancel
        </button>
      </div>
    </Panel>
  );
}

type ExportProps = {
  deckName: string;
  entries: Entries;
  printings: Printings;
  cards: Record<string, CardSummary>;
  splits?: Splits;
  onClose: () => void;
};

export function ExportPanel({ deckName, entries, printings, cards, splits, onClose }: ExportProps) {
  const [format, setFormat] = useState<ExportFormat>("moxfield");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => exportDeck(entries, cards, format, printings, splits), [entries, cards, format, printings, splits]);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deckName.replace(/[^\w\- ]+/g, "").trim() || "deck"} (${EXPORT_FORMATS[format]}).txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel title="Export" onClose={onClose}>
      <div role="tablist" className="flex flex-wrap gap-2">
        {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={f === format}
            onClick={() => setFormat(f)}
            className={`rounded-md border px-3 py-1 text-sm ${
              f === format ? "border-gold bg-gold text-gold-ink" : "border-foreground/20"
            }`}
          >
            {EXPORT_FORMATS[f]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm opacity-70">{EXPORT_NOTES[format]}</p>
      <textarea
        readOnly
        value={text}
        rows={12}
        onFocus={(e) => e.target.select()}
        className="mt-3 w-full rounded-md border border-foreground/20 bg-transparent p-3 font-mono text-sm"
      />
      <div className="mt-3 flex gap-3">
        <button onClick={copy} className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-gold-ink">
          {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={download} className="rounded-md border border-foreground/20 px-4 py-2 text-sm">
          Download .txt
        </button>
        <button onClick={onClose} className="text-sm opacity-70">
          Close
        </button>
      </div>
    </Panel>
  );
}

export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-foreground/15 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100">
          ✕
        </button>
      </div>
      {children}
    </section>
  );
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="font-medium text-amber-700 dark:text-amber-400">{title}</p>
      <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 opacity-80">{children}</ul>
    </div>
  );
}
