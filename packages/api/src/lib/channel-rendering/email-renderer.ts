/**
 * Email channel renderer: agent markdown → email-safe HTML + plaintext fallback.
 *
 * - Primary defense: DOMPurify with explicit allowlist + URI scheme pin.
 * - Defense in depth: marked Renderer overrides reject non-http(s) URIs at parse
 *   time so visible text survives stripping.
 *
 * Renderer overrides never interpolate token values into style= attributes;
 * every style string is hardcoded.
 */

import DOMPurify from "isomorphic-dompurify";
import { Marked, type Tokens } from "marked";

const SAFE_URI_REGEXP = /^https?:/i;

const HEADING_SIZES: Record<number, string> = {
	1: "24px",
	2: "20px",
	3: "16px",
	4: "14px",
	5: "13px",
	6: "12px",
};

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildMarked(): Marked {
	const instance = new Marked({ gfm: true, breaks: false });

	instance.use({
		renderer: {
			heading({ tokens, depth }: Tokens.Heading) {
				const inner = this.parser.parseInline(tokens);
				const size = HEADING_SIZES[depth] ?? "14px";
				return `<h${depth} style="font-size:${size};font-weight:600;margin:16px 0 8px">${inner}</h${depth}>`;
			},
			paragraph({ tokens }: Tokens.Paragraph) {
				return `<p style="margin:8px 0">${this.parser.parseInline(tokens)}</p>`;
			},
			blockquote({ tokens }: Tokens.Blockquote) {
				return `<blockquote style="border-left:3px solid #d1d5db;padding-left:12px;margin:8px 0;color:#6b7280">${this.parser.parse(tokens)}</blockquote>`;
			},
			hr() {
				return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0">`;
			},
			list(token: Tokens.List) {
				const ordered = token.ordered;
				const tag = ordered ? "ol" : "ul";
				const startAttr =
					ordered && token.start !== 1 && token.start !== ""
						? ` start="${token.start}"`
						: "";
				const body = token.items.map((item) => this.listitem(item)).join("");
				return `<${tag}${startAttr} style="margin:8px 0;padding-left:24px">${body}</${tag}>`;
			},
			listitem(item: Tokens.ListItem) {
				// Use block parser so nested lists/paragraphs render correctly.
				// parseInline rejects block-level tokens (e.g., nested list).
				const content = this.parser.parse(item.tokens);
				return `<li>${content}</li>`;
			},
			code({ text, lang: _lang }: Tokens.Code) {
				return `<pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;font-family:Menlo,Consolas,monospace;font-size:13px"><code>${escapeHtml(text)}</code></pre>`;
			},
			codespan({ text }: Tokens.Codespan) {
				return `<code style="background:#f3f4f6;padding:2px 4px;border-radius:3px;font-family:Menlo,Consolas,monospace;font-size:0.9em">${text}</code>`;
			},
			link({ href, title, tokens }: Tokens.Link) {
				const text = this.parser.parseInline(tokens);
				if (!SAFE_URI_REGEXP.test(href)) {
					// Strip href, keep visible text. DOMPurify will also catch this.
					return text;
				}
				const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
				return `<a href="${escapeAttr(href)}"${titleAttr} style="color:#3b82f6;text-decoration:underline">${text}</a>`;
			},
			image({ href, title, text }: Tokens.Image) {
				if (!SAFE_URI_REGEXP.test(href)) {
					// Strip src, fall back to alt as plain text.
					return escapeHtml(text);
				}
				const altAttr = ` alt="${escapeAttr(text)}"`;
				const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
				return `<img src="${escapeAttr(href)}"${altAttr}${titleAttr} style="max-width:600px;height:auto">`;
			},
			table(token: Tokens.Table) {
				let html =
					'<table style="border-collapse:collapse;width:100%;margin:12px 0;border:1px solid #e5e5e5"><thead><tr>';
				for (const cell of token.header) {
					const align = cell.align ? ` align="${cell.align}"` : "";
					const inner = this.parser.parseInline(cell.tokens);
					html += `<th${align} style="padding:6px 10px;border:1px solid #e5e5e5;text-align:left;vertical-align:top;background:#f5f5f5;font-weight:600">${inner}</th>`;
				}
				html += "</tr></thead><tbody>";
				for (const row of token.rows) {
					html += "<tr>";
					for (const cell of row) {
						const align = cell.align ? ` align="${cell.align}"` : "";
						const inner = this.parser.parseInline(cell.tokens);
						html += `<td${align} style="padding:6px 10px;border:1px solid #e5e5e5;text-align:left;vertical-align:top">${inner}</td>`;
					}
					html += "</tr>";
				}
				html += "</tbody></table>";
				return html;
			},
			strong({ tokens }: Tokens.Strong) {
				return `<strong>${this.parser.parseInline(tokens)}</strong>`;
			},
			em({ tokens }: Tokens.Em) {
				return `<em>${this.parser.parseInline(tokens)}</em>`;
			},
			del({ tokens }: Tokens.Del) {
				return `<del>${this.parser.parseInline(tokens)}</del>`;
			},
			br() {
				return "<br>";
			},
		},
	});

	return instance;
}

const markedInstance = buildMarked();

const SANITIZE_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
	USE_PROFILES: { html: true },
	FORBID_TAGS: [
		"svg",
		"math",
		"style",
		"script",
		"iframe",
		"object",
		"embed",
		"form",
		"input",
		"button",
		"link",
		"meta",
	],
	FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onmouseout", "onfocus", "onblur"],
	ALLOWED_URI_REGEXP: /^https?:/i,
};

export interface EmailRenderResult {
	/** Sanitized HTML fragment (no document shell). */
	html: string;
	/** Original markdown verbatim, for the multipart/alternative text/plain part. */
	text: string;
}

/**
 * Render agent markdown to email-safe HTML plus a plaintext fallback.
 *
 * The `text` field is the input verbatim — the multipart/alternative text/plain
 * part is intentionally the raw markdown, not a second prose-stripping pass.
 */
export function renderForEmail(markdown: string): EmailRenderResult {
	if (!markdown) {
		return { html: "", text: markdown ?? "" };
	}

	const rawHtml = markedInstance.parse(markdown, { async: false }) as string;
	const sanitized = DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);

	return { html: sanitized, text: markdown };
}
