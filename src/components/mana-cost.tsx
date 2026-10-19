// Renders a mana cost like "{2}{B}{G}" with Scryfall's official symbol images.
const SYMBOL_URL = "https://svgs.scryfall.io/card-symbols/";

export function ManaCost({ cost, size = 14 }: { cost: string | null; size?: number }) {
  if (!cost) return null;
  const faces = cost.split(" // ");
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      {faces.map((face, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="mx-0.5 opacity-50">{"//"}</span>}
          {[...face.matchAll(/\{([^}]+)\}/g)].map((m, j) => (
            <img
              key={j}
              src={`${SYMBOL_URL}${m[1].replace(/\//g, "")}.svg`}
              alt={`{${m[1]}}`}
              title={`{${m[1]}}`}
              width={size}
              height={size}
              loading="lazy"
            />
          ))}
        </span>
      ))}
    </span>
  );
}
