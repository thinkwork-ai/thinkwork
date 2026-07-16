/**
 * Drop a single leading `--` separator forwarded by package-manager script
 * runners. `pnpm dev -- destroy --stage prod --yes` hands the literal `--`
 * through to the script, and commander then demotes every following flag to a
 * positional — the destroy above silently ran with its default stage
 * (2026-07-16). Only the first token after the script path is stripped; any
 * later `--` keeps its usual end-of-options meaning.
 */
export function stripForwardedSeparator(argv: readonly string[]): string[] {
  if (argv[2] === "--") {
    return [...argv.slice(0, 2), ...argv.slice(3)];
  }
  return [...argv];
}
