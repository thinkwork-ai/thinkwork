/**
 * Reserved folder names — Plan §008 U8.
 *
 * `memory/` and `skills/` are reserved at any depth in a Fat folder tree.
 * They are not sub-agent folders even if an `AGENTS.md` routing row points
 * at them: `memory/` is the per-folder write-memory scope, `skills/` is
 * the local skill-package scope. Both are consumed by the runtime through
 * dedicated paths, never via `delegate_to_workspace`.
 *
 * Single source of truth for the TypeScript surface (composer enumeration,
 * routing-table parser, bundle importer). The Python runtime mirrors the
 * same set in `packages/agentcore/agent-container/agents_md_parser.py`
 * (`RESERVED_FOLDER_NAMES`); the small-constant-mirrored-across-languages
 * pattern is per
 * `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`.
 *
 * Callers should compare folder segments after stripping any trailing slash:
 *
 *   const seg = goTo.replace(/\/$/, "");
 *   if (RESERVED_FOLDER_NAMES.has(seg)) { … }
 *
 * Adding a new reserved name requires updating both this constant and the
 * Python mirror, and refreshing fixtures in
 * `packages/agentcore/agent-container/fixtures/agents-md-sample.md` so the
 * parity test stays meaningful.
 */
export const RESERVED_FOLDER_NAMES: ReadonlySet<string> = new Set([
	"memory",
	"skills",
]);

/** Type-level enumeration mirroring the runtime set, useful for narrowing. */
export type ReservedFolderName = "memory" | "skills";

/**
 * True when `segment` (with any trailing slash already stripped) names a
 * reserved folder. The helper exists so callers don't have to remember the
 * canonicalisation rule at every site.
 */
export function isReservedFolderSegment(segment: string): boolean {
	return RESERVED_FOLDER_NAMES.has(segment);
}
