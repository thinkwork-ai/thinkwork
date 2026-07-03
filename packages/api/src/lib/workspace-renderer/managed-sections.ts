/**
 * Managed-sections composer — ONE engine for both governance-file
 * generation paths (Composer plan 2026-07-02-001 U4; KTD-1, KTD-2).
 *
 * The layer's source file IS the template: each AGENTS.md/CONTEXT.md
 * carries operator prose plus managed sections — known `## ` headings
 * whose bodies are recomputed from the effective capability set. There
 * is no template DSL and no separate template files; the managed-heading
 * set is the entire slot vocabulary:
 *
 *   - AGENTS.md:  `## Folder Structure`, `## Skills & Tools`
 *   - CONTEXT.md: `## Routing`
 *
 * Byte-preservation contract: recomposing a file replaces ONLY the
 * managed-section bodies. Every byte of prose before, between, and after
 * managed headings survives verbatim. A file with no managed headings
 * gets them appended in canonical order; a file that is only prose and a
 * file that is only managed sections both round-trip.
 *
 * Consumers (KTD-2):
 *   - the agent-level map path (`workspace-map-generator.ts`, skill
 *     toggles) bakes perspective-INDEPENDENT section bodies (folder map,
 *     skills inventory) into the source file via `replaceManagedSections`;
 *   - the per-thread render path (`compose-tuple.ts`) preserves those
 *     baked bodies byte-for-byte in the generated AGENTS.md (the
 *     render-equals-map unification), and generates CONTEXT.md through
 *     `composeGeneratedContextMd` below.
 *
 * Perspective split (KTD-8): perspective-DEPENDENT content (plugin gate
 * states, per-requester routing rows) is computed only at render time
 * into the per-tuple generated file — the map path writes
 * perspective-neutral bodies and never bakes gate state into source.
 *
 * KTD-9 (ACTIVE since U5): the computed CONTEXT.md `## Routing` section —
 * `computeContextRoutingRows` / `composeContextMdManagedSections` — IS the
 * live render output. U5 activated it in the same deploy that retired
 * install-time snippet appends (catalog-install no longer touches
 * CONTEXT.md; the one-shot snippet migration strips legacy appends), so
 * no render carries both legacy snippet lines and computed rows. The
 * computed rows are the ONLY plugin-gate enforcement for CONTEXT.md
 * routing.
 */

import {
  EMPTY_PLUGIN_GATE,
  pluginGateExcludesWorkspacePath,
  type PluginActivationGate,
} from "../plugins/gating.js";

// ---------------------------------------------------------------------------
// Managed-heading vocabulary (KTD-1)
// ---------------------------------------------------------------------------

export type AgentsMdManagedSectionName = "Folder Structure" | "Skills & Tools";

/** Canonical append order for AGENTS.md managed sections. */
export const AGENTS_MD_MANAGED_SECTION_ORDER: readonly AgentsMdManagedSectionName[] =
  ["Folder Structure", "Skills & Tools"];

export type ContextMdManagedSectionName = "Routing";

/** Canonical append order for CONTEXT.md managed sections. */
export const CONTEXT_MD_MANAGED_SECTION_ORDER: readonly ContextMdManagedSectionName[] =
  ["Routing"];

export type ManagedSectionName =
  | AgentsMdManagedSectionName
  | ContextMdManagedSectionName;

// ---------------------------------------------------------------------------
// Section primitives (extracted from workspace-map-generator.ts — behavior
// is byte-identical; the map-generator test suite characterizes it)
// ---------------------------------------------------------------------------

export interface MarkdownSectionRange {
  headingStart: number;
  bodyStart: number;
  end: number;
}

/**
 * Locate a `## <sectionName>` section. The section body runs from the end
 * of the heading line to the next `## ` heading or `---` divider line (or
 * end of document).
 */
export function findMarkdownSectionRange(
  markdown: string,
  sectionName: string,
): MarkdownSectionRange | null {
  const headingPattern = new RegExp(
    `(^|\\n)## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?:\\r?\\n|$)`,
    "g",
  );
  const match = headingPattern.exec(markdown);
  if (!match) return null;

  const headingStart = match.index + (match[1] === "\n" ? 1 : 0);
  const bodyStart = headingPattern.lastIndex;
  const linePattern = /[^\n]*(?:\n|$)/g;
  linePattern.lastIndex = bodyStart;

  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = linePattern.exec(markdown))) {
    const lineStart = lineMatch.index;
    if (lineStart >= markdown.length) break;
    const line = lineMatch[0];
    const trimmed = line.trim();
    if (
      lineStart > headingStart &&
      (trimmed === "---" || line.startsWith("## "))
    ) {
      return { headingStart, bodyStart, end: lineStart };
    }
    if (linePattern.lastIndex >= markdown.length) break;
  }

  return { headingStart, bodyStart, end: markdown.length };
}

export function findMarkdownSectionBodyRange(
  markdown: string,
  sectionName: string,
): { start: number; end: number } | null {
  const sectionRange = findMarkdownSectionRange(markdown, sectionName);
  if (!sectionRange) return null;
  return { start: sectionRange.bodyStart, end: sectionRange.end };
}

