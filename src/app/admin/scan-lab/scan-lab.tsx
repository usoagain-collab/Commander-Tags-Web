"use client";

// Card scanner experiment (Nov 21, 2026): camera with a card-shaped guide, one scan at a time, then David picks the
// printing he really scanned so every method gets scored. See src/lib/scan/ for the logic.

import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_RATIO } from "@/lib/scan/image";
import { LAB_KEY, pct, readLabResults, resultsText, summarize, type LabResult } from "@/lib/scan/lab-results";
import { cardByName, loadImage, ocrWorker, printingKey, printingsOf, rank, scanCard, straighten, type Ranked, type ScanOutput } from "@/lib/scan/pipeline";

const LANGS: [string, string][] = [
  ["en", "English"], ["ja", "Japanese"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"],
  ["pt", "Portuguese"], ["ru", "Russian"], ["ko", "Korean"], ["zhs", "Chinese (simplified)"], ["zht", "Chinese (traditional)"],
];

// The guide box inside the video, in video pixels: a card shape filling 86% of the frame.
function guideRect(vw: number, vh: number) {
  let h = vh * 0.86;
  let w = h * CARD_RATIO;
  if (w > vw * 0.86) {
    w = vw * 0.86;
    h = w / CARD_RATIO;
  }
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

// The crop handed on: the guide plus a little room, so the card's own edges can be found inside it.
function withMargin(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number) {
  const mx = r.w * 0.06;
  const my = r.h * 0.05;
  const x = Math.max(0, r.x - mx);
  const y = Math.max(0, r.y - my);
  return { x, y, w: Math.min(vw, r.x + r.w + mx) - x, h: Math.min(vh, r.y + r.h + my) - y };
}

type Source = LabResult["source"];

export function ScanLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null); // null = this camera has no light control
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<(ScanOutput & { source: Source; n: number }) | null>(null);
  const scans = useRef(0);
  const [rows, setRows] = useState<LabResult[]>([]);
  const [url, setUrl] = useState("");

  useEffect(() => setRows(readLabResults(localStorage.getItem(LAB_KEY))), []);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const save = (next: LabResult[]) => {
    setRows(next);
    localStorage.setItem(LAB_KEY, JSON.stringify(next));
  };

  const startCamera = async () => {
    setError(null);
    setCamera("starting");
    ocrWorker().catch(() => {}); // start loading the reader while the camera opens
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setSize({ w: video.videoWidth, h: video.videoHeight });
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch(caps.torch ? false : null);
      setCamera("on");
    } catch (e) {
      setCamera("off");
      setError(e instanceof Error ? `Couldn't open the camera: ${e.message}` : "Couldn't open the camera.");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera("off");
    setTorch(null);
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const run = useCallback(async (card: HTMLCanvasElement, source: Source) => {
    setError(null);
    setOut(null);
    try {
      const result = await scanCard(card, setStep);
      setOut({ ...result, source, n: ++scans.current });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan failed.");
    } finally {
      setStep(null);
    }
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !size) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    void run(straighten(video, vw, vh, withMargin(guideRect(vw, vh), vw, vh), true), "camera");
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    const src = URL.createObjectURL(file);
    try {
      const img = await loadImage(src);
      await run(straighten(img, img.naturalWidth, img.naturalHeight, null, true), "photo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      URL.revokeObjectURL(src);
    }
  };

  const fromUrl = async () => {
    if (!url.trim()) return;
    try {
      const img = await loadImage(url.trim());
      await run(straighten(img, img.naturalWidth, img.naturalHeight, null, true), "url");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that image.");
    }
  };

  const guide = size ? guideRect(size.w, size.h) : null;
  const busy = step !== null;

  return (
    <div className="mt-6 space-y-6">
      <section className="panel p-4">
        <h2 className="display text-xl">1. Scan a card</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-80">
          <li>Lay the card on a plain surface that contrasts with its border (white paper for black-bordered cards).</li>
          <li>Fill the gold outline with the card, upright, held steady. Good light, no glare across the bottom corner.</li>
          <li>Mix it up: foils, showcase and borderless, sleeved, old cards (before 2014), other languages.</li>
        </ul>

        <div
          className="relative mx-auto mt-4 overflow-hidden rounded-lg bg-black"
          style={size ? { aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(70vh * ${size.w / size.h}))` } : { display: camera === "on" ? undefined : "none" }}
        >
          <video ref={videoRef} playsInline muted className="block h-full w-full" />
          {guide && size ? (
            <div
              className="pointer-events-none absolute rounded-[4%] border-2 border-[var(--color-gold,#d4a84b)]"
              style={{
                left: `${(guide.x / size.w) * 100}%`,
                top: `${(guide.y / size.h) * 100}%`,
                width: `${(guide.w / size.w) * 100}%`,
                height: `${(guide.h / size.h) * 100}%`,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
              }}
            />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {camera === "on" ? (
            <>
              <button type="button" className="btn btn-gold min-h-12 flex-1 text-lg" onClick={capture} disabled={busy}>
                {busy ? "Scanning…" : "Scan"}
              </button>
              {torch !== null ? (
                <button type="button" className="btn min-h-12" onClick={toggleTorch}>
                  Light {torch ? "off" : "on"}
                </button>
              ) : null}
              <button type="button" className="btn min-h-12" onClick={stopCamera}>
                Stop camera
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-gold min-h-12 flex-1 text-lg" onClick={startCamera} disabled={camera === "starting"}>
              {camera === "starting" ? "Opening the camera…" : "Start camera"}
            </button>
          )}
          <label className="btn min-h-12 cursor-pointer">
            Use a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                void fromFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer opacity-75">Test with an image link</summary>
          <div className="mt-2 flex gap-2">
            <input
              className="min-h-11 flex-1 rounded-md border border-foreground/20 bg-transparent px-3"
              placeholder="https://cards.scryfall.io/large/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void fromUrl()}
            />
            <button type="button" className="btn min-h-11" onClick={fromUrl} disabled={busy}>
              Scan it
            </button>
          </div>
        </details>

        {step ? <p className="mt-3 text-sm" role="status">{step}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-400" role="alert">{error}</p> : null}
      </section>

      {out ? <ScanReview key={out.n} out={out} onSave={(r) => { save([...rows, r]); setOut(null); }} onSkip={() => setOut(null)} /> : null}

      <Summary rows={rows} onClear={() => save([])} onUndo={() => save(rows.slice(0, -1))} />
    </div>
  );
}

function ScanReview({ out, onSave, onSkip }: { out: ScanOutput & { source: Source }; onSave: (r: LabResult) => void; onSkip: () => void }) {
  const [candidates, setCandidates] = useState<Ranked[]>(out.candidates);
  const [artOrder, setArtOrder] = useState<string[]>(out.artOrder);
  const lineKey = out.linePrinting ? printingKey(out.linePrinting) : null;
  const [pick, setPick] = useState<string | null>(
    lineKey && out.candidates.some((c) => printingKey(c) === lineKey) ? lineKey : out.candidates[0] ? printingKey(out.candidates[0]) : null,
  );
  const [lang, setLang] = useState(out.line.lang ?? out.linePrinting?.lang ?? "en");
  const [foil, setFoil] = useState(false);
  const [sleeved, setSleeved] = useState(() => localStorage.getItem("scan-lab:sleeved") === "1");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const wrongCard = async () => {
    setLooking(true);
    setLookError(null);
    try {
      const card = await cardByName(name);
      if (!card) {
        setLookError("Scryfall didn't find that name.");
        return;
      }
      const ranked = await rank(out.prints, await printingsOf(card.oracleId));
      setCandidates(ranked.candidates);
      setArtOrder(ranked.artOrder);
      setPick(ranked.candidates[0] ? printingKey(ranked.candidates[0]) : null);
    } catch (e) {
      setLookError(e instanceof Error ? e.message : "The lookup failed.");
    } finally {
      setLooking(false);
    }
  };

  const chosen = candidates.find((c) => printingKey(c) === pick) ?? null;
  const cardRank = pick ? candidates.findIndex((c) => printingKey(c) === pick) + 1 || null : null;
  const artRank = pick ? artOrder.indexOf(pick) + 1 || null : null;

  const submit = () => {
    if (!chosen) return;
    localStorage.setItem("scan-lab:sleeved", sleeved ? "1" : "0");
    onSave({
      at: new Date().toISOString(),
      source: out.source,
      trueName: chosen.name,
      truePrinting: printingKey(chosen),
      trueSet: chosen.set,
      trueNumber: chosen.number,
      trueLang: lang,
      foil,
      sleeved,
      note: note.trim(),
      nameRead: out.nameRead,
      nameMatch: out.nameMatch?.name ?? null,
      lineRead: out.lineRead,
      lineSet: out.line.set,
      lineNumber: out.line.number,
      lineLang: out.line.lang,
      foilMark: out.line.foilMark,
      linePrinting: lineKey,
      lineDisagrees: out.disagree,
      candidates: candidates.length,
      cardRank,
      artRank,
      ms: out.ms,
    });
  };

  const bestPicture = candidates[0] ? printingKey(candidates[0]) : null;

  return (
    <section className="panel p-4">
      <h2 className="display text-xl">2. What it found</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-[10rem_1fr]">
        <img src={out.cardImage} alt="The scanned card, straightened" className="w-40 rounded-md" />
        <div className="space-y-3 text-sm">
          <div>
            <div className="opacity-75">Name, as read</div>
            <img src={out.nameImage} alt="" className="mt-1 max-h-10 max-w-full rounded bg-white" />
            <div className="mt-1">
              “{out.nameRead || "nothing"}” → <b>{out.nameMatch?.name ?? "no match"}</b>
            </div>
          </div>
          <div>
            <div className="opacity-75">Bottom-left corner, as read</div>
            <img src={out.lineImage} alt="" className="mt-1 max-h-14 max-w-full rounded bg-white" />
            <div className="mt-1 whitespace-pre-wrap">“{out.lineRead || "nothing"}”</div>
            <div className="mt-1">
              Set <b>{out.line.set ?? "?"}</b> · number <b>{out.line.number ?? "?"}</b> · language <b>{out.line.lang ?? "?"}</b> · mark{" "}
              <b>{out.line.foilMark === "star" ? "★ (foil?)" : out.line.foilMark === "dot" ? "• (nonfoil?)" : "?"}</b>
            </div>
            <div className="mt-1">
              → <b>{out.linePrinting ? `${out.linePrinting.name} (${out.linePrinting.setName} #${out.linePrinting.number})` : "no printing found"}</b>
            </div>
          </div>
          {out.disagree ? <div className="text-amber-400">The name and the corner point at different cards, so the name won.</div> : null}
          <div className="opacity-75">{(out.ms / 1000).toFixed(1)} s</div>
        </div>
      </div>

      <h3 className="mt-5 font-semibold">Which printing did you scan?</h3>
      <p className="text-sm opacity-75">
        Sorted by picture match, best first. “Corner” = what the small print pointed to; “Picture” = the best picture match.
      </p>
      {candidates.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {(showAll ? candidates : candidates.filter((c, i) => i < 24 || printingKey(c) === pick || printingKey(c) === lineKey)).map((c) => {
            const key = printingKey(c);
            const on = key === pick;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setPick(key)}
                className={`rounded-md p-1 text-left text-xs ${on ? "outline outline-2 outline-[var(--color-gold,#d4a84b)]" : "opacity-80"}`}
                aria-pressed={on}
              >
                <img src={c.image} alt={`${c.name}, ${c.setName} #${c.number}`} className="w-full rounded" loading="lazy" />
                <div className="mt-1 font-semibold uppercase">
                  {c.set} #{c.number}
                </div>
                <div className="truncate opacity-75">{c.setName}</div>
                <div className="flex flex-wrap gap-1">
                  {key === lineKey ? <span className="rounded bg-blue-500/30 px-1">Corner</span> : null}
                  {key === bestPicture ? <span className="rounded bg-green-500/30 px-1">Picture</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
      {candidates.length > 24 && !showAll ? (
        <button type="button" className="btn mt-3 min-h-11 w-full" onClick={() => setShowAll(true)}>
          Show all {candidates.length} printings
        </button>
      ) : null}
      {!candidates.length ? (
        <p className="mt-2 text-sm text-amber-400">No card found to compare with. Type its name below.</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <input
          className="min-h-11 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 text-sm"
          placeholder="Wrong card? Type its name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void wrongCard()}
        />
        <button type="button" className="btn min-h-11" onClick={wrongCard} disabled={looking || !name.trim()}>
          {looking ? "Looking…" : "Find"}
        </button>
      </div>
      {lookError ? <p className="mt-1 text-sm text-red-400">{lookError}</p> : null}

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={foil} onChange={(e) => setFoil(e.target.checked)} /> It&apos;s a foil
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="h-5 w-5" checked={sleeved} onChange={(e) => setSleeved(e.target.checked)} /> In a sleeve
        </label>
        <label className="flex min-h-11 items-center gap-2">
          Language
          <select className="min-h-11 flex-1 rounded-md border border-foreground/20 bg-transparent px-2" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        className="mt-3 min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3 text-sm"
        placeholder="Note (optional): glare, blurry, odd frame…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-4 flex gap-3">
        <button type="button" className="btn btn-gold min-h-12 flex-1" onClick={submit} disabled={!chosen}>
          Save and scan the next card
        </button>
        <button type="button" className="btn min-h-12" onClick={onSkip}>
          Skip
        </button>
      </div>
    </section>
  );
}

function Summary({ rows, onClear, onUndo }: { rows: LabResult[]; onClear: () => void; onUndo: () => void }) {
  const [copied, setCopied] = useState(false);
  const s = summarize(rows);
  const lines: [string, string][] = [
    ["Scans saved", String(s.scans)],
    ["Name read right", `${s.nameRight} (${pct(s.nameRight, s.scans)})`],
    ["Corner readable", `${s.lineReadable} (${pct(s.lineReadable, s.scans)})`],
    ["Right printing from the corner", `${s.linePrintingRight} (${pct(s.linePrintingRight, s.scans)})`],
    ["Language right (corner)", `${s.langRight} of ${s.lineReadable}`],
    ["Foil mark matches foil", `${s.foilMarkRight} of ${s.foilMarkRead} read`],
    ["Picture match: whole card best", `${s.cardTop1} (${pct(s.cardTop1, s.scans)})`],
    ["Picture match: art only best", `${s.artTop1} (${pct(s.artTop1, s.scans)})`],
    ["Right printing, corner then picture", `${s.printingRightAny} (${pct(s.printingRightAny, s.scans)})`],
    ["Average time", `${(s.avgMs / 1000).toFixed(1)} s`],
  ];
  const copy = async () => {
    await navigator.clipboard.writeText(resultsText(rows));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <section className="panel p-4">
      <h2 className="display text-xl">3. Results so far</h2>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {lines.map(([k, v]) => (
            <tr key={k} className="border-t border-foreground/10">
              <td className="py-1.5 pr-3 opacity-80">{k}</td>
              <td className="py-1.5 text-right font-semibold">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn btn-gold min-h-11" onClick={copy} disabled={!rows.length}>
          {copied ? "Copied" : "Copy results"}
        </button>
        <button type="button" className="btn min-h-11" onClick={onUndo} disabled={!rows.length}>
          Remove last scan
        </button>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!rows.length}
          onClick={() => window.confirm(`Delete all ${rows.length} saved scans from this phone?`) && onClear()}
        >
          Clear all
        </button>
      </div>
      <p className="mt-2 text-xs opacity-70">Copy results and paste them into the chat with Claude when you&apos;re done.</p>
    </section>
  );
}
