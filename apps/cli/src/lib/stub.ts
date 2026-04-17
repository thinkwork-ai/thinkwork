/**
 * Stub helper for Phase 0 scaffolding.
 *
 * Every domain command registered during Phase 0 ships with its final
 * `.description()` + `.addHelpText()` + argument parsing so `thinkwork <cmd>
 * --help` shows the real docs and the overall surface is discoverable. Action
 * bodies call `notYetImplemented(path, phase)` until the corresponding phase
 * PR lands. Exits 2 so scripts fail loudly and can distinguish "not yet
 * implemented" (2) from general errors (1).
 */

import chalk from "chalk";

export type Phase = 1 | 2 | 3 | 4 | 5;

const ROADMAP_URL =
  "https://github.com/thinkwork-ai/thinkwork/blob/main/apps/cli/README.md#roadmap";

export function notYetImplemented(commandPath: string, phase: Phase): never {
  const label = chalk.yellow(`⧗ not yet implemented`);
  const line = chalk.bold(`thinkwork ${commandPath}`);
  process.stderr.write(
    `\n  ${label}: ${line} ships in Phase ${phase}.\n` +
      `  ${chalk.dim(`See the roadmap: ${ROADMAP_URL}`)}\n\n`,
  );
  process.exit(2);
}
