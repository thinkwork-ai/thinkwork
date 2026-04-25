/**
 * AGENTS.md routing-table parser (Plan §008 U6).
 *
 * Extracts the `| Task | Go to | Read | Skills |` markdown table from a
 * folder's AGENTS.md content into typed `RoutingRow[]`. Surrounding prose
 * is preserved verbatim on `rawMarkdown` so callers (admin builder, the
 * AGENTS.md round-trip writer) can edit a row without clobbering the rest
 * of the document.
 *
 * Used by:
 *   - `derive-agent-skills.ts` (U11) to recompute `agent_skills` on save
 *   - admin builder routing-row editor (U18) for structured editing
 *   - folder-bundle-importer (U15) to enumerate sub-agents from imports
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PINNED_SHAPE_CONTRACT
 * ─────────────────────────────────────────────────────────────────────────
 * The Python mirror lives at:
 *   `packages/agentcore/agent-container/agents_md_parser.py`
 * with the matching contract block. The shared fixture lives at:
 *   `packages/agentcore/agent-container/fixtures/agents-md-sample.md`
 * Both parsers run a fixture-parity test that fails when either drifts.
 *
 * Public surface (must stay in sync, both sides):
 *   parseAgentsMd(md) → { routing: RoutingRow[], rawMarkdown }
 *
 * RoutingRow:
 *   {
 *     task:   string         // human-readable label, decoration-stripped
 *     goTo:   string         // sub-agent folder path, e.g. "expenses/"
 *     reads:  string[]       // file paths the operator referenced (verbatim)
 *     skills: string[]       // skill slugs (verbatim, dedup is U11's job)
 *   }
 *
 * Tolerances (both sides):
 *   - Column reordering — header names locate columns; aliases case-insensitive
 *   - Whitespace variation in cells, header rows, separator rows
 *   - Italics / bold / backticks stripped before validation
 *   - Trailing empty rows skipped
 *   - Rows with invalid goTo paths skipped + WARN-logged (not thrown)
 *   - Rows with reserved goTo names (`memory`, `skills`) skipped + WARN-logged
 *
 * Hard errors (both sides):
 *   - Routing table present but no `Go to` column → throw
 *   - Multiple top-level tables and no `## Routing` heading → throw
 *
 * Per `inline-helpers-vs-shared-package` learning: this parser is inlined
 * (TS+Py mirrors) rather than extracted to a shared package. Total parser
 * is < 80 lines per side; the fixture-parity test is the drift detector.
 */

const RESERVED_FOLDER_NAMES: ReadonlySet<string> = new Set(["memory", "skills"]);

export interface RoutingRow {
	task: string;
	goTo: string;
	reads: string[];
	skills: string[];
}

export interface ParsedAgentsMd {
	routing: RoutingRow[];
	rawMarkdown: string;
}

interface TableBlock {
	headerLine: string;
	dataLines: string[];
}

export function parseAgentsMd(markdown: string): ParsedAgentsMd {
	const block = locateRoutingTable(markdown);
	if (!block) {
		return { routing: [], rawMarkdown: markdown };
	}
	const routing = parseRoutingBlock(block);
	return { routing, rawMarkdown: markdown };
}

function locateRoutingTable(markdown: string): TableBlock | null {
	const lines = markdown.split("\n");

	// Preferred: '## Routing' (or 'Routes' / 'Routing Table') heading.
	const headingIdx = lines.findIndex((l) =>
		/^##\s+Routing(\s+Table)?\s*$/i.test(l.trim()),
	);
	if (headingIdx !== -1) {
		const sectionLines = sliceUntilNextH2(lines, headingIdx + 1);
		const block = extractFirstTable(sectionLines);
		return block;
	}

	// Fallback: a single top-level table when the document has no routing
	// heading. If multiple tables exist we refuse — too ambiguous to risk
	// guessing wrong on import.
	const tables = extractAllTables(lines);
	if (tables.length === 0) return null;
	if (tables.length === 1) return tables[0];
	throw new Error(
		"AGENTS.md has multiple tables but no '## Routing' heading — add a heading to disambiguate.",
	);
}

