import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type RemovedTransaction,
  type Transaction as PlaidTransaction,
} from "plaid";
import { db } from "./db";
import { categorize, looksLikeTransfer } from "./categorize";
import type { AccountType } from "./types";

/**
 * Plaid bank linking.
 *
 * Everything here degrades to a clear error rather than a crash when keys are
 * absent, so the app is fully usable before you sign up for Plaid. Check
 * `isPlaidConfigured()` before offering bank-link UI.
 *
 * Secrets: PLAID_CLIENT_ID / PLAID_SECRET live in .env (gitignored). The
 * per-bank access_token returned by Plaid is stored in the local SQLite file
 * and never leaves this machine.
 */

/**
 * A blank line in .env (`PLAID_SECRET=`) yields `""`, not undefined, so `??`
 * would treat it as configured. Blank means unset.
 */
export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());
}

export function plaidEnvName(): string {
  return process.env.PLAID_ENV?.trim() || "sandbox";
}

let client: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  if (!isPlaidConfigured()) {
    throw new Error(
      "Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env — see README.",
    );
  }
  if (client) return client;

  const env = plaidEnvName();
  const basePath = PlaidEnvironments[env];
  if (!basePath) {
    throw new Error(`Unknown PLAID_ENV "${env}". Use "sandbox" or "production".`);
  }

  client = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
        },
      },
    }),
  );
  return client;
}

/**
 * A stable id for "this user" in Plaid's eyes. Single-user local app, so it is
 * a constant — but Plaid requires the field and uses it for link analytics.
 */
const CLIENT_USER_ID = "ledger-local-user";

export async function createLinkToken(): Promise<string> {
  const response = await plaidClient().linkTokenCreate({
    user: { client_user_id: CLIENT_USER_ID },
    client_name: "Ledger",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    transactions: { days_requested: 730 },
  });
  return response.data.link_token;
}

/**
 * Re-link an item whose credentials expired. Plaid returns a token that opens
 * Link straight into the repair flow for that specific bank.
 */
export async function createUpdateLinkToken(itemId: number): Promise<string> {
  const item = db
    .prepare("SELECT access_token FROM plaid_items WHERE id = ?")
    .get(itemId) as { access_token: string } | undefined;
  if (!item) throw new Error(`No linked bank with id ${itemId}`);

  const response = await plaidClient().linkTokenCreate({
    user: { client_user_id: CLIENT_USER_ID },
    client_name: "Ledger",
    country_codes: [CountryCode.Us],
    language: "en",
    access_token: item.access_token,
  });
  return response.data.link_token;
}

/** Exchange the short-lived public token from Link for a durable access token. */
export async function exchangePublicToken(publicToken: string): Promise<number> {
  const api = plaidClient();
  const exchange = await api.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  let institutionName: string | null = null;
  let institutionId: string | null = null;
  try {
    const item = await api.itemGet({ access_token: accessToken });
    institutionId = item.data.item.institution_id ?? null;
    if (institutionId) {
      const institution = await api.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = institution.data.institution.name;
    }
  } catch {
    // Institution metadata is cosmetic; a failure here must not lose the link.
  }

  const result = db
    .prepare(
      `INSERT INTO plaid_items (item_id, access_token, institution_name, institution_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         access_token     = excluded.access_token,
         institution_name = COALESCE(excluded.institution_name, plaid_items.institution_name),
         status           = 'active'`,
    )
    .run(itemId, accessToken, institutionName, institutionId);

  const rowId =
    result.changes > 0 && result.lastInsertRowid
      ? Number(result.lastInsertRowid)
      : (db.prepare("SELECT id FROM plaid_items WHERE item_id = ?").get(itemId) as {
          id: number;
        }).id;

  await syncAccounts(rowId);
  return rowId;
}

/** Map Plaid's account taxonomy onto ours. */
function mapAccountType(plaidType: string, subtype: string | null): AccountType {
  if (plaidType === "credit") return "credit";
  if (plaidType === "loan") return "loan";
  if (plaidType === "investment") return "investment";
  if (plaidType === "depository") {
    if (subtype === "savings" || subtype === "cd" || subtype === "money market") {
      return "savings";
    }
    return "checking";
  }
  return "other";
}

/** Pull the current account list and balances for one linked bank. */
export async function syncAccounts(itemRowId: number): Promise<number> {
  const item = db
    .prepare("SELECT access_token, institution_name FROM plaid_items WHERE id = ?")
    .get(itemRowId) as { access_token: string; institution_name: string | null } | undefined;
  if (!item) throw new Error(`No linked bank with id ${itemRowId}`);

  const response = await plaidClient().accountsGet({ access_token: item.access_token });
  const upsert = db.prepare(
    `INSERT INTO accounts
       (name, type, institution, mask, balance_cents, currency, is_manual, plaid_item_id, plaid_account_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(plaid_account_id) DO UPDATE SET
       name          = excluded.name,
       type          = excluded.type,
       institution   = excluded.institution,
       mask          = excluded.mask,
       balance_cents = excluded.balance_cents`,
  );

  db.transaction((accounts: AccountBase[]) => {
    for (const account of accounts) {
      const balance = account.balances.current ?? 0;
      upsert.run(
        account.name,
        mapAccountType(account.type, account.subtype ?? null),
        item.institution_name,
        account.mask,
        Math.round(balance * 100),
        account.balances.iso_currency_code ?? "USD",
        itemRowId,
        account.account_id,
      );
    }
  })(response.data.accounts);

  return response.data.accounts.length;
}

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  accounts: number;
  institution: string | null;
  needsReauth?: boolean;
}

