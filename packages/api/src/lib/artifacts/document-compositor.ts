/**
 * Document Compositor v2 (THINK-154): deterministic server-side compiler from
 * agent-authored markdown (frontmatter + prose + `tw:` directive blocks) to
 * the self-contained house-style HTML render.
 *
 * Enforcement-over-nudge, by construction (R1/KTD4):
 *
 * - Raw HTML in the markdown is DROPPED at the Marked layer (the `html` token
 *   renders to nothing) and anything that slips through is stripped by a
 *   sanitize-html allowlist that permits zero SVG and zero script vectors —
 *   two independent walls between model-authored bytes and the render.
 * - Directive components that carry SVG never pass through the sanitizer:
 *   they compile to opaque, content-hash-derived placeholder tokens, and the
 *   compiler substitutes the house renderer's SVG into those tokens AFTER the
 *   sanitize pass (KTD4 inject-after-sanitize). The only SVG that can appear
 *   in a render is renderer-produced.
 * - External URLs (links, images) are converted to inert text at parse time —
 *   DocSpector's EXTERNAL_REF check is default-deny and documents must be
 *   fully self-contained, so an external href would be rejected downstream
 *   anyway; the compiler degrades it legibly instead.
 *
 * Pure and deterministic: identical input compiles to byte-identical output
 * (R4). No clock reads, no randomness — placeholder tokens derive from a
 * content hash of the input.
 */

