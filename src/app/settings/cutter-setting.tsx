"use client";

// Smart Cutter settings (profiles.cutter_prefs, migration 0033): power user mode, which unlocks weights, dismiss
// reasons, curve overrides, custom archetypes and the extra tools in the Cutter; plus combo protection and the
// warning before a manual removal puts a role below target (both modes). Saved half a second after a change.
import { useState } from "react";
import { ARCHETYPES, GENERAL_KEY, type Archetype, type Curve } from "@/lib/cutter/archetypes";
import { CURVE_LABELS } from "@/lib/cutter/archetype";
import { DEFAULT_WEIGHTS, type CutterWeights } from "@/lib/cutter/config";
import { readCutterPrefs } from "@/lib/cutter/state";
import { useCutterPrefs } from "@/lib/cutter/use-cutter";

const WEIGHT_NAMES: { key: keyof CutterWeights; name: string; about: string }[] = [
  { key: "coverage", name: "Role coverage", about: "How many of your roles and top themes the card covers" },
  { key: "saturation", name: "Saturation", about: "Pressure when the card's roles are over their targets" },
  { key: "weakest", name: "Weakest in role", about: "Mana value, speed and flexibility against the other cards in its roles" },
  { key: "theme", name: "Theme fit", about: "Overlap with your top themes and your commander's tags" },
  { key: "curve", name: "Curve fit", about: "How full its spot on the mana curve is for your archetype" },
  { key: "popularity", name: "Popularity", about: "How widely the card is played (EDHREC rank): staples are harder to cut" },
];

const GENERAL_CURVE = ARCHETYPES.find((a) => a.key === GENERAL_KEY)!.curve;

