/**
 * PRD-22: Process template parser.
 *
 * Parses PROCESS.md markdown into a typed ProcessTemplate structure.
 * Steps are defined as H3 headers with key-value pairs.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessStep {
	id: string;
	title: string;
	assignee: string;
	priority: string;
	dependsOn: string[];
	gate: "none" | "human";
	gatePollInterval?: string;
	contextProfile?: string;
	instructions: string;
}

export interface ProcessConfig {
	triggerChannel?: string;
	maxConcurrentSteps?: number;
}

export interface ProcessTemplate {
	title: string;
	config: ProcessConfig;
	steps: ProcessStep[];
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseProcessTemplate(markdown: string): ProcessTemplate {
	const lines = markdown.split("\n");

	// Extract title from first H1
	const titleLine = lines.find((l) => /^# /.test(l));
	const title = titleLine ? titleLine.replace(/^# /, "").trim() : "Untitled Process";

	// Extract config section
	const config = parseConfigSection(lines);

	// Extract steps
	const steps = parseSteps(lines);

	// Validate
	validateSteps(steps);

	return { title, config, steps };
}

// ── Config parsing ───────────────────────────────────────────────────────────

function parseConfigSection(lines: string[]): ProcessConfig {
	const config: ProcessConfig = {};
	let inConfig = false;

	for (const line of lines) {
		if (/^## Config\b/i.test(line)) {
			inConfig = true;
			continue;
		}
		if (inConfig && /^## /.test(line)) break;
		if (!inConfig) continue;

		const match = line.match(/^- (\w[\w_]*)\s*:\s*(.+)$/);
		if (!match) continue;

		const [, key, value] = match;
		if (key === "trigger_channel") config.triggerChannel = value.trim();
		if (key === "max_concurrent_steps") config.maxConcurrentSteps = parseInt(value.trim(), 10);
	}

	return config;
}

// ── Step parsing ─────────────────────────────────────────────────────────────

function parseSteps(lines: string[]): ProcessStep[] {
	const steps: ProcessStep[] = [];
	let inSteps = false;

	// Find the ## Steps section
	const stepsIdx = lines.findIndex((l) => /^## Steps\b/i.test(l));
	if (stepsIdx === -1) return steps;

	// Collect step blocks: split on ### headers
	const stepBlocks: { header: string; body: string[] }[] = [];
	let current: { header: string; body: string[] } | null = null;

	for (let i = stepsIdx + 1; i < lines.length; i++) {
		const line = lines[i];

		// Stop at next H2 section
		if (/^## /.test(line) && !/^### /.test(line)) break;

		if (/^### /.test(line)) {
			if (current) stepBlocks.push(current);
			current = { header: line, body: [] };
			continue;
		}

		if (current) current.body.push(line);
	}
	if (current) stepBlocks.push(current);

	// Parse each step block
	for (const block of stepBlocks) {
		const step = parseStepBlock(block.header, block.body);
		if (step) steps.push(step);
	}

	return steps;
}

function parseStepBlock(header: string, body: string[]): ProcessStep | null {
	// Header format: ### step-id: Title
	const headerMatch = header.match(/^### ([\w-]+):\s*(.+)$/);
	if (!headerMatch) return null;

	const [, id, title] = headerMatch;

	const fields: Record<string, string> = {};
	let instructionsLines: string[] = [];
	let inInstructions = false;

	for (const line of body) {
		// Check if this is a new key-value pair (not inside instructions)
		const kvMatch = line.match(/^- ([\w_]+)\s*:\s*(.*)$/);

		if (kvMatch && !inInstructions) {
			const [, key, value] = kvMatch;
			if (key === "instructions" && value.trim() === "|") {
				inInstructions = true;
				continue;
			}
			fields[key] = value.trim();
		} else if (kvMatch && inInstructions) {
			// A new top-level key-value ends the instructions block
			inInstructions = false;
			const [, key, value] = kvMatch;
			if (key === "instructions" && value.trim() === "|") {
				inInstructions = true;
				instructionsLines = [];
				continue;
			}
			fields[key] = value.trim();
		} else if (inInstructions) {
			instructionsLines.push(line);
		}
	}

	// Parse depends_on — supports both [step-1, step-2] and [] formats
	let dependsOn: string[] = [];
	const depsRaw = fields.depends_on || "[]";
	const depsMatch = depsRaw.match(/\[(.*)\]/);
	if (depsMatch && depsMatch[1].trim()) {
		dependsOn = depsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
	}

	// Parse gate
	const gateRaw = (fields.gate || "none").toLowerCase();
	const gate: "none" | "human" = gateRaw === "human" ? "human" : "none";

	// Clean up instructions — remove leading/trailing blank lines, dedent
	const instructions = dedentInstructions(instructionsLines);

	return {
		id,
		title: title.trim(),
		assignee: fields.assignee || "{{current_agent}}",
		priority: fields.priority || "medium",
		dependsOn,
		gate,
		gatePollInterval: fields.gate_poll_interval,
		contextProfile: fields.context_profile || undefined,
		instructions,
	};
}

function dedentInstructions(lines: string[]): string {
	// Remove leading/trailing blank lines
	while (lines.length > 0 && lines[0].trim() === "") lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

	if (lines.length === 0) return "";

	// Find minimum indentation
	const nonEmpty = lines.filter((l) => l.trim().length > 0);
	if (nonEmpty.length === 0) return "";

	const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1].length ?? 0));

	return lines.map((l) => l.slice(minIndent)).join("\n").trimEnd();
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateSteps(steps: ProcessStep[]): void {
	const ids = new Set<string>();

	// Check for duplicate IDs
	for (const step of steps) {
		if (ids.has(step.id)) {
			throw new Error(`Duplicate step ID: "${step.id}"`);
		}
		ids.add(step.id);
	}

	// Check dependency references
	for (const step of steps) {
		for (const dep of step.dependsOn) {
			if (!ids.has(dep)) {
				throw new Error(
					`Step "${step.id}" depends on "${dep}" which does not exist`,
				);
			}
		}
	}

	// Check for cycles via topological sort
	detectCycles(steps);
}

function detectCycles(steps: ProcessStep[]): void {
	const visited = new Set<string>();
	const inStack = new Set<string>();
	const adjMap = new Map<string, string[]>();

	for (const step of steps) {
		adjMap.set(step.id, step.dependsOn);
	}

	function visit(id: string): void {
		if (inStack.has(id)) {
			throw new Error(`Circular dependency detected involving step "${id}"`);
		}
		if (visited.has(id)) return;

		inStack.add(id);
		for (const dep of adjMap.get(id) || []) {
			visit(dep);
		}
		inStack.delete(id);
		visited.add(id);
	}

	for (const step of steps) {
		visit(step.id);
	}
}
