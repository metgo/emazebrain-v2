import type { Context } from "hono";
import type { z } from "zod";

/**
 * Parses a JSON body with a zod schema. On failure the response lists which
 * fields were wrong (paths and codes only, never the submitted values).
 */
export async function parseBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  // Custom checks carry their own code in the message (e.g. "needs_duration"); built-in checks use zod's code.
  const issues = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    code: i.code === "custom" || i.message.startsWith("invalid_") || i.message === "no_decisions" ? i.message : i.code,
  }));
  return { ok: false, response: c.json({ error: "invalid", issues }, 400) };
}
