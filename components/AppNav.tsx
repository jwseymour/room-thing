"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/room", label: "Room" },
  { href: "/things", label: "Things" },
  { href: "/hang", label: "Hang" },
  { href: "/find", label: "Find" },
  { href: "/library", label: "Prints" },
];

/** Sorting and ordering prints both belong to the print library. */
const UNDER_PRINTS = ["/library", "/sort", "/print"];

export function AppNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/library"
      ? UNDER_PRINTS.some((p) => pathname.startsWith(p))
      : pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-ink bg-paper pb-[env(safe-area-inset-bottom)] sm:static sm:border-t-0 sm:border-b sm:border-line"
    >
      <ul className="mx-auto flex max-w-6xl sm:gap-2 sm:px-4">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex-1 sm:flex-none">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center justify-center px-3 text-[0.7rem] tracking-[0.18em] uppercase ${
                  active
                    ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--ink)] max-sm:shadow-[inset_0_2px_0_var(--ink)]"
                    : "text-muted"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
