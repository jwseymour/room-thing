"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { TrayItem } from "@/app/api/find/tray/route";

const TrayContext = createContext<{ items: TrayItem[]; refresh: () => void }>({
  items: [],
  refresh: () => {},
});

export const useTray = () => useContext(TrayContext);

const SHOWN = 6;

/**
 * Everything kept and not yet printed, along the bottom of Find, so you can
 * see the pile grow and go straight to printing it.
 */
export function TrayProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const refresh = useCallback(() => {
    fetch("/api/find/tray")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setItems(data.items))
      .catch(() => {
        // The bar is a convenience. Without it, Prints still has everything.
      });
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <TrayContext value={{ items, refresh }}>
      {children}
      {items.length > 0 && (
        <aside
          aria-label="To print"
          className="fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-10 border-t border-ink bg-paper sm:bottom-0"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
            <p className="shrink-0 text-sm" role="status">
              <span className="font-semibold">{items.length}</span> to print
            </p>
            <ul className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {items.slice(0, SHOWN).map((item) => (
                <li key={item.id} className="size-10 shrink-0 overflow-hidden border border-line bg-card">
                  <Link href={`/library/${item.id}`} title={item.label} className="block size-full">
                    {item.kind === "photo" ? (
                      <img src={`/api/media/${item.id}/thumb`} alt={item.label} className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-lg leading-none" aria-label={item.label}>
                        “
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {items.length > SHOWN && (
                <li className="flex h-10 shrink-0 items-center px-1 text-xs text-muted">+{items.length - SHOWN}</li>
              )}
            </ul>
            <Link href="/print/paper" className="btn btn-primary shrink-0">
              Lay out and print
            </Link>
          </div>
        </aside>
      )}
    </TrayContext>
  );
}
