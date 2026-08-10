import { db } from "@/lib/db";
import { categorize, looksLikeTransfer } from "@/lib/categorize";
import { parseTransactionCSV } from "@/lib/csv";
import { looksLikeOfx, parseOFX } from "@/lib/ofx";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Import an OFX/QFX statement.
 *
 * Better than CSV in one decisive way: every transaction carries FITID, the
 * bank's own unique id, so re-importing an overlapping statement matches
 * exactly instead of guessing from date + amount + description.
 */
function importOfx(text: string, accountId: number) {
  const statements = parseOFX(text);

  const findByFitid = db.prepare(
    "SELECT id FROM transactions WHERE account_id = ? AND ofx_fitid = ?",
  );
  /**
   * A statement previously imported as CSV has no FITID, so re-importing the
   * same period as QFX would double it. This finds that earlier row so the
   * FITID can be adopted instead.
   *
   * Deliberately narrow: only rows from a CSV import, and the description must
   * match as well as the date and amount. Matching on date+amount alone
   * silently merges genuinely different transactions that happen to coincide —
   * two $50 charges on the same day, or a manually entered paycheck — and the
   * incoming row is then never inserted at all. Failing the other way merely
   * produces a visible duplicate you can delete, so the loose match is the one
   * to avoid.
   */
  const findByShape = db.prepare(
    `SELECT id FROM transactions
      WHERE account_id = ? AND date = ? AND amount_cents = ?
        AND ofx_fitid IS NULL
        AND source = 'csv'
        AND (description = ? OR merchant = ?)
      LIMIT 1`,
  );
  const claimFitid = db.prepare("UPDATE transactions SET ofx_fitid = ? WHERE id = ?");
  const insert = db.prepare(
    `INSERT INTO transactions
       (account_id, category_id, date, amount_cents, merchant, description,
        is_transfer, source, ofx_fitid)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'csv', ?)`,
  );

  let imported = 0;
  let duplicates = 0;
  let linked = 0;
  const skipped: string[] = [];

  db.transaction(() => {
    for (const statement of statements) {
      skipped.push(...statement.skipped);

      for (const row of statement.transactions) {
        if (findByFitid.get(accountId, row.fitid)) {
          duplicates++;
          continue;
        }

        const priorImport = findByShape.get(
          accountId,
          row.date,
          row.amount_cents,
          row.description,
          row.merchant,
        ) as { id: number } | undefined;
        if (priorImport) {
          // Same transaction, imported before FITIDs were available. Adopt the
          // id so future imports match exactly rather than heuristically.
          claimFitid.run(row.fitid, priorImport.id);
          linked++;
          continue;
        }

        const input = {
          merchant: row.merchant,
          description: row.description,
          amount_cents: row.amount_cents,
        };
        insert.run(
          accountId,
          categorize(input),
          row.date,
          row.amount_cents,
          row.merchant,
          row.description,
          looksLikeTransfer(input) ? 1 : 0,
          row.fitid,
        );
        imported++;
      }
    }
  })();

  return ok({
    format: "ofx",
    imported,
    duplicates,
    linked_to_existing: linked,
    skipped: skipped.length,
    skipped_detail: skipped.slice(0, 10),
    statements: statements.map((statement) => ({
      account: statement.mask ? `••${statement.mask}` : "unknown",
      type: statement.account_type,
      transactions: statement.transactions.length,
    })),
  });
}

/**
 * CSV import. Expects multipart/form-data with `file` and `account_id`.
 *
 * Duplicate handling: a row is treated as already-imported when the same
 * account already has a transaction with an identical date, amount, and
 * description. Re-importing an overlapping statement is therefore safe — you
 * get the new rows and nothing doubles up.
 */
export const POST = route(async (request: Request) => {
  const form = await request.formData();
  const file = form.get("file");
  const accountId = Number(form.get("account_id"));

  if (!(file instanceof File)) return fail("No file was uploaded.", 422);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return fail("Choose an account to import into.", 422);
  }

  const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId);
  if (!account) return fail(`No account with id ${accountId}.`, 422);

  const text = await file.text();

  // OFX/QFX is detected by content rather than extension: banks label the same
  // format .qfx, .ofx, and occasionally .qbo.
  if (looksLikeOfx(text)) {
    return importOfx(text, accountId);
  }

  const parsed = parseTransactionCSV(text);

  if (parsed.rows.length === 0) {
    return fail(
      `No usable rows found. ${parsed.skipped.slice(0, 3).join("; ")}`,
      422,
    );
  }

  const findDuplicate = db.prepare(
    `SELECT id FROM transactions
      WHERE account_id = ? AND date = ? AND amount_cents = ? AND description = ?
      LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO transactions
       (account_id, category_id, date, amount_cents, merchant, description,
        is_transfer, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'csv')`,
  );

  let imported = 0;
  let duplicates = 0;

  db.transaction(() => {
    for (const row of parsed.rows) {
      if (findDuplicate.get(accountId, row.date, row.amount_cents, row.description)) {
        duplicates++;
        continue;
      }

      const input = {
        merchant: row.merchant,
        description: row.description,
        amount_cents: row.amount_cents,
      };

      insert.run(
        accountId,
        categorize(input),
        row.date,
        row.amount_cents,
        row.merchant,
        row.description,
        looksLikeTransfer(input) ? 1 : 0,
      );
      imported++;
    }
  })();

  return ok({
    imported,
    duplicates,
    skipped: parsed.skipped.length,
    skipped_detail: parsed.skipped.slice(0, 10),
    detected_columns: parsed.detected,
  });
});