/** Extract a section's body text, or null when the heading is absent. */
export function getMarkdownSectionBody(
  markdown: string,
  sectionName: string,
): string | null {
  const range = findMarkdownSectionBodyRange(markdown, sectionName);
  if (!range) return null;
  return markdown.slice(range.start, range.end);
}

/**
 * Replace one section's body, or append the section (behind a `---`
 * divider) when the heading is absent. Section bodies conventionally
 * start and end with `\n`.
 */
export function replaceMarkdownSection(
  markdown: string,
  sectionName: string,
  body: string,
): string {
  const sectionRange = findMarkdownSectionBodyRange(markdown, sectionName);
  if (sectionRange) {
    return (
      markdown.slice(0, sectionRange.start) +
      body +
      markdown.slice(sectionRange.end)
    );
  }

  const suffix = markdown.endsWith("\n") ? "" : "\n";
  return `${markdown}${suffix}\n---\n\n## ${sectionName}${body}`;
}

/**
 * Remove a section (heading + body), swallowing the `---` divider that
 * immediately precedes it. Returns the input unchanged when absent.
 */
export function removeMarkdownSection(
  markdown: string,
  sectionName: string,
): string {
  const sectionRange = findMarkdownSectionRange(markdown, sectionName);
  if (!sectionRange) return markdown;

  let start = sectionRange.headingStart;
  const before = markdown.slice(0, start);
  const leadingDivider = before.match(/(?:^|\n)---[ \t]*(?:\r?\n){1,2}$/);
  if (leadingDivider) {
    start =
      before.length -
      leadingDivider[0].length +
      (leadingDivider[0].startsWith("\n") ? 1 : 0);
  }

  return markdown.slice(0, start) + markdown.slice(sectionRange.end);
}

// ---------------------------------------------------------------------------
// Managed-section recomposition (generalized replaceDerivedAgentsMdSections)
// ---------------------------------------------------------------------------

export interface ReplaceManagedSectionsOptions {
  /** Canonical order in which absent managed headings are appended. */
  order: readonly string[];
  /** Legacy sections stripped before recomposition (e.g. retired headings). */
  removeSections?: readonly string[];
}

/**
 * Recompute a governance file's managed-section bodies while preserving
 * every byte of surrounding operator prose. Present headings are replaced
 * in place; absent headings are appended in canonical `order` behind `---`
 * dividers. Idempotent for identical section bodies.
 */
export function replaceManagedSections(
  markdown: string,
  sections: Readonly<Record<string, string>>,
  options: ReplaceManagedSectionsOptions,
): string {
  let rendered = markdown;
  for (const sectionName of options.removeSections ?? []) {
    rendered = removeMarkdownSection(rendered, sectionName);
  }

  for (const sectionName of options.order) {
    const sectionRange = findMarkdownSectionBodyRange(rendered, sectionName);
    if (!sectionRange) continue;
    rendered =
      rendered.slice(0, sectionRange.start) +
      (sections[sectionName] ?? "") +
      rendered.slice(sectionRange.end);
  }

  for (const sectionName of options.order) {
    if (findMarkdownSectionBodyRange(rendered, sectionName)) continue;
    const suffix = rendered.endsWith("\n") ? "" : "\n";
    rendered = `${rendered}${suffix}---\n\n## ${sectionName}\n${sections[sectionName] ?? ""}`;
  }

  return rendered;
}

// ---------------------------------------------------------------------------
// CONTEXT.md Routing section — computed rows (INERT in U4 per KTD-9)
// ---------------------------------------------------------------------------

/** One skill in the effective capability set feeding the Routing section. */
export interface ContextRoutingSkillEntry {
  slug: string;
  /**
   * Workspace-relative skill folder (`skills/<slug>/`). Defaults from the
   * slug; plugin-namespaced folders (`skills/<key>--<slug>/`) pass the
   * materialized folder explicitly.
   */
  skillFolderPath?: string;
  /**
   * Assignment state (`.assignment.json` semantics: absent = enabled).
   * A disabled skill carries no routing row — inactive skills are omitted,
   * matching capability-inspector gate-state semantics.
   */
  enabled?: boolean;
  /**
   * Effective-capability gate state for the perspective-INDEPENDENT gates
   * the runtime applies to the loaded skill set — chiefly the skill trust
   * gate (`skill-trust/runtime-gate.ts`) and any future composer-side eval
   * gate. Absent = active. A skill that is NOT active carries no routing
   * row: the runtime refuses to load trust-gated catalog skills, so a
   * routing row for one would instruct the model to use a skill the
   * platform never loads (the honesty gap Composer U4/U5 exists to close).
   * Callers MUST derive this from the same predicate the runtime/inspector
   * use (`loadTrustedCatalogSkillIds`) — never a re-implemented rule — so
   * routing rows can never diverge from the effective loaded set. The
   * per-requester plugin activation gate stays separate (`pluginGate`,
   * perspective-DEPENDENT per KTD-8).
   */
  active?: boolean;
  /** Optional short description rendered into the row for routing context. */
  description?: string | null;
}

