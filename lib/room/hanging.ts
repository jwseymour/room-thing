import { printDimensions, printSize, type Orientation } from "./print";
import { MOUNT_LABELS, type Mount } from "./schema";

export type HangItem = {
  id: string;
  printSizeId: string;
  orientation: Orientation;
  u: number;
  v: number;
  mount: Mount;
};

export type HangStep<T extends HangItem> = {
  item: T;
  /** 1-based, matching the numbers on the wall diagram. */
  number: number;
  w: number;
  h: number;
  /** Left edge of the print, from the left edge of the surface. */
  fromLeftMm: number;
  /** Top edge of the print, from the floor. This is the line to mark in pencil. */
  topFromFloorMm: number;
  bottomFromFloorMm: number;
};

/** Items within this much of each other horizontally count as one column. */
const COLUMN_TOLERANCE_MM = 20;

/**
 * Left to right, and top to bottom within a column, so each item is measured
 * from the wall's edge or checked against a neighbour that's already up.
 */
export function hangingSteps<T extends HangItem>(items: T[]): HangStep<T>[] {
  const sized = items.map((item) => ({
    item,
    ...printDimensions(item.printSizeId, item.orientation),
  }));
  sized.sort((a, b) =>
    Math.abs(a.item.u - b.item.u) > COLUMN_TOLERANCE_MM
      ? a.item.u - b.item.u
      : b.item.v + b.h - (a.item.v + a.h),
  );
  return sized.map(({ item, w, h }, index) => ({
    item,
    number: index + 1,
    w,
    h,
    fromLeftMm: item.u,
    topFromFloorMm: item.v + h,
    bottomFromFloorMm: item.v,
  }));
}

export type Supply = { label: string; quantity: number; note?: string };

/**
 * What to have in hand before starting. Quantities are for paper prints: four
 * fixings each, with a couple more for anything larger than A3.
 */
export function supplies(items: HangItem[]): Supply[] {
  const count = (mount: Mount) => items.filter((i) => i.mount === mount);
  const fixings = (list: HangItem[]) =>
    list.reduce(
      (sum, i) => sum + (printSize(i.printSizeId).longMm > 420 ? 6 : 4),
      0,
    );
  const list: Supply[] = [];

  const pinned = count("pin");
  if (pinned.length) {
    list.push({ label: MOUNT_LABELS.pin, quantity: fixings(pinned) });
  }
  const stuck = count("removable_strip");
  if (stuck.length) {
    list.push({
      label: MOUNT_LABELS.removable_strip,
      quantity: fixings(stuck),
      note: "Small size. Check the pack says it suits your wall's paint.",
    });
  }
  const hooked = count("removable_hook");
  if (hooked.length) {
    list.push({ label: MOUNT_LABELS.removable_hook, quantity: hooked.length });
  }
  const clipped = count("string_and_clips");
  if (clipped.length) {
    list.push({
      label: "Clips",
      quantity: clipped.length,
      note: "Plus string, and two pins for each row.",
    });
  }
  return list;
}
