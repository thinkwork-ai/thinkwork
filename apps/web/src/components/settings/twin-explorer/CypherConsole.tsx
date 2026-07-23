import { useCallback, useMemo, useState } from "react";
import { useQuery } from "urql";
import { Loader2, Play } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { TwinRawQuery } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";

/**
 * Client-side mirror of the server denylist + comment stripping — instant
 * feedback only; the SERVER (twin-query handler via `prepareRawCypher`) is
 * authoritative. Keep in lockstep with packages/api/src/lib/twin/
 * query-compiler.ts.
 */
const CLIENT_DENYLIST_RE =
  /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|CALL|LOAD)\b/i;

export function clientDenylistHit(text: string): string | null {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = CLIENT_DENYLIST_RE.exec(stripped);
  return match ? match[1]!.toUpperCase() : null;
}

export interface RawQueryEnvelope {
  ok: boolean;
  results?: unknown[];
  redactedCount?: number;
  unfenced?: boolean;
  truncated?: boolean;
  reason?: string;
  detail?: string;
}

export function parseRawEnvelope(value: unknown): RawQueryEnvelope | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof (parsed as { ok?: unknown }).ok !== "boolean") return null;
    return parsed as RawQueryEnvelope;
  } catch {
    return null;
  }
}

/** Rows render as a table only when every row is a flat uniform object. */
export function tableColumns(rows: unknown[]): string[] | null {
  if (rows.length === 0) return null;
  let columns: string[] | null = null;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const keys = Object.keys(row as object);
    if (keys.length === 0) return null;
    if (columns === null) columns = keys;
    else if (
      columns.length !== keys.length ||
      !keys.every((key) => columns!.includes(key))
    ) {
      return null;
    }
  }
  return columns;
}

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Operator Cypher console (THINK-327 U6, R9/R10): toggle-revealed raw
 * query surface for testing queries against the tenant's subgraph.
 * Server-guarded (see twinRawQuery); this surface adds instant client
 * feedback, in-flight locking (no double submits, no duplicate audit
 * events), and the redaction/unfenced caveats.
 */
export function CypherConsole() {
  const { tenantId } = useTenant();
  const [text, setText] = useState(
    "MATCH (n:customer) WHERE n.tenantId = $tenantId RETURN count(n)",
  );
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [clientRejection, setClientRejection] = useState<string | null>(null);

  const [{ data, fetching, error }, reexecute] = useQuery<{
    twinRawQuery?: unknown;
  }>({
    query: TwinRawQuery,
    variables: { tenantId, query: submitted ?? "" },
    pause: !tenantId || submitted === null,
  });

  const run = useCallback(() => {
    if (fetching) return;
    const denied = clientDenylistHit(text);
    if (denied) {
      setClientRejection(denied);
      return;
    }
    setClientRejection(null);
    if (text === submitted) {
      reexecute({ requestPolicy: "network-only" });
    } else {
      setSubmitted(text);
    }
  }, [fetching, text, submitted, reexecute]);

  const envelope = useMemo(() => parseRawEnvelope(data?.twinRawQuery), [data]);
  const rows = envelope?.ok ? (envelope.results ?? []) : [];
  const columns = useMemo(() => tableColumns(rows), [rows]);

  return (
    <section
      className="space-y-2 rounded-lg border border-border p-3"
      data-testid="cypher-console"
    >
      {/* Just the input and Run (R2) — no heading, no read-only caption;
          the redaction/unfenced banners still explain fencing when it
          actually bites. */}
      <textarea
        className="min-h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground"
        aria-label="openCypher query"
        data-testid="console-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            run();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          data-testid="console-run"
          disabled={fetching || !text.trim()}
          onClick={run}
        >
          {fetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Run
        </Button>
        <span className="text-xs text-muted-foreground">⌘⏎</span>
        {fetching ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="console-pending"
          >
            Running… (up to 10s)
          </span>
        ) : null}
      </div>

      {clientRejection ? (
        <p
          className="text-sm text-amber-600"
          data-testid="console-client-reject"
        >
          {clientRejection} is a write/procedure clause — the console is
          read-only, so this wasn&apos;t sent.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-500" role="alert">
          {error.message}
        </p>
      ) : null}
      {envelope && !envelope.ok ? (
        <p
          className="text-sm text-amber-600"
          data-testid="console-server-reject"
        >
          {envelope.reason === "invalid_request"
            ? `The server rejected this query: ${envelope.detail ?? "invalid"}`
            : `The twin isn't available right now${envelope.detail ? ` (${envelope.detail})` : ""}.`}
        </p>
      ) : null}

      {envelope?.ok ? (
        <div className="space-y-2">
          {(envelope.redactedCount ?? 0) > 0 ? (
            <p
              className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-600"
              data-testid="console-redaction-banner"
            >
              {envelope.redactedCount} result
              {envelope.redactedCount === 1 ? "" : "s"} outside your tenant
              {envelope.redactedCount === 1 ? " was" : " were"} redacted.
            </p>
          ) : null}
          {envelope.unfenced ? (
            <p
              className="rounded-md bg-sky-500/10 px-2 py-1 text-xs text-sky-600"
              data-testid="console-unfenced-banner"
            >
              Unfenced aggregate: scalar values can&apos;t be attributed to a
              tenant — scope your query with{" "}
              <code className="font-mono">n.tenantId = $tenantId</code>.
            </p>
          ) : null}
          {envelope.truncated ? (
            <p className="text-xs text-muted-foreground">
              Results truncated to the first 100 rows.
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows.</p>
          ) : columns ? (
            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-xs"
                data-testid="console-table"
              >
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column}
                        className="border-b border-border px-2 py-1 font-medium text-muted-foreground"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td
                          key={column}
                          className="border-b border-border/50 px-2 py-1 font-mono"
                        >
                          {formatCell((row as Record<string, unknown>)[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre
              className="max-h-80 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs"
              data-testid="console-json"
            >
              {JSON.stringify(rows, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </section>
  );
}
