export interface WikiContextTraceCardProps {
  trace: Record<string, unknown>;
}

const OKF_WIKI_TRACE_TOOLS = new Set([
  "wiki_ls",
  "wiki_rg",
  "wiki_read",
  "wiki_links",
]);

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function redactTraceText(value: string): string {
  return value
    .replace(/\/mnt\/thinkwork-okf\/[^\s)"']+/g, "[okf-root]")
    .replace(/s3:\/\/[^\s)"']+/g, "[s3-object]");
}

function sensitiveTraceKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return (
    normalized.includes("root") ||
    normalized.includes("absolute") ||
    normalized.includes("s3key") ||
    normalized.includes("bucket")
  );
}

function redactTraceValue(value: unknown): unknown {
  if (typeof value === "string") return redactTraceText(value);
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveTraceKey(key))
        .map(([key, child]) => [key, redactTraceValue(child)]),
    );
  }
  return value;
}

function redactTraceRecord(value: Record<string, unknown>) {
  return recordValue(redactTraceValue(value));
}

function isOkfTrace(value: Record<string, unknown>) {
  const tool = stringValue(value.tool)?.toLowerCase();
  return (
    value.surface === "okf_efs" &&
    Boolean(tool && OKF_WIKI_TRACE_TOOLS.has(tool))
  );
}

function withTraceFallbacks(
  trace: Record<string, unknown>,
  record: Record<string, unknown>,
) {
  const toolCallId =
    stringValue(trace.tool_call_id) ??
    stringValue(trace.toolCallId) ??
    stringValue(record.id) ??
    stringValue(record.tool_call_id) ??
    stringValue(record.toolCallId);
  const toolName =
    stringValue(trace.tool) ??
    stringValue(record.tool_name) ??
    stringValue(record.toolName) ??
    stringValue(record.name);
  return redactTraceRecord({
    ...trace,
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    ...(toolName ? { tool: toolName } : {}),
  });
}

function titleForItem(item: Record<string, unknown>): string | null {
  const path =
    stringValue(item.path) ?? stringValue(item.href) ?? stringValue(item.slug);
  const title = stringValue(item.title) ?? stringValue(item.label);
  const line =
    numberValue(item.line) ??
    numberValue(item.startLine) ??
    numberValue(item.start_line);
  const snippet = stringValue(item.snippet) ?? stringValue(item.text);
  if (!path && !title) return null;
  const label = path
    ? `${redactTraceText(path)}${title ? ` (${redactTraceText(title)})` : ""}`
    : redactTraceText(title ?? "wiki page");
  const lineText = line != null ? ` line ${line}` : "";
  const snippetText = snippet
    ? `: ${redactTraceText(snippet).slice(0, 180)}`
    : "";
  return `${label}${lineText}${snippetText}`;
}

function traceCount(trace: Record<string, unknown>): number {
  const explicit =
    numberValue(trace.matchCount) ??
    numberValue(trace.entryCount) ??
    numberValue(trace.linkCount) ??
    numberValue(trace.backlinkCount);
  if (explicit != null) return explicit;
  const entries = arrayValue(trace.entries).length;
  if (entries > 0) return entries;
  return arrayValue(trace.links).length + arrayValue(trace.backlinks).length;
}

export function wikiContextTraceFromRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record) return null;
  if (isOkfTrace(record)) return withTraceFallbacks(record, record);

  for (const key of ["okf_wiki_trace", "okfWikiTrace"]) {
    const direct = recordValue(record[key]);
    if (isOkfTrace(direct)) return withTraceFallbacks(direct, record);
  }

  const details = recordValue(record.details);
  for (const key of ["okf_wiki_trace", "okfWikiTrace"]) {
    const detailTrace = recordValue(details[key]);
    if (isOkfTrace(detailTrace)) {
      return withTraceFallbacks(detailTrace, record);
    }
  }

  const result = recordValue(record.result);
  const resultDetails = recordValue(result.details);
  for (const value of [
    result.okf_wiki_trace,
    result.okfWikiTrace,
    resultDetails.okf_wiki_trace,
    resultDetails.okfWikiTrace,
  ]) {
    const resultTrace = recordValue(value);
    if (isOkfTrace(resultTrace)) {
      return withTraceFallbacks(resultTrace, record);
    }
  }

  return null;
}

