"use client";

// Card scanner experiment (Nov 21, 2026): camera with a card-shaped guide, one scan at a time, then David picks the
// printing he really scanned so every method gets scored. See src/lib/scan/ for the logic.

import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_RATIO, houghCorners } from "@/lib/scan/image";
import { LAB_KEY, pct, readLabResults, resultsText, summarize, type LabResult } from "@/lib/scan/lab-results";
import { cardByName, loadImage, nameIndex, ocrWorker, printingKey, printingsOf, rank, scanCard, searchCards, straighten, type Printing, type Ranked, type ScanOutput, type Straightened } from "@/lib/scan/pipeline";
import { isLocked, plausibleQuad, startTrack, stepTrack, type Quad4, type TrackState } from "@/lib/scan/track";

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

// Find the card in the current video frame, on a copy at most 320 px on its long side, so the gold outline can follow
// the card at whatever angle David holds the phone (Nov 22, 2026: he tilts it so his shadow doesn't fall on the card).
// Round 6: 320 px instead of 240 (the outline sat a few pixels off), and skewed shapes are dropped before tracking.
function trackCard(video: HTMLVideoElement, scratch: HTMLCanvasElement): Quad4 | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = Math.min(1, 320 / Math.max(vw, vh));
  scratch.width = Math.round(vw * s);
  scratch.height = Math.round(vh * s);
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, scratch.width, scratch.height);
  const corners = houghCorners(ctx.getImageData(0, 0, scratch.width, scratch.height), 1.5);
  const quad: Quad4 | null = corners ? corners.map(([x, y]) => [x / scratch.width, y / scratch.height]) : null;
  return quad && plausibleQuad(quad, vw / vh) ? quad : null;
}

// The area to search at capture: around the live outline when there is one (plus 15%), else the guide (plus 20%).
function searchBox(quad: Quad4 | null, vw: number, vh: number) {
  if (!quad) return withMargin(guideRect(vw, vh), vw, vh, 0.2);
  const xs = quad.map((p) => p[0] * vw);
  const ys = quad.map((p) => p[1] * vh);
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return withMargin(r, vw, vh, 0.15);
}

// The crop handed on: the guide plus some room, so the card's own edges can be found inside it.
function withMargin(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number, share = 0.06) {
  const mx = r.w * share;
  const my = r.h * share;
  const x = Math.max(0, r.x - mx);
  const y = Math.max(0, r.y - my);
  return { x, y, w: Math.min(vw, r.x + r.w + mx) - x, h: Math.min(vh, r.y + r.h + my) - y };
}

// The preview shows the middle of the photo when their shapes differ, so place the outline the same way on the photo.
function onPhoto(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number, pw: number, ph: number) {
  const k = Math.min(pw / vw, ph / vh);
  const ox = (pw - vw * k) / 2;
  const oy = (ph - vh * k) / 2;
  return { x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: r.h * k };
}

type Corners = [[number, number], [number, number], [number, number], [number, number]];

// The live outline's corners in the picture's own pixels (the same placement as onPhoto).
function cornersOnPhoto(q: Quad4, vw: number, vh: number, pw: number, ph: number): Corners {
  const k = Math.min(pw / vw, ph / vh);
  const ox = (pw - vw * k) / 2;
  const oy = (ph - vh * k) / 2;
  return q.map(([x, y]) => [ox + x * vw * k, oy + y * vh * k]) as Corners;
}

type Source = LabResult["source"];

/* ---------- crop pictures kept with each saved scan ---------- */

const IMAGES_KEY = "scan-lab:images";
type ScanImages = { card: string; name: string; line: string };

