/**
 * Shared document-plate surface for Pi extensions (plates provenance
 * 2026-07): the dispatch-payload `document_plates` normalizer + types used by
 * BOTH the emit_document tool (document-composer.ts) and the turn-start
 * system-prompt plate-contract block (system-prompt-compose.ts), plus the
 * light tw:sources claims parser the runtime ledger cross-check consumes.
 *
 * Deliberately dependency-free of packages/api — the server-side compositor
 * owns the authoritative tw:sources grammar; the parser here only needs to
 * extract claimed tool names from digest markdown.
 */

/** One registered plate on the tenant's emit_document tool surface (R10). */
export interface DocumentPlateSummary {
  slug: string;
  displayName: string;
  useFor: string;
  /** Plate-wide operator authoring instructions — shown pre-emission. */
  authoringInstructions?: string;
  /**
   * THINK-183 KTD8: enforced content contract, when the plate declares one.
   * Sections are required (or required-if-material — waive with tw:waiver
   * when the data is genuinely unavailable); analyses name plate-declared
   * server-computed calculations authored via tw:analysis blocks.
   */
  sections?: Array<{
    id: string;
    title: string;
    tier: "required" | "required-if-material";
    /** Operator-authored section instructions — shown pre-emission. */
    guidance?: string;
    /** Plate-suggested visualizations for this section. */
    suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
  }>;
  analyses?: Array<{
    key: string;
    op: string;
    inputHint: string;
    /** Operator-authored analysis instructions — shown pre-emission. */
    guidance?: string;
  }>;
}

/**
 * Fallback surface when the dispatch payload carries no `document_plates`
 * field (older server or lagging customer stack). Server-side registry
 * validation remains the authority either way (KTD4).
 */
export const FALLBACK_PLATES: readonly DocumentPlateSummary[] = [
  {
    slug: "report",
    displayName: "Report",
    useFor:
      "General findings and analysis presented as a narrative with evidence.",
  },
  {
    slug: "plan",
    displayName: "Plan",
    useFor: "A course of action: phases, workstreams, owners, and sequencing.",
  },
  {
    slug: "brief",
    displayName: "Decision Brief",
    useFor: "A decision brief: options, tradeoffs, and a recommendation.",
  },
  {
    slug: "ideation",
    displayName: "Ideation",
    useFor: "Exploratory thinking: directions, concepts, and open questions.",
  },
];

export const PLATE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Normalize the payload's `document_plates` field. A missing or malformed
 * field (wrong shape, junk entries only) is treated as ABSENT — the caller
 * falls back to the core four and logs a structured event — never a throw.
 */
/** THINK-183 KTD8: carry a plate's contract sections; junk degrades to absent. */
function normalizePlateSections(
  raw: unknown,
): DocumentPlateSummary["sections"] {
  if (!Array.isArray(raw)) return undefined;
  const sections: NonNullable<DocumentPlateSummary["sections"]> = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const tier = rec.tier;
    if (
      !PLATE_SLUG_RE.test(id) ||
      !title ||
      (tier !== "required" && tier !== "required-if-material")
    ) {
      continue;
    }
    const guidance =
      typeof rec.guidance === "string" ? rec.guidance.trim() : "";
    const suggestedDirectives = Array.isArray(rec.suggestedDirectives)
      ? rec.suggestedDirectives.flatMap((d) => {
          if (d === null || typeof d !== "object" || Array.isArray(d)) {
            return [];
          }
          const dr = d as Record<string, unknown>;
          const kind = typeof dr.kind === "string" ? dr.kind.trim() : "";
          if (!kind) return [];
          const chartType =
            typeof dr.chartType === "string" ? dr.chartType.trim() : "";
          return [{ kind, ...(chartType ? { chartType } : {}) }];
        })
      : [];
    sections.push({
      id,
      title,
      tier,
      ...(guidance ? { guidance } : {}),
      ...(suggestedDirectives.length > 0 ? { suggestedDirectives } : {}),
    });
  }
  return sections.length > 0 ? sections : undefined;
}

