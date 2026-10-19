// Mana costs and rules text drawn with Scryfall's official symbol images ({2}{B}{G}, {T}, {G/U}…).
const SYMBOL_URL = "https://svgs.scryfall.io/card-symbols/";

export function ManaSymbol({ symbol, size = 14 }: { symbol: string; size?: number }) {
  return (
    <img
      src={`${SYMBOL_URL}${symbol.replace(/\//g, "")}.svg`}
      alt={`{${symbol}}`}
      title={`{${symbol}}`}
      width={size}
      height={size}
      loading="lazy"
      className="inline-block align-[-0.15em]"
    />
  );
}

export function ManaCost({ cost, size = 14 }: { cost: string | null; size?: number }) {
  if (!cost) return null;
  // Transforming cards have no cost on the back face ("{U} // "), so drop empty faces.
  const faces = cost.split("//").map((f) => f.trim()).filter(Boolean);
  if (faces.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {faces.map((face, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="mx-0.5 opacity-50">{"//"}</span>}
          {[...face.matchAll(/\{([^}]+)\}/g)].map((m, j) => (
            <ManaSymbol key={j} symbol={m[1]} size={size} />
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * Rules text or a ruling: one paragraph per line, {symbols} as icons, and reminder text in parentheses
 * set in italics the way it's printed on cards.
 */
export function SymbolText({ text, size = 14 }: { text: string; size?: number }) {
  return (
    <>
      {text.split("\n").map((para, i) => (
        <p key={i} className="mb-1.5 last:mb-0">
          {para.split(/(\([^)]*\))/).map((chunk, j) => {
            const parts = chunk.split(/(\{[^}]+\})/).map((p, k) =>
              /^\{[^}]+\}$/.test(p) ? <ManaSymbol key={k} symbol={p.slice(1, -1)} size={size} /> : p,
            );
            return chunk.startsWith("(") ? (
              <em key={j} className="opacity-75">
                {parts}
              </em>
            ) : (
              <span key={j}>{parts}</span>
            );
          })}
        </p>
      ))}
    </>
  );
}