/**
 * Incremental transaction sync for one linked bank.
 *
 * Plaid's /transactions/sync is cursor-based: it hands back everything that
 * changed since the stored cursor. The cursor is only persisted after the whole
 * page set is written, so an interrupted sync re-fetches rather than skips.
 */
export async function syncTransactions(itemRowId: number): Promise<SyncResult> {
  const item = db
    .prepare(
      "SELECT access_token, cursor, institution_name FROM plaid_items WHERE id = ?",
    )
    .get(itemRowId) as
    | { access_token: string; cursor: string | null; institution_name: string | null }
    | undefined;
  if (!item) throw new Error(`No linked bank with id ${itemRowId}`);

  const api = plaidClient();
  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: RemovedTransaction[] = [];

  let cursor = item.cursor ?? undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await api.transactionsSync({
        access_token: item.access_token,
        cursor,
        count: 500,
      });
      added.push(...response.data.added);
      modified.push(...response.data.modified);
      removed.push(...response.data.removed);
      cursor = response.data.next_cursor;
      hasMore = response.data.has_more;
    }
  } catch (error) {
    if (isItemLoginRequired(error)) {
      db.prepare("UPDATE plaid_items SET status = 'needs_reauth' WHERE id = ?").run(itemRowId);
      return {
        added: 0, modified: 0, removed: 0, accounts: 0,
        institution: item.institution_name,
        needsReauth: true,
      };
    }
    throw error;
  }

  const accountCount = await syncAccounts(itemRowId);

  const accountIdFor = db.prepare(
    "SELECT id FROM accounts WHERE plaid_account_id = ?",
  );
  const insert = db.prepare(
    `INSERT INTO transactions
       (account_id, category_id, date, amount_cents, merchant, description,
        pending, is_transfer, source, plaid_transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plaid', ?)
     ON CONFLICT(plaid_transaction_id) DO UPDATE SET
       date         = excluded.date,
       amount_cents = excluded.amount_cents,
       merchant     = excluded.merchant,
       description  = excluded.description,
       pending      = excluded.pending,
       updated_at   = datetime('now')`,
  );
  const deleteTx = db.prepare("DELETE FROM transactions WHERE plaid_transaction_id = ?");

  const write = db.transaction(() => {
    for (const tx of [...added, ...modified]) {
      const account = accountIdFor.get(tx.account_id) as { id: number } | undefined;
      if (!account) continue; // account not synced yet; next run picks it up

      // Plaid's sign convention is the opposite of ours: it reports money
      // leaving the account as POSITIVE. Flip it here, once, at the boundary.
      const amountCents = -Math.round(tx.amount * 100);

      const merchant = tx.merchant_name ?? tx.name ?? "";
      const description = tx.name ?? "";
      const plaidCategory = tx.personal_finance_category?.primary ?? null;
      const plaidDetailedCategory = tx.personal_finance_category?.detailed ?? null;

      const input = {
        merchant,
        description,
        amount_cents: amountCents,
        plaidCategory,
        plaidDetailedCategory,
      };
      insert.run(
        account.id,
        categorize(input),
        tx.date,
        amountCents,
        merchant,
        description,
        tx.pending ? 1 : 0,
        looksLikeTransfer(input) ? 1 : 0,
        tx.transaction_id,
      );
    }
    for (const tx of removed) {
      deleteTx.run(tx.transaction_id);
    }
    db.prepare(
      `UPDATE plaid_items
          SET cursor = ?, last_synced_at = datetime('now'), status = 'active'
        WHERE id = ?`,
    ).run(cursor ?? null, itemRowId);
  });

  write();

  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    accounts: accountCount,
    institution: item.institution_name,
  };
}

/** Sync every linked bank. Individual failures do not abort the rest. */
export async function syncAllItems(): Promise<{
  results: SyncResult[];
  errors: Array<{ itemId: number; message: string }>;
}> {
  const items = db.prepare("SELECT id FROM plaid_items").all() as Array<{ id: number }>;
  const results: SyncResult[] = [];
  const errors: Array<{ itemId: number; message: string }> = [];

  for (const item of items) {
    try {
      results.push(await syncTransactions(item.id));
    } catch (error) {
      errors.push({
        itemId: item.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { results, errors };
}

/**
 * Unlink a bank. This tells Plaid to invalidate the access token (so it stops
 * billing and stops holding the connection) and drops the local rows.
 * Transactions are deleted with their accounts via ON DELETE CASCADE.
 */
export async function removeItem(itemRowId: number): Promise<void> {
  const item = db
    .prepare("SELECT access_token FROM plaid_items WHERE id = ?")
    .get(itemRowId) as { access_token: string } | undefined;
  if (!item) return;

  try {
    await plaidClient().itemRemove({ access_token: item.access_token });
  } catch {
    // If Plaid rejects the removal the local rows should still go, otherwise
    // the UI shows a bank you cannot get rid of.
  }
  db.prepare("DELETE FROM plaid_items WHERE id = ?").run(itemRowId);
}

function isItemLoginRequired(error: unknown): boolean {
  const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data
    ?.error_code;
  return code === "ITEM_LOGIN_REQUIRED";
}

/** Turn a Plaid API error into something worth showing a human. */
export function plaidErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, string> } })?.response?.data;
  if (data?.error_message) {
    return `${data.error_message}${data.error_code ? ` (${data.error_code})` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}
