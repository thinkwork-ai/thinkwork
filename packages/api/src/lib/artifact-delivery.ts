/**
 * Artifact delivery utilities.
 *
 * Renders markdown artifacts to various delivery formats:
 * - HTML email (via SES) — uses the channel-rendering renderer for
 *   email-safe inline-styled HTML and a raw-markdown plaintext fallback.
 * - SMS summary (plain text truncation).
 * - PDF-ready HTML (full document with print styles).
 */

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { parse as parseYaml } from "yaml";
import { renderForEmail } from "./channel-rendering/index.js";
import { stripLeadingFrontmatter } from "./artifacts/document-compositor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtifactPayload {
  id: string;
  title: string;
  type: string;
  status: string;
  content: string;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EmailDeliveryResult {
  subject: string;
  htmlBody: string;
  textBody: string;
}

export interface SmsDeliveryResult {
  body: string;
}

// ---------------------------------------------------------------------------
// Type display labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  data_view: "Data View",
  note: "Note",
  report: "Report",
  plan: "Plan",
  draft: "Draft",
  digest: "Digest",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

// ---------------------------------------------------------------------------
// Plate directives in email (THINK-227 follow-up)
//
// Document markdown carries `tw:*` fenced directives (stats, verdict-grid,
// chart, timeline, …) that the Document Compositor renders as plate
// components on the web/share surface. The email renderer knows nothing
// about them, so they used to leak as literal YAML code blocks. Split them
// out and render email-safe (inline-styled, table-based) equivalents; a
// directive we can't render degrades to a "view the live report" note —
// raw YAML must never reach a recipient.
// ---------------------------------------------------------------------------

type EmailSegment =
  | { type: "md"; text: string }
  | { type: "directive"; kind: string; body: string };

