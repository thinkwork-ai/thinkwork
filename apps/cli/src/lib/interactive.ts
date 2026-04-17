/**
 * Thin wrapper around @inquirer/prompts that formalises the two UX modes every
 * command supports:
 *
 *   - Flag-driven (agents/CI): if a required value is missing and stdin isn't a
 *     TTY, we print a clear error and exit 1 instead of hanging on a prompt.
 *   - Interactive (humans): if stdin is a TTY, we prompt.
 *
 * Every command that takes user input should route through here so the
 * TTY / cancellation / error semantics stay consistent.
 */

import { printError } from "../ui.js";

/** @inquirer/prompts throws `ExitPromptError` on Ctrl+C / Esc. */
export function isCancellation(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}

/**
 * True when stdin is connected to a terminal. Commands use this to decide
 * whether to prompt for missing values or fail fast.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * Print a human-readable error and exit non-zero when a required value is
 * missing in a non-interactive context. Returns `never` so the calling site
 * type-checks without further guards.
 */
export function requireTty(label: string): never | void {
  if (!isInteractive()) {
    printError(
      `${label} is required. Pass it as a flag or re-run in an interactive terminal.`,
    );
    process.exit(1);
  }
}

/**
 * Convenience: await a prompt and translate Ctrl+C into a clean exit.
 * Callers that want to keep going after a cancel (e.g. to print "Cancelled.")
 * should catch `isCancellation` directly instead of using this.
 */
export async function promptOrExit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isCancellation(err)) {
      console.log("");
      console.log("  Cancelled.");
      process.exit(0);
    }
    throw err;
  }
}
