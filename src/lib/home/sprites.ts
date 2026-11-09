// Pixel-art sprites for the architecture diagram (from the Relate home design): 16x16 grids of
// palette letters, drawn as SVG `path` runs at build time, so the page ships no sprite code.
export const PALETTE: Record<string, string> = {
  "D": "#002B43",
  "E": "#181414",
  "W": "#E9EFF1",
  "w": "#FCF9F6",
  "g": "#4F4E4D",
  "B": "#014063",
  "b": "#0A6190",
  "c": "#4C99A4",
  "C": "#8FE3E8",
  "P": "#6A82FF",
  "Y": "#8FE3E8",
  "F": "#145439",
  "f": "#6FA646",
  "L": "#90CB62",
  "H": "#D43300",
  "h": "#F96746",
  "l": "#FF8E6A",
  "K": "#181414"
};

export const SPRITES: Record<string, string[]> = {
  "robot": [
      ".......hh.......",
      ".......KK.......",
      "..KKKKKKKKKKKK..",
      ".KCCCCCCCCCCCCK.",
      "KCCCCCCCCCCCCCCK",
      "KCKKKKCCCCKKKKCK",
      "KCKYYKCCCCKYYKCK",
      "KCKKKKCCCCKKKKCK",
      "KCCCCCCCCCCCCCCK",
      "KCKKKKKKKKKKKKCK",
      "KCCCCCCCCCCCCccK",
      ".KKKKKKKKKKKKKK.",
      ".KCCCCCCCCCCCCK.",
      ".KcCCCCCCCCCCcK.",
      ".KcccCCCCCCcccK.",
      ".KKKKKKKKKKKKKK."
  ],
  "star": [
    ".......KK.......",
    "......KYYK......",
    "......KYYK......",
    ".....KYYYYK.....",
    "KKKKKKYYYYKKKKKK",
    "KYYYYWWYYYYYYYYK",
    ".KYYYYWYYYYYYYK.",
    "..KYYYYYYYYYYK..",
    "..KYYYYYYYYYYK..",
    "...KYYYYYYYYK...",
    "...KYYYYYYYYK...",
    ".KYYYYYKKYYYYYK.",
    "KYYYYKK..KKYYYYK",
    "KYYKK......KKYYK",
    ".KKK........KKK.",
    "................"
  ],
  "terminal": [
    "................",
    "..KKKKKKKKKKKK..",
    ".KccccccccccccK.",
    ".KKKKKKKKKKKKKK.",
    ".KBBBBBBBBBBBBK.",
    ".KBCBBBBBBBBBBK.",
    ".KBBCBBBBBBBBBK.",
    ".KBBBCBBBBBBBBK.",
    ".KBBCBBBBBBBBBK.",
    ".KBCBBBBBBBBBBK.",
    ".KBBBBBBlllBBBK.",
    ".KBBBBBBBBBBBBK.",
    ".KKKKKKKKKKKKKK.",
    "................",
    "................",
    "................"
  ],
  "plug": [
    "....KK....KK....",
    "....Kc....Kc....",
    "....Kc....Kc....",
    "...KKKKKKKKKK...",
    "..KCCCCCCCCCCK..",
    "..KCCCCCCCCCCK..",
    "..KCCCPCCPCCCK..",
    "..KCCCCCCCCCCK..",
    "...KCCCCCCCCK...",
    "....KKCCCCKK....",
    ".....KcccCK.....",
    "......KccK......",
    "......KccK......",
    "......KccK......",
    ".......KK.......",
    "................"
  ],
  "code": [
    "................",
    "................",
    "..........hhK...",
    "....CCK..KhhK...",
    "...CCK...hhKC...",
    "..CCK....hhKCC..",
    ".CCK....hhK.KCC.",
    "CCK.....hhK..KCC",
    ".CCK...hhK..KCC.",
    "..CCK..hhK.KCC..",
    "...CCKhhK.KCC...",
    "....CChhKKCC....",
    ".....hhK........",
    "................",
    "................",
    "................"
  ],
  "memory": [
    "................",
    ".......KK.......",
    "......KPPK......",
    "......KPPK......",
    ".......KK.......",
    ".......KK.......",
    "......K..K......",
    ".....K....K.....",
    "....K......K....",
    "..KK........KK..",
    ".KCCK......KhhK.",
    ".KCCKKKKKKKKhhK.",
    "..KK........KK..",
    "................",
    "................",
    "................"
  ],
  "plus": [
    "................",
    "................",
    ".....KKKKKK.....",
    ".....KCCccK.....",
    ".....KCcccK.....",
    "..KKKCcccccKKK..",
    "..KCCccccccccK..",
    "..KCcccccccccK..",
    "..KccccccccccK..",
    "..KccccccccccK..",
    "..KKKccccccKKK..",
    ".....KccccK.....",
    ".....KccccK.....",
    ".....KKKKKK.....",
    "................",
    "................"
  ],
  "py": [
    "................",
    ".KKKKKKKKKKKKKK.",
    ".KccccccccccccK.",
    ".KccccccccccccK.",
    ".KccccccccccccK.",
    ".KcKKKcKcKccccK.",
    ".KcKcKcKcKccccK.",
    ".KcKKKccKcccccK.",
    ".KcKccccKcccccK.",
    ".KcKccccKcccccK.",
    ".KccccccccccccK.",
    ".KccccccccccccK.",
    ".KccccccccccccK.",
    ".KccccccccccccK.",
    ".KKKKKKKKKKKKKK.",
    "................"
  ],
  "js": [
    "................",
    ".KKKKKKKKKKKKKK.",
    ".KllllllllllllK.",
    ".KllllllllllllK.",
    ".KllllllllllllK.",
    ".KllKKlKKKllllK.",
    ".KlllKlKllllllK.",
    ".KlllKlKKKllllK.",
    ".KlKlKlllKllllK.",
    ".KlKKllKKKllllK.",
    ".KllllllllllllK.",
    ".KllllllllllllK.",
    ".KllllllllllllK.",
    ".KllllllllllllK.",
    ".KKKKKKKKKKKKKK.",
    "................"
  ],
  "rs": [
    "................",
    ".KKKKKKKKKKKKKK.",
    ".KhhhhhhhhhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KhKKhhKKKhhhhK.",
    ".KhKhKhKhhhhhhK.",
    ".KhKKhhKKKhhhhK.",
    ".KhKhKhhhKhhhhK.",
    ".KhKhKhKKKhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KhhhhhhhhhhhhK.",
    ".KKKKKKKKKKKKKK.",
    "................"
  ]
};

/** An inline SVG of sprite `name`: one path per palette colour, crisp pixels. */
export function sprite(name: string): string {
  const rows = SPRITES[name];
  if (!rows) return '';
  const n = rows.length;
  const byColour = new Map<string, string>();
  rows.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      const colour = PALETTE[row[x]];
      if (!colour) continue;
      byColour.set(colour, `${byColour.get(colour) ?? ''}M${x} ${y}h1v1h-1z`);
    }
  });
  const paths = [...byColour].map(([c, d]) => `<path fill="${c}" d="${d}"/>`).join('');
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">${paths}</svg>`;
}
