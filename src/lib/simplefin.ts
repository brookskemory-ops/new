import { db } from "./db";
import { categorize, looksLikeTransfer } from "./categorize";
import { parseAmountToCents, toDateString } from "./money";
import type { AccountType } from "./types";

/**
 * SimpleFIN bank sync.
 *
 * SimpleFIN is an alternative to Plaid aimed at individuals rather than
 * companies: you link your banks on the SimpleFIN Bridge website, it hands you
 * a one-time Setup Token, and this app trades that token for a long-lived
 * Access URL. There are no API keys and nothing to put in .env — the Access URL
 * is the credential, and it lives in the local database.
 *
 * Two things make this integration simpler than Plaid:
 *
 *  - SimpleFIN signs amounts the way we do (negative = money left the account),
 *    so there is no flip at the boundary.
 *  - Every transaction carries a stable `id` from the bank, so duplicate
 *    detection is exact rather than heuristic.
 *
 * Spec: https://www.simplefin.org/protocol.html
 */

/** SimpleFIN needs no configuration — a connection is claimed at runtime. */
export function hasSimpleFinConnections(): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM simplefin_connections").get() as {
    n: number;
  };
  return row.n > 0;
}

/* ------------------------------------------------------------------ */
/* Access URL handling                                                 */
/* ------------------------------------------------------------------ */

/**
 * An Access URL embeds credentials as `https://user:pass@host/path`.
 *
 * Node's fetch (undici) rejects userinfo in a URL, so the credentials have to
 * be pulled out and sent as a Basic auth header instead. Splitting them here
 * also keeps the password out of anything that later logs the URL.
 */