function splitDirectiveFences(markdown: string): EmailSegment[] {
  const lines = markdown.split("\n");
  const segments: EmailSegment[] = [];
  let mdBuf: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^```tw:([a-z][a-z0-9-]*)\s*$/.exec(lines[i]);
    if (!open) {
      mdBuf.push(lines[i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    const body: string[] = [];
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    if (j >= lines.length) {
      // Unclosed fence — leave it to the markdown renderer as-is.
      mdBuf.push(lines[i]);
      i += 1;
      continue;
    }
    if (mdBuf.length > 0) {
      segments.push({ type: "md", text: mdBuf.join("\n") });
      mdBuf = [];
    }
    segments.push({ type: "directive", kind: open[1], body: body.join("\n") });
    i = j + 1;
  }
  if (mdBuf.length > 0) segments.push({ type: "md", text: mdBuf.join("\n") });
  return segments;
}

function yamlRecord(body: string): Record<string, unknown> | null {
  try {
    const data: unknown = parseYaml(body);
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const DIRECTIVE_FALLBACK_HTML =
  '<p style="margin:12px 0;padding:10px 14px;background:#f5f5f5;border-radius:6px;font-size:13px;color:#6b7280">This section contains an interactive component — open the live report to view it.</p>';

/**
 * The directive kinds `renderDirectiveForEmail` below renders natively — the
 * 8th seam a new `tw:` kind has to touch (THINK-685). Keep this in sync with
 * the if-chain: `directive-kinds-parity.test.ts` asserts every registry kind
 * is either listed here (and actually renders non-fallback email HTML) or
 * explicitly waived in DELIVERY_FALLBACK_OK. Without the guard, a new kind
 * silently downgrades to "open the live report" in delivered email.
 */
export const DELIVERY_RENDERED_KINDS = [
  "stats",
  "verdict-grid",
  "timeline",
  "chart",
  // Not a registry kind of its own: tw:analysis blocks carry the same
  // title/series/caption shape as tw:chart and reuse that branch.
  "analysis",
] as const;

/**
 * Registry kinds deliberately left to the generic email fallback. Add a kind
 * here (WITH a comment saying why the live surface is the only place it makes
 * sense) instead of silently letting the drift test discover it. Empty today.
 */
export const DELIVERY_FALLBACK_OK: readonly string[] = [];

/** The generic "open the live report" text, shared with the drift test. */
export const DIRECTIVE_FALLBACK_TEXT =
  "[Interactive component — open the live report to view it]";

/** Render one tw:* directive to email-safe HTML + a plain-text line. */
export function renderDirectiveForEmail(
  kind: string,
  body: string,
): { html: string; text: string } {
  const root = yamlRecord(body);
  const fallback = {
    html: DIRECTIVE_FALLBACK_HTML,
    text: DIRECTIVE_FALLBACK_TEXT,
  };
  if (!root) return fallback;

  if (kind === "stats") {
    const rawItems = Array.isArray(root.items) ? root.items : [];
    const tiles: Array<{ value: string; label: string }> = [];
    for (const item of rawItems) {
      const rec =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value = scalarText(rec?.value);
      const label = scalarText(rec?.label);
      if (value !== null && label !== null) tiles.push({ value, label });
    }
    if (tiles.length === 0) return fallback;
    const cells = tiles
      .map(
        (t) =>
          '<td style="border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;text-align:center">' +
          `<div style="font-size:20px;font-weight:700;color:#1a1a1a">${escapeHtml(t.value)}</div>` +
          `<div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(t.label)}</div>` +
          "</td>",
      )
      .join('<td style="width:8px"></td>');
    return {
      html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:separate"><tr>${cells}</tr></table>`,
      text: tiles.map((t) => `${t.value} ${t.label}`).join(" · "),
    };
  }

  if (kind === "verdict-grid") {
    const rawCards = Array.isArray(root.cards) ? root.cards : [];
    const cards: Array<{ question: string; answer: string; note?: string }> =
      [];
    for (const card of rawCards) {
      const rec =
        card && typeof card === "object" && !Array.isArray(card)
          ? (card as Record<string, unknown>)
          : null;
      const question = scalarText(rec?.question);
      const answer = scalarText(rec?.answer);
      if (question !== null && answer !== null) {
        cards.push({
          question,
          answer,
          note: scalarText(rec?.note) ?? undefined,
        });
      }
    }
    if (cards.length === 0) return fallback;
    const rows = cards
      .map(
        (c) =>
          '<div style="border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;margin:8px 0">' +
          `<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(c.question)}</div>` +
          `<div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-top:2px">${escapeHtml(c.answer)}</div>` +
          (c.note
            ? `<div style="font-size:13px;color:#4b5563;margin-top:4px">${escapeHtml(c.note)}</div>`
            : "") +
          "</div>",
      )
      .join("");
    return {
      html: `<div style="margin:16px 0">${rows}</div>`,
      text: cards.map((c) => `${c.question}: ${c.answer}`).join(" · "),
    };
  }

  if (kind === "timeline") {
    const rawItems = Array.isArray(root.items) ? root.items : [];
    const entries: string[] = [];
    const textEntries: string[] = [];
    for (const item of rawItems) {
      const rec =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const label = scalarText(rec?.label);
      if (label === null) continue;
      const caption = scalarText(rec?.caption);
      const date = scalarText(rec?.date);
      const current = rec?.current === true;
      const detail = [caption, date].filter(Boolean).join(" — ");
      entries.push(
        `<li style="margin:4px 0">${current ? "<strong>" : ""}${escapeHtml(label)}${current ? " (current)</strong>" : ""}${detail ? ` <span style="color:#6b7280">— ${escapeHtml(detail)}</span>` : ""}</li>`,
      );
      textEntries.push(`${label}${current ? " (current)" : ""}`);
    }
    if (entries.length === 0) return fallback;
    return {
      html: `<ol style="margin:16px 0;padding-left:20px;font-size:14px;color:#1a1a1a">${entries.join("")}</ol>`,
      text: textEntries.join(" → "),
    };
  }

  if (kind === "chart" || kind === "analysis") {
    // Charts are SVG on the live surface; email clients strip SVG, so ship
    // the underlying data table (the same drill-down the doc pairs with
    // every chart) plus the caption takeaway.
    const title = scalarText(root.title);
    const rawSeries = Array.isArray(root.series) ? root.series : [];
    const points: Array<{ label: string; value: string }> = [];
    for (const point of rawSeries) {
      const rec =
        point && typeof point === "object" && !Array.isArray(point)
          ? (point as Record<string, unknown>)
          : null;
      const label = scalarText(rec?.label);
      const value = scalarText(rec?.value);
      if (label !== null && value !== null) points.push({ label, value });
    }
    if (points.length === 0) return fallback;
    const rows = points
      .map(
        (p) =>
          `<tr><td style="border:1px solid #e5e5e5;padding:6px 12px;font-size:13px">${escapeHtml(p.label)}</td><td style="border:1px solid #e5e5e5;padding:6px 12px;font-size:13px;text-align:right">${escapeHtml(p.value)}</td></tr>`,
      )
      .join("");
    const caption = scalarText(root.caption);
    return {
      html:
        '<div style="margin:16px 0">' +
        (title
          ? `<div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:6px">${escapeHtml(title)}</div>`
          : "") +
        `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>` +
        (caption
          ? `<div style="font-size:12px;color:#6b7280;margin-top:6px">${escapeHtml(caption)}</div>` +
            ""
          : "") +
        "</div>",
      text: `${title ? `${title}: ` : ""}${points.map((p) => `${p.label} ${p.value}`).join(", ")}`,
    };
  }

  return fallback;
}

