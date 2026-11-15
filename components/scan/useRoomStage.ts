"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomStage, StageEvents } from "@/lib/scan/stage";

export type StageStatus =
  | { state: "loading"; progress: number }
  | { state: "ready"; splats: number }
  | { state: "error"; message: string };

/**
 * Mounts the 3D room in a container. The 3D code is loaded only in the
 * browser, and only on screens that show the scan.
 */
export function useRoomStage(
  scan: { id: string; fileType: string },
  events: StageEvents,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<RoomStage | null>(null);
  const [status, setStatus] = useState<StageStatus>({ state: "loading", progress: 0 });
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

    import("@/lib/scan/stage").then(
      ({ RoomStage }) => {
        if (cancelled) return;
        try {
          created = new RoomStage(
            container,
            { url: `/api/scan/${scan.id}/file`, fileType: scan.fileType },
            {
              onProgress: (progress) =>
                setStatus((s) => (s.state === "loading" ? { state: "loading", progress } : s)),
              onReady: (splats) => setStatus({ state: "ready", splats }),
              onError: (message) => setStatus({ state: "error", message }),
              onTap: (pick) => latest.current.onTap?.(pick),
              onPictureDrag: (id, u, v) => latest.current.onPictureDrag?.(id, u, v),
              onPictureDrop: (id) => latest.current.onPictureDrop?.(id),
            },
          );
          setStage(created);
        } catch {
          setStatus({
            state: "error",
            message: "This browser couldn't start 3D graphics. Try Safari or Chrome.",
          });
        }
      },
      () => setStatus({ state: "error", message: "The 3D viewer didn't load." }),
    );

    return () => {
      cancelled = true;
      created?.dispose();
      setStage(null);
    };
  }, [scan.id, scan.fileType]);

  return { containerRef, stage, status };
}

export function statusText(status: StageStatus): string | null {
  if (status.state === "error") return status.message;
  if (status.state === "loading") {
    return status.progress > 0 && status.progress < 1
      ? `Loading the scan, ${Math.round(status.progress * 100)}%`
      : "Loading the scan";
  }
  return null;
}
