"use client";

import { useActionState } from "react";
import { addTextAction } from "@/lib/actions/content";

export function TextForm() {
  // React resets the form after the action, so it's ready for the next line.
  const [error, action, pending] = useActionState(addTextAction, null);

  return (
    <details className="rounded-lg border border-line bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
        Add a quote or reminder
      </summary>
      <form action={action} className="space-y-2 p-3 pt-0">
        <textarea
          name="body"
          rows={3}
          required
          aria-label="Text"
          placeholder="A line worth seeing every day"
          className="field"
        />
        <input
          name="attribution"
          aria-label="Who said it"
          placeholder="Who said it (optional)"
          className="field"
        />
        <div className="flex items-center gap-3">
          <select name="kind" aria-label="Type" className="field max-w-32">
            <option value="quote">Quote</option>
            <option value="reminder">Reminder</option>
          </select>
          <button type="submit" disabled={pending} className="btn btn-primary">
            Add
          </button>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </form>
    </details>
  );
}