/**
 * Render an artifact as an HTML email.
 *
 * Returns subject, HTML body (wrapped in email document shell), and plain
 * text fallback for multipart/alternative.
 */
export function renderEmailDelivery(
  artifact: ArtifactPayload,
  options: {
    /**
     * THINK-227 U5 (R7): public share URL for the LIVING document. When set,
     * the email gains a prominent "View the live report" button after the
     * inline content and the link joins the plain-text fallback.
     */
    shareUrl?: string | null;
  } = {},
): EmailDeliveryResult {
  const label = typeLabel(artifact.type);
  const subject = `${label}: ${artifact.title}`;

  // Header badge — hardcoded inline styles; no token-value interpolation
  // into style= attributes (R12 of the channel-rendering plan).
  const headerHtml = `
<div style="margin-bottom:16px">
  <span style="display:inline-block;background:#e5e7eb;color:#374151;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(label)}</span>
  ${artifact.status === "draft" ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:6px">DRAFT</span>' : ""}
</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;color:#1a1a1a">${escapeHtml(artifact.title)}</h1>
`;

  // THINK-154: document digests may lead with compiler frontmatter — not
  // reader-facing content; strip it before rendering.
  const markdownContent = stripLeadingFrontmatter(artifact.content);
  // tw:* plate directives render as email-safe components (never raw YAML);
  // the markdown between them takes the normal email renderer.
  const segments = splitDirectiveFences(markdownContent);
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const segment of segments) {
    if (segment.type === "md") {
      if (segment.text.trim() !== "") {
        htmlParts.push(renderForEmail(segment.text).html);
        textParts.push(segment.text);
      }
      continue;
    }
    const rendered = renderDirectiveForEmail(segment.kind, segment.body);
    htmlParts.push(rendered.html);
    textParts.push(rendered.text);
  }
  const contentHtml = htmlParts.join("");
  const textContent = textParts.join("\n");

  // Share-link button: href is URL-derived (our own signed share URL), never
  // interpolated into a style attribute; text stays static.
  const shareUrl = options.shareUrl?.trim();
  const shareHtml = shareUrl
    ? `
<div style="margin:24px 0 8px;text-align:center">
  <a href="${escapeHtml(shareUrl)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;font-size:14px;font-weight:600;padding:10px 24px;border-radius:6px;text-decoration:none">View the live report</a>
  <p style="font-size:12px;color:#6b7280;margin:8px 0 0">This link always shows the latest edition.</p>
</div>`
    : "";

  const htmlBody = wrapEmailDocument(headerHtml + contentHtml + shareHtml, {
    title: artifact.title,
    preheader: artifact.summary ?? artifact.title,
  });

  // Plain text fallback: label + title + truncated content (directives
  // already reduced to one-line summaries above).
  const textBody = [
    `${label}: ${artifact.title}`,
    artifact.status === "draft" ? "[DRAFT]" : "",
    "",
    textContent.slice(0, 2000),
    textContent.length > 2000 ? "\n[Content truncated]" : "",
    shareUrl ? `\nView the live report: ${shareUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, htmlBody, textBody };
}

// ---------------------------------------------------------------------------
// SMS delivery
// ---------------------------------------------------------------------------

/** Maximum SMS segment length (GSM-7 single segment) */
const SMS_MAX_LENGTH = 160;

/**
 * Generate an SMS-ready summary of an artifact.
 *
 * Uses the artifact's `summary` field if available, otherwise truncates
 * the content to fit within SMS limits.
 */
export function renderSmsDelivery(
  artifact: ArtifactPayload,
  maxLength = SMS_MAX_LENGTH,
): SmsDeliveryResult {
  const prefix = `${typeLabel(artifact.type)}: `;
  const available = maxLength - prefix.length;

  if (artifact.summary && artifact.summary.length <= available) {
    return { body: prefix + artifact.summary };
  }

  const source = artifact.summary ?? stripLeadingFrontmatter(artifact.content);
  // Strip markdown formatting for SMS
  const plain = source
    .replace(/[#*_`~\[\]()>]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  if (plain.length <= available) {
    return { body: prefix + plain };
  }

  return { body: prefix + plain.slice(0, available - 1) + "…" };
}

