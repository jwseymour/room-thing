import sharp, { type Sharp } from "sharp";
import { variantPath } from "../content/media";
import type { ContentItem } from "../content/store";
import { A4, coverCrop, TARGET_PPI } from "./print";
import { quoteSvg } from "./print-files";
import { packSheets, sheetRect, type Placed, type SheetMode } from "./sheets";

const PT_PER_MM = 72 / 25.4;
const pxFor = (mm: number) => Math.round((mm / 25.4) * TARGET_PPI);

type Drawn = { jpeg: Buffer; widthPx: number; heightPx: number; grey: boolean };

/** One item as a JPEG, upright, at up to 300 ppi for the size it prints at. */
async function draw(
  item: ContentItem,
  size: { w: number; h: number },
  mode: SheetMode,
): Promise<Drawn> {
  let pipeline: Sharp;
  if (item.kind !== "photo") {
    pipeline = sharp(Buffer.from(quoteSvg(item.body ?? "", item.attribution, size.w, size.h)));
  } else {
    if (!item.widthPx || !item.heightPx) throw new Error(`Photo ${item.id} has no recorded size.`);
    pipeline = sharp(variantPath(item.id, "original"))
      .autoOrient()
      .flatten({ background: "#ffffff" });
    let width = item.widthPx;
    let height = item.heightPx;
    if (mode === "fill") {
      const crop = coverCrop(item.widthPx, item.heightPx, size);
      pipeline = pipeline.extract(crop);
      width = crop.width;
      height = crop.height;
    }
    pipeline = pipeline.resize({
      width: Math.min(width, pxFor(size.w)),
      height: Math.min(height, pxFor(size.h)),
      fit: "fill",
    });
  }
  const { data, info } = await pipeline
    .toColourspace("srgb")
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, widthPx: info.width, heightPx: info.height, grey: info.channels === 1 };
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * A PDF written by hand: each page is A4 with JPEGs set down at exact sizes and
 * a hairline round each to cut along. That's all a print needs, and it saves
 * bringing in a PDF library.
 */
export function buildPdf(
  pages: { drawn: Drawn; at: Placed }[][],
  page: { w: number; h: number } = A4,
): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer[]): number => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : Buffer.concat(body));
    return objects.length;
  };
  // Objects 1 and 2 are the catalogue and the page list, filled in at the end.
  objects.push(Buffer.alloc(0), Buffer.alloc(0));
  const pageW = page.w * PT_PER_MM;
  const pageH = page.h * PT_PER_MM;
  const pageIds: number[] = [];

  for (const items of pages) {
    const names: string[] = [];
    let stream = "0.6 G 0.3 w\n";
    items.forEach(({ drawn, at }, index) => {
      const id = add([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${drawn.widthPx} /Height ${drawn.heightPx} /ColorSpace ${drawn.grey ? "/DeviceGray" : "/DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${drawn.jpeg.length} >>\nstream\n`,
          "latin1",
        ),
        drawn.jpeg,
        Buffer.from("\nendstream", "latin1"),
      ]);
      names.push(`/Im${index} ${id} 0 R`);
      const x = at.x * PT_PER_MM;
      const w = at.w * PT_PER_MM;
      const h = at.h * PT_PER_MM;
      // PDF measures up from the bottom of the page.
      const y = pageH - (at.y + at.h) * PT_PER_MM;
      const matrix = at.rotated
        ? `0 ${num(h)} ${num(-w)} 0 ${num(x + w)} ${num(y)}`
        : `${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)}`;
      stream += `q ${matrix} cm /Im${index} Do Q\n${num(x)} ${num(y)} ${num(w)} ${num(h)} re S\n`;
    });
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Resources << /XObject << ${names.join(" ")} >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }

  objects[0] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1");
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "latin1",
  );

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    parts.push(part);
    length += part.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

/** The chosen items, each at its chosen size, laid out on A4 and drawn. */
export async function renderSheets(
  chosen: { item: ContentItem; sizeId: string }[],
  mode: SheetMode,
): Promise<{ pdf: Buffer; sheets: number }> {
  const byId = new Map(chosen.map((c) => [c.item.id, c]));
  const sheets = packSheets(
    chosen.map(({ item, sizeId }) => ({ id: item.id, ...sheetRect(item, sizeId, mode) })),
  );
  const pages: { drawn: Drawn; at: Placed }[][] = [];
  for (const sheet of sheets) {
    const items: { drawn: Drawn; at: Placed }[] = [];
    for (const at of sheet) {
      const { item } = byId.get(at.id)!;
      // Drawn upright at its own size. The PDF does any turning.
      const upright = at.rotated ? { w: at.h, h: at.w } : { w: at.w, h: at.h };
      items.push({ drawn: await draw(item, upright, mode), at });
    }
    pages.push(items);
  }
  return { pdf: buildPdf(pages), sheets: sheets.length };
}
