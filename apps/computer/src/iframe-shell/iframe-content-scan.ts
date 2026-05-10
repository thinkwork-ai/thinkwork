/**
 * Compile-time content scan for forbidden runtime patterns.
 *
 * Plan-012 U9 — migrated forward from plan-001's same-origin-era safety
 * boundary. The iframe sandbox + CSP `connect-src 'none'` is the
 * primary defense against agent-emitted side effects reaching the
 * parent origin. This content scan is the secondary defense: catch
 * patterns the agent should never emit (eval, top-level network calls,
 * direct globalThis access) at compile time so the agent gets a clear
 * error and can self-correct, rather than mounting + hitting a CSP
 * violation at runtime.
 *
 * False positives are acceptable in v1 — `fetchOpportunities` is
 * rejected; the agent renames during retry.
 *
 * Source of truth for the rule list:
 *   docs/specs/computer-applet-contract-v1.md §Forbidden runtime patterns
 *
 * The same rules apply in iframe scope. We re-implement here (rather
 * than importing the parent's existing scanner) so the iframe-shell
 * bundle can ship as a self-contained artifact at sandbox.thinkwork.ai
 * without parent-side coupling.
 */

export interface ContentScanFinding {
	pattern: string;
	match: string;
	line: number;
	column: number;
}

export interface ContentScanResult {
	ok: boolean;
	findings: ContentScanFinding[];
}

/**
 * Forbidden runtime escape hatches. Each pattern is a JavaScript
 * RegExp; matches anywhere in the source reject the fragment.
 *
 * Word-boundary anchored where it makes sense to avoid mistakenly
 * flagging substrings inside identifiers (e.g. `globalThisIsFine` is
 * fine, `globalThis` is not).
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
	{ name: "fetch", pattern: /\bfetch\b/g },
	{ name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/g },
	{ name: "WebSocket", pattern: /\bWebSocket\b/g },
	{ name: "globalThis", pattern: /\bglobalThis\b/g },
	{ name: "eval", pattern: /\beval\s*\(/g },
	{ name: "Function-constructor", pattern: /\bFunction\s*\(/g },
	{ name: "dynamic-import", pattern: /\bimport\s*\(/g },
	{ name: "Reflect", pattern: /\bReflect\b/g },
];

export function scanFragmentSource(source: string): ContentScanResult {
	const findings: ContentScanFinding[] = [];
	for (const { name, pattern } of FORBIDDEN_PATTERNS) {
		// Reset lastIndex because patterns are global.
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		// eslint-disable-next-line no-cond-assign
		while ((match = pattern.exec(source))) {
			const before = source.slice(0, match.index);
			const line = before.split("\n").length;
			const lastNewline = before.lastIndexOf("\n");
			const column = match.index - (lastNewline + 1);
			findings.push({
				pattern: name,
				match: match[0],
				line,
				column,
			});
			// Avoid infinite loops on zero-length matches.
			if (match.index === pattern.lastIndex) pattern.lastIndex++;
		}
	}
	return {
		ok: findings.length === 0,
		findings,
	};
}

export class ContentScanRejection extends Error {
	readonly findings: ContentScanFinding[];
	constructor(findings: ContentScanFinding[]) {
		super(
			`Fragment source rejected by iframe-shell content scan: ${findings
				.map((f) => `${f.pattern} at ${f.line}:${f.column}`)
				.join(", ")}`,
		);
		this.name = "ContentScanRejection";
		this.findings = findings;
	}
}

export function assertScanPasses(source: string): void {
	const result = scanFragmentSource(source);
	if (!result.ok) {
		throw new ContentScanRejection(result.findings);
	}
}
