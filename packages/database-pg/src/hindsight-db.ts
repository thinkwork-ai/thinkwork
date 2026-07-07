/**
 * Hindsight database client seam (THINK-220).
 *
 * Hindsight is moving from a `hindsight` schema inside the shared thinkwork
 * database to its own database (`thinkwork_hindsight`, same Aurora cluster)
 * so upstream's maintenance-loop discovery queries — which assume schema
 * `public` — actually run.
 *
 * `HINDSIGHT_DATABASE_NAME` is both the wiring and the cutover flag:
 *
 *   - unset (today): every helper degrades to the status quo —
 *     `resolveHindsightDb()` returns the caller's primary handle untouched
 *     (so test-injected mocks keep working) and query text keeps the
 *     `hindsight.` prefix. Behavior is byte-identical to before this seam.
 *   - set (post-cutover): a dedicated pool targets the named database and
 *     query text uses the `public.` prefix.
 *
 * All direct SQL against Hindsight tables MUST route through these helpers;
 * a guard test in packages/api fails on literal `hindsight.<table>` strings.
 */

import { sql, type SQL } from "drizzle-orm";

import {
  buildDatabaseUrl,
  createDb,
  getDb,
  resolveDatabaseUrlFromSecrets,
  type Database,
} from "./db";

/** Read at call time (not module load) so tests can flip the env var. */
export function hindsightDatabaseName(): string | undefined {
  return process.env.HINDSIGHT_DATABASE_NAME || undefined;
}

/**
 * Schema qualifier for Hindsight tables — `hindsight.` on the shared
 * database, `public.` on the dedicated one.
 */
export function hindsightSchemaPrefix(): "hindsight." | "public." {
  return hindsightDatabaseName() ? "public." : "hindsight.";
}

/**
 * Drizzle SQL chunk for the schema qualifier, for interpolation in query
 * templates: sql`SELECT ... FROM ${hindsightSql()}memory_units`.
 */
export function hindsightSql(): SQL {
  return sql.raw(hindsightSchemaPrefix());
}

let _hdb: Database | undefined;

/**
 * Dedicated Hindsight client. With HINDSIGHT_DATABASE_NAME unset this is
 * exactly `getDb()`; set, it is a lazily-created singleton pool against the
 * named database using the same connection resolution as the primary
 * (DATABASE_URL with the path swapped, or components/Secrets Manager).
 */
export function getHindsightDb(): Database {
  const dbName = hindsightDatabaseName();
  if (!dbName) return getDb();
  if (_hdb) return _hdb;

  const url = buildDatabaseUrl(dbName);
  if (url) {
    _hdb = createDb(url, () => {
      _hdb = undefined;
    });
    return _hdb;
  }

  // Async Secrets Manager fallback, mirroring getDb()'s proxy approach.
  let resolving: Promise<Database> | undefined;
  return new Proxy({} as Database, {
    get(_target, prop) {
      if (_hdb) return (_hdb as any)[prop];
      if (!resolving) {
        resolving = resolveDatabaseUrlFromSecrets(dbName).then((resolved) => {
          _hdb = createDb(resolved, () => {
            _hdb = undefined;
          });
          return _hdb;
        });
      }
      return (...args: any[]) =>
        resolving!.then((db: any) => db[prop](...args));
    },
  });
}

/**
 * Route a Hindsight query to the right handle when the caller already holds
 * a primary handle (possibly test-injected). Unset env → the caller's handle,
 * unchanged; set → the dedicated client. Accepts narrowed handle types
 * (e.g. bank-merge's DbLike) and preserves them.
 */
export function resolveHindsightDb<T>(primary: T): T {
  return hindsightDatabaseName() ? (getHindsightDb() as unknown as T) : primary;
}

/** Test-only: drop the dedicated-client singleton. */
export function resetHindsightDbForTests(): void {
  _hdb = undefined;
}
