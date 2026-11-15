"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ScanUpload({ hasScan }: { hasScan: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  function upload(file: File) {
    setError(null);
    setProgress(0);
    // XMLHttpRequest, because fetch can't report upload progress.
    const request = new XMLHttpRequest();
    request.open("PUT", "/api/scan");
    request.setRequestHeader("x-filename", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === 200) {
        router.push("/room/align");
        return;
      }
      setProgress(null);
      try {
        setError(JSON.parse(request.responseText).error);
      } catch {
        setError("The upload didn't work. Try again.");
      }
    };
    request.onerror = () => {
      setProgress(null);
      setError("The upload didn't finish. Is the laptop still on?");
    };
    request.send(file);
  }

  async function useSample() {
    setError(null);
    setProgress(1);
    const response = await fetch("/api/scan/sample", { method: "POST" });
    if (response.ok) router.push("/room/align");
    else {
      setProgress(null);
      setError("Couldn't make the sample room.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`btn btn-primary ${busy ? "opacity-50" : ""}`}>
          {hasScan ? "Add a new scan" : "Add your scan"}
          <input
            type="file"
            // iOS greys out files it doesn't know the type of, so no `accept`.
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={useSample}>
          Try a sample room
        </button>
      </div>
      {busy && (
        <p role="status" className="mt-2 text-sm text-muted">
          {progress < 1 ? `Sending, ${Math.round(progress * 100)}%` : "Nearly there"}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
