export type Orientation = "landscape" | "portrait";

export type PrintSize = {
  id: string;
  label: string;
  /** Long edge, then short edge, in millimetres. */
  longMm: number;
  shortMm: number;
};

export const PRINT_SIZES: PrintSize[] = [
  { id: "6x4", label: "6×4 in", longMm: 152, shortMm: 102 },
  { id: "postcard", label: "Postcard (A6)", longMm: 148, shortMm: 105 },
  { id: "7x5", label: "7×5 in", longMm: 178, shortMm: 127 },
  { id: "a5", label: "A5", longMm: 210, shortMm: 148 },
  { id: "square", label: "Square 20 cm", longMm: 200, shortMm: 200 },
  { id: "a4", label: "A4", longMm: 297, shortMm: 210 },
  { id: "a3", label: "A3", longMm: 420, shortMm: 297 },
  { id: "a2", label: "A2", longMm: 594, shortMm: 420 },
];

export function printSize(id: string): PrintSize {
  const size = PRINT_SIZES.find((s) => s.id === id);
  if (!size) throw new Error(`Unknown print size: ${id}`);
  return size;
}

export function printDimensions(
  sizeId: string,
  orientation: Orientation,
): { w: number; h: number } {
  const { longMm, shortMm } = printSize(sizeId);
  return orientation === "landscape"
    ? { w: longMm, h: shortMm }
    : { w: shortMm, h: longMm };
}

/** The print size id given to things, which are already the size they are. */
export const OWN_SIZE = "own";

/** How big something is on the wall, in millimetres. */
export function placementSize(p: {
  printSizeId: string;
  orientation: Orientation;
  widthMm?: number | null;
  heightMm?: number | null;
}): { w: number; h: number } {
  if (p.widthMm && p.heightMm) return { w: p.widthMm, h: p.heightMm };
  return printDimensions(p.printSizeId, p.orientation);
}

/** Paper and frame sizes a thing is likely to be, long edge first. */
export const THING_SIZES: { label: string; longMm: number; shortMm: number }[] = [
  { label: "Postcard", longMm: 148, shortMm: 105 },
  { label: "6×4 photo", longMm: 152, shortMm: 102 },
  { label: "7×5 photo", longMm: 178, shortMm: 127 },
  { label: "A5", longMm: 210, shortMm: 148 },
  { label: "A4", longMm: 297, shortMm: 210 },
  { label: "A3", longMm: 420, shortMm: 297 },
  { label: "A2", longMm: 594, shortMm: 420 },
  { label: "A1", longMm: 841, shortMm: 594 },
  { label: "50×70 cm", longMm: 700, shortMm: 500 },
  { label: "61×91 cm poster", longMm: 915, shortMm: 610 },
];

/**
 * The likeliest real size for something of this shape, as seen in a photo.
 * Shape alone can't tell A5 from A3, so this returns every size that fits
 * the proportions, smallest first.
 */
export function sizesForAspect(aspect: number): { label: string; w: number; h: number }[] {
  const portrait = aspect < 1;
  const long = portrait ? 1 / aspect : aspect;
  return THING_SIZES.filter((s) => Math.abs(s.longMm / s.shortMm / long - 1) < 0.035).map((s) => ({
    label: s.label,
    w: portrait ? s.shortMm : s.longMm,
    h: portrait ? s.longMm : s.shortMm,
  }));
}

export function orientationFor(widthPx: number, heightPx: number): Orientation {
  return heightPx > widthPx ? "portrait" : "landscape";
}

export const MIN_GOOD_PPI = 150;
export const MIN_USABLE_PPI = 100;
export const TARGET_PPI = 300;

export type PrintQuality = {
  /** Resolution of the printed image once it's cropped to fill the print. */
  ppi: number;
  /** Share of the image cut away by that crop, from 0 to 1. */
  cropped: number;
  rating: "good" | "soft" | "too_small";
};

/** Photos are cropped to fill the print, so the tighter axis sets the resolution. */
export function printQuality(
  widthPx: number,
  heightPx: number,
  print: { w: number; h: number },
): PrintQuality {
  const mmPerPx = Math.max(print.w / widthPx, print.h / heightPx);
  const ppi = 25.4 / mmPerPx;
  const visible = (print.w / mmPerPx) * (print.h / mmPerPx);
  const cropped = Math.max(0, 1 - visible / (widthPx * heightPx));
  const rating =
    ppi >= MIN_GOOD_PPI ? "good" : ppi >= MIN_USABLE_PPI ? "soft" : "too_small";
  return { ppi: Math.round(ppi), cropped, rating };
}

/** The largest crop that fills the print, centred, in source pixels. */
export function coverCrop(
  widthPx: number,
  heightPx: number,
  print: { w: number; h: number },
): { left: number; top: number; width: number; height: number } {
  const aspect = print.w / print.h;
  const width = Math.min(widthPx, Math.round(heightPx * aspect));
  const height = Math.min(heightPx, Math.round(widthPx / aspect));
  return {
    left: Math.floor((widthPx - width) / 2),
    top: Math.floor((heightPx - height) / 2),
    width,
    height,
  };
}
