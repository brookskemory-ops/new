"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/accounts", label: "Accounts" },
  { href: "/insights", label: "Insights" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    // min-w-0 is load-bearing: a flex item defaults to min-width:auto, which
    // refuses to shrink below its content, so without it the nav pushes the
    // header wider than the screen and the whole page scrolls sideways on a
    // phone instead of the nav scrolling on its own.
    <nav className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-accent-soft font-medium text-accent"
                : "text-muted hover:bg-surface-2 hover:text-text"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
