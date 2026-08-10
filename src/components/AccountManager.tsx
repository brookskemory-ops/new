"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import type { Account } from "@/lib/types";

interface LinkedBank {
  id: number;
  institution_name: string | null;
  status: string;
  last_synced_at: string | null;
  account_count: number;
}

interface SimpleFinConnection {
  id: number;
  name: string | null;
  status: string;
  last_synced_at: string | null;
  account_count: number;
}

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit: (error: { display_message?: string } | null) => void;
      }): { open(): void };
    };
  }
}

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export function AccountManager({
  accounts,
  banks,
  simplefinConnections,
  plaidConfigured,
  plaidEnvironment,
}: {
  accounts: Account[];
  banks: LinkedBank[];
  simplefinConnections: SimpleFinConnection[];
  plaidConfigured: boolean;
  plaidEnvironment: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  /* ---------------- Plaid Link ---------------- */

  /** The Link script is only fetched when you actually click Link a bank. */
  const loadPlaidScript = useCallback(() => {
    if (window.Plaid) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PLAID_SCRIPT;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Plaid Link."));
      document.head.appendChild(script);
    });
  }, []);

  async function linkBank(reauthItemId?: number) {
    setBusy("link");
    setStatus(null);
    try {
      await loadPlaidScript();

      const tokenUrl = reauthItemId
        ? `/api/plaid/link-token?item=${reauthItemId}`
        : "/api/plaid/link-token";
      const tokenResponse = await fetch(tokenUrl);
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenData.error);

      window.Plaid!.create({
        token: tokenData.link_token,
        onSuccess: async (publicToken) => {
          setBusy("link");
          setStatus({ text: "Pulling your transactions…", error: false });
          try {
            const response = await fetch("/api/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ public_token: publicToken }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            setStatus({
              text: `Linked. Imported ${data.sync.added} transactions across ${data.sync.accounts} accounts.`,
              error: false,
            });
            router.refresh();
          } catch (error) {
            setStatus({ text: describe(error), error: true });
          } finally {
            setBusy(null);
          }
        },
        onExit: (error) => {
          setBusy(null);
          if (error?.display_message) {
            setStatus({ text: error.display_message, error: true });
          }
        },
      }).open();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
      setBusy(null);
    }
  }

  async function sync(itemId?: number) {
    setBusy("sync");
    setStatus({ text: "Syncing…", error: false });
    try {
      const response = await fetch(
        itemId ? `/api/plaid/sync?item=${itemId}` : "/api/plaid/sync",
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const added = data.results.reduce(
        (sum: number, result: { added: number }) => sum + result.added,
        0,
      );
      const reauth = data.results.filter(
        (result: { needsReauth?: boolean }) => result.needsReauth,
      );

      setStatus({
        text: reauth.length
          ? `${reauth.length} bank(s) need you to sign in again.`
          : added > 0
            ? `Added ${added} new transactions.`
            : "Already up to date.",
        error: reauth.length > 0,
      });
      router.refresh();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function unlink(itemId: number, name: string) {
    if (
      !confirm(
        `Unlink ${name}? This deletes its accounts and all transactions imported from it. Manually entered transactions are not affected.`,
      )
    ) {
      return;
    }
    setBusy("unlink");
    try {
      const response = await fetch(`/api/plaid/items/${itemId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus({ text: `Unlinked ${name}.`, error: false });
      router.refresh();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {status && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            status.error
              ? "bg-negative-soft text-negative"
              : "bg-positive-soft text-positive"
          }`}
        >
          {status.text}
        </p>
      )}

      <SimpleFinSection connections={simplefinConnections} />

      {/* ---------------- Linked banks ---------------- */}
      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title">Linked banks</h2>
            <p className="text-xs text-muted">
              Transactions sync automatically through Plaid.
            </p>
          </div>
          {plaidConfigured && (
            <div className="flex gap-2">
              {banks.length > 0 && (
                <button
                  type="button"
                  onClick={() => sync()}
                  className="btn"
                  disabled={busy !== null}
                >
                  {busy === "sync" ? "Syncing…" : "Sync now"}
                </button>
              )}
              <button
                type="button"
                onClick={() => linkBank()}
                className="btn btn-primary"
                disabled={busy !== null}
              >
                Link a bank
              </button>
            </div>
          )}
        </div>

        {!plaidConfigured ? (
          <div className="rounded-lg bg-surface-2 p-3 text-sm text-muted">
            <p className="font-medium text-text">Bank linking is not set up yet.</p>
            <p className="mt-1">
              Add <code className="font-mono">PLAID_CLIENT_ID</code> and{" "}
              <code className="font-mono">PLAID_SECRET</code> to{" "}
              <code className="font-mono">.env</code>, then restart. The README
              walks through getting keys — sandbox keys are free and take about
              five minutes. Until then, use CSV import below.
            </p>
          </div>
        ) : banks.length === 0 ? (
          <p className="text-sm text-muted">
            No banks linked yet. You are in{" "}
            <strong>{plaidEnvironment}</strong> mode
            {plaidEnvironment === "sandbox" && (
              <>
                {" "}
                — use the test credentials <code className="font-mono">
                  user_good
                </code>{" "}
                / <code className="font-mono">pass_good</code>
              </>
            )}
            .
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {banks.map((bank) => {
              const name = bank.institution_name ?? `Bank #${bank.id}`;
              return (
                <li
                  key={bank.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted">
                      {bank.account_count}{" "}
                      {bank.account_count === 1 ? "account" : "accounts"}
                      {bank.last_synced_at
                        ? ` · last synced ${bank.last_synced_at} UTC`
                        : " · never synced"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {bank.status === "needs_reauth" && (
                      <button
                        type="button"
                        onClick={() => linkBank(bank.id)}
                        className="btn btn-primary py-1 text-xs"
                      >
                        Sign in again
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => sync(bank.id)}
                      className="btn py-1 text-xs"
                      disabled={busy !== null}
                    >
                      Sync
                    </button>
                    <button
                      type="button"
                      onClick={() => unlink(bank.id, name)}
                      className="btn py-1 text-xs"
                      disabled={busy !== null}
                    >
                      Unlink
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <AccountList accounts={accounts} />
        <CsvImport accounts={accounts} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * SimpleFIN connections.
 *
 * Unlike Plaid there is nothing to configure ahead of time — no API keys, no
 * .env entry. You link banks on SimpleFIN's site, paste the one-time Setup
 * Token here, and this trades it for stored credentials.
 */
interface SyncAccountDetail {
  name: string;
  added: number;
  total_returned: number;
  is_new: boolean;
}

interface Diagnosis {
  http_status: number;
  window_days: number;
  connections: Array<{ id: string; name: string }>;
  accounts: Array<{
    id: string;
    name: string;
    institution: string | null;
    balance: string | null;
    transactions_returned: number;
    oldest: string | null;
    newest: string | null;
    known_locally: boolean;
  }>;
  missing_locally_known: string[];
  errors: string[];
}

function SimpleFinSection({ connections }: { connections: SimpleFinConnection[] }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [showForm, setShowForm] = useState(connections.length === 0);
  const [accountDetail, setAccountDetail] = useState<SyncAccountDetail[]>([]);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy("claim");
    setStatus({ text: "Claiming the token and pulling your history…", error: false });
    try {
      const response = await fetch("/api/simplefin/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setup_token: token.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setToken("");
      setShowForm(false);
      setStatus({
        text: `Connected. Imported ${data.sync.added} transactions across ${data.sync.accounts} accounts.`,
        error: false,
      });
      router.refresh();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function sync(connectionId?: number, fullHistory = false) {
    setBusy("sync");
    setStatus({
      text: fullHistory ? "Re-pulling a full year…" : "Syncing…",
      error: false,
    });
    try {
      const params = new URLSearchParams();
      if (connectionId) params.set("connection", String(connectionId));
      if (fullHistory) params.set("full", "1");
      const response = await fetch(`/api/simplefin/sync?${params}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const added = data.results.reduce(
        (sum: number, result: { added: number }) => sum + result.added,
        0,
      );
      const warnings = data.results.flatMap(
        (result: { warnings: string[] }) => result.warnings,
      );
      const failures = data.errors ?? [];
      // Per-account detail turns "nothing happened" into something you can act
      // on: which bank returned nothing, and whether it returned nothing at all
      // or returned rows that were already present.
      const perAccount = data.results.flatMap(
        (result: { per_account?: SyncAccountDetail[] }) => result.per_account ?? [],
      ) as SyncAccountDetail[];
      const silent = perAccount.filter((entry) => entry.total_returned === 0);

      const parts: string[] = [];
      parts.push(added > 0 ? `Added ${added} new transactions.` : "No new transactions.");

      const skipped = data.results.reduce(
        (sum: number, r: { skipped_no_date?: number }) => sum + (r.skipped_no_date ?? 0),
        0,
      );
      const repaired = data.results.reduce(
        (sum: number, r: { repaired_bad_dates?: number }) => sum + (r.repaired_bad_dates ?? 0),
        0,
      );
      if (repaired > 0) {
        parts.push(
          `Removed ${repaired} previously-imported ${repaired === 1 ? "row" : "rows"} that had an impossible date and were invisible in every month.`,
        );
      }
      if (skipped > 0) {
        parts.push(
          `${skipped} ${skipped === 1 ? "row" : "rows"} skipped — SimpleFIN sent them without a usable date.`,
        );
      }
      if (silent.length > 0) {
        parts.push(
          `${silent.map((entry) => entry.name).join(", ")} returned nothing — if that looks wrong, check the connection on SimpleFIN's site.`,
        );
      }
      if (warnings.length > 0) parts.push(`SimpleFIN reported: ${warnings.join("; ")}`);

      setAccountDetail(perAccount);
      setStatus({
        text: failures.length
          ? failures.map((f: { message: string }) => f.message).join(" ")
          : parts.join(" "),
        error: failures.length > 0 || warnings.length > 0,
      });
      router.refresh();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function diagnose(connectionId: number) {
    setBusy("diagnose");
    setStatus(null);
    setDiagnosis(null);
    try {
      const response = await fetch(`/api/simplefin/diagnose?connection=${connectionId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setDiagnosis(data.diagnosis);
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(connectionId: number) {
    if (
      !confirm(
        "Disconnect this SimpleFIN connection? Its accounts and the transactions it imported are deleted. Anything you entered by hand or imported from CSV is untouched.\n\nThis does not cancel your SimpleFIN subscription — do that on their site.",
      )
    ) {
      return;
    }
    setBusy("disconnect");
    try {
      const response = await fetch(`/api/simplefin/connections/${connectionId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus({ text: "Disconnected.", error: false });
      router.refresh();
    } catch (error) {
      setStatus({ text: describe(error), error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">SimpleFIN</h2>
          <p className="text-xs text-muted">
            Automatic sync without a developer account. No API keys to set up.
            SimpleFIN caps history at 90 days — use CSV import for anything
            older.
          </p>
        </div>
        <div className="flex gap-2">
          {connections.length > 0 && (
            <button
              type="button"
              onClick={() => sync()}
              className="btn"
              disabled={busy !== null}
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className={connections.length === 0 ? "btn btn-primary" : "btn"}
          >
            {showForm ? "Cancel" : "Connect"}
          </button>
        </div>
      </div>

      {status && (
        <p
          role="status"
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            status.error
              ? "bg-negative-soft text-negative"
              : "bg-positive-soft text-positive"
          }`}
        >
          {status.text}
        </p>
      )}

      {diagnosis && <DiagnosisReport diagnosis={diagnosis} />}

      {accountDetail.length > 0 && (
        <div className="mb-3 rounded-lg bg-surface-2 p-3">
          <div className="mb-1 text-xs font-medium">Last sync, by account</div>
          <ul className="text-xs text-muted">
            {accountDetail.map((entry) => (
              <li key={entry.name} className="flex justify-between gap-3 py-0.5">
                <span className="min-w-0 truncate">{entry.name}</span>
                <span className="tnum shrink-0">
                  {entry.total_returned === 0
                    ? "returned nothing"
                    : `${entry.added} new of ${entry.total_returned} returned`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {connections.length > 0 && (
        <ul className="mb-3 divide-y divide-border text-sm">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <div className="font-medium">
                  {connection.name ?? "SimpleFIN"}
                  {connection.status === "needs_reauth" && (
                    <span className="ml-2 text-xs text-negative">
                      needs reconnecting
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {connection.account_count}{" "}
                  {connection.account_count === 1 ? "account" : "accounts"}
                  {connection.last_synced_at
                    ? ` · last synced ${connection.last_synced_at} UTC`
                    : " · never synced"}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => sync(connection.id)}
                  className="btn py-1 text-xs"
                  disabled={busy !== null}
                >
                  Sync
                </button>
                <button
                  type="button"
                  onClick={() => sync(connection.id, true)}
                  className="btn py-1 text-xs"
                  disabled={busy !== null}
                  title="Ignore the incremental window and re-pull a full year. Use this if a bank looks like it is missing history."
                >
                  Full re-pull
                </button>
                <button
                  type="button"
                  onClick={() => diagnose(connection.id)}
                  className="btn py-1 text-xs"
                  disabled={busy !== null}
                  title="Show exactly what SimpleFIN returns, without changing anything."
                >
                  {busy === "diagnose" ? "Checking…" : "Diagnose"}
                </button>
                <button
                  type="button"
                  onClick={() => disconnect(connection.id)}
                  className="btn py-1 text-xs"
                  disabled={busy !== null}
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <div className="rounded-lg bg-surface-2 p-3">
          <ol className="mb-3 flex list-decimal flex-col gap-1 pl-4 text-sm text-muted">
            <li>
              Go to{" "}
              <a
                href="https://beta-bridge.simplefin.org/"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                SimpleFIN Bridge
              </a>{" "}
              and connect your banks there.
            </li>
            <li>Create a Setup Token for this app.</li>
            <li>Paste it below. It works once, so grab a new one if you retry.</li>
          </ol>

          <form onSubmit={connect} className="flex flex-col gap-2">
            <textarea
              className="field font-mono text-xs"
              rows={3}
              placeholder="Paste the Setup Token (a long block of letters and numbers)"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              aria-label="SimpleFIN Setup Token"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy !== null || token.trim() === ""}
            >
              {busy === "claim" ? "Connecting…" : "Connect"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

const ACCOUNT_TYPES: Array<{ value: string; label: string }> = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "investment", label: "Investment" },
  { value: "loan", label: "Loan" },
  { value: "other", label: "Other" },
];

/**
 * One account, with its type editable in place.
 *
 * The type is a dropdown rather than something buried in an edit screen
 * because a wrong guess from bank sync puts the account on the wrong side of
 * net worth, and that should take one click to correct.
 */
function AccountRow({ account }: { account: Account }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owed = account.type === "credit" || account.type === "loan";

  async function update(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.refresh();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete "${account.name}"? Its transactions are deleted too. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.refresh();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`py-2 ${busy ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={account.name}>
            {account.name}
          </div>
          <div className="text-xs text-muted">
            {account.institution ?? "Manual"}
            {account.mask ? ` ••${account.mask}` : ""}
            {account.is_manual === 0 ? " · synced" : ""}
          </div>
        </div>

        <select
          className="field w-auto py-1 text-xs"
          value={account.type}
          onChange={(event) => update({ type: event.target.value })}
          disabled={busy}
          aria-label={`Account type for ${account.name}`}
        >
          {ACCOUNT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <span
          className={`tnum w-24 shrink-0 text-right font-medium ${
            owed && account.balance_cents !== 0 ? "text-negative" : ""
          }`}
          title={owed ? "Counts against net worth" : "Counts toward net worth"}
        >
          {owed && account.balance_cents !== 0 ? "−" : ""}
          {formatCents(Math.abs(account.balance_cents))}
        </span>

        {account.is_manual === 1 && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs text-faint hover:text-negative"
            aria-label={`Delete ${account.name}`}
          >
            Delete
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-negative">{error}</p>}
    </li>
  );
}

function AccountList({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [balance, setBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, balance: balance || 0 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setName("");
      setBalance("");
      router.refresh();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Your accounts</h2>

      <p className="mb-2 text-xs text-muted">
        Change an account&apos;s type if it was guessed wrong — credit cards and
        loans count against net worth instead of toward it.
      </p>

      <ul className="mb-4 divide-y divide-border text-sm">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </ul>

      <form onSubmit={addAccount} className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted">Add an account you track by hand</p>
        <div className="flex gap-2">
          <input
            className="field flex-1"
            placeholder="Account name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <select
            className="field w-auto"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit card</option>
            <option value="cash">Cash</option>
            <option value="investment">Investment</option>
            <option value="loan">Loan</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            className="field tnum flex-1"
            placeholder="Current balance (owed, for cards and loans)"
            inputMode="decimal"
            value={balance}
            onChange={(event) => setBalance(event.target.value)}
          />
          <button type="submit" className="btn" disabled={busy}>
            Add
          </button>
        </div>
        {error && <p className="text-xs text-negative">{error}</p>}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CsvImport({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(String(accounts[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account_id", accountId);

      const response = await fetch("/api/import", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const parts = [`Imported ${data.imported} transactions`];
      if (data.duplicates > 0) parts.push(`skipped ${data.duplicates} already present`);
      if (data.skipped > 0) parts.push(`${data.skipped} rows unreadable`);
      setResult(`${parts.join(", ")}.`);

      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4">
      <h2 className="section-title">Import a CSV</h2>
      <p className="mt-1 text-xs text-muted">
        Export from your bank&apos;s website and drop the file here. Date, amount,
        and description columns are detected automatically — most US bank and card
        exports work unchanged. Re-importing an overlapping statement is safe;
        duplicates are skipped.
      </p>

      <form onSubmit={upload} className="mt-3 flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="field"
          required
          aria-label="CSV file"
        />
        <div className="flex gap-2">
          <select
            className="field flex-1"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            aria-label="Import into account"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </form>

      {result && <p className="mt-2 text-xs text-positive">{result}</p>}
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
    </section>
  );
}

/**
 * What SimpleFIN actually returned, laid out so the three indistinguishable
 * failure cases become distinguishable: account absent, account present but
 * empty, or account errored.
 */
function DiagnosisReport({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">
          What SimpleFIN returned
        </span>
        <span className="text-xs text-faint">
          HTTP {diagnosis.http_status} · last {diagnosis.window_days} days
        </span>
      </div>

      {diagnosis.errors.length > 0 && (
        <ul className="mb-2 rounded bg-negative-soft px-2 py-1.5 text-xs text-negative">
          {diagnosis.errors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}

      {diagnosis.connections.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          Institutions attached:{" "}
          {diagnosis.connections.map((entry) => entry.name).join(", ")}
        </p>
      )}

      {diagnosis.accounts.length === 0 ? (
        <p className="text-xs text-negative">
          No accounts returned at all. The connection exists but SimpleFIN is
          sending nothing — check it on their site.
        </p>
      ) : (
        <ul className="text-xs">
          {diagnosis.accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-border py-1 first:border-t-0"
            >
              <span className="min-w-0 truncate font-medium">
                {account.name}
                {account.institution && (
                  <span className="ml-1 font-normal text-faint">
                    {account.institution}
                  </span>
                )}
              </span>
              <span
                className={`tnum shrink-0 ${account.transactions_returned === 0 ? "text-negative" : "text-muted"}`}
              >
                {account.transactions_returned === 0
                  ? "0 transactions returned"
                  : `${account.transactions_returned} transactions · ${account.oldest} → ${account.newest}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {diagnosis.missing_locally_known.length > 0 && (
        <p className="mt-2 text-xs text-negative">
          Stored here but not returned this time:{" "}
          {diagnosis.missing_locally_known.join(", ")}
        </p>
      )}

      <p className="mt-2 text-xs text-faint">
        An account showing 0 transactions is SimpleFIN sending none — nothing in
        this app filters them out. That usually means the institution needs
        re-authorising on SimpleFIN&apos;s site, or it has not finished its first
        pull.
      </p>
    </div>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
