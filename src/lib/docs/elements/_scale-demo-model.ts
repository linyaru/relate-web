// The model behind `:::scale-demo`, shared by its build side
// (src/lib/docs/elements/scale-demo.ts), its browser module
// (src/scripts/docs/elements/scale-demo.ts) and the unit tests
// (src/lib/docs/scale-demo.test.ts); free of Node and DOM imports. It holds
// the sizes a directive may offer and which one the reader is offered first.

/** The sizes the reader picks from, when the directive names none. */
export const DEFAULT_SIZES = [1000, 10000, 100000];
/** The largest size a directive may offer. */
export const MAX_SIZE = 200000;
/** The narrowest column, in CSS pixels, offered the largest size first; a narrower one (a phone) is offered the middle size. */
export const WIDE_PX = 720;

/** The sizes a directive offers (`sizes="1000,10000"`), in its order; null when it is not a list of whole numbers. */
export function sizesOf(attr: string | undefined): number[] | null {
  if (attr === undefined) return DEFAULT_SIZES;
  const list = attr.split(',').map((s) => s.trim());
  if (!list.length || list.some((s) => !/^[1-9]\d*$/.test(s))) return null;
  return list.map(Number);
}

/** The size offered first: the largest on a wide screen, the middle one (rounded down) on a narrow one. */
export const firstSize = (sizes: readonly number[], wide: boolean) => (wide ? sizes.at(-1)! : sizes[Math.floor((sizes.length - 1) / 2)]);
