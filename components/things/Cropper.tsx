"use client";

import { useRef, useState } from "react";
import { rectify, straightSize, type Corner } from "@/lib/content/rectify";

const START: Corner[] = [
  { x: 0.12, y: 0.12 },
  { x: 0.88, y: 0.12 },
  { x: 0.88, y: 0.88 },
  { x: 0.12, y: 0.88 },
];
const NAMES = ["Top left", "Top right", "Bottom right", "Bottom left"];
/** The photo is worked on at this size at most: plenty for a wall plan, and quick on a phone. */
const WORK_PX = 2200;

/**
 * Marks the four corners of a thing in its photo, then cuts it out
 * straightened, as if photographed square-on.
 */
export function Cropper({
  src,
  onDone,
  onCancel,
}: {
  src: string;
  onDone: (blob: Blob) => Promise<void>;
  onCancel: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [corners, setCorners] = useState(START);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function move(index: number, clientX: number, clientY: number) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    setCorners((all) => all.map((c, i) => (i === index ? { x, y } : c)));
  }

  async function cut() {
    const image = imageRef.current;
    if (!image?.naturalWidth) return;
    setBusy(true);
    setError(null);
    try {
      const scale = Math.min(1, WORK_PX / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.round(image.naturalWidth * scale);
      const height = Math.round(image.naturalHeight * scale);
      const work = document.createElement("canvas");
      work.width = width;
      work.height = height;
      const context = work.getContext("2d", { willReadFrequently: true })!;
      context.drawImage(image, 0, 0, width, height);
      const quad = corners.map((c) => ({ x: c.x * width, y: c.y * height }));
      const size = straightSize(quad);
      const pixels = rectify(context.getImageData(0, 0, width, height), quad, size);
      const out = document.createElement("canvas");
      out.width = size.width;
      out.height = size.height;
      out.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, size.width, size.height), 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("no image");
      await onDone(blob);
    } catch {
      setError("That didn't work. Try again.");
      setBusy(false);
    }
  }

  const points = corners.map((c) => `${c.x * 100},${c.y * 100}`).join(" ");
  return (
    <div>
      <p className="mb-2 text-sm text-muted">
        Drag each corner marker onto a corner of the thing itself. It doesn&apos;t
        matter if the photo was taken at an angle.
      </p>
      <div ref={boxRef} className="relative touch-none select-none border border-ink">
        <img ref={imageRef} src={src} alt="The photo, to mark the corners on" className="block w-full" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          <polygon
            points={points}
            fill="rgb(61 111 217 / 0.18)"
            stroke="#3d6fd9"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {corners.map((c, i) => (
          <button
            key={NAMES[i]}
            type="button"
            aria-label={`${NAMES[i]} corner`}
            className="absolute size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(i);
            }}
            onPointerMove={(event) => {
              if (dragging === i) move(i, event.clientX, event.clientY);
            }}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.02 : 0.004;
              const by: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
              };
              const d = by[event.key];
              if (!d) return;
              event.preventDefault();
              setCorners((all) =>
                all.map((p, k) =>
                  k === i
                    ? { x: Math.min(1, Math.max(0, p.x + d[0])), y: Math.min(1, Math.max(0, p.y + d[1])) }
                    : p,
                ),
              );
            }}
          >
            <span
              aria-hidden
              className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 border-2 border-[#3d6fd9] bg-white"
            />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={cut}>
          {busy ? "Cutting it out" : "Cut it out"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