import { createHash } from "node:crypto";
import { Marked, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { parse as parseYaml } from "yaml";
import {
  renderAnalysisDirective,
  renderDocumentDirective,
  renderWaiverDirective,
  type CollectedWaiver,
} from "./document-directives.js";
import { renderDocumentShell } from "./document-templates.js";

export type { CollectedWaiver } from "./document-directives.js";

/** Mirrors the DocSpector diagnostic shape so rejects surface in-turn (R2). */
export interface CompositorDiagnostic {
  code: string;
  /** Model-actionable: names the problem, the fix, and a corrected example. */
  message: string;
  location: string;
}

export type CompositorResult =
  | {
      ok: true;
      renderHtml: string;
      warnings: CompositorDiagnostic[];
      /** Suitability waivers collected from tw:waiver blocks (THINK-183). */
      waivers: CollectedWaiver[];
    }
  | { ok: false; diagnostics: CompositorDiagnostic[] };

/**
 * Directive engine seam (U2 provides the real registry): compiles one
 * `tw:<kind>` fenced block into house-component HTML. Output with
 * `containsSvg: true` rides the placeholder path and is injected after the
 * sanitize pass; all other output must be sanitizer-allowlist-compatible
 * plate-class HTML.
 */
export type DirectiveRender =
  | { ok: true; html: string; containsSvg: boolean }
  | { ok: false; diagnostics: CompositorDiagnostic[] };

export type DirectiveEngine = (input: {
  kind: string;
  body: string;
  genre: string;
}) => DirectiveRender;

/**
 * The plate configuration the compiler consumes (THINK-153 KTD3). Structurally
 * satisfied by the registry's ResolvedPlate; the compositor stays decoupled
 * from resolution.
 */
/** Manifest section as the compiler consumes it (THINK-183). */
export interface CompositorPlateSection {
  id: string;
  title: string;
  tier: "required" | "required-if-material" | "suggested";
  guidance: string;
  suggestedDirectives?: readonly { kind: string; chartType?: string }[];
}

/** Declared analysis as the compiler consumes it (THINK-183). */
export interface CompositorPlateAnalysis {
  key: string;
  op: string;
  params?: Readonly<Record<string, unknown>>;
  presentation: { directive: string; chartType?: string };
}

export interface CompositorPlate {
  slug: string;
  eyebrow: string;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  /** Directive kinds documents in this plate may use; "all" = unrestricted. */
  allowedDirectives: readonly string[] | "all";
  /** Content contract: tiered section manifest (THINK-183; absent = none). */
  sections?: readonly CompositorPlateSection[];
  /** Content contract: declared analyses (THINK-183; absent = none). */
  analyses?: readonly CompositorPlateAnalysis[];
}

/** Fence info-string prefix that routes a fenced block to the engine. */
export const DIRECTIVE_FENCE_PREFIX = "tw:";

/** Frontmatter keys the compiler defines (KTD7). Everything else is dropped. */
const FRONTMATTER_KEYS = ["eyebrow", "date", "context"] as const;
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[number];
type Frontmatter = Partial<Record<FrontmatterKey, string>>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Split optional leading YAML frontmatter from the body. Malformed or
 * non-object frontmatter is warned-and-dropped, never a hard reject (KTD7 —
 * a stray hint never threatens render integrity).
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Drop a leading YAML frontmatter block, if any. For digest CONSUMERS
 * (mobile rendering, email/PDF delivery) that display the markdown directly:
 * frontmatter is a compiler input, not reader-facing content, and markdown
 * renderers garble it (hr + setext heading).
 */
export function stripLeadingFrontmatter(markdown: string): string {
  const match = FRONTMATTER_RE.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

function parseFrontmatter(markdown: string): {
  frontmatter: Frontmatter;
  body: string;
  warnings: CompositorDiagnostic[];
} {
  const warnings: CompositorDiagnostic[] = [];
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown, warnings };

  const body = markdown.slice(match[0].length);
  let raw: unknown;
  try {
    raw = parseYaml(match[1]);
  } catch (err) {
    warnings.push({
      code: "FRONTMATTER_INVALID",
      message: `Frontmatter failed to parse as YAML and was ignored (${err instanceof Error ? err.message.split("\n")[0] : "parse error"}). Supported keys: ${FRONTMATTER_KEYS.join(", ")}.`,
      location: "frontmatter",
    });
    return { frontmatter: {}, body, warnings };
  }
  if (raw === null || raw === undefined) {
    return { frontmatter: {}, body, warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push({
      code: "FRONTMATTER_INVALID",
      message: `Frontmatter must be a YAML mapping; got ${Array.isArray(raw) ? "a list" : typeof raw}. It was ignored. Supported keys: ${FRONTMATTER_KEYS.join(", ")}.`,
      location: "frontmatter",
    });
    return { frontmatter: {}, body, warnings };
  }

  const frontmatter: Frontmatter = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      warnings.push({
        code: "FRONTMATTER_UNKNOWN_KEY",
        message: `Frontmatter key "${key}" is not supported and was dropped. Supported keys: ${FRONTMATTER_KEYS.join(", ")}.`,
        location: "frontmatter",
      });
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      warnings.push({
        code: "FRONTMATTER_UNKNOWN_KEY",
        message: `Frontmatter key "${key}" must be a string; it was dropped.`,
        location: "frontmatter",
      });
      continue;
    }
    frontmatter[key as FrontmatterKey] = String(value);
  }
  return { frontmatter, body, warnings };
}

/**
 * The undeduped heading-slug transform. Exported so plate save gates can
 * verify a manifest section's `title` slugs to its `id` (THINK-183 KTD6) —
 * one transform, no drift between save-time validation and compile-time
 * presence checking.
 */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/&[a-z#0-9]+;/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "section"
  );
}

/** Deterministic ASCII slug for heading ids, deduped per document. */
function makeSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = headingSlug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/** True for URL values that keep the document self-contained (DocSpector). */
function isInertHref(href: string): boolean {
  const v = href.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("mailto:");
}

function isDataUri(href: string): boolean {
  return href.trim().toLowerCase().startsWith("data:");
}

