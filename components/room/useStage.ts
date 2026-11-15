"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomStage, StageEvents } from "@/lib/room3d/stage";

/**
 * Mounts the 3D room in a container. The 3D code is loaded only in the
 * browser, and only on the screen that shows the room.
 */
export function useStage(events: StageEvents) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<RoomStage | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The stage keeps one set of callbacks for its lifetime, so route them
  // through a ref to always reach the latest render's handlers.
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let created: RoomStage | null = null;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    import("@/lib/room3d/stage").then(
      ({ RoomStage, PALETTES }) => {
        if (cancelled) return;
        try {
          created = new RoomStage(
            container,
            {
              onTap: (pick) => latest.current.onTap?.(pick),
              onPictureDrag: (id, u, v) => latest.current.onPictureDrag?.(id, u, v),
              onPictureDrop: (id) => latest.current.onPictureDrop?.(id),
              onBlockDrag: (id, x, y) => latest.current.onBlockDrag?.(id, x, y),
              onBlockDrop: (id) => latest.current.onBlockDrop?.(id),
              onScanProgress: (fraction) => latest.current.onScanProgress?.(fraction),
              onScanState: (state) => latest.current.onScanState?.(state),
            },
            PALETTES[dark ? "dark" : "light"],
          );
          setStage(created);
        } catch {
          setFailed("This browser couldn't start 3D graphics. Try Safari or Chrome.");
        }
      },
      () => setFailed("The 3D view didn't load."),
    );

    return () => {
      cancelled = true;
      created?.dispose();
      setStage(null);
    };
  }, []);

  return { containerRef, stage, failed };
}
