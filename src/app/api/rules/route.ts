import { z } from "zod";
import { db } from "@/lib/db";
import { invalidateRulesCache, recategorizeUnlocked } from "@/lib/categorize";
import { ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async () =>
  ok({
    rules: db
      .prepare(
        `SELECT r.id, r.pattern, r.priority, r.is_system, c.name AS category_name
           FROM rules r JOIN categories c ON c.id = r.category_id
          ORDER BY r.is_system ASC, r.priority DESC, r.pattern ASC`,
      )
      .all(),
  }),
);

const CreateRule = z.object({
  pattern: z.string().min(3).max(120),
  category_id: z.number().int().positive(),
  /** Re-run categorization over existing transactions after saving. */
  apply_now: z.boolean().default(true),
});

export const POST = route(async (request: Request) => {
  const body = CreateRule.parse(await request.json());

  db.prepare(
    `INSERT INTO rules (pattern, category_id, priority, is_system)
     VALUES (?, ?, 200, 0)`,
  ).run(body.pattern.trim().toLowerCase(), body.category_id);
  invalidateRulesCache();

  // Only transactions you have not categorized by hand are touched.
  const recategorized = body.apply_now ? recategorizeUnlocked() : 0;

  return ok({ created: true, recategorized }, 201);
});

export const DELETE = route(async (request: Request) => {
  const id = Number(new URL(request.url).searchParams.get("id"));
  // System rules are the shipped defaults; deleting them would leave the app
  // in a state a reinstall can't reproduce.
  db.prepare("DELETE FROM rules WHERE id = ? AND is_system = 0").run(id);
  invalidateRulesCache();
  return ok({ deleted: id });
});
