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
      console.error("[api]", error);
      return fail(error instanceof Error ? error.message : "Unexpected error", 500);
    }
  };
}

/** Read and coerce a numeric query param. */
export function numParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
