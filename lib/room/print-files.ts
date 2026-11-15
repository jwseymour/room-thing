import sharp from "sharp";
import { variantPath } from "../content/media";
import { layoutQuote } from "../content/quote-layout";
import {
  coverCrop,
  printDimensions,
  TARGET_PPI,
  type Orientation,
} from "./print";
import type { PlacementWithContent } from "./store";

const pxFor = (mm: number) => Math.round((mm / 25.4) * TARGET_PPI);

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function quoteSvg(body: string, attribution: string | null, w: number, h: number) {
  const layout = layoutQuote(body, attribution, w, h);
  const lines = layout.lines
    .map(
      (line, i) =>
        `<text x="${w / 2}" y="${layout.firstBaselineMm + i * layout.lineHeightMm}" font-size="${layout.fontSizeMm}" text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("");
  const credit = layout.attribution
    ? `<text x="${w / 2}" y="${layout.attribution.baselineMm}" font-size="${layout.attribution.fontSizeMm}" text-anchor="middle" fill="#5c564d">${escapeXml(layout.attribution.text)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxFor(w)}" height="${pxFor(h)}" viewBox="0 0 ${w} ${h}" font-family="Georgia, serif" fill="#211e1a"><rect width="${w}" height="${h}" fill="#fffdf9"/>${lines}${credit}</svg>`;
}

/** A JPEG at the print's true proportions, up to 300 ppi and never enlarged. */
export async function renderPrintFile(item: {
  printSizeId: string;
  orientation: Orientation;
  content: PlacementWithContent["content"];
}): Promise<Buffer> {
  const print = printDimensions(item.printSizeId, item.orientation);
  const { content } = item;

  if (content.kind !== "photo") {
    const svg = quoteSvg(content.body ?? "", content.attribution, print.w, print.h);
    return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
  }

  if (!content.widthPx || !content.heightPx) {
    throw new Error(`Photo ${content.id} has no recorded size.`);
  }
  const crop = coverCrop(content.widthPx, content.heightPx, print);
  // One pipeline, so the photo is only compressed once, on the way out. Sharp
  // orients before it extracts, so the crop applies to the upright image.
  return sharp(variantPath(content.id, "original"))
    .autoOrient()
    .extract(crop)
    .resize({
      width: Math.min(crop.width, pxFor(print.w)),
      height: Math.min(crop.height, pxFor(print.h)),
      fit: "fill",
    })
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

/** A folder per size, numbered within it, so each folder is one line of a print order. */
export function printFileNames(items: { printSizeId: string }[]): string[] {
  const seen = new Map<string, number>();
  return items.map(({ printSizeId }) => {
    const n = (seen.get(printSizeId) ?? 0) + 1;
    seen.set(printSizeId, n);
    return `${printSizeId}/${printSizeId}-${String(n).padStart(2, "0")}.jpg`;
  });
}