function sliceUntilNextH2(lines: string[], from: number): string[] {
	const end = lines.slice(from).findIndex((l) => /^##\s+/.test(l.trim()));
	return end === -1 ? lines.slice(from) : lines.slice(from, from + end);
}

function extractFirstTable(lines: string[]): TableBlock | null {
	const all = extractAllTables(lines);
	return all.length > 0 ? all[0] : null;
}

function extractAllTables(lines: string[]): TableBlock[] {
	const tables: TableBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!isTableLine(lines[i])) {
			i++;
			continue;
		}
		const headerLine = lines[i];
		// A valid markdown table has a separator row directly after the header.
		if (i + 1 >= lines.length || !isSeparatorRow(lines[i + 1])) {
			i++;
			continue;
		}
		const dataLines: string[] = [];
		let j = i + 2;
		while (j < lines.length && isTableLine(lines[j])) {
			dataLines.push(lines[j]);
			j++;
		}
		tables.push({ headerLine, dataLines });
		i = j;
	}
	return tables;
}

function isTableLine(line: string): boolean {
	return line.trim().startsWith("|");
}

function isSeparatorRow(line: string): boolean {
	const cells = parseRowCells(line);
	return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function parseRowCells(line: string): string[] {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|")) return [];
	let body = trimmed.slice(1);
	if (body.endsWith("|")) body = body.slice(0, -1);
	return body.split("|").map((c) => c.trim());
}

interface ColumnIndex {
	task: number;
	goTo: number;
	reads: number;
	skills: number;
}

function indexColumns(headerCells: string[]): ColumnIndex {
	const idx: ColumnIndex = { task: -1, goTo: -1, reads: -1, skills: -1 };
	for (let i = 0; i < headerCells.length; i++) {
		const normalized = headerCells[i]
			.toLowerCase()
			.replace(/[\s_\-]/g, "");
		if (normalized === "task") idx.task = i;
		else if (normalized === "goto") idx.goTo = i;
		else if (normalized === "read" || normalized === "reads") idx.reads = i;
		else if (normalized === "skill" || normalized === "skills")
			idx.skills = i;
	}
	return idx;
}

function parseRoutingBlock(block: TableBlock): RoutingRow[] {
	const headerCells = parseRowCells(block.headerLine);
	const cols = indexColumns(headerCells);
	if (cols.goTo === -1) {
		throw new Error(
			"AGENTS.md routing table is missing the 'Go to' column. " +
				"Add a 'Go to' header to the routing table.",
		);
	}

	const out: RoutingRow[] = [];
	for (const line of block.dataLines) {
		const cells = parseRowCells(line);
		if (cells.length === 0) continue;
		if (cells.every((c) => c === "")) continue;

		const rawGoTo = cells[cols.goTo] ?? "";
		const goTo = stripDecorations(rawGoTo);
		if (!goTo) continue;

		const goToFolder = goTo.replace(/\/$/, "");
		if (RESERVED_FOLDER_NAMES.has(goToFolder)) {
			console.warn(
				`[agents-md-parser] Skipping row — goTo "${goTo}" is a reserved folder name (memory/skills).`,
			);
			continue;
		}
		if (!isValidFolderPath(goTo)) {
			console.warn(
				`[agents-md-parser] Skipping row — goTo "${rawGoTo}" is not a valid folder path.`,
			);
			continue;
		}

		const task =
			cols.task >= 0 ? stripDecorations(cells[cols.task] ?? "") : "";
		const reads =
			cols.reads >= 0
				? splitList(cells[cols.reads] ?? "")
						.map(stripDecorations)
						.filter((s) => s.length > 0)
				: [];
		const skills =
			cols.skills >= 0
				? splitList(cells[cols.skills] ?? "")
						.map(stripDecorations)
						.filter((s) => s.length > 0)
				: [];

		out.push({ task, goTo, reads, skills });
	}
	return out;
}

function stripDecorations(s: string): string {
	let out = s.trim();
	// Strip wrapping italics (_..._ or *...*) and bold (**...** or __...__).
	out = out.replace(/^(\*\*|__)(.*?)(\*\*|__)$/, "$2");
	out = out.replace(/^(\*|_)(.*?)(\*|_)$/, "$2");
	// Strip backticks anywhere; routing-row cells don't contain code spans.
	out = out.replace(/`/g, "");
	return out.trim();
}

function splitList(cell: string): string[] {
	return cell.split(",").map((p) => p.trim());
}

const FOLDER_PATH_RE = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*\/?$/;

function isValidFolderPath(p: string): boolean {
	return FOLDER_PATH_RE.test(p);
}