interface CompileState {
  genre: string;
  engine: DirectiveEngine;
  errors: CompositorDiagnostic[];
  warnings: CompositorDiagnostic[];
  /** placeholder token → post-sanitize substitution HTML (KTD4). */
  placeholders: Map<string, string>;
  tokenFor: (index: number) => string;
  nextPlaceholder: number;
  slug: (text: string) => string;
  /** Emitted heading ids, for the section-manifest check (THINK-183 KTD6). */
  headingIds: string[];
  /** Waivers collected from tw:waiver blocks (THINK-183 KTD3). */
  waivers: CollectedWaiver[];
}

function buildMarked(state: CompileState): Marked {
  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        // The shell owns the single H1; body headings start at h2.
        const level = Math.min(6, Math.max(2, depth === 1 ? 2 : depth));
        const id = state.slug(text);
        state.headingIds.push(id);
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const info = (lang ?? "").trim();
        if (info.toLowerCase().startsWith(DIRECTIVE_FENCE_PREFIX)) {
          const kind = info.slice(DIRECTIVE_FENCE_PREFIX.length).trim();
          const result = state.engine({ kind, body: text, genre: state.genre });
          if (!result.ok) {
            state.errors.push(...result.diagnostics);
            return "";
          }
          if (!result.containsSvg) return `${result.html}\n`;
          // SVG-bearing components never pass the sanitizer: emit an opaque
          // token and substitute the renderer output after the sanitize pass.
          const token = state.tokenFor(state.nextPlaceholder++);
          state.placeholders.set(token, result.html);
          return `<div class="tw-directive-slot">${token}</div>\n`;
        }
        return `<pre><code>${escapeHtml(text)}</code></pre>\n`;
      },
      html({ text }: Tokens.HTML | Tokens.Tag) {
        // Model-authored HTML never reaches the render (R1). Dropped, with a
        // non-blocking warning so the model learns; sanitize-html is the
        // second wall for anything marked misses.
        const tag = /<\s*([a-z][\w-]*)/i.exec(text)?.[1] ?? "inline HTML";
        state.warnings.push({
          code: "RAW_HTML_STRIPPED",
          message: `Raw HTML (<${tag}>) is not allowed in document markdown and was removed. Express structure with markdown or a tw: directive block.`,
          location: `<${tag}>`,
        });
        return "";
      },
      link({ href, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        if (isInertHref(href))
          return `<a href="${escapeHtml(href)}">${inner}</a>`;
        // Documents are fully self-contained — external hrefs are rejected by
        // DocSpector, so degrade to text and keep the URL visible.
        const plain = inner.replace(/<[^>]*>/g, "");
        return plain === href
          ? `<code>${escapeHtml(href)}</code>`
          : `${inner} (<code>${escapeHtml(href)}</code>)`;
      },
      image({ href, text }: Tokens.Image) {
        if (isDataUri(href)) {
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}">`;
        }
        state.warnings.push({
          code: "EXTERNAL_IMAGE_STRIPPED",
          message: `Image "${escapeHtml(text || href)}" references an external URL; documents must be self-contained, so it was replaced with its alt text. Inline the image as a data: URI if it is essential.`,
          location: text || href,
        });
        return escapeHtml(text);
      },
      table(token: Tokens.Table) {
        let html = '<table class="data"><thead><tr>';
        for (const cell of token.header) {
          const align = cell.align ? ` align="${cell.align}"` : "";
          html += `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
        }
        html += "</tr></thead><tbody>";
        for (const row of token.rows) {
          html += "<tr>";
          for (const cell of row) {
            const align = cell.align ? ` align="${cell.align}"` : "";
            html += `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
          }
          html += "</tr>";
        }
        return `${html}</tbody></table>\n`;
      },
    },
  });
  return instance;
}

/**
 * sanitize-html allowlist — the "no model-authored HTML" enforcement wall.
 * Zero SVG tags (KTD4), zero script vectors, plate vocabulary only. Directive
 * SVG is injected AFTER this pass via placeholder substitution.
 */
const SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "br",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
    "span",
    "article",
    "figure",
    "figcaption",
    "details",
    "summary",
    "dl",
    "dt",
    "dd",
  ],
  allowedAttributes: {
    "*": ["class", "id"],
    a: ["href"],
    img: ["src", "alt"],
    th: ["align"],
    td: ["align"],
    ol: ["start"],
    details: ["open"],
  },
  allowedSchemes: ["data", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
};

export interface CompileDocumentInput {
  plate: CompositorPlate;
  title: string;
  abstract: string;
  markdownBody: string;
}

/**
 * Gate the directive engine on the plate's allowed set (KTD8): the plate's
 * config selects which directives its documents may use, riding the existing
 * DIRECTIVE_GENRE_RESTRICTED rejection shape the engine already emits for
 * spec-level restrictions.
 */
function gateEngineOnPlate(
  engine: DirectiveEngine,
  plate: CompositorPlate,
): DirectiveEngine {
  if (plate.allowedDirectives === "all") return engine;
  const allowed = plate.allowedDirectives;
  const vocabulary = allowed.map((k) => `tw:${k}`).join(", ") || "(none)";
  return (input) => {
    if (!allowed.includes(input.kind)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "DIRECTIVE_GENRE_RESTRICTED",
            message: `Directive "tw:${input.kind}" is not available for the "${plate.slug}" genre. Directives available for "${plate.slug}": ${vocabulary}.`,
            location: `tw:${input.kind}`,
          },
        ],
      };
    }
    return engine(input);
  };
}

/**
 * Compile agent-authored markdown into the house-style render (R4). Pure and
 * deterministic; rejects (ok: false) are model-actionable in-turn diagnostics.
 */
