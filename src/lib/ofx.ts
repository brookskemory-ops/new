import { parseAmountToCents } from "./money";

/**
 * OFX / QFX import.
 *
 * Almost every US bank and credit union offers a "Download to Quicken (.qfx)"
 * or "Money (.ofx)" button next to the CSV one, and the file is strictly better
 * for this purpose: it carries `FITID`, a unique identifier the bank assigns to
 * each transaction. That turns duplicate detection from a heuristic on
 * date+amount+description into an exact match, so re-importing overlapping
 * statements is safe by construction.
 *
 * The format is awkward rather than hard. OFX 1.x is SGML with *unclosed*
 * tags — `<TRNAMT>-24.10` with no `</TRNAMT>` — which no XML parser will
 * accept. OFX 2.x is real XML. Rather than depend on a parser that handles
 * both, this reads the handful of fields that matter with a tolerant scan,
 * which works for either dialect.
 */

export interface OfxTransaction {
  /** The bank's unique id for this transaction. */
  fitid: string;
  date: string;
  /** Negative = money out, matching the app's convention (and OFX's). */
  amount_cents: number;
  merchant: string;
  description: string;
  type: string | null;
}

export interface OfxStatement {
  /** Account number as the bank reports it; usually the full number. */
  account_id: string | null;
  /** Last four, for display — never store or show more than this. */
  mask: string | null;
  account_type: "bank" | "credit" | null;
  balance_cents: number | null;
  currency: string;
  transactions: OfxTransaction[];
  skipped: string[];
}

/** True when the text looks like OFX/QFX rather than CSV. */
export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 2048).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>");
}

/**
 * Read the first value of an unclosed-or-closed SGML tag.
 * `<TRNAMT>-24.10` and `<TRNAMT>-24.10</TRNAMT>` both yield "-24.10".
 */
function tagValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : value;
}

/**
 * OFX dates are `YYYYMMDD` optionally followed by a time and timezone, e.g.
 * `20260807120000.000[-7:MST]`. Only the calendar date is kept: the app stores
 * the date a person would read on their statement, and applying a timezone
 * shift can move a late-evening transaction onto the wrong day.
 */
export function parseOfxDate(value: string): string | null {
  const match = /^\s*(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Clean a bank's transaction label. OFX splits it across NAME and MEMO, and
 * which one holds the useful text varies by institution — some put the
 * merchant in NAME, others put a transaction code there and the merchant in
 * MEMO. Prefer the longer of the two as the description.
 */
function pickLabels(name: string | null, memo: string | null) {
  const cleanName = (name ?? "").trim();
  const cleanMemo = (memo ?? "").trim();

  if (cleanName && cleanMemo) {
    const description = cleanMemo.length > cleanName.length ? cleanMemo : cleanName;
    return { merchant: cleanName, description };
  }
  const single = cleanName || cleanMemo;
  return { merchant: single, description: single };
}

export function parseOFX(text: string): OfxStatement[] {
  if (!looksLikeOfx(text)) {
    throw new Error("That file does not look like an OFX or QFX export.");
  }

  const statements: OfxStatement[] = [];

  // A file can carry several statements — a checking account and a card in one
  // download. Bank and credit-card statements use different wrappers.
  const blocks = [
    ...text.matchAll(/<STMTRS>([\s\S]*?)<\/STMTRS>/gi),
    ...text.matchAll(/<CCSTMTRS>([\s\S]*?)<\/CCSTMTRS>/gi),
  ];

  // Some exports omit the wrapper entirely and just list transactions.
  const sources: Array<{ body: string; isCredit: boolean }> =
    blocks.length > 0
      ? blocks.map((match) => ({
          body: match[1],
          isCredit: match[0].toUpperCase().startsWith("<CCSTMTRS"),
        }))
      : [{ body: text, isCredit: /<CREDITCARDMSGSRSV1>/i.test(text) }];

  for (const { body, isCredit } of sources) {
    const transactions: OfxTransaction[] = [];
    const skipped: string[] = [];

    const entries = [...body.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)];
    for (const [index, entry] of entries.entries()) {
      const block = entry[1];

      const fitid = tagValue(block, "FITID");
      const rawDate = tagValue(block, "DTPOSTED") ?? tagValue(block, "DTUSER");
      const rawAmount = tagValue(block, "TRNAMT");

      if (!rawDate || !rawAmount) {
        skipped.push(`Transaction ${index + 1}: missing date or amount`);
        continue;
      }

      const date = parseOfxDate(rawDate);
      if (!date) {
        skipped.push(`Transaction ${index + 1}: unreadable date "${rawDate}"`);
        continue;
      }

      // OFX signs amounts the way this app does: negative is money out.
      const cents = parseAmountToCents(rawAmount);
      if (cents === null || cents === 0) {
        skipped.push(`Transaction ${index + 1}: unreadable amount "${rawAmount}"`);
        continue;
      }

      const { merchant, description } = pickLabels(
        tagValue(block, "NAME"),
        tagValue(block, "MEMO"),
      );

      transactions.push({
        // A file without FITID is unusual but legal. Fall back to a stable
        // composite so re-importing still dedupes rather than doubling.
        fitid: fitid ?? `${date}:${cents}:${merchant}`.slice(0, 120),
        date,
        amount_cents: cents,
        merchant,
        description,
        type: tagValue(block, "TRNTYPE"),
      });
    }

    const accountId = tagValue(body, "ACCTID");
    const balanceRaw = tagValue(body, "BALAMT");

    statements.push({
      account_id: accountId,
      mask: accountId ? accountId.replace(/\D/g, "").slice(-4) || null : null,
      account_type: isCredit ? "credit" : "bank",
      balance_cents: balanceRaw ? parseAmountToCents(balanceRaw) : null,
      currency: tagValue(body, "CURDEF") ?? "USD",
      transactions,
      skipped,
    });
  }

  const total = statements.reduce(
    (sum, statement) => sum + statement.transactions.length,
    0,
  );
  if (total === 0) {
    throw new Error(
      "No transactions found in that OFX file. It may be a balance-only export.",
    );
  }

  return statements;
}
