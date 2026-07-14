import {
  Ban,
  CircleCheck,
  CircleHelp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

/**
 * THINK-280 U7 — governed capability-headless execution evidence panel.
 *
 * Renders the readiness verdict + broker-call evidence chain for a
 * capability-backed Routine run. The status is conveyed by ICON + LABEL, never
 * color alone (plan U7: blocked/degraded/indeterminate must be distinguishable
 * without relying on color), and binding-revocation remediation renders
 * adjacent to the run outcome. Purely presentational; all fields come from the
 * RoutineExecutionDetail query and are NULL on ordinary (non-capability) runs,
 * in which case this panel renders nothing.
 */

export interface CapabilityBrokerCallView {
  id: string;
  clientRequestId: string;
  operationRef?: string | null;
  contractHash?: string | null;
  status: string;
  errorCategory?: string | null;
  effect?: string | null;
  adapterKind?: string | null;
  durationMs?: number | null;
}

export interface CapabilityRunEvidenceProps {
  readinessOutcome?: string | null;
  executionPrincipal?: unknown;
  capabilityDependencies?: unknown;
  configFingerprint?: string | null;
  brokerSessionId?: string | null;
  remediation?: unknown;
  brokerCalls?: CapabilityBrokerCallView[] | null;
}

type Verdict = "ready" | "blocked" | "degraded" | "indeterminate";

const VERDICT_META: Record<
  Verdict,
  { icon: LucideIcon; label: string; tone: string }
> = {
  ready: {
    icon: CircleCheck,
    label: "Ready",
    tone: "text-green-600 dark:text-green-400",
  },
  blocked: {
    icon: Ban,
    label: "Blocked",
    tone: "text-red-600 dark:text-red-400",
  },
  degraded: {
    icon: TriangleAlert,
    label: "Degraded",
    tone: "text-amber-600 dark:text-amber-400",
  },
  indeterminate: {
    icon: CircleHelp,
    label: "Indeterminate",
    tone: "text-purple-600 dark:text-purple-400",
  },
};

function normalizeVerdict(value?: string | null): Verdict | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (
    v === "ready" ||
    v === "blocked" ||
    v === "degraded" ||
    v === "indeterminate"
  ) {
    return v;
  }
  return null;
}

/** Parse an AWSJSON scalar that may arrive as a JSON string or an object. */
function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function remediationText(remediation: unknown): string | null {
  const parsed = parseJsonish(remediation);
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, unknown>;
  const msg = r.message ?? r.reason ?? r.remediation;
  return typeof msg === "string" && msg.length > 0 ? msg : null;
}

export function CapabilityRunEvidence({
  readinessOutcome,
  executionPrincipal,
  capabilityDependencies,
  configFingerprint,
  brokerSessionId,
  remediation,
  brokerCalls,
}: CapabilityRunEvidenceProps) {
  const verdict = normalizeVerdict(readinessOutcome);
  // Non-capability runs carry none of these fields — render nothing.
  if (!verdict && !brokerSessionId && !executionPrincipal) return null;

  const meta = verdict ? VERDICT_META[verdict] : null;
  const Icon = meta?.icon;
  const principal = parseJsonish(executionPrincipal) as {
    mode?: string;
    subjectId?: string;
  } | null;
  const deps = parseJsonish(capabilityDependencies);
  const depList = Array.isArray(deps)
    ? (deps as Array<Record<string, unknown>>)
    : [];
  const remediationMsg = remediationText(remediation);
  const calls = brokerCalls ?? [];

  return (
    <section
      aria-label="Governed capability run evidence"
      data-testid="capability-run-evidence"
      className="rounded-md border border-border p-3 text-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        {Icon && meta ? (
          <span
            className={`inline-flex items-center gap-1.5 font-medium ${meta.tone}`}
          >
            <Icon aria-hidden className="h-4 w-4" />
            <span data-testid="capability-readiness-label">{meta.label}</span>
          </span>
        ) : (
          <span className="font-medium text-muted-foreground">
            Capability run
          </span>
        )}
        {principal?.mode && (
          <span className="text-xs text-muted-foreground">
            principal: {principal.mode}
            {principal.subjectId ? ` · ${principal.subjectId}` : ""}
          </span>
        )}
      </div>

      {/* Remediation renders adjacent to the outcome for blocked/degraded runs. */}
      {remediationMsg && (
        <div
          data-testid="capability-remediation"
          role="alert"
          className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="font-medium">Remediation:</span> {remediationMsg}
        </div>
      )}

      {configFingerprint && (
        <div className="mb-1 text-xs text-muted-foreground">
          config fingerprint:{" "}
          <code className="font-mono">{configFingerprint.slice(0, 16)}…</code>
        </div>
      )}

      {depList.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-medium text-muted-foreground">
            Pinned dependencies
          </div>
          <ul className="mt-1 space-y-0.5">
            {depList.map((d, i) => (
              <li key={i} className="font-mono text-xs">
                {String(d.twcap ?? "?")}
                {d.contractHash
                  ? ` @ ${String(d.contractHash).slice(0, 12)}…`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {calls.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground">
            Broker calls ({calls.length})
          </div>
          <ul className="mt-1 space-y-0.5">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono">
                  {c.operationRef ?? c.clientRequestId}
                </span>
                <span className="text-muted-foreground">
                  {c.status}
                  {c.errorCategory ? ` · ${c.errorCategory}` : ""}
                  {c.effect ? ` · ${c.effect}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
