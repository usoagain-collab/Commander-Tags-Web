"use client";

// Gamer look (v2): mana symbols in the deck's colors rain down once when the deck becomes Complete. Decoration only:
// no clicks, gone after the fall, and skipped for anyone whose system asks for reduced motion (see globals.css).
import { useMemo } from "react";

const SYMBOL_URL = "https://svgs.scryfall.io/card-symbols/";

export function ManaConfetti({ colors }: { colors: string[] }) {
  const pieces = useMemo(() => {
    const pool = colors.length ? colors : ["C"];
    // A fixed pattern per render, so it doesn't jump between renders; spread across the width.
    return Array.from({ length: 28 }, (_, i) => ({
      symbol: pool[i % pool.length],
      left: (i * 37) % 100,
      delay: (i % 7) * 0.12,
      size: 18 + ((i * 13) % 14),
      drift: ((i * 29) % 60) - 30,
    }));
  }, [colors]);
  return (
    <div aria-hidden className="mana-confetti pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((p, i) => (
        <img
          key={i}
          src={`${SYMBOL_URL}${p.symbol}.svg`}
          alt=""
          width={p.size}
          height={p.size}
          className="mana-confetti-piece absolute top-0"
          style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, ["--drift" as string]: `${p.drift}px` }}
        />
      ))}
    </div>
  );
}
