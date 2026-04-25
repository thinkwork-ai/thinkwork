export interface RoutingRow {
  task: string;
  goTo: string;
  read: string;
  skills: string[];
}

export interface RoutingParseResult {
  rows: RoutingRow[];
  warning?: string;
  rowWarnings?: string[];
}

const REQUIRED_COLUMNS = ["task", "go to", "read", "skills"];
const RESERVED_GO_TO_SEGMENTS = new Set(["memory", "skills"]);

export function parseRoutingTable(markdown: string): RoutingParseResult {
  const lines = markdown.split(/\r?\n/);
  const { headingIndex, sectionEnd } = findRoutingSection(lines);
  if (headingIndex < 0) {
    return { rows: [], warning: "No routing table found." };
  }
  const searchStart = headingIndex + 1;
  const tableStart = lines.findIndex(
    (line, index) =>
      index >= searchStart && index < sectionEnd && isTableLine(line),
  );

  if (tableStart < 0) return { rows: [], warning: "No routing table found." };

  const header = splitTableRow(lines[tableStart]);
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(
    (column) => !normalizedHeader.includes(column),
  );
  if (missing.length > 0) {
    return {
      rows: [],
      warning: `Routing table is missing ${missing.join(", ")} column.`,
    };
  }

  const separatorIndex = tableStart + 1;
  if (!isSeparatorRow(lines[separatorIndex] ?? "")) {
    return {
      rows: [],
      warning: "Routing table header must be followed by a separator row.",
    };
  }

  const columnIndex = (name: string) => normalizedHeader.indexOf(name);
  const rows: RoutingRow[] = [];
  for (let i = separatorIndex + 1; i < sectionEnd; i++) {
    const line = lines[i];
    if (!isTableLine(line)) break;
    const cells = splitTableRow(line);
    const task = cells[columnIndex("task")]?.trim() ?? "";
    const goTo = cells[columnIndex("go to")]?.trim() ?? "";
    const read = cells[columnIndex("read")]?.trim() ?? "";
    const skills = splitSkills(cells[columnIndex("skills")] ?? "");
    if (!task && !goTo && !read && skills.length === 0) continue;
    rows.push({ task, goTo, read, skills });
  }

  return { rows, rowWarnings: validateRoutingRows(rows) };
}

export function replaceRoutingTable(
  markdown: string,
  rows: RoutingRow[],
): string {
  const lines = markdown.split(/\r?\n/);
  const { headingIndex, sectionEnd } = findRoutingSection(lines);
  const searchStart = headingIndex >= 0 ? headingIndex + 1 : lines.length;
  const tableStart = lines.findIndex(
    (line, index) =>
      index >= searchStart && index < sectionEnd && isTableLine(line),
  );
  const tableLines = serializeRoutingRows(rows).split("\n");

  if (tableStart < 0) {
    if (headingIndex >= 0) {
      const next = [
        ...lines.slice(0, headingIndex + 1),
        "",
        ...tableLines,
        ...lines.slice(headingIndex + 1),
      ];
      return next.join("\n");
    }
    const suffix = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${suffix}\n## Routing\n\n${tableLines.join("\n")}\n`;
  }

  let tableEnd = tableStart;
  while (tableEnd < lines.length && isTableLine(lines[tableEnd])) {
    tableEnd++;
  }

  const next = [
    ...lines.slice(0, tableStart),
    ...tableLines,
    ...lines.slice(tableEnd),
  ];
  return next.join("\n");
}

export function serializeRoutingRows(rows: RoutingRow[]): string {
  const header = "| Task | Go to | Read | Skills |";
  const separator = "| --- | --- | --- | --- |";
  const body = rows.map((row) =>
    [
      escapeCell(row.task),
      escapeCell(row.goTo),
      escapeCell(row.read),
      escapeCell(row.skills.join(", ")),
    ].join(" | "),
  );
  return [header, separator, ...body.map((row) => `| ${row} |`)].join("\n");
}

export function splitSkills(value: string): string[] {
  return value
    .split(",")
    .map((skill) => skill.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

export function validateRoutingRows(rows: RoutingRow[]): string[] {
  const warnings: string[] = [];
  for (const [index, row] of rows.entries()) {
    const goTo = row.goTo.trim();
    if (!goTo) continue;
    const normalized = goTo.replace(/`/g, "");
    if (goTo !== normalized) {
      warnings.push(`Row ${index + 1}: Go to cannot use markdown decoration.`);
    }
    if (
      normalized.startsWith("/") ||
      normalized.includes("..") ||
      normalized.includes("\\")
    ) {
      warnings.push(`Row ${index + 1}: Go to must be a relative folder path.`);
    }
    const segments = normalized
      .replace(/^\.\//, "")
      .replace(/\/$/, "")
      .split("/")
      .filter(Boolean);
    const reserved = segments.find((segment) =>
      RESERVED_GO_TO_SEGMENTS.has(segment),
    );
    if (reserved) {
      warnings.push(
        `Row ${index + 1}: "${reserved}" is a reserved folder name.`,
      );
    }
  }
  return warnings;
}

function isTableLine(line: string) {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isSeparatorRow(line: string) {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function splitTableRow(line: string) {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "/").trim();
}

function findRoutingSection(lines: string[]) {
  const headingIndex = lines.findIndex((line) =>
    /^##\s+routing\s*$/i.test(line.trim()),
  );
  if (headingIndex < 0) {
    return { headingIndex: -1, sectionEnd: lines.length };
  }
  const sectionEnd = lines.findIndex(
    (line, index) => index > headingIndex && /^#{1,2}\s+/.test(line.trim()),
  );
  return {
    headingIndex,
    sectionEnd: sectionEnd < 0 ? lines.length : sectionEnd,
  };
}
