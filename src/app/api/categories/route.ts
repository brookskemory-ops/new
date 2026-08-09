import { z } from "zod";
import { db } from "@/lib/db";
import { listCategories } from "@/lib/queries";
import { ok, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ categories: listCategories() }));

const CreateCategory = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(["expense", "income", "transfer"]).default("expense"),
  bucket: z.enum(["need", "want", "save", "none"]).default("want"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #0ea5e9")
    .default("#64748b"),
});

export const POST = route(async (request: Request) => {
  const body = CreateCategory.parse(await request.json());
  const result = db
    .prepare(
      `INSERT INTO categories (name, kind, color, bucket, is_system, sort_order)
       VALUES (?, ?, ?, ?, 0, 60)`,
    )
    .run(body.name, body.kind, body.color, body.bucket);
  return ok({ id: Number(result.lastInsertRowid) }, 201);
});
