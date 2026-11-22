// Card scanner experiment, round 6 (Nov 22, 2026): keep the live gold outline steady.
// Round 5 drew whatever the latest video frame found, so one bad frame made the outline jump to a fabric stripe or
// vanish, and it never settled. Now a found outline has to show up in two frames in a row before it's drawn, it
// follows the card smoothly, a missed frame or two keeps the last one, and it "locks" once it has stayed put.

export type Quad4 = [number, number][]; // four corners (top-left, top-right, bottom-right, bottom-left), as fractions of the frame

export const TRACK = {
  follow: 0.06, // a new outline within this of the shown one (largest corner move, share of the frame) is the same card moving
  blend: 0.5, // how far the shown outline moves toward each new one
  hold: 4, // frames without a find before the outline disappears (about half a second)
  still: 0.012, // a corner move under this counts as holding still
  lockAfter: 3, // frames held still before the outline locks
  minAngle: 62, // corner angles a flat card can show, even photographed at an angle (degrees)
  maxAngle: 118,
};

export interface TrackState {
  shown: Quad4 | null; // what's drawn
  pending: Quad4 | null; // a new find waiting for a second frame to agree
  misses: number;
  steady: number; // frames in a row the shown outline barely moved
}

export const startTrack = (): TrackState => ({ shown: null, pending: null, misses: 0, steady: 0 });

// The largest distance any corner moved.
export function quadMove(a: Quad4, b: Quad4): number {
  let d = 0;
  for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
  return d;
}

// A card seen from any reasonable angle: a convex four-sided shape whose corners are all fairly square. Lines that
// cross the card (a stripe, the art's edge) make skewed shapes, so this drops most wrong finds before they're drawn.
// `aspect` = frame width / height, because the corners are fractions of each.
export function plausibleQuad(q: Quad4, aspect = 1): boolean {
  const pts = q.map(([x, y]) => [x * aspect, y]);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = pts[(i + 3) % 4];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[(i + 1) % 4];
    const ux = ax - bx;
    const uy = ay - by;
    const vx = cx - bx;
    const vy = cy - by;
    const turn = Math.sign(ux * vy - uy * vx);
    if (!turn || (sign && turn !== sign)) return false; // not convex
    sign = turn;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (angle < TRACK.minAngle || angle > TRACK.maxAngle) return false;
  }
  return true;
}

const mix = (a: Quad4, b: Quad4, k: number): Quad4 => a.map(([x, y], i) => [x + (b[i][0] - x) * k, y + (b[i][1] - y) * k]);

// One video frame's find (or null) moves the tracker on.
export function stepTrack(s: TrackState, found: Quad4 | null): TrackState {
  if (!found) {
    const misses = s.misses + 1;
    return misses > TRACK.hold ? startTrack() : { ...s, pending: null, misses, steady: 0 };
  }
  if (!s.shown) {
    // Appear only once two frames agree.
    if (s.pending && quadMove(s.pending, found) < TRACK.follow) return { shown: found, pending: null, misses: 0, steady: 0 };
    return { ...s, pending: found };
  }
  const d = quadMove(s.shown, found);
  if (d < TRACK.follow) {
    return { shown: mix(s.shown, found, TRACK.blend), pending: null, misses: 0, steady: d < TRACK.still ? s.steady + 1 : 0 };
  }
  // Somewhere else: jump only when the next frame agrees (the card really moved); a one-frame glitch is ignored.
  if (s.pending && quadMove(s.pending, found) < TRACK.follow) return { shown: found, pending: null, misses: 0, steady: 0 };
  return { ...s, pending: found };
}

export const isLocked = (s: TrackState) => !!s.shown && s.steady >= TRACK.lockAfter;
