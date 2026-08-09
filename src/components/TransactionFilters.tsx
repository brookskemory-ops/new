"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Account, Category } from "@/lib/types";

export function TransactionFilters({
  categories,
  accounts,
}: {
  categories: Category[];
  accounts: Account[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
    query.delete("page"); // a changed filter invalidates the page number
    const qs = query.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  // Debounce so typing doesn't fire a navigation per keystroke.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => apply({ q: search || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const uncategorized = params.get("uncategorized") === "1";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className="field max-w-xs flex-1"
        placeholder="Search merchant, description, notes…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search transactions"
      />

      <select
        className="field w-auto"
        value={params.get("category") ?? ""}
        onChange={(event) => apply({ category: event.target.value || null })}
        aria-label="Filter by category"
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <select
        className="field w-auto"
        value={params.get("account") ?? ""}
        onChange={(event) => apply({ account: event.target.value || null })}
        aria-label="Filter by account"
      >
        <option value="">All accounts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => apply({ uncategorized: uncategorized ? null : "1" })}
        aria-pressed={uncategorized}
        className={`btn ${uncategorized ? "btn-primary" : ""}`}
      >
        Needs a category
      </button>
    </div>
  );
}
