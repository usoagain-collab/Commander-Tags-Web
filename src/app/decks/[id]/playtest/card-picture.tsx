// A playtest card's picture, shared by the desktop and phone tables: the face that's showing (the back face once
// flipped), or the card back when it's face down.
import { faceImage, faceName, type Instance } from "@/lib/playtest/game";

const ROUND = "rounded-[4.75%/3.5%]";

/** The back of a Magic card, drawn rather than loaded, so it matches the library pile. */
export function CardBack({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex aspect-[63/88] w-full items-center justify-center ${ROUND} border border-foreground/30 bg-gradient-to-br from-amber-900 to-stone-800 shadow ${className}`}
    >
      <span className="h-[55%] w-[55%] rounded-full border-2 border-amber-200/40 bg-amber-950/40" />
    </span>
  );
}

/**
 * `reveal` shows a face-down card's real face (the hover preview and the card sheet: you may look at your own
 * face-down cards).
 */
export function CardPicture({ inst, reveal, className = "", style }: { inst: Instance; reveal?: boolean; className?: string; style?: React.CSSProperties }) {
  if (inst.faceDown && !reveal) return <CardBack className={className} />;
  const src = faceImage(inst);
  return src ? (
    <img src={src} alt="" draggable={false} style={style} className={`w-full ${ROUND} shadow ${className}`} />
  ) : (
    <span className={`flex aspect-[63/88] w-full items-center justify-center rounded-lg border border-foreground/30 bg-foreground/5 p-1 text-center text-[11px] leading-tight ${className}`}>{faceName(inst)}</span>
  );
}

/** What to call a card on the table: others can't know a face-down card, but you can. */
export const tableName = (inst: Instance) => (inst.faceDown ? `Face-down ${faceName(inst)}` : faceName(inst));
