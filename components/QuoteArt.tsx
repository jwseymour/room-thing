import { layoutQuote } from "@/lib/content/quote-layout";

/** A quote drawn in millimetres, using the same layout as the print file. */
export function QuoteArt({
  body,
  attribution,
  w,
  h,
}: {
  body: string;
  attribution: string | null;
  w: number;
  h: number;
}) {
  const layout = layoutQuote(body, attribution, w, h);
  return (
    <g fontFamily="Georgia, serif">
      <rect width={w} height={h} fill="#fffdf9" />
      {layout.lines.map((line, index) => (
        <text
          key={index}
          x={w / 2}
          y={layout.firstBaselineMm + index * layout.lineHeightMm}
          fontSize={layout.fontSizeMm}
          textAnchor="middle"
          fill="#211e1a"
        >
          {line}
        </text>
      ))}
      {layout.attribution && (
        <text
          x={w / 2}
          y={layout.attribution.baselineMm}
          fontSize={layout.attribution.fontSizeMm}
          textAnchor="middle"
          fill="#5c564d"
        >
          {layout.attribution.text}
        </text>
      )}
    </g>
  );
}
