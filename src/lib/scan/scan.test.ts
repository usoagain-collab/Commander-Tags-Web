import { describe, expect, it } from "vitest";
import { cleanNumber, parseCollectorLine } from "./collector-line";
import { CARD_RATIO, cardCorners, colorDistance, colorGrid, dHash, findCardBounds, hamming, homography, houghCorners, otsu, warp, type Pixels } from "./image";
import { readLabResults, resultsText, summarize, type LabResult } from "./lab-results";
import { buildNameIndex, cleanNameRead, closestName, editDistance, nameFits, printedNames, setCodeVariants } from "./names";
import { isLocked, plausibleQuad, quadMove, startTrack, stepTrack, TRACK, type Quad4 } from "./track";

describe("parseCollectorLine", () => {
  it("reads a current two-line corner", () => {
    expect(parseCollectorLine("0123 R\nMOM • EN")).toEqual({ number: "123", set: "mom", lang: "en", rarity: "R", foilMark: "dot" });
  });
  it("reads the older number / set size form and a star", () => {
    expect(parseCollectorLine("122/269 R\nM15 ★ EN")).toMatchObject({ number: "122", set: "m15", lang: "en", foilMark: "star" });
  });
  it("forgives common OCR slips", () => {
    expect(parseCollectorLine("O2I5 M\nwoe * JP")).toMatchObject({ number: "215", set: "woe", lang: "ja", foilMark: null, rarity: "M" });
  });
  it("reads the number even when the rarity letter is misread", () => {
    expect(parseCollectorLine("263 V]\nC21 « EN Ww MIKI BlERIK")).toMatchObject({ number: "263", rarity: "U", set: "c21", lang: "en", foilMark: "dot" });
    expect(parseCollectorLine("0263\nC21 • EN")).toMatchObject({ number: "263", rarity: null });
  });
  it("reads the newer rarity-first order", () => {
    expect(parseCollectorLine("C 0145\nWOC «EN % DAN Scott")).toMatchObject({ number: "145", rarity: "C", set: "woc", lang: "en" });
  });
  it("keeps letters after the number", () => {
    expect(cleanNumber("0045a")).toBe("45a");
  });
  it("needs a letter in the set code and a known language", () => {
    expect(parseCollectorLine("0123 C\n0456 • EN").set).toBeNull();
    expect(parseCollectorLine("MOM • QQ").set).toBeNull();
  });
  it("reads no separator as an unknown mark", () => {
    expect(parseCollectorLine("0001 C\nDSK EN")).toMatchObject({ set: "dsk", foilMark: null });
  });
  it("returns nothing for an old card", () => {
    expect(parseCollectorLine("Illus. Mark Poole")).toEqual({ number: null, set: null, lang: null, rarity: null, foilMark: null });
  });
});

