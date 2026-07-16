// Self-acquired capabilities governance feed (governed autonomy U5) +
// review workflow: everything an agent self-acquired with NO human —
// connections it self-admitted (admissionMode = 'autonomous') and routines
// it self-promoted (approvalMode = 'autonomous') — is not just listed but
// REVIEWABLE. Clicking a connection opens the full signed descriptor
// (operations, adapter, binding requirements), provenance + signature
// metadata, and live binding readiness with probe evidence. Clicking a
// routine opens the full promotion-review surface (composed code, fixtures,
// dependency contracts, hermetic gate result) with operator approve/reject.
//
// Read-only for non-operators. Nothing here exposes credential material —
// bindings surface readiness state and redacted probe evidence only.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  Ban,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@thinkwork/ui";
import {
  CapabilityCredentialBindingsQuery,
  CapabilityRuntimeCatalogQuery,
  RevokeServicePrincipalMutation,
  RoutineProposalsQuery,
  TenantServicePrincipalsQuery,
} from "@/lib/capability-runtime-queries";
import {
  FingerprintChip,
  StatusBadge,
  parseAwsJson,
} from "@/components/settings/capability-runtime-shared";
import { RoutineProposalReview } from "@/components/approvals/RoutineProposalReview";

/** Purpose stamped on every service principal an agent provisions for itself. */
const SELF_EXTENSION_PURPOSE = "autonomous self-extension";

function AutonomousChip() {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400"
      data-testid="self-acquired-autonomous-chip"
    >
      <Bot className="size-3" aria-hidden />
      autonomous
    </Badge>
  );
}

function fmt(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** Short agent-id tail so the feed stays scannable. */
function shortId(id: string | null | undefined): string {
  if (!id) return "unknown agent";
  return id.length > 12 ? `…${id.slice(-12)}` : id;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "(unrenderable)";
  }
}

/** The signed CapabilityDescriptor persisted on the admitted version. */
type ParsedDescriptor = {
  adapter?: { kind?: string; config?: { baseUrl?: string } & object };
  bindingRequirements?: {
    credentialKinds?: string[];
    principalModes?: string[];
  };
  provenance?: { sourceUrls?: string[] };
  operations?: Array<{
    operationId?: string;
    summary?: string;
    reversibility?: string;
    inputDataClass?: string;
    outputDataClass?: string;
    targetScope?: {
      kind?: string;
      resourceSelector?: { method?: string; host?: string; path?: string };
    };
  }>;
};

type ParsedSignature = {
  algorithm?: string;
  payloadHash?: string;
  signed_by?: string;
  signed_at?: string;
};

type BindingRow = {
  id: string;
  definitionVersionId: string;
  principalMode: string;
  servicePrincipalId?: string | null;
  readiness: string;
  readinessEvidence?: unknown;
  lastVerifiedAt?: string | null;
  revokedAt?: string | null;
};

function opTarget(
  op: NonNullable<ParsedDescriptor["operations"]>[number],
): string {
  const scope = op.targetScope;
  if (!scope) return "—";
  if (scope.kind === "open_world") return "open world";
  const sel = scope.resourceSelector;
  if (sel && (sel.method || sel.path)) {
    return `${sel.method ?? ""} ${sel.path ?? ""}`.trim();
  }
  return scope.kind ?? "—";
}

/**
 * Full review panel for one self-admitted connection: signed descriptor
 * (operations, adapter, binding requirements), provenance + signature, and
 * live binding readiness with redacted probe evidence.
 */
