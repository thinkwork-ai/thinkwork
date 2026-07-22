/**
 * Call-time guard for twin best-effort consumers that fall back to the
 * MODULE-LEVEL db (dual-read gate consult, soft-layer sweep). The lazy db
 * proxy in @thinkwork/database-pg resolves credentials asynchronously on
 * first property access; when nothing is configured (vitest/CI), the
 * chained drizzle call orphans that rejection where no caller try/catch
 * can reach it. Best-effort twin paths must therefore check this BEFORE
 * touching the module-level db. Config is read at call time (vitest
 * env-capture timing rule) via getConfig — DATABASE_SECRET_ARN lives in
 * the SSM runtime-config document, so a bare process.env read would be
 * undefined on deployed Lambdas and wrongly disable the gate.
 */
import { getConfig } from "@thinkwork/runtime-config";

export function moduleDbConfigured(): boolean {
  return Boolean(getConfig("DATABASE_URL") || getConfig("DATABASE_SECRET_ARN"));
}
