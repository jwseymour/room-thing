export type QuoteLayout = {
  lines: string[];
  fontSizeMm: number;
  lineHeightMm: number;
  /** Baseline of the first line, from the top of the print. */
  firstBaselineMm: number;
  attribution: { text: string; fontSizeMm: number; baselineMm: number } | null;
};

/** Average glyph width of a text serif, as a share of its size. */
const CHAR_WIDTH = 0.47;
const LINE_HEIGHT = 1.32;
const MARGIN = 0.12;

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
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
 * Picks the largest type that fits. The wall editor and the print file both use
 * this, so what's on screen matches what gets printed.
 */
export function layoutQuote(
  text: string,
  attribution: string | null,
  widthMm: number,
  heightMm: number,
): QuoteLayout {
  const margin = Math.min(widthMm, heightMm) * MARGIN;
  const innerW = widthMm - margin * 2;
  const innerH = heightMm - margin * 2;

  let fontSizeMm = innerH / 3;
  let lines: string[] = [];
  while (fontSizeMm > 1) {
    const maxChars = Math.max(1, Math.floor(innerW / (fontSizeMm * CHAR_WIDTH)));
    lines = wrap(text, maxChars);
    const attributionH = attribution ? fontSizeMm * 1.6 : 0;
    const longest = Math.max(...lines.map((l) => l.length));
    const fitsWidth = longest * fontSizeMm * CHAR_WIDTH <= innerW;
    const fitsHeight =
      lines.length * fontSizeMm * LINE_HEIGHT + attributionH <= innerH;
    if (fitsWidth && fitsHeight) break;
    fontSizeMm *= 0.94;
  }

  const lineHeightMm = fontSizeMm * LINE_HEIGHT;
  const attributionH = attribution ? fontSizeMm * 1.6 : 0;
  const blockH = lines.length * lineHeightMm + attributionH;
  const top = (heightMm - blockH) / 2;
  const firstBaselineMm = top + fontSizeMm;

  return {
    lines,
    fontSizeMm,
    lineHeightMm,
    firstBaselineMm,
    attribution: attribution
      ? {
          text: attribution,
          fontSizeMm: fontSizeMm * 0.62,
          baselineMm: top + lines.length * lineHeightMm + fontSizeMm * 1.1,
        }
      : null,
  };
}
