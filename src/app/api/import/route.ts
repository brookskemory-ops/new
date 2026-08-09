import { db } from "@/lib/db";
import { categorize, looksLikeTransfer } from "@/lib/categorize";
import { parseTransactionCSV } from "@/lib/csv";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

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
