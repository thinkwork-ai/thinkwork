// Self-acquired capabilities governance feed (governed autonomy U5).
//
// The operator's safety net for the AUTO tier: everything an agent
// self-acquired with NO human — connections it self-admitted
// (admissionMode = 'autonomous') and routines it self-promoted
// (approvalMode = 'autonomous') — surfaced with provenance (which agent,
// when) and a one-click revoke. Revoking the agent's self-extension service
// principal blocks every capability it acquired at the next run
// (binding_revoked); the signed version rows stay as an immutable audit trail.
//
// Read-only for non-operators. Nothing here exposes credential material.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Ban, Bot, CircleCheck, ShieldCheck } from "lucide-react";
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
} from "@thinkwork/ui";
import {
  CapabilityRuntimeCatalogQuery,
  RevokeServicePrincipalMutation,
  RoutineProposalsQuery,
  TenantServicePrincipalsQuery,
} from "@/lib/capability-runtime-queries";

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
  const [, revokeServicePrincipal] = useMutation(
    RevokeServicePrincipalMutation,
  );

  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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

  const loading = catalog.fetching || routines.fetching || principals.fetching;
  const error = catalog.error ?? routines.error ?? principals.error;
  const empty =
    !loading &&
    selfAdmitted.length === 0 &&
    selfPromoted.length === 0 &&
    selfPrincipals.length === 0;

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

      {/* Connections an agent self-admitted. */}
      {selfAdmitted.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Self-admitted connections</h3>
          <ul className="divide-y rounded-md border">
            {selfAdmitted.map((def) => (
              <li
                key={def.id}
                className="space-y-1 p-3"
                data-testid={`self-acquired-connection-${def.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{def.displayName}</span>
                  <AutonomousChip />
                </div>
                <p className="text-xs text-muted-foreground">
                  {def.namespace}/{def.class}/{def.slug} · admitted by{" "}
                  {shortId(def.admittedVersion?.admittedByAgentId)} ·{" "}
                  {fmt(def.admittedVersion?.admittedAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Routines an agent self-promoted. */}
      {selfPromoted.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Self-promoted routines</h3>
          <ul className="divide-y rounded-md border">
            {selfPromoted.map((p) => (
              <li
                key={p.id}
                className="space-y-1 p-3"
                data-testid={`self-acquired-routine-${p.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {p.routineId
                      ? `Routine ${shortId(p.routineId)}`
                      : "Routine"}
                  </span>
                  <AutonomousChip />
                  <Badge variant="outline" className="text-muted-foreground">
                    {p.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  composed by {shortId(p.createdByActorId)} ·{" "}
                  {p.promotedCommitSha
                    ? `promoted ${p.promotedCommitSha.slice(0, 12)}`
                    : "not yet promoted"}{" "}
                  · {fmt(p.decidedAt ?? p.createdAt)}
                </p>
              </li>
            ))}
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
