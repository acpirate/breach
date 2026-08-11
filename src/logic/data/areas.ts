// Alpha 0.1.0 §8 — Area-Pattern Registry. Enumerated stable IDs mapped to
// EXPLICIT coordinate sets (stored directly, never derived from catalog
// numbers). Coordinate convention: (0,0) = source/detonating tile, +x right,
// +y down. Out-of-board coordinates are clipped by the consumer at resolution
// time.
//
// Alpha 0.6.0 §22.1 — catalog entries 4-7 from the dataset notes are now coded
// (director-authorized 2026-08-11), because PSV_BIGGER_BOMB advances a Bomb one
// NAMED step and the previous four-entry catalog left the largest authored Bomb
// (EBOMB, catalog 3) with nowhere to go. The notes' cumulative rule — "area
// designators include all lower areas, centered on detonating gem" — is what
// every entry below is built from, so each pattern is a strict superset of the
// one before it and the progression order is the catalog order.

export type AreaPatternId =
  | 'AREA_SELF'
  | 'AREA_CARDINAL_1'
  | 'AREA_SQUARE_3X3'
  | 'AREA_SQUARE_3X3_CARDINAL_2'
  | 'AREA_FAT_CROSS_2'
  | 'AREA_SQUARE_5X5'
  | 'AREA_FAT_CROSS_3'
  | 'AREA_SQUARE_7X7_CROSS_4';

export interface AreaOffset {
  x: number;
  y: number;
}

// §8.1 catalog 0 — the source tile only.
const AREA_SELF: ReadonlyArray<AreaOffset> = [{ x: 0, y: 0 }];

// §8.2 catalog 1 — AREA_SELF plus the four cardinal neighbors.
const AREA_CARDINAL_1: ReadonlyArray<AreaOffset> = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

// §8.3 catalog 2 — every coordinate in the centered 3x3 square.
const AREA_SQUARE_3X3: ReadonlyArray<AreaOffset> = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

// §8.4 catalog 3 — the 3x3 square plus one tile in each cardinal direction at
// distance 2 (13 cells at board center; NO distance-2 diagonals).
const AREA_SQUARE_3X3_CARDINAL_2: ReadonlyArray<AreaOffset> = [
  ...AREA_SQUARE_3X3,
  { x: 0, y: -2 },
  { x: 2, y: 0 },
  { x: 0, y: 2 },
  { x: -2, y: 0 },
];

// A perpendicular bar of `half*2+1` tiles centered on each cardinal direction
// at `dist`. This builds the notes' "fat cross" arms; the coordinate SETS are
// still what the registry stores, exactly as before — this is construction, not
// runtime derivation.
function cardinalBars(dist: number, half: number): AreaOffset[] {
  const out: AreaOffset[] = [];
  for (let o = -half; o <= half; o++) {
    out.push({ x: o, y: -dist }); // north
    out.push({ x: dist, y: o }); // east
    out.push({ x: o, y: dist }); // south
    out.push({ x: -dist, y: o }); // west
  }
  return out;
}

function square(radius: number): AreaOffset[] {
  const out: AreaOffset[] = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) out.push({ x, y });
  }
  return out;
}

// Deduplicate while preserving first-seen order, so a cumulative pattern reads
// as "everything smaller, then what this step adds".
function union(...groups: ReadonlyArray<AreaOffset>[]): ReadonlyArray<AreaOffset> {
  const seen = new Set<string>();
  const out: AreaOffset[] = [];
  for (const g of groups) {
    for (const o of g) {
      const k = `${o.x},${o.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(o);
    }
  }
  return out;
}

// catalog 4 — "3 tiles in each cardinal direction at a distance of 2 from the
// center making a fat cross pattern": the 3x3 square with 3-wide bars at
// distance 2. 21 cells unclipped (the 5x5 square minus its four corners).
const AREA_FAT_CROSS_2: ReadonlyArray<AreaOffset> = union(AREA_SQUARE_3X3_CARDINAL_2, cardinalBars(2, 1));

// catalog 5 — "square of 5 tiles on each side": the fat cross plus the four
// (+-2,+-2) corners. 25 cells unclipped.
const AREA_SQUARE_5X5: ReadonlyArray<AreaOffset> = union(AREA_FAT_CROSS_2, square(2));

// catalog 6 — "3 tiles in each cardinal direction at a distance of 3 from the
// center making a fatter cross pattern". 37 cells unclipped.
const AREA_FAT_CROSS_3: ReadonlyArray<AreaOffset> = union(AREA_SQUARE_5X5, cardinalBars(3, 1));

// catalog 7 — "square of 7 tiles on each side + 5 tiles in each cardinal
// direction making a very fat cross". 69 cells unclipped; on the 8x8
// Datastream this always clips to the entire board.
const AREA_SQUARE_7X7_CROSS_4: ReadonlyArray<AreaOffset> = union(AREA_FAT_CROSS_3, square(3), cardinalBars(4, 2));

export const AREA_PATTERNS: Record<AreaPatternId, ReadonlyArray<AreaOffset>> = {
  AREA_SELF,
  AREA_CARDINAL_1,
  AREA_SQUARE_3X3,
  AREA_SQUARE_3X3_CARDINAL_2,
  AREA_FAT_CROSS_2,
  AREA_SQUARE_5X5,
  AREA_FAT_CROSS_3,
  AREA_SQUARE_7X7_CROSS_4,
};

// §22.1 — the ONE progression authority, in ascending nominal (unclipped)
// footprint order. PSV_BIGGER_BOMB advances a pattern by index along this list;
// UI and combat both read it here rather than keeping a second catalog.
export const AREA_PATTERN_ORDER: ReadonlyArray<AreaPatternId> = [
  'AREA_SELF',
  'AREA_CARDINAL_1',
  'AREA_SQUARE_3X3',
  'AREA_SQUARE_3X3_CARDINAL_2',
  'AREA_FAT_CROSS_2',
  'AREA_SQUARE_5X5',
  'AREA_FAT_CROSS_3',
  'AREA_SQUARE_7X7_CROSS_4',
];

export function isAreaPatternId(s: string): s is AreaPatternId {
  return Object.prototype.hasOwnProperty.call(AREA_PATTERNS, s);
}

// §22.1 — advance `steps` named steps, SATURATING at the largest registered
// pattern. Edge clipping never changes the step: this operates on names, not on
// how many cells survive the board bounds. `steps` <= 0 returns the input.
export function advanceAreaPattern(id: AreaPatternId, steps: number): AreaPatternId {
  if (steps <= 0) return id;
  const i = AREA_PATTERN_ORDER.indexOf(id);
  if (i < 0) return id;
  return AREA_PATTERN_ORDER[Math.min(i + steps, AREA_PATTERN_ORDER.length - 1)];
}