export function compileDocument(
  input: CompileDocumentInput,
  engine: DirectiveEngine = renderDocumentDirective,
): CompositorResult {
  const { frontmatter, body, warnings } = parseFrontmatter(input.markdownBody);

  // Placeholder tokens derive from a hash of the full input: deterministic,
  // and a body cannot contain its own token without a hash preimage.
  const inputHash = createHash("sha256")
    .update(`${input.plate.slug}\n${input.title}\n${input.markdownBody}`)
    .digest("hex");

  // Structural contract directives (THINK-183 KTD11): tw:analysis (and
  // tw:waiver, U4) route BEFORE the plate's allowedDirectives gate — their
  // own validation (declared-analysis lookup, manifest membership) is the
  // real gate, so a plate with a restricted directive list can still carry
  // its contract.
  const gated = gateEngineOnPlate(engine, input.plate);
  const engineWithStructural: DirectiveEngine = (directiveInput) => {
    if (directiveInput.kind === "analysis") {
      return renderAnalysisDirective({
        body: directiveInput.body,
        analyses: input.plate.analyses,
      });
    }
    if (directiveInput.kind === "waiver") {
      const result = renderWaiverDirective({
        body: directiveInput.body,
        sections: input.plate.sections,
      });
      if (!result.ok) return result;
      state.waivers.push(result.waiver);
      return { ok: true, html: result.html, containsSvg: false };
    }
    return gated(directiveInput);
  };

  const state: CompileState = {
    genre: input.plate.slug,
    engine: engineWithStructural,
    errors: [],
    warnings,
    placeholders: new Map(),
    tokenFor: (index) => `tw-directive-slot-${inputHash.slice(0, 24)}-${index}`,
    nextPlaceholder: 0,
    slug: makeSlugger(),
    headingIds: [],
    waivers: [],
  };

  const marked = buildMarked(state);
  const rawBody = marked.parse(body, { async: false }) as string;

  // Post-parse contract check (THINK-183 KTD1/KTD6): every required or
  // required-if-material manifest section must be present as a heading id or
  // explicitly waived. Diagnostics append to the same array directive
  // rejections use, so enforcement rides the COMPILE_REJECTED self-repair
  // path. No manifest → no new code paths execute (AE4).
  const manifest = input.plate.sections ?? [];
  if (manifest.length > 0) {
    const headingIds = new Set(state.headingIds);
    for (const waiver of state.waivers) {
      if (headingIds.has(waiver.sectionId)) {
        state.errors.push({
          code: "SECTION_WAIVER_CONFLICT",
          message: `The document waives section "${waiver.sectionId}" but also contains that heading. Remove the tw:waiver block (the section is present) or remove the section (the waiver stands).`,
          location: `tw:waiver`,
        });
      }
    }
    const waivedIds = new Set(state.waivers.map((w) => w.sectionId));
    for (const section of manifest) {
      if (section.tier === "suggested") continue; // R11: never checked.
      if (headingIds.has(section.id) || waivedIds.has(section.id)) continue;
      const suggested = (section.suggestedDirectives ?? [])
        .map((d) =>
          d.chartType ? `tw:${d.kind} (${d.chartType})` : `tw:${d.kind}`,
        )
        .join(", ");
      const waiverPath =
        section.tier === "required-if-material"
          ? `If the data to back it is genuinely unavailable, waiving is the expected path: add a \`\`\`tw:waiver\`\`\` block with \`section: ${section.id}\` and a reason.`
          : `If the data to back it is genuinely unavailable, add a \`\`\`tw:waiver\`\`\` block with \`section: ${section.id}\` and a reason instead.`;
      state.errors.push({
        code: "REQUIRED_SECTION_MISSING",
        message: `This plate requires a "${section.title}" section and the document has neither the heading nor a waiver. Author a "## ${section.title}" heading (its id compiles to "${section.id}"). Guidance: ${section.guidance}${suggested ? ` Suggested directives: ${suggested}.` : ""} ${waiverPath}`,
        location: `section:${section.id}`,
      });
    }
  }

  if (state.errors.length > 0) {
    return { ok: false, diagnostics: state.errors };
  }

  const sanitizedBody = sanitizeHtml(rawBody, SANITIZE_CONFIG);

  // KTD4: inject renderer SVG after the sanitize pass. Tokens are unique,
  // hash-derived strings; each substitutes exactly once.
  let finalBody = sanitizedBody;
  for (const [token, html] of state.placeholders) {
    finalBody = finalBody.replace(token, () => html);
  }

  const eyebrow = frontmatter.eyebrow ?? input.plate.eyebrow;
  const metaParts: string[] = [];
  if (frontmatter.date) {
    metaParts.push(`<strong>date</strong> ${escapeHtml(frontmatter.date)}`);
  }
  if (frontmatter.context) {
    metaParts.push(escapeHtml(frontmatter.context));
  }
  const abstract = input.abstract.trim();
  const metaLineHtml =
    [
      metaParts.length > 0
        ? `<p class="meta">${metaParts.join(" &nbsp;·&nbsp; ")}</p>`
        : null,
      abstract ? `<p class="meta">${escapeHtml(abstract)}</p>` : null,
    ]
      .filter(Boolean)
      .join("\n") || null;

  // Provenance footer (THINK-183 R9): waived sections are named with their
  // reasons — loud omission, recorded where every reader sees it.
  const waiverFooterLines = state.waivers
    .map(
      (w) =>
        `<div class="waived">Section waived: ${escapeHtml(w.title)} — ${escapeHtml(w.reason)}</div>`,
    )
    .join("");
  const footerHtml = `<footer class="composition-signal">Composed by the ThinkWork document compositor · ${escapeHtml(input.plate.slug)}${frontmatter.date ? ` · ${escapeHtml(frontmatter.date)}` : ""}${waiverFooterLines}</footer>`;

  const renderHtml = renderDocumentShell({
    plateSlug: input.plate.slug,
    title: input.title,
    eyebrow,
    metaLineHtml,
    bodyHtml: finalBody.trim(),
    footerHtml,
    tokensLight: input.plate.tokensLight,
    tokensDark: input.plate.tokensDark,
  });

  return {
    ok: true,
    renderHtml,
    warnings: state.warnings,
    waivers: state.waivers,
  };
}
