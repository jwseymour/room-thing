"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CONCURRENT_UPLOADS = 3;

type Progress = { done: number; total: number; failed: string[]; duplicates: number };

export function Uploader() {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const uploading = progress !== null && progress.done < progress.total;

  async function upload(files: File[]) {
    setProgress({ done: 0, total: files.length, failed: [], duplicates: 0 });
    const queue = [...files];

    async function worker() {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const name = file.name;
        let duplicate = false;
        let ok = false;
        try {
          const form = new FormData();
          form.set("file", file);
          const response = await fetch("/api/upload", { method: "POST", body: form });
          ok = response.ok;
          if (ok) duplicate = (await response.json()).duplicate;
        } catch {
          ok = false;
        }
        setProgress((p) =>
          p && {
            ...p,
            done: p.done + 1,
            duplicates: p.duplicates + (duplicate ? 1 : 0),
            failed: ok ? p.failed : [...p.failed, name],
          },
        );
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_UPLOADS }, worker));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {progress && (
        <p role="status" className="text-sm text-muted">
          {uploading
            ? `Adding ${progress.done} of ${progress.total}`
            : `Added ${progress.total - progress.failed.length - progress.duplicates}`}
          {!uploading && progress.duplicates > 0 && `, ${progress.duplicates} already here`}
          {progress.failed.length > 0 && (
            <span className="text-danger">, {progress.failed.length} failed</span>
          )}
        </p>
      )}
      <label className={`btn btn-primary ${uploading ? "opacity-50" : ""}`}>
        Add photos
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploading}
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) void upload(files);
          }}
        />
      </label>
    </div>
  );
}