// A test picture: gray background, a darker card rectangle, a bright stripe for "art".
function picture(w: number, h: number, card: { x: number; y: number; w: number; h: number } | null, shade = 1): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inCard = card && x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h;
      let v = inCard ? 30 : 200;
      if (inCard && card && y < card.y + card.h * 0.5 && x < card.x + card.w * (x / w)) v = 150;
      const j = (y * w + x) * 4;
      data[j] = Math.min(255, v * shade);
      data[j + 1] = Math.min(255, v * shade * 0.9);
      data[j + 2] = Math.min(255, v * shade * 0.8);
      data[j + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("image helpers", () => {
  it("finds a card's edges inside a rough crop", () => {
    const card = { x: 20, y: 24, w: 252, h: 352 };
    const r = findCardBounds(picture(292, 400, card));
    expect(Math.abs(r.x - card.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.y - card.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.w - card.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.w / r.h - CARD_RATIO)).toBeLessThan(0.02);
  });
  it("keeps the whole crop when no card edge stands out", () => {
    expect(findCardBounds(picture(100, 140, null))).toEqual({ x: 0, y: 0, w: 100, h: 140 });
  });
  it("gives the same hash under different light, and a different one for another picture", () => {
    const card = { x: 0, y: 0, w: 126, h: 176 };
    const a = picture(126, 176, card);
    const b = picture(126, 176, card, 1.3);
    const other = picture(126, 176, { x: 30, y: 10, w: 60, h: 120 });
    expect(hamming(dHash(a), dHash(b))).toBeLessThan(10);
    expect(hamming(dHash(a), dHash(other))).toBeGreaterThan(20);
    expect(colorDistance(colorGrid(a), colorGrid(b))).toBeLessThan(0.05);
  });
  it("splits dark text from a light background", () => {
    const gray = new Float32Array([10, 12, 15, 11, 240, 235, 250, 245]);
    const t = otsu(gray);
    expect(t).toBeGreaterThanOrEqual(15);
    expect(t).toBeLessThan(235);
  });
});

const row = (over: Partial<LabResult>): LabResult => ({
  at: "2026-11-21T00:00:00Z", source: "camera", trueName: "Sol Ring", truePrinting: "c21/263", trueSet: "c21", trueNumber: "263",
  trueLang: "en", foil: false, sleeved: false, note: "", nameRead: "Sol Ring", nameMatch: "Sol Ring", lineRead: "0263 U\nC21 • EN",
  lineSet: "c21", lineNumber: "263", lineLang: "en", foilMark: "dot", linePrinting: "c21/263", candidates: 40, cardRank: 3, artRank: 7, ms: 2000,
  ...over,
});

describe("lab results", () => {
  it("scores each method", () => {
    const s = summarize([
      row({}),
      row({ nameMatch: "Sol Talisman", lineSet: null, lineNumber: null, lineLang: null, foilMark: null, linePrinting: null, cardRank: 1, foil: true }),
      row({ linePrinting: "c20/252", foilMark: "dot", foil: true }),
    ]);
    expect(s).toMatchObject({ scans: 3, nameRight: 2, lineReadable: 2, linePrintingRight: 1, foilScans: 2, foilMarkRead: 2, foilMarkRight: 1, cardTop1: 1, printingRightAny: 2, avgMs: 2000 });
    expect(s).toMatchObject({ cardFound: 2, avgTotalMs: null });
  });
  it("drops bad saved data", () => {
    expect(readLabResults("not json")).toEqual([]);
    expect(readLabResults(JSON.stringify([{ nope: 1 }, row({})]))).toHaveLength(1);
  });
  it("writes one tab-separated line per scan without breaking on newlines", () => {
    const text = resultsText([row({ note: "glare\nhere" })]);
    const lines = text.split("\n");
    expect(lines[lines.length - 1].split("\t")).toHaveLength(29);
    expect(text).toContain("0263 U C21 • EN");
  });
});

describe("closest card name", () => {
  const index = buildNameIndex(["Cetacean Ops", "Sol Ring", "Sol Talisman", "Arcane Signet", "Delver of Secrets // Insectile Aberration", "Lim-Dûl's Vault"]);
  it("fixes a wrong first letter that Scryfall's fuzzy search misses", () => {
    expect(closestName("Cotacean Ons —", index)?.name).toBe("Cetacean Ops");
  });
  it("ignores stray marks and case", () => {
    expect(closestName("(sol Ring", index)?.name).toBe("Sol Ring");
    expect(closestName("IGeane Sienet", index)?.name).toBe("Arcane Signet");
  });
  it("finds a double-faced card by its front name, and accents don't matter", () => {
    expect(closestName("Delver of Secrcts", index)?.name).toBe("Delver of Secrets");
    expect(closestName("Lim-Dul's Vault", index)?.name).toBe("Lim-Dûl's Vault");
  });
  it("gives up on gibberish and very short reads", () => {
    expect(closestName("HAR f aR i ELVA", index)).toBeNull();
    expect(closestName("|", index)).toBeNull();
  });
  it("counts letter edits", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abcdefgh", 2)).toBe(3);
  });
});

