"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteContentAction, setStatusAction } from "@/lib/actions/content";
import type { ContentStatus } from "@/lib/db/schema";

const OPTIONS: { status: ContentStatus; label: string }[] = [
  { status: "keep", label: "Keep" },
  { status: "maybe", label: "Maybe" },
  { status: "no", label: "No" },
  { status: "inbox", label: "To sort" },
];

export function ContentControls({
  id,
  status,
  placed,
}: {
  id: string;
  status: ContentStatus;
  placed: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.status}
            type="button"
            disabled={pending}
            aria-pressed={status === option.status}
            onClick={() =>
              startTransition(() => setStatusAction(id, option.status))
            }
            className={`btn ${status === option.status ? "btn-primary" : ""}`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          className="btn btn-danger ml-auto"
          onClick={() => {
            const warning = placed
              ? `This is on your walls in ${placed} ${placed === 1 ? "place" : "places"}. Delete it from there too?`
              : "Delete this for good?";
            if (!window.confirm(warning)) return;
            startTransition(async () => {
              await deleteContentAction(id);
              router.push("/library");
            });
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
