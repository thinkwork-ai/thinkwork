/**
 * Artifact delivery utilities.
 *
 * Renders markdown artifacts to various delivery formats:
 * - HTML email (via SES)
 * - SMS summary (plain text truncation)
 * - PDF-ready HTML (full document with print styles)
 */

import { markdownToHtml, wrapEmailHtml } from "./markdown-render.js";

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
 * Returns subject, HTML body (wrapped in email template), and plain text
 * fallback for multipart/alternative.
 */
export function renderEmailDelivery(artifact: ArtifactPayload): EmailDeliveryResult {
	const label = typeLabel(artifact.type);
	const subject = `${label}: ${artifact.title}`;

	// Header badge
	const headerHtml = `
<div style="margin-bottom:16px">
  <span style="display:inline-block;background:#e5e7eb;color:#374151;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px">${label}</span>
  ${artifact.status === "draft" ? '<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:6px">DRAFT</span>' : ""}
</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;color:#1a1a1a">${escapeHtml(artifact.title)}</h1>
`;

	const contentHtml = markdownToHtml(artifact.content);

	const htmlBody = wrapEmailHtml(headerHtml + contentHtml, {
		title: artifact.title,
		preheader: artifact.summary ?? artifact.title,
	});

	// Plain text fallback: summary or first 500 chars of content
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

	return { body: prefix + plain.slice(0, available - 1) + "\u2026" };
}

// ---------------------------------------------------------------------------
// PDF-ready HTML
// ---------------------------------------------------------------------------

/**
 * Render an artifact as a full HTML document suitable for PDF generation
 * (via Puppeteer, wkhtmltopdf, or similar).
 */
export function renderPdfHtml(artifact: ArtifactPayload): string {
	const label = typeLabel(artifact.type);
	const contentHtml = markdownToHtml(artifact.content);

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
<span class="type-badge">${label}</span>${artifact.status === "draft" ? '<span class="draft-badge">DRAFT</span>' : ""}
${contentHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
