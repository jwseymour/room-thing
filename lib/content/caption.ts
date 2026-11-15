import sharp from "sharp";

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Breaks a caption into lines no longer than a subtitle would run. */
export function captionLines(caption: string, maxChars = 44): string[] {
  const lines: string[] = [];
  for (const part of caption.split(/\n+/)) {
    let line = "";
    for (const word of part.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Sets a line of text along the bottom of a picture the way a subtitle sits on
 * a film frame: white, with a dark edge so it reads over anything.
 */
export async function captionImage(bytes: Buffer, caption: string): Promise<Buffer> {
  const upright = await sharp(bytes).autoOrient().toBuffer({ resolveWithObject: true });
  const { width, height } = upright.info;
  const lines = captionLines(caption);
  if (lines.length === 0) return upright.data;

  const size = Math.round(width * 0.034);
  const lineHeight = size * 1.3;
  const bottom = height - size * 1.4;
  const text = lines
    .map((line, index) => {
      const y = bottom - (lines.length - 1 - index) * lineHeight;
      return `<text x="${width / 2}" y="${y}">${escapeXml(line)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600" text-anchor="middle" fill="#ffffff" stroke="#000000" stroke-width="${size * 0.16}" stroke-linejoin="round" paint-order="stroke">${text}</svg>`;

  return sharp(upright.data)
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 93, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
