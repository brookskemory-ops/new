import { z } from "zod";
import { db } from "@/lib/db";
import { parseAmountToCents } from "@/lib/money";
import { listGoals } from "@/lib/queries";
import { fail, ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ goals: listGoals() }));

const CreateGoal = z.object({
  name: z.string().min(1).max(80),
  target: z.union([z.string(), z.number()]),
  saved: z.union([z.string(), z.number()]).default(0),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const POST = route(async (request: Request) => {
  const body = CreateGoal.parse(await request.json());

  const target = parseAmountToCents(body.target);
  const saved = parseAmountToCents(body.saved);
  if (target === null || target <= 0) return fail("Target must be more than zero.", 422);
  if (saved === null || saved < 0) return fail("Saved amount cannot be negative.", 422);

  const result = db
    .prepare(
      "INSERT INTO goals (name, target_cents, saved_cents, target_date) VALUES (?, ?, ?, ?)",
    )
    .run(body.name, target, saved, body.target_date ?? null);

  return ok({ id: Number(result.lastInsertRowid) }, 201);
});

const UpdateGoal = z.object({
  id: z.number().int().positive(),
  saved: z.union([z.string(), z.number()]),
});

export const PATCH = route(async (request: Request) => {
  const body = UpdateGoal.parse(await request.json());
  const saved = parseAmountToCents(body.saved);
  if (saved === null || saved < 0) return fail("Saved amount cannot be negative.", 422);

  const result = db
    .prepare("UPDATE goals SET saved_cents = ? WHERE id = ?")
    .run(saved, body.id);
  if (result.changes === 0) return fail(`No goal with id ${body.id}.`, 404);

  return ok({ id: body.id, saved_cents: saved });
});

export const DELETE = route(async (request: Request) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("A goal id is required.", 422);
  db.prepare("DELETE FROM goals WHERE id = ?").run(id);
  return ok({ deleted: id });
});
