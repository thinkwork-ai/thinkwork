/**
 * PRD-09 Batch 4: Prompt template rendering.
 *
 * Simple {{variable}} interpolation for workflow config prompt templates.
 * Supports nested dot notation (e.g., {{thread.title}}).
 * Unknown variables are left as-is to avoid breaking templates.
 */

export interface PromptTemplateContext {
	tenant?: {
		id?: string;
		slug?: string;
	};
	agent?: {
		id?: string;
		slug?: string;
		name?: string;
	};
	thread?: {
		id?: string;
		identifier?: string;
		title?: string;
		status?: string;
		channel?: string;
	};
	source?: string;
	[key: string]: unknown;
}

/**
 * Render a prompt template by replacing {{path.to.value}} placeholders
 * with values from the context object.
 *
 * Returns the original template unchanged if it's empty/null.
 * Unknown placeholders are left as-is (not stripped).
 */
export function renderPromptTemplate(
	template: string | null | undefined,
	context: PromptTemplateContext,
): string | null {
	if (!template) return null;

	return template.replace(/\{\{(\s*[\w.]+\s*)\}\}/g, (_match, path: string) => {
		const trimmed = path.trim();
		const value = resolvePath(context, trimmed);
		if (value === undefined || value === null) {
			// Leave unknown placeholders as-is
			return `{{${trimmed}}}`;
		}
		return String(value);
	});
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}