export function wikiContextTraceKey(
  record: Record<string, unknown> | null | undefined,
): string {
  const trace = wikiContextTraceFromRecord(record);
  if (!trace) return "";
  const count = traceCount(trace);
  return [
    stringValue(trace.tool_call_id) ?? stringValue(trace.id),
    stringValue(trace.tool),
    stringValue(trace.query),
    stringValue(trace.path),
    count,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(":");
}

export function wikiContextTraceTitle(trace: Record<string, unknown>): string {
  const count = traceCount(trace);
  return `OKF wiki returned ${count} item${count === 1 ? "" : "s"}`;
}

export function formatWikiContextTraceDetail(
  trace: Record<string, unknown>,
): string {
  const bounds = recordValue(trace.bounds);
  const entries = arrayValue(trace.entries).map(recordValue).filter(Boolean);
  const links = arrayValue(trace.links).map(recordValue).filter(Boolean);
  const backlinks = arrayValue(trace.backlinks)
    .map(recordValue)
    .filter(Boolean);
  const itemLines = [...entries, ...links, ...backlinks]
    .map(titleForItem)
    .filter((line): line is string => Boolean(line))
    .slice(0, 6);
  const boundsLines = [
    numberValue(bounds.maxBytes) != null
      ? `maxBytes=${numberValue(bounds.maxBytes)}`
      : null,
    numberValue(bounds.maxResults) != null
      ? `maxResults=${numberValue(bounds.maxResults)}`
      : null,
    numberValue(bounds.maxDepth) != null
      ? `maxDepth=${numberValue(bounds.maxDepth)}`
      : null,
    boolValue(bounds.truncated) != null
      ? `truncated=${boolValue(bounds.truncated) ? "true" : "false"}`
      : null,
  ].filter(Boolean);
  const redaction = recordValue(trace.redaction);
  const startLine =
    numberValue(trace.startLine) ?? numberValue(trace.start_line);
  const endLine = numberValue(trace.endLine) ?? numberValue(trace.end_line);
  const offsetBytes =
    numberValue(trace.offsetBytes) ?? numberValue(trace.offset_bytes);
  const bytesRead =
    numberValue(trace.bytesRead) ?? numberValue(trace.bytes_read);
  const summary = [
    stringValue(trace.tool) ? `Tool: ${stringValue(trace.tool)}` : null,
    stringValue(trace.query) ? `Query: ${stringValue(trace.query)}` : null,
    stringValue(trace.path) ? `Path: ${stringValue(trace.path)}` : null,
    stringValue(trace.bundleVersion ?? trace.bundle_version)
      ? `Bundle: ${stringValue(trace.bundleVersion ?? trace.bundle_version)}`
      : null,
    `Results: ${traceCount(trace)}`,
    startLine != null || endLine != null
      ? `Lines: ${startLine ?? "?"}-${endLine ?? "?"}`
      : null,
    offsetBytes != null || bytesRead != null
      ? `Bytes: offset ${offsetBytes ?? 0}, read ${bytesRead ?? 0}`
      : null,
    boolValue(trace.truncated) || boolValue(bounds.truncated)
      ? "Status: truncated"
      : stringValue(trace.status)
        ? `Status: ${stringValue(trace.status)?.replace(/_/g, " ")}`
        : null,
    boundsLines.length ? `Bounds: ${boundsLines.join(", ")}` : null,
    stringValue(redaction.policy)
      ? `Redaction: ${stringValue(redaction.policy)}`
      : null,
  ].filter(Boolean);

  return [
    summary.join("\n"),
    itemLines.length
      ? `Pages:\n${itemLines.map((line) => `- ${line}`).join("\n")}`
      : null,
    JSON.stringify(redactTraceRecord(trace), null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function WikiContextTraceCard({ trace }: WikiContextTraceCardProps) {
  const bounds = recordValue(trace.bounds);
  const entries = arrayValue(trace.entries).map(recordValue);
  const links = arrayValue(trace.links).map(recordValue);
  const backlinks = arrayValue(trace.backlinks).map(recordValue);
  const items = [...entries, ...links, ...backlinks]
    .map(titleForItem)
    .filter((line): line is string => Boolean(line))
    .slice(0, 4);
  const truncated = boolValue(trace.truncated) || boolValue(bounds.truncated);

  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">
          {wikiContextTraceTitle(trace)}
        </span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {truncated ? "truncated" : "ok"}
        </span>
      </div>
      <div className="grid min-w-0 gap-1 [overflow-wrap:anywhere]">
        {stringValue(trace.query) ? (
          <div>Query: {stringValue(trace.query)}</div>
        ) : null}
        {stringValue(trace.path) ? (
          <div>Path: {stringValue(trace.path)}</div>
        ) : null}
        {stringValue(trace.bundleVersion ?? trace.bundle_version) ? (
          <div>
            Bundle: {stringValue(trace.bundleVersion ?? trace.bundle_version)}
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul className="grid min-w-0 list-disc gap-1 pl-4">
            {items.map((item, index) => (
              <li key={`${item}-${index}`} className="min-w-0 break-words">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <div>No pages returned.</div>
        )}
      </div>
    </div>
  );
}
