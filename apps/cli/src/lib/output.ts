/**
 * Dual-mode output helpers. Every command honours a global `--json` flag:
 *
 *   - Human mode (default): chalk-coloured messages + aligned tables on stdout.
 *   - JSON mode (`--json`): a single JSON document on stdout; all logs / spinners
 *     / warnings go to stderr so piping `| jq` stays clean.
 *
 * The `--json` state is module-level so we don't have to thread a flag through
 * every action. `cli.ts` sets it in a `preAction` hook before any command runs.
 */

import chalk from "chalk";

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = Boolean(enabled);
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/** Emit the command's structured result. No-op when not in JSON mode. */
export function printJson(value: unknown): void {
  if (!jsonMode) return;
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * Print a key-value block in human mode (tree-aligned). Skipped in JSON mode —
 * callers are expected to pair this with `printJson(...)` for the machine path.
 */
export function printKeyValue(
  pairs: Array<[string, string | number | boolean | null | undefined]>,
): void {
  if (jsonMode) return;
  const width = Math.max(...pairs.map(([k]) => k.length));
  for (const [k, v] of pairs) {
    const label = chalk.dim(k.padEnd(width) + "  ");
    console.log(`  ${label}${v ?? chalk.dim("—")}`);
  }
}

/**
 * Print a simple aligned table in human mode. `rows` is an array of records;
 * column order comes from `columns`. No decoration (no borders) — keep it
 * copy-paste friendly.
 */
export function printTable<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<{ key: keyof T; header: string; format?: (v: T[keyof T]) => string }>,
): void {
  if (jsonMode) return;
  if (rows.length === 0) {
    console.log(chalk.dim("  (no results)"));
    return;
  }

  const widths = columns.map((c) => {
    const header = c.header.length;
    const maxRow = Math.max(
      ...rows.map((r) => (c.format ? c.format(r[c.key]) : String(r[c.key] ?? "")).length),
    );
    return Math.max(header, maxRow);
  });

  const header = columns
    .map((c, i) => chalk.bold(c.header.padEnd(widths[i])))
    .join("  ");
  console.log(`  ${header}`);
  console.log(
    "  " + widths.map((w) => chalk.dim("─".repeat(w))).join("  "),
  );
  for (const row of rows) {
    const line = columns
      .map((c, i) => {
        const v = c.format ? c.format(row[c.key]) : String(row[c.key] ?? "");
        return v.padEnd(widths[i]);
      })
      .join("  ");
    console.log(`  ${line}`);
  }
}

/** Emit a line to stderr so it never contaminates `--json` stdout. */
export function logStderr(message: string): void {
  process.stderr.write(message + "\n");
}
