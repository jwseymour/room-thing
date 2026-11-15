import Link from "next/link";
import { ScanUpload } from "@/components/scan/ScanUpload";
import { requireSession } from "@/lib/auth";
import { currentScan } from "@/lib/scan/store";

// Waits for live data instead of showing a placeholder. See app/(app)/page.tsx.
export const instant = false;

export default async function ScanPage() {
  await requireSession();
  const scan = currentScan();

  return (
    <div className="mx-auto max-w-2xl">
      {scan && (
        <Link href="/room" className="text-sm text-muted">
          ← Room
        </Link>
      )}
      <h1 className="text-3xl">Scan your room</h1>
      <p className="mt-1 mb-5 text-muted">
        Walk round the room with your phone, and the app builds the room from
        the result: the walls and their sizes, the furniture, and how much
        clear wall there is.
      </p>

      <ol className="mb-6 space-y-3">
        {[
          [
            "Get Scaniverse",
            "The original app, sometimes listed as Scaniverse Classic, is free for personal use and makes the scan on the phone itself. Choose Splat when it asks what to capture.",
          ],
          [
            "Set the room up",
            "Daylight with the main light on. Open the curtains halfway, clear the floor, and close the door. Nothing should move while you scan.",
          ],
          [
            "Scan for three or four minutes",
            "Move slowly and keep the phone about a metre from what it's looking at. Go round the room once at chest height facing the walls, once lower, and once pointing up at where the walls meet the ceiling. Finish where you started, and include every corner.",
          ],
          [
            "Send it here",
            "When it has finished processing, tap Share, then Export, and pick PLY. Save it to Files, then add it below. From the phone, the upload goes straight to the laptop.",
          ],
        ].map(([title, detail], index) => (
          <li key={title} className="flex gap-3 rounded-lg border border-line bg-card p-3">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-sm text-muted"
            >
              {index + 1}
            </span>
            <span>
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted">{detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <ScanUpload hasScan={Boolean(scan)} />

      <p className="mt-6 text-sm text-muted">
        Any app that exports a Gaussian splat works: Polycam, Luma, KIRI Engine
        and others. A .ply file is measured automatically: walls, furniture
        and clear wall space. Other formats, such as .spz, can be shown and
        lined up by hand, but the furniture isn&apos;t found in them. A better
        scan later replaces this one, and your things stay where you put them.
      </p>
    </div>
  );
}