export function CutterSetting({ userId, initial }: { userId: string; initial: unknown }) {
  const { prefs, setPrefs, saveError } = useCutterPrefs(userId, readCutterPrefs(initial));
  const total = Object.values(prefs.weights).reduce((a, b) => a + b, 0) || 1;
  const toggle = (key: "power" | "comboProtect" | "belowTargetWarning", on: boolean) => setPrefs((p) => ({ ...p, [key]: on }));

  return (
    <fieldset className="mt-6">
      <legend className="display text-xl">Smart Cutter</legend>
      <p className="mt-1 text-sm opacity-80">Suggests what to cut from a deck using its roles, targets and themes, and explains each pick.</p>
      <div className="mt-3 space-y-2 text-sm">
        <Toggle on={prefs.power} onChange={(on) => toggle("power", on)} name="Power user mode" about="Weights, reasons for dismissing, curve overrides, custom archetypes, and the walkthrough, head to head, 2-for-1 and what-if tools." />
        <Toggle
          on={prefs.belowTargetWarning}
          onChange={(on) => toggle("belowTargetWarning", on)}
          name="Warn before a removal drops a role below target"
          about="Asks first when you remove or move a card and one of its roles would fall under its target."
        />
        {prefs.power && (
          <Toggle on={prefs.comboProtect} onChange={(on) => toggle("comboProtect", on)} name="Protect combo pieces" about="Never suggest cutting a card that is part of a two-card combo in the deck." />
        )}
      </div>

      {prefs.power && (
        <>
          <div className="panel mt-4 space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Keep score weights</h3>
              <button type="button" className="min-h-9 text-gold underline" onClick={() => setPrefs((p) => ({ ...p, weights: DEFAULT_WEIGHTS }))}>
                Reset
              </button>
            </div>
            {WEIGHT_NAMES.map((w) => (
              <label key={w.key} className="block">
                <span className="flex justify-between">
                  <span>{w.name}</span>
                  <span className="tabular-nums opacity-80">{Math.round((prefs.weights[w.key] / total) * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(prefs.weights[w.key] * 100)}
                  onChange={(e) => setPrefs((p) => ({ ...p, weights: { ...p.weights, [w.key]: Number(e.target.value) / 100 } }))}
                  className="h-11 w-full accent-gold"
                  aria-describedby={`w-${w.key}`}
                />
                <span id={`w-${w.key}`} className="block text-xs opacity-70">
                  {w.about}
                </span>
              </label>
            ))}
            <p className="text-xs opacity-70">The percentages always add up to 100.</p>
          </div>
          <ArchetypeEditor archetypes={prefs.archetypes} onChange={(archetypes) => setPrefs((p) => ({ ...p, archetypes }))} />
        </>
      )}
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-red-400">
        {saveError}
      </p>
    </fieldset>
  );
}

function Toggle({ on, onChange, name, about }: { on: boolean; onChange: (on: boolean) => void; name: string; about: string }) {
  return (
    <label className={`panel flex min-h-14 cursor-pointer items-start gap-3 p-3 ${on ? "border-gold" : ""}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-gold" />
      <span>
        <span className="block font-medium">{name}</span>
        <span className="block opacity-80">{about}</span>
      </span>
    </label>
  );
}

/** Custom archetype profiles: a name, the tags that signal it, and the expected curve. Used in every deck. */
function ArchetypeEditor({ archetypes, onChange }: { archetypes: Archetype[]; onChange: (a: Archetype[]) => void }) {
  const [name, setName] = useState("");
  const [slugs, setSlugs] = useState("");
  const [curve, setCurve] = useState<Curve>([...GENERAL_CURVE] as Curve);
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const tags = slugs
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase().replace(/^otag:/, ""))
      .filter(Boolean);
    const sum = curve.reduce((a, b) => a + b, 0);
    if (!name.trim()) return setProblem("Give it a name.");
    if (!tags.length) return setProblem("List at least one tag that signals it, like sacrifice-outlet.");
    if (sum <= 0) return setProblem("The curve needs at least one number above 0.");
    const key = `custom:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (archetypes.some((a) => a.key === key)) return setProblem("You already have an archetype with that name.");
    onChange([
      ...archetypes,
      { key, name: name.trim().slice(0, 40), signals: [{ kind: "tags", slugs: tags, weight: 1 }], curve: curve.map((n) => (100 * n) / sum) as Curve, custom: true },
    ]);
    setName("");
    setSlugs("");
    setCurve([...GENERAL_CURVE] as Curve);
    setProblem(null);
  };
  return (
    <div className="panel mt-4 space-y-3 p-4 text-sm">
      <h3 className="font-medium">Your archetypes</h3>
      <p className="opacity-80">Offered next to the built-in ones in every deck. Detected from the tags you list; the curve sets what the Cutter expects.</p>
      {archetypes.length > 0 && (
        <ul className="space-y-1">
          {archetypes.map((a) => (
            <li key={a.key} className="flex items-center justify-between gap-2">
              <span>
                {a.name}{" "}
                <span className="text-xs opacity-65">{a.signals.flatMap((s) => (s.kind === "tags" ? s.slugs : [])).join(", ")}</span>
              </span>
              <button type="button" className="min-h-9 text-red-400" onClick={() => onChange(archetypes.filter((x) => x.key !== a.key))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="mt-1 min-h-11 w-full rounded-lg border border-foreground/20 bg-background px-3" placeholder="Elfball" />
      </label>
      <label className="block">
        Tags that signal it (Scryfall oracle tags, comma separated)
        <input value={slugs} onChange={(e) => setSlugs(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-foreground/20 bg-background px-3" placeholder="typal-elf, mana-dork" />
      </label>
      <div>
        Expected curve (share of spells at each mana value)
        <div className="mt-1 grid grid-cols-7 gap-1">
          {CURVE_LABELS.map((l, i) => (
            <label key={l} className="text-center text-xs">
              {l}
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(curve[i])}
                onChange={(e) => setCurve((c) => c.map((n, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : n)) as Curve)}
                className="mt-0.5 min-h-11 w-full rounded-lg border border-foreground/20 bg-background px-1 text-center"
              />
            </label>
          ))}
        </div>
      </div>
      {problem && <p className="text-red-400">{problem}</p>}
      <button type="button" className="btn min-h-11" onClick={add}>
        Add archetype
      </button>
    </div>
  );
}