describe("cleanNameRead", () => {
  it("drops the mana cost and dashes OCR adds after a name", () => {
    expect(cleanNameRead("Worf, Regent of Terok Nox —¢5")).toBe("Worf, Regent of Terok Nox");
    expect(cleanNameRead("Cotacean Ons —")).toBe("Cotacean Ons");
    expect(cleanNameRead("(sol Ring 1")).toBe("sol Ring");
  });
});

// A card-shaped dark quadrilateral (a photo taken at an angle) on a striped light surface.
function slantedCard(w: number, h: number, c: [number, number][]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i];
      const [bx, by] = c[(i + 1) % 4];
      const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (cross < 0) return false;
      s++;
    }
    return s === 4;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const v = inside(x, y) ? 25 + (x % 9) : 140 + ((y >> 2) % 2) * 25; // dark card vs striped fabric
      data[j] = data[j + 1] = data[j + 2] = v;
      data[j + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("finding a slanted card", () => {
  const corners: [number, number][] = [[70, 60], [250, 75], [262, 330], [55, 320]];
  const pic = slantedCard(320, 400, corners);
  it("finds its four corners", () => {
    const found = cardCorners(pic);
    expect(found).not.toBeNull();
    found!.forEach(([x, y], i) => {
      // within the 2.5% push outward that makes up for rounded corners
      expect(Math.hypot(x - corners[i][0], y - corners[i][1])).toBeLessThan(9);
    });
  });
  it("maps the upright rectangle onto those corners", () => {
    const H = homography(100, 140, corners as [[number, number], [number, number], [number, number], [number, number]]);
    const at = (x: number, y: number) => {
      const z = H[6] * x + H[7] * y + H[8];
      return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
    };
    expect(at(0, 0)[0]).toBeCloseTo(70);
    expect(at(100, 140)[1]).toBeCloseTo(330);
    expect(at(0, 140)[0]).toBeCloseTo(55);
  });
  it("flattens it into an upright card", () => {
    const H = homography(100, 140, cardCorners(pic)!);
    const out = warp(pic, H, 100, 140);
    // Every pixel comes from inside the card (dark), hardly any from the fabric around it.
    let fabric = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i] > 90) fabric++;
    expect(fabric / (out.length / 4)).toBeLessThan(0.12);
  });
});

describe("corner from David's Worf photo", () => {
  it("reads a rarity touching the number, and * stays unknown", () => {
    expect(parseCollectorLine("their choice. ri\nM0026 &\nsDS *EN dw OLIVER BARRETT")).toMatchObject({ number: "26", rarity: "M", set: "sds", lang: "en", foilMark: null });
  });
});

describe("finding a card's edges as lines", () => {
  it("finds a slanted card on striped fabric", () => {
    const corners: [number, number][] = [[70, 60], [250, 75], [262, 330], [55, 320]];
    const found = houghCorners(slantedCard(320, 400, corners));
    expect(found).not.toBeNull();
    found!.forEach(([x, y], i) => expect(Math.hypot(x - corners[i][0], y - corners[i][1])).toBeLessThan(6));
  });
});

describe("misread set codes and flavor names", () => {
  const valid = new Set(["sds", "sos", "trk", "trc", "mom", "c21"]);
  it("offers real codes one slip away", () => {
    expect(setCodeVariants("sos", valid)).toEqual(["sos", "sds"]);
    expect(setCodeVariants("trek", valid)).toEqual(["trk"]);
    expect(setCodeVariants("C2I", valid)).toEqual(["c21"]);
    expect(setCodeVariants("zzz", valid)).toEqual([]);
  });
  it("finds a card by its printed flavor name, and reads a bar as L", () => {
    const index = buildNameIndex(["Mogis, God of Slaughter", "U.S.S. Voyager, Lone Wanderer"], [["Worf, Regent of Terok Nor", "Mogis, God of Slaughter"]]);
    expect(closestName("BE REeen of Terok Nor", index)).toBeNull(); // too far gone
    expect(closestName("Worf. Regent of Terok Nox", index)?.target).toBe("Mogis, God of Slaughter");
    expect(closestName("11S S Vovacer | one Wander", index)?.target).toBe("U.S.S. Voyager, Lone Wanderer");
  });
});

