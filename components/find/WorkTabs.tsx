"use client";

import { createContext, useContext, useState } from "react";

type WorkState = {
  /** A line waiting to be set over a still. */
  caption: string;
  setCaption: (line: string) => void;
  /** Whether there are stills to put a line on. */
  hasStills: boolean;
  putOnStill: (line: string) => void;
};

const WorkContext = createContext<WorkState | null>(null);

/** Null anywhere but a film or book's page. */
export const useWork = () => useContext(WorkContext);

export type WorkTab = { id: string; label: string; count?: number; panel: React.ReactNode };

/**
 * The parts of a film or book's page, one showing at a time. The others stay
 * loaded underneath, so switching loses nothing: not a filter, not a reply
 * from Claude that took two minutes.
 */
export function WorkTabs({ tabs, initial, stillsTab }: { tabs: WorkTab[]; initial: string; stillsTab: string | null }) {
  const [current, setCurrent] = useState(tabs.some((t) => t.id === initial) ? initial : tabs[0].id);
  const [caption, setCaption] = useState("");

  const show = (id: string) => {
    setCurrent(id);
    // So a reload, or the back button from Prints, returns to the same part.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  };

  return (
    <WorkContext
      value={{
        caption,
        setCaption,
        hasStills: stillsTab !== null,
        putOnStill: (line) => {
          if (!stillsTab) return;
          setCaption(line);
          show(stillsTab);
          window.scrollTo({ top: 0 });
        },
      }}
    >
      <div role="tablist" className="sticky top-0 z-10 -mx-4 mb-4 flex overflow-x-auto border-b border-line bg-paper px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={current === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => show(tab.id)}
            className={`flex min-h-12 shrink-0 items-center gap-1.5 px-3 text-[0.7rem] tracking-[0.18em] uppercase ${
              current === tab.id ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--ink)]" : "text-muted"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tracking-normal text-muted">{tab.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={current !== tab.id}>
          {tab.panel}
        </div>
      ))}
    </WorkContext>
  );
}
