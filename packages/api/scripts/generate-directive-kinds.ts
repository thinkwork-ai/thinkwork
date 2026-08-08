/**
 * Generate the web app's directive-kind mirror from the API's directive
 * registry (THINK-685).
 *
 * `apps/web` cannot import `packages/api`, so the plate editor's list of
 * directive kinds used to be a hand-typed array that silently drifted when a
 * new `tw:` kind landed. This script renders that array from `DIRECTIVE_KINDS`
 * (derived from `DEFAULT_REGISTRY`) into a checked-in generated module, and
 * `directive-kinds-parity.test.ts` fails the build when the checked-in file
 * no longer matches what this script would emit.
 *
 *   pnpm --filter @thinkwork/api generate:directive-kinds
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTIVE_KINDS } from "../src/lib/artifacts/document-directives.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the checked-in generated module in apps/web. */
export const GENERATED_DIRECTIVE_KINDS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "src",
  "components",
  "artifacts",
  "plates",
  "directive-kinds.generated.ts",
);

export const REGENERATE_COMMAND =
  "pnpm --filter @thinkwork/api generate:directive-kinds";

/** Render the generated module's exact contents (prettier-compatible). */
export function renderDirectiveKindsModule(
  kinds: readonly string[] = DIRECTIVE_KINDS,
): string {
  const entries = kinds.map((kind) => `  ${JSON.stringify(kind)},`).join("\n");
  return `// AUTO-GENERATED from packages/api DEFAULT_REGISTRY — do not edit; regenerate with ${REGENERATE_COMMAND}

/** Directive kinds a plate may make available to documents. */
export const PLATE_DIRECTIVE_KINDS = [
${entries}
] as const;

export type PlateDirectiveKind = (typeof PLATE_DIRECTIVE_KINDS)[number];
`;
}

function main(): void {
  writeFileSync(
    GENERATED_DIRECTIVE_KINDS_PATH,
    renderDirectiveKindsModule(),
    "utf8",
  );
  console.log(`wrote ${GENERATED_DIRECTIVE_KINDS_PATH}`);
}

// Only write when executed directly (the parity test imports the renderer).
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
