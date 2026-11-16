"use client";

import { useRouter } from "next/navigation";

/** For when nothing comes to mind: one of the starting points, picked for you. */
export function RandomPoint({ hrefs }: { hrefs: string[] }) {
  const router = useRouter();
  if (hrefs.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => router.push(hrefs[Math.floor(Math.random() * hrefs.length)])}
      className="btn btn-quiet"
    >
      Surprise me
    </button>
  );
}