describe("round 5 corner reads", () => {
  it("prefers a four-digit padded number in a jumbled read", () => {
    expect(parseCollectorLine("3 RR 0185 5 LS 44 1 20 A BE IRC * EN AB LA")).toMatchObject({ number: "185" });
    expect(parseCollectorLine("C002 TRK * EN  CN SEARL")).toMatchObject({ number: "2", set: "trk" });
  });
  it("treats T and I as lookalikes", () => {
    expect(setCodeVariants("irc", new Set(["trc", "trk"]))).toEqual(["trc"]);
  });
});

describe("nameFits (round 6: no wrong card from junk)", () => {
  it("accepts close reads and trailing junk", () => {
    expect(nameFits("Fortified Village dura", ["Fortified Village"])).toBe(true);
    expect(nameFits(": forest", ["Forest"])).toBe(true);
    expect(nameFits("enova, Ancient Calamity", ["Jenova, Ancient Calamity"])).toBe(true);
    expect(nameFits("Worf, Regent of Terok Nor", ["Mogis, God of Slaughter", "Worf, Regent of Terok Nor"])).toBe(true);
  });
  it("rejects junk that fuzzy search turned into a card", () => {
    expect(nameFits("- PE . N a - ry Ad Shr", ["Vadrok, Apex of Thunder"])).toBe(false);
    expect(nameFits("", ["Forest"])).toBe(false);
  });
  it("lists flavor names and faces of a card", () => {
    const index = buildNameIndex(["Mogis, God of Slaughter", "Zenos yae Galvus // Shinryu, Transcendent Rival"], [["Worf, Regent of Terok Nor", "Mogis, God of Slaughter"]]);
    expect(printedNames("Mogis, God of Slaughter", index)).toContain("Worf, Regent of Terok Nor");
    expect(printedNames("Zenos yae Galvus // Shinryu, Transcendent Rival", index)).toContain("Zenos yae Galvus");
  });
});

describe("tracker (round 6: a steady outline)", () => {
  const card = (dx = 0, dy = 0): Quad4 => [
    [0.2 + dx, 0.1 + dy],
    [0.8 + dx, 0.1 + dy],
    [0.8 + dx, 0.9 + dy],
    [0.2 + dx, 0.9 + dy],
  ];
  it("shows an outline only once two frames agree", () => {
    let s = stepTrack(startTrack(), card());
    expect(s.shown).toBeNull();
    s = stepTrack(s, card(0.005));
    expect(s.shown).not.toBeNull();
  });
  it("ignores a one-frame glitch and keeps the outline through short misses", () => {
    let s = stepTrack(stepTrack(startTrack(), card()), card());
    s = stepTrack(s, card(0.3, 0)); // a stripe somewhere else
    expect(quadMove(s.shown!, card())).toBeLessThan(0.01);
    for (let i = 0; i < TRACK.hold; i++) s = stepTrack(s, null);
    expect(s.shown).not.toBeNull();
    s = stepTrack(s, null);
    expect(s.shown).toBeNull();
  });
  it("jumps when the card really moved, and locks when held still", () => {
    let s = stepTrack(stepTrack(startTrack(), card()), card());
    s = stepTrack(stepTrack(s, card(0.2)), card(0.2));
    expect(quadMove(s.shown!, card(0.2))).toBeLessThan(0.001);
    expect(isLocked(s)).toBe(false);
    for (let i = 0; i < TRACK.lockAfter; i++) s = stepTrack(s, card(0.2));
    expect(isLocked(s)).toBe(true);
  });
  it("drops skewed shapes", () => {
    expect(plausibleQuad(card())).toBe(true);
    expect(plausibleQuad([[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.7, 0.9]])).toBe(false);
    expect(plausibleQuad([[0.2, 0.1], [0.8, 0.9], [0.8, 0.1], [0.2, 0.9]])).toBe(false); // crossed
  });
});
