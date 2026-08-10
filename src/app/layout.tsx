import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Personal finance tracking that runs on your own machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <Link href="/" className="flex items-center gap-2 font-semibold">
                <span
                  aria-hidden
                  className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-semibold text-white shadow-sm"
                >
                  L
                </span>
                Ledger
              </Link>
              <NavLinks />
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

          <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-faint">
            Your data lives in <code className="font-mono">data/ledger.db</code> on
            this machine. Nothing is uploaded unless you link a bank or run an AI
            analysis.
          </footer>
        </div>
      </body>
    </html>
  );
}