/** THINK-183 KTD8: carry a plate's declared analyses; junk degrades to absent. */
function normalizePlateAnalyses(
  raw: unknown,
): DocumentPlateSummary["analyses"] {
  if (!Array.isArray(raw)) return undefined;
  const analyses: NonNullable<DocumentPlateSummary["analyses"]> = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    const op = typeof rec.op === "string" ? rec.op.trim() : "";
    if (!PLATE_SLUG_RE.test(key) || !op) continue;
    const guidance =
      typeof rec.guidance === "string" ? rec.guidance.trim() : "";
    analyses.push({
      key,
      op,
      inputHint: typeof rec.inputHint === "string" ? rec.inputHint.trim() : "",
      ...(guidance ? { guidance } : {}),
    });
  }
  return analyses.length > 0 ? analyses : undefined;
}

export function normalizeDocumentPlates(
  raw: unknown,
): DocumentPlateSummary[] | null {
  if (!Array.isArray(raw)) return null;
  const plates: DocumentPlateSummary[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const slug = typeof rec.slug === "string" ? rec.slug.trim() : "";
    if (!PLATE_SLUG_RE.test(slug)) continue;
    const sections = normalizePlateSections(rec.sections);
    const analyses = normalizePlateAnalyses(rec.analyses);
    const authoringInstructions =
      typeof rec.authoringInstructions === "string"
        ? rec.authoringInstructions.trim()
        : "";
    plates.push({
      slug,
      displayName:
        typeof rec.displayName === "string" && rec.displayName.trim()
          ? rec.displayName.trim()
          : slug,
      useFor: typeof rec.useFor === "string" ? rec.useFor.trim() : "",
      ...(authoringInstructions ? { authoringInstructions } : {}),
      ...(sections ? { sections } : {}),
      ...(analyses ? { analyses } : {}),
    });
  }
  return plates.length > 0 ? plates : null;
}

// ---------------------------------------------------------------------------
// tw:sources claims parsing — the runtime ledger cross-check's input.
// ---------------------------------------------------------------------------

/** One tw:sources fence's claims as the runtime cross-check consumes them. */
export interface SourcesClaim {
  /** The fence's `section:` value, when parseable (unvalidated here). */
  sectionId: string | null;
  /** Tool names cited by `- tool:` lines. `- none:` lines never appear. */
  tools: string[];
}

const SOURCES_TOOL_LINE = /^-\s*tool:\s*([^\s—:]+)/;
const SOURCES_SECTION_LINE = /^section:\s*(\S+)\s*$/;

/**
 * Extract tw:sources claims from digest markdown. Light by design: the
 * server-side compositor owns full grammar validation; this parser only
 * needs the claimed tool names, and tolerates both the canonical
 * ` ```tw:sources ` fence and the untyped-fence variant where `tw:sources`
 * is the first body line (mirroring the compositor's fence leniency).
 */
export function parseSourcesClaims(markdown: string): SourcesClaim[] {
  const claims: SourcesClaim[] = [];
  const fenceRe = /^ {0,3}```([^\n]*)\n([\s\S]*?)^ {0,3}```[ \t]*$/gm;
  for (const match of markdown.matchAll(fenceRe)) {
    const info = match[1].trim().toLowerCase();
    let body = match[2];
    if (info !== "tw:sources") {
      if (info !== "") continue;
      const marker = /^tw:sources[ \t]*(?:\r?\n|$)/i.exec(body);
      if (!marker) continue;
      body = body.slice(marker[0].length);
    }
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const sectionId = lines[0] ? SOURCES_SECTION_LINE.exec(lines[0]) : null;
    const tools: string[] = [];
    for (const line of lines) {
      const tool = SOURCES_TOOL_LINE.exec(line);
      if (tool) tools.push(tool[1]);
    }
    claims.push({ sectionId: sectionId ? sectionId[1] : null, tools });
  }
  return claims;
}

/** Canonical form for lenient tool-name comparison: lowercase, separators
 * collapsed to `_` — MCP namespacing (`mcp_twenty--crm_execute_tool` vs a
 * claimed `twenty--crm.execute_tool`) differs only in separators/prefixes. */
function canonicalToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Lenient claim-vs-invocation match: equal canonical forms, or one is a
 * separator-boundary-aligned prefix/suffix of the other (namespaced MCP tool
 * names may carry `mcp_<server>_` prefixes the model omits, or vice versa).
 */
export function toolNamesMatch(claimed: string, invoked: string): boolean {
  const c = canonicalToolName(claimed);
  const i = canonicalToolName(invoked);
  if (!c || !i) return false;
  return (
    c === i ||
    i.endsWith(`_${c}`) ||
    c.endsWith(`_${i}`) ||
    i.startsWith(`${c}_`) ||
    c.startsWith(`${i}_`)
  );
}
