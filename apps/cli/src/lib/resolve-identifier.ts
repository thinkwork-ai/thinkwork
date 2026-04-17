/**
 * Resolve a resource by UUID, slug, or human name — with TTY picker fallback.
 *
 * Every command that takes a positional `<id>` hits the same three cases:
 *
 *   1. The caller passes a UUID (from `list`, `--json`, or a script). Use it.
 *   2. The caller passes a friendlier alias (slug, name, number). Look it up.
 *   3. No positional at all + interactive terminal. Show an arrow-key picker
 *      over the available resources.
 *
 * The `mcp` commands were the first real case (user pain: `thinkwork mcp remove
 * lastmile-routing` → HTTP 500 because the DELETE handler matches by UUID and
 * the CLI only surfaces slugs). Every Phase 1+ command (thread, agent, etc.)
 * will want the same shape, so the helper is generic.
 *
 * The fetcher is injected, not hardcoded — REST callers pass `apiFetch` wrappers
 * here, GraphQL callers will pass urql calls in Phase 1+. Keeps this file
 * decoupled from any auth/transport choice.
 */

import { select } from "@inquirer/prompts";
import { printError } from "../ui.js";
import { isInteractive, requireTty } from "./interactive.js";

/**
 * Cheap UUID-v4 detector. We don't validate RFC 4122 version bits — if it
 * looks like a UUID, the server lookup will succeed or fail with a clean 404.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface ResolveIdentifierOptions<T> {
  /** The positional arg the user typed. `undefined` triggers the picker. */
  identifier: string | undefined;
  /** Fetcher — called at most once per resolve. */
  list: () => Promise<T[]>;
  /** Canonical UUID for a resource. Used for exact UUID matches. */
  getId: (item: T) => string;
  /** Friendly aliases the caller might type (slug, name, issue number, …). */
  getAliases: (item: T) => string[];
  /** Human label used in error messages ("MCP server", "thread"). */
  resourceLabel: string;
  /** TTY picker row formatter. Defaults to `${getAliases[0]}  (${getId})`. */
  pickerLabel?: (item: T) => string;
}

export async function resolveIdentifier<T>(
  opts: ResolveIdentifierOptions<T>,
): Promise<T> {
  const { identifier, list, getId, getAliases, resourceLabel } = opts;

  // ── 1. No positional → picker (TTY) or error (CI).
  //     Check interactivity FIRST so the non-TTY exit doesn't race into select().
  if (!identifier) {
    if (!isInteractive()) {
      requireTty(`${capitalize(resourceLabel)} identifier`); // calls process.exit(1)
      throw new Error("unreachable: requireTty must exit in non-TTY"); // satisfy control flow
    }
    const items = await list();
    if (items.length === 0) {
      printError(`No ${resourceLabel}s found. Nothing to pick.`);
      process.exit(1);
    }
    if (items.length === 1) {
      console.log(`  Using the only ${resourceLabel}: ${defaultLabel(items[0], opts)}`);
      return items[0];
    }
    const chosenId = await select({
      message: `Which ${resourceLabel}?`,
      choices: items.map((it) => ({
        name: (opts.pickerLabel ?? defaultLabelFor(opts))(it),
        value: getId(it),
      })),
      loop: false,
    });
    return items.find((it) => getId(it) === chosenId)!;
  }

  // ── 2. UUID — fetch once and match by id (so we can return a clean error
  //        on a missing row instead of relying on the server's 404 behavior).
  const items = await list();
  if (isUuid(identifier)) {
    const hit = items.find((it) => getId(it) === identifier);
    if (hit) return hit;
    printError(
      `${capitalize(resourceLabel)} with ID "${identifier}" not found. Available: ${formatAvailable(items, opts)}`,
    );
    process.exit(1);
  }

  // ── 3. Alias match (slug / name / number, case-insensitive on strings).
  const needle = identifier.toLowerCase();
  const matches = items.filter((it) =>
    getAliases(it).some((a) => a != null && String(a).toLowerCase() === needle),
  );

  if (matches.length === 0) {
    printError(
      `${capitalize(resourceLabel)} "${identifier}" not found. Available: ${formatAvailable(items, opts)}`,
    );
    process.exit(1);
  }
  if (matches.length > 1) {
    printError(
      `"${identifier}" matches ${matches.length} ${resourceLabel}s. Pass the UUID instead — candidates: ${matches.map(getId).join(", ")}`,
    );
    process.exit(1);
  }
  return matches[0];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function defaultLabelFor<T>(
  opts: Pick<ResolveIdentifierOptions<T>, "getAliases" | "getId">,
): (item: T) => string {
  return (item) => defaultLabel(item, opts);
}

function defaultLabel<T>(
  item: T,
  opts: Pick<ResolveIdentifierOptions<T>, "getAliases" | "getId">,
): string {
  const aliases = opts.getAliases(item).filter(Boolean);
  const primary = aliases[0] ?? "(no name)";
  return `${primary}  (${opts.getId(item)})`;
}

function formatAvailable<T>(
  items: T[],
  opts: Pick<ResolveIdentifierOptions<T>, "getAliases">,
): string {
  if (items.length === 0) return "(none)";
  const names = items
    .map((it) => opts.getAliases(it)[0])
    .filter((n): n is string => Boolean(n))
    .slice(0, 10);
  const suffix = items.length > names.length ? `, …(${items.length - names.length} more)` : "";
  return names.join(", ") + suffix;
}

// Re-export for callers that want to early-return on non-interactive without a
// full `resolveIdentifier` call (e.g. shell completions).
export { isInteractive };
