import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Shared response helpers so every route fails the same way. */

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wrap a route handler so thrown errors become clean JSON instead of a stack
 * trace in the browser. Zod validation errors get field-level detail.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        const path = first?.path.join(".");
        return fail(path ? `${path}: ${first.message}` : first.message, 422);
      }
      if (error instanceof BadRequest) return fail(error.message, 422);
      // A body that isn't valid JSON is the caller's mistake, not a server
      // fault — surfacing it as a 500 sends people hunting for a bug here.
      if (error instanceof SyntaxError) {
        return fail("Request body is not valid JSON.", 400);
      }
      console.error("[api]", error);
      return fail(error instanceof Error ? error.message : "Unexpected error", 500);
    }
  };
}

/**
 * Read a 'YYYY-MM' query param.
 *
 * Returns undefined when absent, and throws when present but malformed —
 * silently returning an empty result set for a typo'd month looks identical to
 * "you had no transactions", which is the more alarming of the two.
 */
export function monthParam(url: URL, key = "month"): string | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    throw new BadRequest(`${key} must look like 2026-08.`);
  }
  return raw;
}

/** Thrown by param helpers; the wrapper turns it into a 422. */
export class BadRequest extends Error {}

/** Read and coerce a numeric query param. */
export function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
