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
import { renderForEmail } from "./channel-rendering/index.js";

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
// Email delivery
// ---------------------------------------------------------------------------

/**
 * Render an artifact as an HTML email.
 *
 * Returns subject, HTML body (wrapped in email document shell), and plain
 * text fallback for multipart/alternative.
 */
export function renderEmailDelivery(
  artifact: ArtifactPayload,
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

  const contentHtml = renderForEmail(artifact.content).html;

  const htmlBody = wrapEmailDocument(headerHtml + contentHtml, {
    title: artifact.title,
    preheader: artifact.summary ?? artifact.title,
  });

  // Plain text fallback: label + title + truncated raw markdown content.
  const textBody = [
    `${label}: ${artifact.title}`,
    artifact.status === "draft" ? "[DRAFT]" : "",
    "",
    artifact.content.slice(0, 2000),
    artifact.content.length > 2000 ? "\n[Content truncated]" : "",
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

  const source = artifact.summary ?? artifact.content;
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
  const contentHtml = renderMarkdownForPdf(artifact.content);

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
