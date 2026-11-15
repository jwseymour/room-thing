"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Adds photos of things you own. One photo goes straight to its page, to crop and size it. */
export function ThingUploader({ label = "Add photos of things" }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; total: number; failed: number } | null>(null);
  const busy = state !== null && state.done < state.total;

  async function upload(files: File[]) {
    setState({ done: 0, total: files.length, failed: 0 });
    const ids: string[] = [];
    for (const file of files) {
      let ok = false;
      try {
        const form = new FormData();
        form.set("file", file);
        const response = await fetch("/api/upload/thing", { method: "POST", body: form });
        ok = response.ok;
        if (ok) ids.push((await response.json()).id);
      } catch {
        ok = false;
      }
      setState((s) => s && { ...s, done: s.done + 1, failed: s.failed + (ok ? 0 : 1) });
    }
    if (files.length === 1 && ids.length === 1) router.push(`/things/${ids[0]}`);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className={`btn btn-primary ${busy ? "opacity-50" : ""}`}>
        {label}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) void upload(files);
          }}
        />
      </label>
      {state && (
        <p role="status" className="text-sm text-muted">
          {busy ? `Adding ${state.done + 1} of ${state.total}` : `Added ${state.total - state.failed}`}
          {state.failed > 0 && <span className="text-danger">, {state.failed} couldn&apos;t be read</span>}
        </p>
      )}
    </div>
  );
}
