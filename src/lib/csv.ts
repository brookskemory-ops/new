/**
 * CSV import for bank and card exports.
 *
 * Every bank exports a different shape, so rather than asking you to remap
 * columns by hand this detects the common ones by header name. The three
 * layouts below cover essentially every US bank and card export:
 *
 *   date, description, amount            (single signed column)
 *   date, description, debit, credit     (two columns, one blank per row)
 *   date, description, amount, type      (unsigned amount + DEBIT/CREDIT flag)
 */

import { parseAmountToCents, toDateString } from "./money";

/** RFC 4180 parser: handles quoted fields, embedded commas, and "" escapes. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Consume \r\n as one break rather than emitting a blank row.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  return rows;
}

/** Find the first header whose name contains any of these words. */
function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const index = headers.findIndex((header) => header.includes(candidate));
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Parse a date cell. Accepts ISO (2026-08-09), US (08/09/2026), and
 * two-digit-year US (08/09/26). Returns null when unparseable.
 */
export function parseDateCell(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(text);
  if (slash) {
    const [, m, d, rawYear] = slash;
    // A two-digit year here is always this century — bank exports don't
    // predate 2000, and "26" meaning 1926 would be nonsense.
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : toDateString(parsed);
}

export interface ParsedRow {
  date: string;
  /** Negative = money out, matching the app's convention. */
  amount_cents: number;
  merchant: string;
  description: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Human-readable reasons rows were skipped, so nothing fails silently. */
  skipped: string[];
  detected: { date: string; amount: string; description: string };
}

export function parseTransactionCSV(text: string): ParseResult {
  const table = parseCSV(text);
  if (table.length < 2) {
    throw new Error("That file has no data rows.");
  }

  const rawHeaders = table[0];
  const headers = rawHeaders.map((header) => header.trim().toLowerCase());

  const dateCol = findColumn(headers, ["posted date", "transaction date", "date"]);
  const amountCol = findColumn(headers, ["amount", "value"]);
  const debitCol = findColumn(headers, ["debit", "withdrawal"]);
  const creditCol = findColumn(headers, ["credit", "deposit"]);
  const descCol = findColumn(headers, [
    "description",
    "name",
    "merchant",
    "payee",
    "memo",
    "details",
  ]);
  const typeCol = findColumn(headers, ["transaction type", "type", "debit/credit"]);

  if (dateCol === -1) {
    throw new Error(
      `No date column found. Headers seen: ${rawHeaders.join(", ")}`,
    );
  }
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    throw new Error(
      `No amount column found. Headers seen: ${rawHeaders.join(", ")}`,
    );
  }

  const rows: ParsedRow[] = [];
  const skipped: string[] = [];

  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const lineNumber = i + 1;

    const date = parseDateCell(cells[dateCol] ?? "");
    if (!date) {
      skipped.push(`Line ${lineNumber}: unreadable date "${cells[dateCol] ?? ""}"`);
      continue;
    }

    let cents: number | null = null;

    if (amountCol !== -1 && (cells[amountCol] ?? "").trim() !== "") {
      cents = parseAmountToCents(cells[amountCol]);

      // Some exports give an unsigned amount plus a separate DEBIT/CREDIT
      // column. Apply the sign from that column when the amount has none.
      if (cents !== null && typeCol !== -1) {
        const kind = (cells[typeCol] ?? "").trim().toLowerCase();
        if (/debit|withdrawal|purchase/.test(kind)) cents = -Math.abs(cents);
        else if (/credit|deposit|refund/.test(kind)) cents = Math.abs(cents);
      }
    } else if (debitCol !== -1 && (cells[debitCol] ?? "").trim() !== "") {
      const debit = parseAmountToCents(cells[debitCol]);
      cents = debit === null ? null : -Math.abs(debit);
    } else if (creditCol !== -1 && (cells[creditCol] ?? "").trim() !== "") {
      const credit = parseAmountToCents(cells[creditCol]);
      cents = credit === null ? null : Math.abs(credit);
    }

    if (cents === null) {
      skipped.push(`Line ${lineNumber}: unreadable amount`);
      continue;
    }
    if (cents === 0) {
      skipped.push(`Line ${lineNumber}: zero amount`);
      continue;
    }

    const description = descCol === -1 ? "" : (cells[descCol] ?? "").trim();

    rows.push({
      date,
      amount_cents: cents,
      merchant: cleanMerchant(description),
      description,
    });
  }

  return {
    rows,
    skipped,
    detected: {
      date: rawHeaders[dateCol] ?? "?",
      amount:
        amountCol !== -1
          ? (rawHeaders[amountCol] ?? "?")
          : `${rawHeaders[debitCol] ?? ""}/${rawHeaders[creditCol] ?? ""}`,
      description: descCol === -1 ? "(none)" : (rawHeaders[descCol] ?? "?"),
    },
  };
}

/**
 * Bank descriptions carry processor noise: "SQ *BLUE BOTTLE 0123 SAN FRANCISCO
 * CA 08/07". Strip it so the categorizer and the merchant list see a name a
 * human would recognize.
 */
export function cleanMerchant(description: string): string {
  let text = description.trim();

  text = text.replace(/^(SQ|TST|PY|SP|PAYPAL|POS|ACH|DEBIT|CREDIT|VISA)\s*\*\s*/i, "");
  text = text.replace(/^(PURCHASE|PAYMENT|POS DEBIT|CHECKCARD|RECURRING)\s+/i, "");
  text = text.replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?\s*$/, "");   // trailing date
  text = text.replace(/\s+#?\d{4,}\s*/g, " ");                   // long digit runs
  text = text.replace(/\s+[A-Z]{2}\s*$/, "");                    // trailing state code
  text = text.replace(/\s{2,}/g, " ").trim();

  // If cleaning ate the whole string, the original is more useful than nothing.
  return text || description.trim();
}