export interface ContextRoutingRow {
  slug: string;
  skillFolderPath: string;
  description: string | null;
}

function skillFolderPathFor(entry: ContextRoutingSkillEntry): string {
  const folder = entry.skillFolderPath ?? `skills/${entry.slug}/`;
  return folder.endsWith("/") ? folder : `${folder}/`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Compute the per-requester Routing rows from the effective capability
 * set. A row is emitted only for a skill that is ACTIVE in that set:
 *   - assignment-enabled (`entry.enabled !== false`);
 *   - active under the perspective-INDEPENDENT effective-capability gates
 *     (`entry.active !== false` — the trust/eval gate the runtime applies
 *     via `loadTrustedCatalogSkillIds`, supplied by the caller so this
 *     function never re-implements gate rules);
 *   - not excluded by the perspective-DEPENDENT plugin activation gate.
 * Perspective-dependent (KTD-8): the plugin activation gate is applied per
 * requester with the same fail-closed semantics as the legacy snippet-line
 * filter — an excluded plugin skill contributes NO row. Callers pass the
 * gate produced by `resolvePluginGate`, which fails closed (never open) on
 * any resolution error or unresolvable requester. Attach/detach reflects
 * immediately: rows are derived from the skill entries present in the
 * workspace at composition time.
 */
export function computeContextRoutingRows(input: {
  skills: readonly ContextRoutingSkillEntry[];
  pluginGate?: PluginActivationGate;
}): ContextRoutingRow[] {
  const gate = input.pluginGate ?? EMPTY_PLUGIN_GATE;
  return input.skills
    .filter((entry) => entry.enabled !== false && entry.active !== false)
    .map((entry) => ({
      slug: entry.slug,
      skillFolderPath: skillFolderPathFor(entry),
      description: entry.description?.trim()
        ? collapseWhitespace(entry.description)
        : null,
    }))
    .filter(
      (row) => !pluginGateExcludesWorkspacePath(gate, row.skillFolderPath),
    )
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

/**
 * Render the CONTEXT.md `## Routing` section body from computed rows.
 * Row shape deliberately mirrors the legacy install-time WIRING.md
 * snippet line ("… read skills/<slug>/SKILL.md and follow it") so U5's
 * cutover swaps the producer without retraining agent behavior.
 */
export function renderContextRoutingSectionBody(
  rows: readonly ContextRoutingRow[],
): string {
  const lines: string[] = [""];
  lines.push(
    "Generated from the attached capability set — do not edit; recomposed on every change.",
  );
  lines.push("");
  if (rows.length === 0) {
    lines.push("No skills attached.");
  } else {
    for (const row of rows) {
      const clause = row.description ? ` (${row.description})` : "";
      lines.push(
        `- For tasks covered by the \`${row.slug}\` skill${clause}, read ${row.skillFolderPath}SKILL.md and follow it.`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export interface ComposeContextMdManagedSectionsInput {
  /**
   * Agent-source CONTEXT.md. Null/undefined/blank is tolerated — legacy
   * agents may lack a root CONTEXT.md — and seeds a minimal document.
   */
  baseline?: string | null;
  skills: readonly ContextRoutingSkillEntry[];
  pluginGate?: PluginActivationGate;
  /** H1 title used when seeding an absent or blank baseline. */
  seedTitle?: string;
}

/**
 * Compose CONTEXT.md with its computed `## Routing` managed section.
 * Operator prose outside the Routing section survives byte-for-byte; an
 * absent heading is appended in canonical order.
 */
export function composeContextMdManagedSections(
  input: ComposeContextMdManagedSectionsInput,
): string {
  const baseline = input.baseline?.trim()
    ? input.baseline
    : `# ${input.seedTitle ?? "Context"}\n`;
  const rows = computeContextRoutingRows({
    skills: input.skills,
    pluginGate: input.pluginGate,
  });
  return replaceManagedSections(
    baseline,
    { Routing: renderContextRoutingSectionBody(rows) },
    { order: CONTEXT_MD_MANAGED_SECTION_ORDER },
  );
}

// ---------------------------------------------------------------------------
// Render-path CONTEXT.md seam (live)
// ---------------------------------------------------------------------------

/**
 * The render path's generated-CONTEXT.md producer (`compose-tuple.ts`).
 * ACTIVE since U5 (KTD-9): composes the source CONTEXT.md with the
 * per-requester computed `## Routing` section. The legacy install-snippet
 * line filter (`filterContextRoutingEntries`) is retired — with install-
 * time snippet appends gone there are no snippet lines to filter, and
 * these computed rows are the only plugin-gate enforcement for CONTEXT.md
 * routing (fail-closed via `computeContextRoutingRows`).
 */
export function composeGeneratedContextMd(
  input: ComposeContextMdManagedSectionsInput,
): string {
  return composeContextMdManagedSections(input);
}
