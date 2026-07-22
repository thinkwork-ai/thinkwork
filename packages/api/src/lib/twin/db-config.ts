/**
 * Call-time guard for twin best-effort consumers that fall back to the
 * MODULE-LEVEL db (dual-read gate consult, soft-layer sweep). The lazy db
 * proxy in @thinkwork/database-pg resolves credentials asynchronously on
 * first property access; when nothing is configured (vitest/CI), the
 * chained drizzle call orphans that rejection where no caller try/catch
 * can reach it. Best-effort twin paths must therefore check this BEFORE
 * touching the module-level db. Env is read at call time (vitest
 * env-capture timing rule).
 */
export function moduleDbConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL || process.env.DATABASE_SECRET_ARN,
  );
}
