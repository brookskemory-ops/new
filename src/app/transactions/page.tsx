import { Suspense } from "react";
import { MonthPicker } from "@/components/MonthPicker";
import { TransactionTable } from "@/components/TransactionTable";
import { TransactionFilters } from "@/components/TransactionFilters";
import { currentMonth, formatCents, formatMonth } from "@/lib/money";
import {
  countTransactions,
  listAccounts,
  listCategories,
  listTransactions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    q?: string;
    category?: string;
    account?: string;
    uncategorized?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : currentMonth();
  const page = Math.max(1, Number(params.page) || 1);

  const filter = {
    month,
    search: params.q || undefined,
    categoryId: params.category ? Number(params.category) : undefined,
    accountId: params.account ? Number(params.account) : undefined,
    uncategorizedOnly: params.uncategorized === "1",
  };

  const transactions = listTransactions({
    ...filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const total = countTransactions(filter);
  const categories = listCategories();
  const accounts = listAccounts();

  const net = transactions.reduce((sum, tx) => sum + tx.amount_cents, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Transactions</h1>
          <p className="text-xs text-muted">
            {total} in {formatMonth(month)} · net{" "}
            <span className="tnum">{formatCents(net)}</span> on this page
          </p>
        </div>
        <Suspense fallback={null}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <TransactionFilters categories={categories} accounts={accounts} />
      </Suspense>

      <TransactionTable transactions={transactions} categories={categories} />

      {pages > 1 && (
        <Pagination page={page} pages={pages} params={params} />
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  params,
}: {
  page: number;
  pages: number;
  params: Record<string, string | undefined>;
}) {
  const link = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "page") query.set(key, value);
    }
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `?${qs}` : "?";
  };

  return (
    <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pages">
      <a
        href={link(page - 1)}
        className={`btn ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        aria-disabled={page <= 1}
      >
        Previous
      </a>
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <a
        href={link(page + 1)}
        className={`btn ${page >= pages ? "pointer-events-none opacity-50" : ""}`}
        aria-disabled={page >= pages}
      >
        Next
      </a>
    </nav>
  );
}
