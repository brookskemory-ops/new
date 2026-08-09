"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { addMonths, currentMonth, formatMonth } from "@/lib/money";

/**
 * Month navigation. The selected month lives in the URL so it survives a
 * refresh and can be linked to.
 */
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next === currentMonth()) query.delete("month");
    else query.set("month", next);
    const qs = query.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  const isCurrent = month === currentMonth();

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => go(addMonths(month, -1))}
        className="btn px-2"
        aria-label="Previous month"
      >
        ‹
      </button>
      <span className="min-w-[9.5rem] text-center text-sm font-medium">
        {formatMonth(month)}
      </span>
      <button
        type="button"
        onClick={() => go(addMonths(month, 1))}
        className="btn px-2"
        aria-label="Next month"
        disabled={isCurrent}
      >
        ›
      </button>
      {!isCurrent && (
        <button type="button" onClick={() => go(currentMonth())} className="btn ml-1">
          Today
        </button>
      )}
    </div>
  );
}
