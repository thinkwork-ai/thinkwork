/**
 * Resolve template expressions in recipe params.
 *
 * Supported templates:
 *   {{now}}        — current ISO timestamp
 *   {{now - Nd}}   — N days ago
 *   {{now - NM}}   — N months ago
 *   {{now - Nh}}   — N hours ago
 *   {{tenant_id}}  — current tenant UUID
 */

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;
const DURATION_RE = /^now\s*-\s*(\d+)(d|M|h)$/;

function resolveExpression(expr: string, context: { tenantId?: string }): string {
	const trimmed = expr.trim();

	if (trimmed === "now") return new Date().toISOString();
	if (trimmed === "tenant_id") return context.tenantId ?? "";

	const match = trimmed.match(DURATION_RE);
	if (match) {
		const amount = parseInt(match[1], 10);
		const unit = match[2];
		const now = new Date();
		if (unit === "d") now.setDate(now.getDate() - amount);
		else if (unit === "M") now.setMonth(now.getMonth() - amount);
		else if (unit === "h") now.setHours(now.getHours() - amount);
		return now.toISOString();
	}

	return `{{${expr}}}`; // unrecognized — leave as-is
}

export function resolveTemplates(
	params: Record<string, unknown>,
	templates: Record<string, string> | null | undefined,
	context: { tenantId?: string } = {},
): Record<string, unknown> {
	if (!templates) return { ...params };

	const resolved = { ...params };
	for (const [key, templateExpr] of Object.entries(templates)) {
		if (typeof templateExpr === "string") {
			resolved[key] = templateExpr.replace(TEMPLATE_RE, (_, expr) =>
				resolveExpression(expr, context),
			);
		}
	}
	return resolved;
}
