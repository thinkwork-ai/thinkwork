/**
 * Small Postgres error helpers shared by GraphQL resolvers and Lambda
 * handlers. Lives under lib/ (not the resolver tree) so handler bundles
 * can import it without pulling in the GraphQL resolver graph.
 */

/**
 * Walk err.cause chain for a Postgres error code (e.g. "23505" unique
 * violation). Drivers and ORMs wrap the original pg error at varying
 * depths, so check every level.
 */
export function hasPgErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const maybe = current as { code?: unknown; cause?: unknown };
    if (maybe.code === code) return true;
    current = maybe.cause;
  }
  return false;
}
