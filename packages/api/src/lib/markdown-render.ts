/**
 * Lightweight markdown → HTML renderer for artifact delivery.
 *
 * Handles common GFM constructs without external dependencies.
 * For richer rendering, swap in a proper markdown parser (e.g., marked).
 */

/** Escape HTML entities to prevent XSS in rendered output */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Convert inline markdown to HTML (bold, italic, code, links) */
function renderInline(text: string): string {
	return escapeHtml(text)
		// Bold **text** or __text__
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/__(.+?)__/g, "<strong>$1</strong>")
		// Italic *text* or _text_
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/_(.+?)_/g, "<em>$1</em>")
		// Inline code `text`
		.replace(/`(.+?)`/g, "<code>$1</code>")
		// Links [text](url)
		.replace(
			/\[(.+?)\]\((.+?)\)/g,
			'<a href="$2" style="color:#3b82f6;text-decoration:underline">$1</a>',
		);
}

/**
 * Render markdown content to HTML suitable for email delivery.
 *
 * Returns an HTML fragment (no <html>/<body> wrapper).
 */
export function markdownToHtml(markdown: string): string {
	const lines = markdown.split("\n");
	const html: string[] = [];
	let inCodeBlock = false;
	let codeLines: string[] = [];
	let inList = false;
	let listType: "ul" | "ol" = "ul";

	function closeList() {
		if (inList) {
			html.push(`</${listType}>`);
			inList = false;
		}
	}

	for (const line of lines) {
		// Code blocks (fenced)
		if (line.startsWith("```")) {
			if (inCodeBlock) {
				html.push(
					`<pre style="background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
				);
				codeLines = [];
				inCodeBlock = false;
			} else {
				closeList();
				inCodeBlock = true;
			}
			continue;
		}

		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		const trimmed = line.trim();

		// Empty line
		if (!trimmed) {
			closeList();
			continue;
		}

		// Headings
		const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			closeList();
			const level = headingMatch[1].length;
			const sizes: Record<number, string> = {
				1: "24px",
				2: "20px",
				3: "16px",
				4: "14px",
				5: "13px",
				6: "12px",
			};
			html.push(
				`<h${level} style="font-size:${sizes[level]};font-weight:600;margin:16px 0 8px">${renderInline(headingMatch[2])}</h${level}>`,
			);
			continue;
		}

		// Horizontal rule
		if (/^[-*_]{3,}$/.test(trimmed)) {
			closeList();
			html.push(
				'<hr style="border:none;border-top:1px solid #e5e5e5;margin:16px 0">',
			);
			continue;
		}

		// Blockquote
		if (trimmed.startsWith("> ")) {
			closeList();
			html.push(
				`<blockquote style="border-left:3px solid #d1d5db;padding-left:12px;margin:8px 0;color:#6b7280">${renderInline(trimmed.slice(2))}</blockquote>`,
			);
			continue;
		}

		// Unordered list
		const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
		if (ulMatch) {
			if (!inList || listType !== "ul") {
				closeList();
				html.push('<ul style="margin:8px 0;padding-left:24px">');
				inList = true;
				listType = "ul";
			}
			html.push(`<li>${renderInline(ulMatch[1])}</li>`);
			continue;
		}

		// Ordered list
		const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
		if (olMatch) {
			if (!inList || listType !== "ol") {
				closeList();
				html.push('<ol style="margin:8px 0;padding-left:24px">');
				inList = true;
				listType = "ol";
			}
			html.push(`<li>${renderInline(olMatch[1])}</li>`);
			continue;
		}

		// GFM table detection (simple: header | sep | rows)
		if (trimmed.includes("|") && trimmed.startsWith("|")) {
			closeList();
			html.push(`<p style="margin:8px 0">${renderInline(trimmed)}</p>`);
			continue;
		}

		// Regular paragraph
		closeList();
		html.push(`<p style="margin:8px 0">${renderInline(trimmed)}</p>`);
	}

	closeList();
	return html.join("\n");
}

/**
 * Wrap an HTML fragment in a full email-safe HTML document.
 */
export function wrapEmailHtml(
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