function splitAccessUrl(accessUrl: string): { base: string; authorization: string } {
  const url = new URL(accessUrl);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  if (!username && !password) {
    throw new SimpleFinError(
      "That Access URL has no credentials in it. Claim a fresh Setup Token from SimpleFIN.",
      "invalid_url",
    );
  }

  url.username = "";
  url.password = "";

  return {
    base: url.toString().replace(/\/$/, ""),
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

export class SimpleFinError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "invalid_token"
      | "invalid_url"
      | "auth"
      | "payment_required"
      | "network"
      | "api",
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Claiming a Setup Token                                              */
/* ------------------------------------------------------------------ */

/**
 * Trade a one-time Setup Token for a durable Access URL.
 *
 * The Setup Token is base64 of a claim URL; POSTing to that URL returns the
 * Access URL as plain text. The token is single-use — claiming it twice fails,
 * which is why the result is stored immediately.
 */
export async function claimSetupToken(setupToken: string): Promise<number> {
  const trimmed = setupToken.trim();
  if (!trimmed) {
    throw new SimpleFinError("Paste the Setup Token from SimpleFIN.", "invalid_token");
  }

  let claimUrl: string;
  try {
    claimUrl = Buffer.from(trimmed, "base64").toString("utf8").trim();
    // A valid token decodes to an https URL. Anything else means the user
    // pasted the Access URL, a truncated token, or unrelated text.
    if (!/^https:\/\/\S+$/.test(claimUrl)) throw new Error("not a url");
  } catch {
    throw new SimpleFinError(
      "That does not look like a SimpleFIN Setup Token. Copy the whole string — it is a long block of letters and numbers, not a URL.",
      "invalid_token",
    );
  }

  let response: Response;
  try {
    response = await fetch(claimUrl, {
      method: "POST",
      headers: { "Content-Length": "0" },
    });
  } catch (error) {
    throw new SimpleFinError(
      `Could not reach SimpleFIN: ${error instanceof Error ? error.message : error}`,
      "network",
    );
  }

  if (response.status === 403) {
    throw new SimpleFinError(
      "SimpleFIN rejected that Setup Token. Tokens can only be claimed once — generate a new one on the SimpleFIN site.",
      "invalid_token",
    );
  }
  if (!response.ok) {
    throw new SimpleFinError(
      `SimpleFIN returned ${response.status} when claiming the token.`,
      "api",
    );
  }

  const accessUrl = (await response.text()).trim();
  if (!accessUrl.startsWith("https://")) {
    throw new SimpleFinError("SimpleFIN did not return a usable Access URL.", "api");
  }

  // Validate before storing so a broken URL fails here rather than at sync time.
  splitAccessUrl(accessUrl);

  const result = db
    .prepare(
      `INSERT INTO simplefin_connections (access_url, name, status)
       VALUES (?, 'SimpleFIN', 'active')
       ON CONFLICT(access_url) DO UPDATE SET status = 'active'`,
    )
    .run(accessUrl);

  const rowId =
    result.changes > 0 && result.lastInsertRowid
      ? Number(result.lastInsertRowid)
      : (
          db
            .prepare("SELECT id FROM simplefin_connections WHERE access_url = ?")
            .get(accessUrl) as { id: number }
        ).id;

  return rowId;
}

/* ------------------------------------------------------------------ */
/* The /accounts response                                              */
/* ------------------------------------------------------------------ */

interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description?: string;
  /** Present in v1 responses; absent in v2. */
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
}

interface SimpleFinAccount {
  id: string;
  name: string;
  currency?: string;
  balance?: string;
  "available-balance"?: string;
  "balance-date"?: number;
  transactions?: SimpleFinTransaction[];
  /** v1 shape: institution details inline. */
  org?: { name?: string; domain?: string; id?: string };
  /** v2 shape: institution referenced by id from the `connections` array. */
  conn_id?: string;
}

interface SimpleFinResponse {
  accounts?: SimpleFinAccount[];
  connections?: Array<{ conn_id: string; name?: string; org_id?: string }>;
  /** v1 calls this `errors`; v2 calls it `errlist`. */
  errors?: Array<string | { msg?: string; code?: string }>;
  errlist?: Array<string | { msg?: string; code?: string }>;
}

/** SimpleFIN reports per-account problems in the body of an otherwise-OK response. */
function collectWarnings(payload: SimpleFinResponse): string[] {
  const raw = [...(payload.errors ?? []), ...(payload.errlist ?? [])];
  return raw.map((entry) =>
    typeof entry === "string" ? entry : (entry.msg ?? entry.code ?? "Unknown error"),
  );
}

/**
 * Guess an account type from its name and balance.
 *
 * SimpleFIN carries no type field, and a credit card treated as an asset shows
 * up on the wrong side of net worth. The hard part is that banks send the
 * *product* name — "Sapphire Preferred", "Quicksilver", "Discover it" — which
 * contains no generic word like "card" at all, so matching on `card|credit`
 * alone misses almost every real credit card.
 *
 * This is still only a guess. The account type is editable on the Accounts
 * page, which is the actual fix when a name is unguessable.
 */
export function guessAccountType(name: string, balanceCents: number): AccountType {
  const text = name.toLowerCase();

  // Loans and mortgages first — "home equity loan" also matches nothing else,
  // and a mortgage must never fall through to a card or a checking account.
  if (/\b(loan|mortgage|heloc|home equity|auto ?finance|lease)\b/.test(text)) {
    return "loan";
  }

  // Generic credit wording, then the card product names US issuers actually
  // send. Without these, a Chase Sapphire arrives looking like a checking
  // account.
  if (/\b(credit|card|visa|mastercard|amex|american express|discover)\b/.test(text)) {
    return "credit";
  }
  if (
    /\b(sapphire|freedom|slate|quicksilver|venture|savor|platinum|gold|blue cash|double ?cash|custom cash|rewards?|cash ?back|miles|points|signature|world elite)\b/.test(
      text,
    )
  ) {
    return "credit";
  }

  if (/\b(invest|brokerage|401\s?k|ira|roth|hsa|529)\b/.test(text)) {
    return "investment";
  }
  if (/\b(savings?|money market|\bcd\b|certificate)\b/.test(text)) return "savings";
  if (/\b(check(ing)?|chequing|debit|spend)\b/.test(text)) return "checking";

  // Nothing in the name is decisive. A negative balance means the institution
  // is reporting something you owe, which is far more likely to be a card than
  // a permanently overdrawn checking account.
  if (balanceCents < 0) return "credit";

  return "checking";
}

export interface SimpleFinSyncResult {
  added: number;
  updated: number;
  accounts: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Syncing                                                             */
/* ------------------------------------------------------------------ */

/** How far back to look the first time. Later syncs only need recent history. */
const FIRST_SYNC_DAYS = 365;
/**
 * Overlap re-fetched on every sync. Banks amend and back-date transactions for
 * a few days after they post; the stable transaction id makes the overlap free.
 */
const OVERLAP_DAYS = 14;

export async function syncConnection(connectionId: number): Promise<SimpleFinSyncResult> {
  const connection = db
    .prepare(
      "SELECT id, access_url, last_synced_at FROM simplefin_connections WHERE id = ?",
    )
    .get(connectionId) as
    | { id: number; access_url: string; last_synced_at: string | null }
    | undefined;

  if (!connection) throw new SimpleFinError(`No SimpleFIN connection ${connectionId}.`, "api");

  const { base, authorization } = splitAccessUrl(connection.access_url);

  const days = connection.last_synced_at ? OVERLAP_DAYS : FIRST_SYNC_DAYS;
  const startDate = Math.floor(Date.now() / 1000) - days * 86400;

  // Pending transactions are deliberately not requested: a pending charge is
  // later replaced by a posted one with a *different* id, which would leave a
  // permanent duplicate behind.
  const url = `${base}/accounts?start-date=${startDate}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: authorization } });
  } catch (error) {
    throw new SimpleFinError(
      `Could not reach SimpleFIN: ${error instanceof Error ? error.message : error}`,
      "network",
    );
  }

  if (response.status === 403) {
    db.prepare("UPDATE simplefin_connections SET status = 'needs_reauth' WHERE id = ?").run(
      connectionId,
    );
    throw new SimpleFinError(
      "SimpleFIN rejected the stored credentials. Claim a new Setup Token to reconnect.",
      "auth",
    );
  }
  if (response.status === 402) {
    throw new SimpleFinError(
      "SimpleFIN says payment is required — check your subscription on their site.",
      "payment_required",
    );
  }
  if (!response.ok) {
    throw new SimpleFinError(`SimpleFIN returned ${response.status}.`, "api");
  }

  let payload: SimpleFinResponse;
  try {
    payload = (await response.json()) as SimpleFinResponse;
  } catch {
    throw new SimpleFinError("SimpleFIN returned a response that was not JSON.", "api");
  }

  const warnings = collectWarnings(payload);
  const accounts = payload.accounts ?? [];
  const connectionNames = new Map(
    (payload.connections ?? []).map((entry) => [entry.conn_id, entry.name]),
  );

  const findAccount = db.prepare(
    "SELECT id FROM accounts WHERE simplefin_account_id = ?",
  );
  const insertAccount = db.prepare(
    `INSERT INTO accounts
       (name, type, institution, balance_cents, currency, is_manual,
        simplefin_connection_id, simplefin_account_id)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const updateAccount = db.prepare(
    `UPDATE accounts SET name = ?, institution = ?, balance_cents = ?, currency = ?
      WHERE id = ?`,
  );

  const findTransaction = db.prepare(
    "SELECT id, category_locked FROM transactions WHERE simplefin_transaction_id = ?",
  );
  const insertTransaction = db.prepare(
    `INSERT INTO transactions
       (account_id, category_id, date, amount_cents, merchant, description,
        pending, is_transfer, source, simplefin_transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'simplefin', ?)`,
  );
  const updateTransaction = db.prepare(
    `UPDATE transactions
        SET date = ?, amount_cents = ?, merchant = ?, description = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
  );

  let added = 0;
  let updated = 0;

  db.transaction(() => {
    for (const account of accounts) {
      const institution =
        account.org?.name ??
        account.org?.domain ??
        (account.conn_id ? connectionNames.get(account.conn_id) : undefined) ??
        "SimpleFIN";

      const balanceCents = parseAmountToCents(account.balance ?? "0") ?? 0;
      const currency =
        account.currency && /^[A-Z]{3}$/.test(account.currency)
          ? account.currency
          : "USD";

      const existing = findAccount.get(account.id) as { id: number } | undefined;
      let accountId: number;

      if (existing) {
        accountId = existing.id;
        updateAccount.run(account.name, institution, balanceCents, currency, accountId);
      } else {
        accountId = Number(
          insertAccount.run(
            account.name,
            guessAccountType(account.name, balanceCents),
            institution,
            balanceCents,
            currency,
            connectionId,
            account.id,
          ).lastInsertRowid,
        );
      }

      for (const transaction of account.transactions ?? []) {
        // SimpleFIN already signs this the way we store it: negative is money
        // leaving the account. No flip, unlike Plaid.
        const amountCents = parseAmountToCents(transaction.amount);
        if (amountCents === null) continue;

        // `posted` is a unix timestamp; store the local calendar date so it
        // matches how a person reads their statement.
        const date = toDateString(new Date(transaction.posted * 1000));

        const description = transaction.description ?? transaction.memo ?? "";
        const merchant = transaction.payee ?? description;

        const known = findTransaction.get(transaction.id) as
          | { id: number; category_locked: number }
          | undefined;

        if (known) {
          // Amend in place — banks revise amounts and descriptions after
          // posting. The category is never touched, so a correction you made
          // by hand survives every future sync.
          updateTransaction.run(date, amountCents, merchant, description, known.id);
          updated++;
          continue;
        }

        const input = { merchant, description, amount_cents: amountCents };
        insertTransaction.run(
          accountId,
          categorize(input),
          date,
          amountCents,
          merchant,
          description,
          looksLikeTransfer(input) ? 1 : 0,
          transaction.id,
        );
        added++;
      }
    }

    db.prepare(
      `UPDATE simplefin_connections
          SET last_synced_at = datetime('now'), status = 'active'
        WHERE id = ?`,
    ).run(connectionId);
  })();

  return { added, updated, accounts: accounts.length, warnings };
}

/** Sync every SimpleFIN connection. One failure does not abort the rest. */
export async function syncAllConnections(): Promise<{
  results: SimpleFinSyncResult[];
  errors: Array<{ connectionId: number; message: string }>;
}> {
  const connections = db
    .prepare("SELECT id FROM simplefin_connections")
    .all() as Array<{ id: number }>;

  const results: SimpleFinSyncResult[] = [];
  const errors: Array<{ connectionId: number; message: string }> = [];

  for (const connection of connections) {
    try {
      results.push(await syncConnection(connection.id));
    } catch (error) {
      errors.push({
        connectionId: connection.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results, errors };
}

/**
 * Remove a connection and everything it brought in. Nothing needs to be
 * revoked remotely — deleting the Access URL is what ends the app's access.
 * Cancel the subscription itself on the SimpleFIN site.
 */
export function removeConnection(connectionId: number): void {
  db.prepare("DELETE FROM simplefin_connections WHERE id = ?").run(connectionId);
}

export function listConnections(): Array<{
  id: number;
  name: string | null;
  status: string;
  last_synced_at: string | null;
  account_count: number;
}> {
  return db
    .prepare(
      `SELECT c.id, c.name, c.status, c.last_synced_at,
              (SELECT COUNT(*) FROM accounts a WHERE a.simplefin_connection_id = c.id)
                AS account_count
         FROM simplefin_connections c
        ORDER BY c.created_at ASC`,
    )
    .all() as Array<{
    id: number;
    name: string | null;
    status: string;
    last_synced_at: string | null;
    account_count: number;
  }>;
}