// ---------------------------------------------------------------------------
// PDF-ready HTML
// ---------------------------------------------------------------------------

/** Sanitizer config for the PDF rendering path. Same trust posture as the
 * email path; the surrounding `renderPdfHtml()` wraps the sanitized fragment
 * in a `<!DOCTYPE html>` + `<style>` document for Puppeteer / wkhtmltopdf. */
const PDF_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "strong",
    "em",
    "code",
    "pre",
    "br",
    "del",
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
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    th: ["align"],
    td: ["align"],
    ol: ["start"],
  },
  allowedSchemesByTag: {
    a: ["http", "https"],
    img: ["http", "https"],
  },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  disallowedTagsMode: "discard",
};

/** Convert markdown to sanitized semantic HTML for the PDF document body. The
 * PDF's `<style>` block handles all styling — output here is plain semantic
 * HTML (no inline styles, no document shell). */
function renderMarkdownForPdf(markdown: string): string {
  if (!markdown) return "";
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(rawHtml, PDF_SANITIZE_CONFIG);
}

/**
 * Render an artifact as a full HTML document suitable for PDF generation
 * (via Puppeteer, wkhtmltopdf, or similar).
 */
export function renderPdfHtml(artifact: ArtifactPayload): string {
  const label = typeLabel(artifact.type);
  const contentHtml = renderMarkdownForPdf(
    stripLeadingFrontmatter(artifact.content),
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(artifact.title)}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1a1a1a;
    max-width: 700px;
    margin: 0 auto;
    padding: 40px 32px;
  }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .type-badge {
    display: inline-block;
    background: #e5e7eb;
    color: #374151;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 24px;
  }
  .draft-badge {
    display: inline-block;
    background: #fef3c7;
    color: #92400e;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: 6px;
  }
  pre {
    background: #f5f5f5;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 13px;
  }
  blockquote {
    border-left: 3px solid #d1d5db;
    padding-left: 12px;
    margin: 8px 0;
    color: #6b7280;
  }
  hr {
    border: none;
    border-top: 1px solid #e5e5e5;
    margin: 16px 0;
  }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(artifact.title)}</h1>
<span class="type-badge">${escapeHtml(label)}</span>${artifact.status === "draft" ? '<span class="draft-badge">DRAFT</span>' : ""}
${contentHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a sanitized HTML fragment in an email-safe document shell. Hardcoded
 * inline styles preserve the artifact-email visual contract (white card,
 * 600px centered container, preheader).
 */
function wrapEmailDocument(
  body: string,
  options?: { title?: string; preheader?: string },
): string {
  const title = options?.title ? escapeHtml(options.title) : "Thinkwork";
  const preheader = options?.preheader
    ? `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(options.preheader)}</span>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
${preheader}
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td align="center" style="padding:24px 16px">
<table width="100%" style="max-width:600px" cellpadding="0" cellspacing="0" role="presentation">
<tr><td style="background:#ffffff;border-radius:8px;padding:32px;border:1px solid #e5e5e5">
${body}
</td></tr>
<tr><td style="padding:16px;text-align:center;font-size:12px;color:#a3a3a3">
Sent by <a href="https://thinkwork.ai" style="color:#a3a3a3">Thinkwork</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
