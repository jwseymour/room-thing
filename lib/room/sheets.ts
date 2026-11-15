import { A4, orientationFor, PAPER_SIZES, printDimensions } from "./print";

/**
 * Laying prints out on sheets of A4, to print on paper and cut out. This file
 * is the arithmetic only, so the page can show how many sheets a selection
 * takes before anything is drawn. `sheet-pdf.ts` draws them.
 */

/** Whether a picture is shown whole at its own shape, or cropped to fill the size. */
export type SheetMode = "whole" | "fill";

export type Rect = { id: string; w: number; h: number };
export type Placed = Rect & {
  x: number;
  /** From the top of the sheet. */
  y: number;
  /** Turned a quarter turn to fit. `w` and `h` are as it sits on the sheet. */
  rotated: boolean;
};

export const isPaperSize = (id: string) => PAPER_SIZES.some((s) => s.id === id);

/**
 * How big an item comes out on paper, in millimetres. A quote fills its size.
 * A picture shown whole keeps its own shape and fits inside the size.
 */
export function sheetRect(
  item: { kind: string; widthPx: number | null; heightPx: number | null },
  sizeId: string,
  mode: SheetMode,
): { w: number; h: number } {
  if (item.kind !== "photo" || !item.widthPx || !item.heightPx) {
    return printDimensions(sizeId, "landscape");
  }
  const box = printDimensions(sizeId, orientationFor(item.widthPx, item.heightPx));
  if (mode === "fill") return box;
  const scale = Math.min(box.w / item.widthPx, box.h / item.heightPx);
  const round = (mm: number) => Math.round(mm * 10) / 10;
  return { w: round(item.widthPx * scale), h: round(item.heightPx * scale) };
}

const EPS = 0.01;

type Shelf = { y: number; h: number; x: number };
type Sheet = { shelves: Shelf[]; items: Placed[] };

/**
 * How to turn the item that starts a new row: `short` lays it on its side,
 * `tall` stands it up, and `fill` picks whichever way lets the row be filled
 * across by the items still to come.
 */
type Prefer = "short" | "tall" | "fill";

/** Rows across the sheet, each as tall as the item that started it. */
function packWith(items: Rect[], prefer: Prefer, page: { w: number; h: number }): Placed[][] {
  const sorted = [...items].sort(
    (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  );
  const sheets: Sheet[] = [];

  for (const [index, item] of sorted.entries()) {
    const left = sorted.length - index;
    const order = <T extends { w: number; h: number }>(list: T[]): T[] => {
      const across = (way: T) =>
        (Math.min(left, Math.floor((page.w + EPS) / way.w)) * way.w) / page.w;
      return [...list].sort((a, b) =>
        prefer === "tall" ? b.h - a.h : prefer === "short" ? a.h - b.h : across(b) - across(a) || a.h - b.h,
      );
    };
    const ways = [
      { w: item.w, h: item.h, rotated: false },
      ...(Math.abs(item.w - item.h) > EPS ? [{ w: item.h, h: item.w, rotated: true }] : []),
    ].filter((way) => way.w <= page.w + EPS && way.h <= page.h + EPS);
    if (ways.length === 0) throw new Error("That doesn't fit on a sheet of A4.");

    // First choice: a gap at the end of a row already started.
    let spot: { sheet: Sheet; shelf: Shelf; way: (typeof ways)[number]; waste: number } | null = null;
    for (const sheet of sheets) {
      for (const shelf of sheet.shelves) {
        for (const way of ways) {
          const waste = shelf.h - way.h;
          if (way.w <= page.w - shelf.x + EPS && waste >= -EPS && (!spot || waste < spot.waste)) {
            spot = { sheet, shelf, way, waste };
          }
        }
      }
      if (spot) break;
    }

    if (!spot) {
      const choices = order(ways);
      for (const sheet of sheets) {
        const last = sheet.shelves[sheet.shelves.length - 1];
        const used = last.y + last.h;
        const way = choices.find((w) => used + w.h <= page.h + EPS);
        if (way) {
          const shelf = { y: used, h: way.h, x: 0 };
          sheet.shelves.push(shelf);
          spot = { sheet, shelf, way, waste: 0 };
          break;
        }
      }
    }

    if (!spot) {
      const way = order(ways)[0];
      const shelf = { y: 0, h: way.h, x: 0 };
      const sheet: Sheet = { shelves: [shelf], items: [] };
      sheets.push(sheet);
      spot = { sheet, shelf, way, waste: 0 };
    }

    spot.sheet.items.push({
      id: item.id,
      x: spot.shelf.x,
      y: spot.shelf.y,
      w: spot.way.w,
      h: spot.way.h,
      rotated: spot.way.rotated,
    });
    spot.shelf.x += spot.way.w;
  }

  return sheets.map((sheet) => centred(sheet.items, page));
}

/** Moves a sheet's contents to the middle, so the printer's blank edge is shared round. */
function centred(items: Placed[], page: { w: number; h: number }): Placed[] {
  const right = Math.max(...items.map((i) => i.x + i.w));
  const bottom = Math.max(...items.map((i) => i.y + i.h));
  const dx = (page.w - right) / 2;
  const dy = (page.h - bottom) / 2;
  return items.map((i) => ({ ...i, x: i.x + dx, y: i.y + dy }));
}

/**
 * Fits the items onto as few sheets as it can find, turning them where that
 * helps. Items sit edge to edge so one cut separates two, and the sheet is used
 * right to its edge: two A5s or four postcards fill a sheet of A4 exactly.
 */
export function packSheets(items: Rect[], page: { w: number; h: number } = A4): Placed[][] {
  if (items.length === 0) return [];
  // Three ways of turning things, and whichever takes the fewest sheets wins.
  return (["fill", "short", "tall"] as const)
    .map((prefer) => packWith(items, prefer, page))
    .reduce((best, next) => (next.length < best.length ? next : best));
}