function readImages(): Record<string, ScanImages> {
  try {
    const v = JSON.parse(localStorage.getItem(IMAGES_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writeImages(all: Record<string, ScanImages>) {
  // Local storage holds about 5 MB; when full, drop the oldest scans' pictures (their results stay).
  const keys = Object.keys(all).sort();
  for (;;) {
    try {
      localStorage.setItem(IMAGES_KEY, JSON.stringify(all));
      return;
    } catch {
      const oldest = keys.shift();
      if (!oldest) return;
      delete all[oldest];
    }
  }
}

function dropImages(ats: string[]) {
  const all = readImages();
  for (const at of ats) delete all[at];
  writeImages(all);
}

async function shrink(src: string, width: number): Promise<string> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = Math.min(width, img.naturalWidth);
  c.height = Math.round((img.naturalHeight * c.width) / img.naturalWidth);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

async function saveImages(at: string, out: ScanOutput) {
  try {
    const [card, name, line] = await Promise.all([shrink(out.cardImage, 200), shrink(out.nameImage, 450), shrink(out.lineImage, 550)]);
    writeImages({ ...readImages(), [at]: { card, name, line } });
  } catch {
    // pictures are a nice-to-have; the result itself is already saved
  }
}

export function ScanLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null); // null = this camera has no light control
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<ReviewInput | null>(null);
  const scans = useRef(0);
  const [rows, setRows] = useState<LabResult[]>([]);
  const [url, setUrl] = useState("");

  useEffect(() => {
    setRows(readLabResults(localStorage.getItem(LAB_KEY)));
    nameIndex().catch(() => {}); // fetch the card name list early, so the first scan doesn't wait for it
  }, []);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // Live outline: find the card in the video about 7 times a second while the camera is on and nothing is scanning,
  // through the tracker (src/lib/scan/track.ts), so it holds steady and locks once the card stays put.
  const [track, setTrack] = useState<TrackState>(startTrack);
  const live = track.shown;
  const liveRef = useRef<Quad4 | null>(null);
  const [quick, setQuick] = useState(false); // use the video picture instead of taking a full photo
  useEffect(() => setQuick(localStorage.getItem("scan-lab:quick") === "1"), []);
  const busyRef = useRef(false);
  busyRef.current = step !== null;
  useEffect(() => {
    if (camera !== "on") {
      setTrack(startTrack());
      liveRef.current = null;
      return;
    }
    const scratch = document.createElement("canvas");
    let timer = 0;
    let stopped = false;
    let state = startTrack();
    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const t = performance.now();
      if (video && !busyRef.current) {
        state = stepTrack(state, trackCard(video, scratch));
        liveRef.current = state.shown;
        setTrack(state);
      }
      // About every 140 ms, less often when finding the card takes longer on this phone.
      timer = window.setTimeout(tick, Math.max(60, 140 - (performance.now() - t)));
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [camera]);

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

  // `found`: the straightened card; `t0`: the tap; `before`: ms spent before reading (the photo, finding the card).
  const run = useCallback(async (found: Straightened, source: Source, t0: number, before: Record<string, number>, size: string) => {
    setError(null);
    setOut(null);
    try {
      const result = await scanCard(found.card, setStep);
      const timing = { ...before, ...result.timing };
      setOut({ ...result, timing, source, n: ++scans.current, foundBy: found.foundBy, totalMs: Math.round(performance.now() - t0), size });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The scan failed.");
    } finally {
      setStep(null);
    }
  }, []);

  // Tap the preview (or Scan): take a full-resolution photo where the browser can (Chrome on Android), because the
  // corner print is too small for a video frame; otherwise use the current video frame (iPhone Safari).
  const capture = async () => {
    const video = videoRef.current;
    if (!video || !size || step !== null) return;
    const t0 = performance.now();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // Search around the live outline (wherever and however tilted the card is), else around the guide. The outline's
    // corners go along too, in case the photo itself doesn't show the edges clearly enough.
    const quad = liveRef.current;
    const guideBox = searchBox(quad, vw, vh);
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
    if (Capture && videoTrack && !quick) {
      setStep("Taking the photo…");
      try {
        const bitmap = await createImageBitmap(await new Capture(videoTrack).takePhoto());
        // Only when the photo has the preview's shape (portrait or landscape); otherwise the outline can't be placed on it.
        if (bitmap.width > bitmap.height === vw > vh) {
          const photo = Math.round(performance.now() - t0);
          setStep("Finding the card…");
          const t1 = performance.now();
          const rect = onPhoto(guideBox, vw, vh, bitmap.width, bitmap.height);
          const corners = quad ? cornersOnPhoto(quad, vw, vh, bitmap.width, bitmap.height) : null;
          const found = await straighten(bitmap, bitmap.width, bitmap.height, rect, true, corners);
          const find = Math.round(performance.now() - t1);
          await run(found, "still", t0, { photo, find }, `${bitmap.width}×${bitmap.height}`);
          bitmap.close();
          return;
        }
        bitmap.close();
      } catch {
        // fall back to the video frame
      }
    }
    // Freeze the frame first: finding the card takes a moment and the video moves on.
    const frame = document.createElement("canvas");
    frame.width = vw;
    frame.height = vh;
    frame.getContext("2d")?.drawImage(video, 0, 0);
    const photo = Math.round(performance.now() - t0);
    setStep("Finding the card…");
    const t1 = performance.now();
    const corners = quad ? cornersOnPhoto(quad, vw, vh, vw, vh) : null;
    const found = await straighten(frame, vw, vh, guideBox, true, corners);
    await run(found, "camera", t0, { photo, find: Math.round(performance.now() - t1) }, `${vw}×${vh}`);
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    const src = URL.createObjectURL(file);
    try {
      const t0 = performance.now();
      const img = await loadImage(src);
      const t1 = performance.now();
      const found = await straighten(img, img.naturalWidth, img.naturalHeight, null, true);
      await run(found, "photo", t0, { photo: Math.round(t1 - t0), find: Math.round(performance.now() - t1) }, `${img.naturalWidth}×${img.naturalHeight}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      URL.revokeObjectURL(src);
    }
  };

  const fromUrl = async () => {
    if (!url.trim()) return;
    try {
      const t0 = performance.now();
      const img = await loadImage(url.trim());
      const t1 = performance.now();
      // A Scryfall image has no surface around the card, so its edges are the picture's edges and the edge finder
      // takes inner lines (the name bar, the text box) instead. Lay it on white paper first, like a real photo.
      const pad = Math.round(img.naturalWidth * 0.08);
      const paper = document.createElement("canvas");
      paper.width = img.naturalWidth + 2 * pad;
      paper.height = img.naturalHeight + 2 * pad;
      const pctx = paper.getContext("2d");
      if (pctx) {
        pctx.fillStyle = "#f4f1ea";
        pctx.fillRect(0, 0, paper.width, paper.height);
        pctx.drawImage(img, pad, pad);
      }
      const found = await straighten(paper, paper.width, paper.height, null, true);
      await run(found, "url", t0, { photo: Math.round(t1 - t0), find: Math.round(performance.now() - t1) }, `${img.naturalWidth}×${img.naturalHeight}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that image.");
    }
  };

  const guide = size ? guideRect(size.w, size.h) : null;
  const busy = step !== null;
  const locked = isLocked(track);

  return (
    <div className="mt-6 space-y-6">
      <section className="panel p-4">
        <h2 className="display text-xl">1. Scan a card</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-80">
          <li>Lay the card on a plain surface that contrasts with its border (white paper for black-bordered cards).</li>
          <li>Hold the phone at whatever angle keeps your shadow off the card. When the gold outline sits on the card, tap. Good light, no glare across the bottom corner.</li>
          <li>Mix it up: foils, showcase and borderless, sleeved, old cards (before 2014), other languages.</li>
        </ul>

        <div
          className={`relative mx-auto mt-4 overflow-hidden rounded-lg bg-black ${camera === "on" ? "cursor-pointer" : ""}`}
          style={size ? { aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc(70vh * ${size.w / size.h}))` } : { display: camera === "on" ? undefined : "none" }}
          onClick={() => {
            if (camera === "on") void capture();
          }}
          role={camera === "on" ? "button" : undefined}
          aria-label={camera === "on" ? "Take the photo" : undefined}
        >
          <video ref={videoRef} playsInline muted className="block h-full w-full" />
          {camera === "on" ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-sm font-semibold text-white" style={{ textShadow: "0 1px 3px #000" }}>
              {busy
                ? step
                : locked
                  ? "Locked on the card: tap to scan"
                  : live
                    ? "Found the card: hold still a moment"
                    : "Point at the card; any angle is fine"}
            </div>
          ) : null}
          {live ? (
            // The card as found: a gold outline at the card's own angle, so a tilted phone is fine.
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
              <polygon
                points={live.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={locked ? "rgba(212,168,75,0.18)" : "rgba(212,168,75,0.06)"}
                stroke="var(--color-gold,#d4a84b)"
                strokeWidth={locked ? 4 : 2}
                strokeDasharray={locked ? undefined : "8 6"}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>
          ) : guide && size ? (
            // No card found yet: a faint card shape to aim at.
            <div
              className="pointer-events-none absolute rounded-[4%] border-2 border-dashed border-white/60"
              style={{
                left: `${(guide.x / size.w) * 100}%`,
                top: `${(guide.y / size.h) * 100}%`,
                width: `${(guide.w / size.w) * 100}%`,
                height: `${(guide.h / size.h) * 100}%`,
              }}
            />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {camera === "on" ? (
            <>
              <button type="button" className="btn btn-gold min-h-12 flex-1 text-lg" onClick={() => void capture()} disabled={busy}>
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
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={quick}
            onChange={(e) => {
              setQuick(e.target.checked);
              localStorage.setItem("scan-lab:quick", e.target.checked ? "1" : "0");
            }}
          />
          Fast capture: use the video picture instead of taking a full photo (quicker, but the corner print may be too small)
        </label>
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

      {out ? (
        <ScanReview
          key={out.n}
          out={out}
          onSave={(r) => {
            save([...rows, r]);
            void saveImages(r.at, out);
            setOut(null);
          }}
          onSkip={() => setOut(null)}
        />
      ) : null}

      <Summary
        rows={rows}
        onClear={() => {
          save([]);
          localStorage.removeItem(IMAGES_KEY);
        }}
        onUndo={() => {
          const last = rows[rows.length - 1];
          save(rows.slice(0, -1));
          if (last) dropImages([last.at]);
        }}
      />
    </div>
  );
}

type ReviewInput = ScanOutput & { source: Source; n: number; foundBy: string; totalMs: number; size: string };

const FOUND_BY: Record<string, string> = {
  edges: "its four edges",
  outline: "its outline",
  live: "the gold outline (the photo's own edges weren't clear)",
  turned: "a turned rectangle (rough)",
  box: "plain edge finding (rough)",
  whole: "nothing: the whole picture was used",
};

const stepsText = (t: Record<string, number>) =>
  ["photo", "find", "prepare", "name", "corner", "lookup", "pictures"]
    .filter((k) => typeof t[k] === "number")
    .map((k) => `${k} ${t[k]}`)
    .join(" · ");

function ScanReview({ out, onSave, onSkip }: { out: ReviewInput; onSave: (r: LabResult) => void; onSkip: () => void }) {
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
  const [choices, setChoices] = useState<Printing[]>([]);
  const [showAll, setShowAll] = useState(false);

  const pickCard = async (oracleId: string) => {
    const ranked = await rank(out.prints, await printingsOf(oracleId));
    setCandidates(ranked.candidates);
    setArtOrder(ranked.artOrder);
    setPick(ranked.candidates[0] ? printingKey(ranked.candidates[0]) : null);
    setChoices([]);
  };

  // One clear match goes straight to its printings; a name that fits many cards ("Worf") lists them to tap.
  const wrongCard = async () => {
    setLooking(true);
    setLookError(null);
    setChoices([]);
    try {
      const card = await cardByName(name);
      if (card) return await pickCard(card.oracleId);
      const found = await searchCards(name);
      if (!found.length) setLookError("Scryfall didn't find that name.");
      else if (found.length === 1) await pickCard(found[0].oracleId);
      else setChoices(found);
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
      nameVia: out.nameVia,
      linePrinting: lineKey,
      lineDisagrees: out.disagree,
      lineFix: out.lineFixedFrom,
      candidates: candidates.length,
      cardRank,
      artRank,
      ms: out.ms,
      totalMs: out.totalMs,
      steps: stepsText(out.timing),
      foundBy: out.foundBy,
      size: out.size,
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
              {out.nameVia === "closest" ? <span className="opacity-75"> (closest name in the full list)</span> : null}
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
              {out.lineFixedFrom && out.linePrinting ? (
                <span className="opacity-75">
                  {" "}
                  (corner read as {out.lineFixedFrom.toUpperCase()}, corrected using the name and the picture)
                </span>
              ) : null}
            </div>
          </div>
          {out.disagree ? <div className="text-amber-400">The name and the corner point at different cards, so the name won.</div> : null}
          <div className="opacity-75">
            Card found by {FOUND_BY[out.foundBy] ?? out.foundBy} · {out.size} px
          </div>
          <div className="opacity-75">
            {(out.totalMs / 1000).toFixed(1)} s from the tap ({stepsText(out.timing)} ms; the name and the corner are read at the same time)
          </div>
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
      {choices.length ? (
        <div className="mt-3">
          <p className="text-sm opacity-75">Which card is it?</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {choices.map((c) => (
              <button key={c.id} type="button" className="rounded-md p-1 text-left text-xs" onClick={() => void pickCard(c.oracleId)}>
                <img src={c.image} alt={c.name} className="w-full rounded" loading="lazy" />
                <div className="mt-1 truncate">{c.flavorName ?? c.name}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
    ["Right printing once the card is known", `${s.printingRightAny} (${pct(s.printingRightAny, s.scans)})`],
    ["On its own: right card", `${s.cardFound} (${pct(s.cardFound, s.scans)})`],
    ["On its own: right printing", `${s.printingFound} (${pct(s.printingFound, s.scans)})`],
    ["Named a wrong card", String(s.wrongCard)],
    ["Average time reading", `${(s.avgMs / 1000).toFixed(1)} s`],
    ...(s.avgTotalMs !== null ? ([["Average time from the tap", `${(s.avgTotalMs / 1000).toFixed(1)} s`]] as [string, string][]) : []),
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
        <button type="button" className="btn min-h-11" onClick={() => void savePictureSheet(rows)} disabled={!rows.length}>
          Save pictures
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
      <p className="mt-2 text-xs opacity-70">
        Copy results and paste them into the chat with Claude when you&apos;re done. Save pictures downloads one image of every
        scan that went wrong (the straightened card, and what the reader saw for the name and the corner): attach it too.
      </p>
      <ScanGallery rows={rows} />
    </section>
  );
}

const nameWrong = (r: LabResult) => (r.nameMatch ?? "").toLowerCase() !== r.trueName.toLowerCase();
const cornerWrong = (r: LabResult) => r.linePrinting !== r.truePrinting;

// What each scan saw, so a failed read can be screenshotted and looked at (glare, blur or a wrong crop).
function ScanGallery({ rows }: { rows: LabResult[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const failed = rows.filter((r) => nameWrong(r) || cornerWrong(r));
  const shown = (all ? rows : failed).slice().reverse();
  const images = open ? readImages() : {};
  return (
    <div className="mt-5">
      <button type="button" className="btn min-h-11 w-full" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} failed reads ({failed.length})
      </button>
      {open ? (
        <>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every scan, not only failed ones
          </label>
          <ul className="mt-2 space-y-4">
            {shown.map((r) => {
              const img = images[r.at];
              return (
                <li key={r.at} className="border-t border-foreground/10 pt-3 text-sm">
                  <div className="font-semibold">
                    {r.trueName} · {r.trueSet.toUpperCase()} #{r.trueNumber}
                    {r.foil ? " · foil" : ""}
                    {r.sleeved ? " · sleeved" : ""} · {r.source}
                  </div>
                  <div className="mt-2 flex gap-3">
                    {img ? <img src={img.card} alt="" className="w-24 shrink-0 self-start rounded" /> : null}
                    <div className="min-w-0 flex-1 space-y-2">
                      {img ? <img src={img.name} alt="" className="max-h-8 max-w-full rounded bg-white" /> : null}
                      <div className={nameWrong(r) ? "text-red-400" : ""}>
                        Name: “{r.nameRead || "nothing"}” → {r.nameMatch ?? "no match"}
                        {r.nameVia === "closest" ? " (closest name)" : ""}
                      </div>
                      {img ? <img src={img.line} alt="" className="max-h-12 max-w-full rounded bg-white" /> : null}
                      <div className={cornerWrong(r) ? "text-red-400" : ""}>
                        Corner: “{r.lineRead.slice(0, 80) || "nothing"}” → {r.linePrinting ?? "no printing"}
                      </div>
                      {!img ? <div className="text-xs opacity-60">No pictures kept for this scan.</div> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// One image of every failed scan (or every scan when none failed): the straightened card, the name and corner crops
// as the reader saw them, and what came out. Downloaded, so David can attach it to the chat (round 6: five rounds
// were tuned without seeing a single crop).
async function savePictureSheet(rows: LabResult[]) {
  const images = readImages();
  const failed = rows.filter((r) => nameWrong(r) || cornerWrong(r));
  const list = (failed.length ? failed : rows).filter((r) => images[r.at]).slice(-16);
  if (!list.length) {
    window.alert("No pictures are kept for these scans (only scans saved on this phone have them).");
    return;
  }
  const W = 1100;
  const H = 330;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H * list.length;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  const fit = async (src: string, x: number, y: number, maxW: number, maxH: number) => {
    try {
      const img = await loadImage(src);
      const k = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
      ctx.drawImage(img, x, y, img.naturalWidth * k, img.naturalHeight * k);
      return img.naturalHeight * k;
    } catch {
      return 0;
    }
  };
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const img = images[r.at];
    const y = i * H;
    ctx.fillStyle = "#ddd";
    ctx.fillRect(0, y, W, 2);
    await fit(img.card, 10, y + 10, 220, H - 20);
    ctx.fillStyle = "#000";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(`${r.trueName} · ${r.trueSet.toUpperCase()} #${r.trueNumber}${r.foil ? " · foil" : ""} · ${r.foundBy ?? "?"}`.slice(0, 90), 245, y + 28);
    ctx.font = "15px sans-serif";
    const nameH = await fit(img.name, 245, y + 40, 840, 70);
    ctx.fillStyle = nameWrong(r) ? "#b00" : "#060";
    ctx.fillText(`Name: "${r.nameRead}" -> ${r.nameMatch ?? "no match"}`.slice(0, 110), 245, y + 58 + nameH);
    const lineH = await fit(img.line, 245, y + 72 + nameH, 840, 150);
    ctx.fillStyle = cornerWrong(r) ? "#b00" : "#060";
    ctx.fillText(`Corner: "${r.lineRead}" -> ${r.linePrinting ?? "no printing"}`.slice(0, 110), 245, y + 92 + nameH + lineH);
  }
  const a = document.createElement("a");
  a.href = c.toDataURL("image/jpeg", 0.85);
  a.download = `scan-lab-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.jpg`;
  a.click();
}