function ConnectionDetail({
  definition,
  bindings,
  canManage,
  onRevoke,
}: {
  definition: {
    id: string;
    slug: string;
    admittedVersion?: {
      id: string;
      version: number;
      lifecycle: string;
      descriptorFingerprint: string;
      descriptor?: unknown;
      provenance?: unknown;
      signature?: unknown;
      admittedAt?: string | null;
      admissionMode?: string | null;
      admittedByAgentId?: string | null;
      operations: Array<{
        operationId: string;
        twcap: string;
        effect: string;
        costClass: string;
        latencyClass: string;
        outputClass: string;
        executable: boolean;
        withheldReasons: string[];
      }>;
    } | null;
  };
  bindings: BindingRow[];
  canManage: boolean;
  onRevoke: (servicePrincipalId: string) => void;
}) {
  const admitted = definition.admittedVersion;
  const descriptor = (parseAwsJson(admitted?.descriptor) ??
    null) as ParsedDescriptor | null;
  const signature = (parseAwsJson(admitted?.signature) ??
    null) as ParsedSignature | null;
  const provenance = parseAwsJson(admitted?.provenance);
  const descriptorOps = new Map(
    (descriptor?.operations ?? []).map((op) => [op.operationId, op]),
  );
  const sourceUrls =
    descriptor?.provenance?.sourceUrls ??
    (provenance as { sourceUrls?: string[] } | null)?.sourceUrls ??
    [];

  if (!admitted) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        No admitted version — nothing to review.
      </p>
    );
  }

  const versionBindings = bindings.filter(
    (binding) => binding.definitionVersionId === admitted.id,
  );

  return (
    <div
      className="mt-2 space-y-4 border-t pt-3"
      data-testid={`self-acquired-connection-detail-${definition.id}`}
    >
      {/* Provenance: who admitted this, when, under which mode, and the
          platform signature over the exact descriptor below. */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Provenance
        </h4>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="text-muted-foreground">
            v{admitted.version}
          </Badge>
          <StatusBadge status={admitted.lifecycle} />
          <span className="text-muted-foreground">
            admitted by {shortId(admitted.admittedByAgentId)} ·{" "}
            {fmt(admitted.admittedAt)} · mode{" "}
            {admitted.admissionMode ?? "operator"}
          </span>
          <FingerprintChip
            label="descriptor"
            fingerprint={admitted.descriptorFingerprint}
          />
        </div>
        {signature ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid={`self-acquired-signature-${definition.id}`}
          >
            signed by <span className="font-mono">{signature.signed_by}</span>{" "}
            at {fmt(signature.signed_at)}
            {signature.algorithm ? ` (${signature.algorithm})` : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No signature envelope recorded.
          </p>
        )}
        {sourceUrls.length > 0 ? (
          <p className="text-xs break-all text-muted-foreground">
            sources: {sourceUrls.join(" · ")}
          </p>
        ) : null}
      </section>

      {/* Adapter + binding requirements from the signed descriptor. */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Adapter &amp; binding requirements
        </h4>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline" className="text-muted-foreground">
            adapter: {descriptor?.adapter?.kind ?? "unknown"}
          </Badge>
          {descriptor?.adapter?.config?.baseUrl ? (
            <span className="font-mono break-all text-muted-foreground">
              {descriptor.adapter.config.baseUrl}
            </span>
          ) : null}
          <Badge variant="outline" className="text-muted-foreground">
            credentials:{" "}
            {(descriptor?.bindingRequirements?.credentialKinds?.length ?? 0) ===
            0
              ? "none (credential-free)"
              : descriptor?.bindingRequirements?.credentialKinds?.join(", ")}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            principals:{" "}
            {descriptor?.bindingRequirements?.principalModes?.join(", ") ?? "—"}
          </Badge>
        </div>
      </section>

      {/* Every operation the agent granted itself, with the risk-relevant
          contract annotations. */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Operations
        </h4>
        {admitted.operations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The admitted version declares no operations.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid={`self-acquired-ops-${definition.id}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Effect</TableHead>
                  <TableHead>Reversibility</TableHead>
                  <TableHead>Data in / out</TableHead>
                  <TableHead>Cost / latency / output</TableHead>
                  <TableHead>Executable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admitted.operations.map((operation) => {
                  const raw = descriptorOps.get(operation.operationId);
                  return (
                    <TableRow key={operation.operationId}>
                      <TableCell
                        className="font-mono text-xs"
                        title={operation.twcap}
                      >
                        {operation.operationId}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {raw ? opTarget(raw) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {operation.effect}
                      </TableCell>
                      <TableCell className="text-xs">
                        {raw?.reversibility ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {raw
                          ? `${raw.inputDataClass ?? "?"} / ${raw.outputDataClass ?? "?"}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {operation.costClass} / {operation.latencyClass} /{" "}
                        {operation.outputClass}
                      </TableCell>
                      <TableCell
                        className="text-xs"
                        title={operation.withheldReasons.join("; ")}
                      >
                        {operation.executable ? "executable" : "withheld"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Binding readiness + redacted probe evidence (statusCode/duration/
          failureKind only — never provider bodies or credentials). */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Binding status
        </h4>
        {versionBindings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No credential bindings for the admitted version.
          </p>
        ) : (
          <ul className="space-y-2">
            {versionBindings.map((binding) => {
              const evidence = parseAwsJson(binding.readinessEvidence) as {
                statusCode?: number;
                durationMs?: number;
                failureKind?: string;
              } | null;
              return (
                <li
                  key={binding.id}
                  className="rounded-md bg-muted/40 px-3 py-2"
                  data-testid={`self-acquired-binding-${binding.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status={binding.readiness} />
                    <span className="text-muted-foreground">
                      {binding.principalMode} principal
                      {binding.lastVerifiedAt
                        ? ` · verified ${fmt(binding.lastVerifiedAt)}`
                        : ""}
                      {binding.revokedAt
                        ? ` · revoked ${fmt(binding.revokedAt)}`
                        : ""}
                    </span>
                    {canManage &&
                    binding.servicePrincipalId &&
                    !binding.revokedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() =>
                          onRevoke(binding.servicePrincipalId as string)
                        }
                        data-testid={`self-acquired-binding-revoke-${binding.id}`}
                      >
                        Revoke access
                      </Button>
                    ) : null}
                  </div>
                  {evidence &&
                  (evidence.statusCode != null ||
                    evidence.durationMs != null ||
                    evidence.failureKind) ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      probe:{" "}
                      {evidence.statusCode != null
                        ? `status ${evidence.statusCode}`
                        : (evidence.failureKind ?? "no result")}
                      {evidence.durationMs != null
                        ? ` · ${evidence.durationMs}ms`
                        : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* The exact signed bytes, for a from-first-principles review. */}
      <details data-testid={`self-acquired-descriptor-raw-${definition.id}`}>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Raw descriptor JSON
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
          {compactJson(descriptor ?? parseAwsJson(admitted.descriptor))}
        </pre>
      </details>
    </div>
  );
}

export function SelfAcquiredView({
  tenantId,
  canManage,
}: {
  tenantId: string;
  canManage: boolean;
}) {
  const [catalog, refetchCatalog] = useQuery({
    query: CapabilityRuntimeCatalogQuery,
    variables: { tenantId },
  });
  const [routines, refetchRoutines] = useQuery({
    query: RoutineProposalsQuery,
    variables: { tenantId },
  });
  const [principals, refetchPrincipals] = useQuery({
    query: TenantServicePrincipalsQuery,
    variables: { tenantId },
  });
  const [bindings, refetchBindings] = useQuery({
    query: CapabilityCredentialBindingsQuery,
    variables: { tenantId },
  });
  const [, revokeServicePrincipal] = useMutation(
    RevokeServicePrincipalMutation,
  );

  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Independently expandable review panels.
  const [openConnections, setOpenConnections] = useState<Set<string>>(
    new Set(),
  );
  const [openRoutines, setOpenRoutines] = useState<Set<string>>(new Set());

  function toggle(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Connections an agent self-admitted (admittedVersion.admissionMode).
  const selfAdmitted = useMemo(
    () =>
      (catalog.data?.capabilityRuntimeCatalog ?? []).filter(
        (def) => def.admittedVersion?.admissionMode === "autonomous",
      ),
    [catalog.data],
  );

  // Routines an agent self-promoted (approvalMode).
  const selfPromoted = useMemo(
    () =>
      (routines.data?.routineProposals ?? []).filter(
        (p) => p.approvalMode === "autonomous",
      ),
    [routines.data],
  );

  // The agents' self-extension service principals — the revoke handle. An
  // already-revoked one still shows (as the audit record) but isn't revocable.
  const selfPrincipals = useMemo(
    () =>
      (principals.data?.tenantServicePrincipals ?? []).filter(
        (p) => p.purpose === SELF_EXTENSION_PURPOSE,
      ),
    [principals.data],
  );

  const allBindings = (bindings.data?.capabilityCredentialBindings ??
    []) as BindingRow[];

  const loading = catalog.fetching || routines.fetching || principals.fetching;
  const error = catalog.error ?? routines.error ?? principals.error;
  const empty =
    !loading &&
    selfAdmitted.length === 0 &&
    selfPromoted.length === 0 &&
    selfPrincipals.length === 0;

  /** Revoke by service-principal id — from the access list or a binding. */
  function requestRevoke(servicePrincipalId: string) {
    const principal = selfPrincipals.find((p) => p.id === servicePrincipalId);
    setRevokeTarget({
      id: servicePrincipalId,
      label: principal?.displayName ?? servicePrincipalId,
    });
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const servicePrincipalId = revokeTarget.id;
    setRevokeTarget(null);
    setPendingId(servicePrincipalId);
    const result = await revokeServicePrincipal({
      tenantId,
      servicePrincipalId,
    });
    setPendingId(null);
    if (
      result.error ||
      result.data?.revokeServicePrincipal.outcome === "rejected"
    ) {
      toast.error("Revoke rejected", {
        description:
          result.error?.message ??
          result.data?.revokeServicePrincipal.reason ??
          undefined,
      });
      return;
    }
    toast.success("Self-acquired capability revoked");
    refetchPrincipals({ requestPolicy: "network-only" });
    refetchCatalog({ requestPolicy: "network-only" });
    refetchRoutines({ requestPolicy: "network-only" });
    refetchBindings({ requestPolicy: "network-only" });
  }

  if (loading) {
    return (
      <div className="space-y-3" data-testid="self-acquired-loading">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn’t load self-acquired capabilities — {error.message}
      </div>
    );
  }

  if (empty) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
        data-testid="self-acquired-empty"
      >
        <ShieldCheck className="size-6" aria-hidden />
        <p className="font-medium text-foreground">
          No self-acquired capabilities
        </p>
        <p className="max-w-md">
          When an agent teaches itself a public, read-only capability, it
          appears here with full provenance and a one-click revoke. Nothing
          credentialed or writing is ever self-acquired — those wait for your
          approval.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="self-acquired-view">
      {/* Self-acquired service principals — the revoke handle. */}
      {selfPrincipals.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Self-acquired access</h3>
          <p className="text-xs text-muted-foreground">
            Each agent that self-extends acts through one revocable service
            principal. Revoke it to block every capability that agent acquired
            at the next run.
          </p>
          <ul className="divide-y rounded-md border">
            {selfPrincipals.map((sp) => {
              const revoked = sp.status === "revoked";
              return (
                <li
                  key={sp.id}
                  className="flex items-center justify-between gap-3 p-3"
                  data-testid={`self-acquired-principal-${sp.id}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {sp.displayName}
                      </span>
                      {revoked ? (
                        <Badge
                          variant="outline"
                          className="gap-1 text-muted-foreground"
                        >
                          <Ban className="size-3" aria-hidden />
                          revoked
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        >
                          <CircleCheck className="size-3" aria-hidden />
                          active
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {sp.slug} · created {fmt(sp.createdAt)}
                      {revoked ? ` · revoked ${fmt(sp.revokedAt)}` : ""}
                    </p>
                  </div>
                  {canManage && !revoked && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pendingId === sp.id}
                      onClick={() =>
                        setRevokeTarget({ id: sp.id, label: sp.displayName })
                      }
                      data-testid={`self-acquired-revoke-${sp.id}`}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Connections an agent self-admitted — click to review the full
          signed descriptor, provenance, and binding readiness. */}
      {selfAdmitted.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Self-admitted connections</h3>
          <ul className="divide-y rounded-md border">
            {selfAdmitted.map((def) => {
              const isOpen = openConnections.has(def.id);
              return (
                <li
                  key={def.id}
                  className="p-3"
                  data-testid={`self-acquired-connection-${def.id}`}
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => toggle(setOpenConnections, def.id)}
                    aria-expanded={isOpen}
                    data-testid={`self-acquired-connection-toggle-${def.id}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {def.displayName}
                    </span>
                    <AutonomousChip />
                  </button>
                  <p className="mt-1 ml-6 text-xs text-muted-foreground">
                    {def.namespace}/{def.class}/{def.slug} · admitted by{" "}
                    {shortId(def.admittedVersion?.admittedByAgentId)} ·{" "}
                    {fmt(def.admittedVersion?.admittedAt)}
                  </p>
                  {isOpen ? (
                    <div className="ml-6">
                      <ConnectionDetail
                        definition={def}
                        bindings={allBindings}
                        canManage={canManage}
                        onRevoke={requestRevoke}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Routines an agent self-promoted — click to review the composed
          code, fixtures, and hermetic gate evidence, and approve/reject. */}
      {selfPromoted.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Self-promoted routines</h3>
          <ul className="divide-y rounded-md border">
            {selfPromoted.map((p) => {
              const isOpen = openRoutines.has(p.id);
              return (
                <li
                  key={p.id}
                  className="p-3"
                  data-testid={`self-acquired-routine-${p.id}`}
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => toggle(setOpenRoutines, p.id)}
                    aria-expanded={isOpen}
                    data-testid={`self-acquired-routine-toggle-${p.id}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">
                      {p.routineId
                        ? `Routine ${shortId(p.routineId)}`
                        : "Routine"}
                    </span>
                    <AutonomousChip />
                    <Badge variant="outline" className="text-muted-foreground">
                      {p.status}
                    </Badge>
                  </button>
                  <p className="mt-1 ml-6 text-xs text-muted-foreground">
                    composed by {shortId(p.createdByActorId)} ·{" "}
                    {p.promotedCommitSha
                      ? `promoted ${p.promotedCommitSha.slice(0, 12)}`
                      : "not yet promoted"}{" "}
                    · {fmt(p.decidedAt ?? p.createdAt)}
                  </p>
                  {isOpen ? (
                    <div
                      className="mt-2 ml-6 border-t pt-3"
                      data-testid={`self-acquired-routine-detail-${p.id}`}
                    >
                      <RoutineProposalReview
                        proposalId={p.id}
                        tenantId={tenantId}
                        readOnly={!canManage}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke self-acquired access?</AlertDialogTitle>
            <AlertDialogDescription>
              This revokes “{revokeTarget?.label}”. Every capability that agent
              self-acquired stops working at its next run (binding_revoked). The
              signed audit records stay. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
