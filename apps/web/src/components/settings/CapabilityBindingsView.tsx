// Bindings view (THINK-280 U2): per-binding credential readiness for
// admitted definition versions, plus tenant service-principal management.
// One explicit principal mode per binding — action-time resolution never
// falls back across modes (R6). Verify runs the declared cheap read-only
// probe inside the trusted API path and moves ONLY that binding; credential
// material never appears here (vault references only, evidence redacted).
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Ban, CircleCheck, Clock, Loader2, TriangleAlert } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@thinkwork/ui";
import {
  CapabilityCredentialBindingsQuery,
  CapabilityRuntimeCatalogQuery,
  CreateCredentialBindingMutation,
  CreateServicePrincipalMutation,
  RevokeCredentialBindingMutation,
  RevokeServicePrincipalMutation,
  TenantServicePrincipalsQuery,
  VerifyCredentialBindingMutation,
} from "@/lib/capability-runtime-queries";
import { SettingsTenantMembersQuery } from "@/lib/settings-queries";
import { parseAwsJson } from "@/components/settings/capability-runtime-shared";

const PRINCIPAL_MODES = ["requester", "agent_owner", "service"] as const;
const NONE_VALUE = "__none__";

/** Probe evidence older than this reads as stale (surfaced, never hidden). */
const STALE_EVIDENCE_MS = 24 * 60 * 60 * 1000;

/**
 * Readiness chip: icon + verbatim label, never color alone
 * (pending_setup | verifying | ready | degraded | revoked).
 */
function ReadinessChip({ readiness }: { readiness: string }) {
  const chips: Record<string, { icon: React.ReactNode; className: string }> = {
    pending_setup: {
      icon: <Clock className="size-3" aria-hidden />,
      className: "text-muted-foreground",
    },
    verifying: {
      icon: <Loader2 className="size-3 animate-spin" aria-hidden />,
      className:
        "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    },
    ready: {
      icon: <CircleCheck className="size-3" aria-hidden />,
      className:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    degraded: {
      icon: <TriangleAlert className="size-3" aria-hidden />,
      className:
        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
    revoked: {
      icon: <Ban className="size-3" aria-hidden />,
      className: "text-muted-foreground",
    },
  };
  const chip = chips[readiness] ?? {
    icon: null,
    className: "text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={`gap-1 ${chip.className}`}
      data-testid={`binding-readiness-${readiness}`}
    >
      {chip.icon}
      {readiness}
    </Badge>
  );
}

/** Compact one-line summary of the redacted probe evidence. */
function evidenceSummary(evidence: unknown): string | null {
  const parsed = parseAwsJson(evidence);
  if (parsed == null || typeof parsed !== "object") return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => {
      const rendered =
        value == null
          ? "—"
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      return `${key}: ${rendered}`;
    })
    .join(" · ")
    .slice(0, 240);
}

export function CapabilityBindingsView({
  tenantId,
  canManage,
}: {
  tenantId: string;
  /** Operator gate for creates/revokes; readiness stays readable for all. */
  canManage: boolean;
}) {
  const [bindingsResult, refetchBindings] = useQuery({
    query: CapabilityCredentialBindingsQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [principalsResult, refetchPrincipals] = useQuery({
    query: TenantServicePrincipalsQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [catalogResult] = useQuery({
    query: CapabilityRuntimeCatalogQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [membersResult] = useQuery({
    query: SettingsTenantMembersQuery,
    variables: { tenantId },
    pause: !tenantId,
  });

  const [, createServicePrincipal] = useMutation(
    CreateServicePrincipalMutation,
  );
  const [, revokeServicePrincipal] = useMutation(
    RevokeServicePrincipalMutation,
  );
  const [, createBinding] = useMutation(CreateCredentialBindingMutation);
  const [, verifyBinding] = useMutation(VerifyCredentialBindingMutation);
  const [, revokeBinding] = useMutation(RevokeCredentialBindingMutation);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revokeBindingTarget, setRevokeBindingTarget] = useState<string | null>(
    null,
  );
  const [revokePrincipalTarget, setRevokePrincipalTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // "New service principal" dialog state.
  const [principalDialogOpen, setPrincipalDialogOpen] = useState(false);
  const [principalSlug, setPrincipalSlug] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [principalPurpose, setPrincipalPurpose] = useState("");

  // "New binding" dialog state.
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [bindingVersionId, setBindingVersionId] = useState("");
  const [bindingMode, setBindingMode] =
    useState<(typeof PRINCIPAL_MODES)[number]>("requester");
  const [bindingPrincipalId, setBindingPrincipalId] = useState("");
  const [bindingSubjectUserId, setBindingSubjectUserId] = useState(NONE_VALUE);
  const [bindingCredentialRefs, setBindingCredentialRefs] = useState("");

  const bindings = useMemo(
    () => bindingsResult.data?.capabilityCredentialBindings ?? [],
    [bindingsResult.data?.capabilityCredentialBindings],
  );
  const principals = useMemo(
    () => principalsResult.data?.tenantServicePrincipals ?? [],
    [principalsResult.data?.tenantServicePrincipals],
  );
  const activePrincipals = useMemo(
    () => principals.filter((principal) => principal.status === "active"),
    [principals],
  );
  const principalById = useMemo(
    () => new Map(principals.map((principal) => [principal.id, principal])),
    [principals],
  );
  const members = useMemo(
    () =>
      (membersResult.data?.tenantMembers ?? [])
        .filter(
          (member) =>
            member.principalType.toUpperCase() === "USER" && member.user?.id,
        )
        .map((member) => ({
          id: member.user!.id,
          name: member.user!.name ?? member.user!.email ?? member.principalId,
        })),
    [membersResult.data?.tenantMembers],
  );
  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  // Admitted version id → "<displayName> v<n>" label from the catalog.
  const versionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const definition of catalogResult.data?.capabilityRuntimeCatalog ??
      []) {
      for (const version of definition.versions) {
        map.set(version.id, `${definition.displayName} v${version.version}`);
      }
    }
    return map;
  }, [catalogResult.data?.capabilityRuntimeCatalog]);
  const admittedVersionOptions = useMemo(
    () =>
      (catalogResult.data?.capabilityRuntimeCatalog ?? [])
        .filter((definition) => definition.admittedVersion)
        .map((definition) => ({
          id: definition.admittedVersion!.id,
          label: `${definition.displayName} v${definition.admittedVersion!.version}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [catalogResult.data?.capabilityRuntimeCatalog],
  );

  const bindingsByVersion = useMemo(() => {
    const map = new Map<string, typeof bindings>();
    for (const binding of bindings) {
      const list = map.get(binding.definitionVersionId) ?? [];
      list.push(binding);
      map.set(binding.definitionVersionId, list);
    }
    return [...map.entries()].sort(([a], [b]) =>
      (versionLabelById.get(a) ?? a).localeCompare(
        versionLabelById.get(b) ?? b,
      ),
    );
  }, [bindings, versionLabelById]);

  function subjectLabel(binding: (typeof bindings)[number]): string {
    if (binding.principalMode === "service") {
      const principal = binding.servicePrincipalId
        ? principalById.get(binding.servicePrincipalId)
        : null;
      return principal?.displayName ?? binding.servicePrincipalId ?? "service";
    }
    if (binding.subjectUserId) {
      return memberNameById.get(binding.subjectUserId) ?? binding.subjectUserId;
    }
    return "any user";
  }

  function surfaceOutcome(
    error: { message: string } | undefined,
    outcome: { outcome: string; reason?: string | null } | null | undefined,
    successMessage: string,
  ): boolean {
    if (error || outcome?.outcome === "rejected") {
      toast.error("Request rejected", {
        description: error?.message ?? outcome?.reason ?? undefined,
      });
      return false;
    }
    toast.success(successMessage);
    return true;
  }

  async function runVerify(bindingId: string) {
    setPendingId(bindingId);
    const result = await verifyBinding({ tenantId, bindingId });
    setPendingId(null);
    if (
      surfaceOutcome(
        result.error,
        result.data?.verifyCredentialBinding,
        `Probe finished — ${
          result.data?.verifyCredentialBinding.binding?.readiness ?? "updated"
        }`,
      )
    ) {
      refetchBindings({ requestPolicy: "network-only" });
    }
  }

  async function confirmRevokeBinding() {
    if (!revokeBindingTarget) return;
    const bindingId = revokeBindingTarget;
    setRevokeBindingTarget(null);
    setPendingId(bindingId);
    const result = await revokeBinding({ tenantId, bindingId });
    setPendingId(null);
    if (
      surfaceOutcome(
        result.error,
        result.data?.revokeCredentialBinding,
        "Binding revoked",
      )
    ) {
      refetchBindings({ requestPolicy: "network-only" });
    }
  }

  async function submitServicePrincipal() {
    const slug = principalSlug.trim();
    const displayName = principalName.trim();
    if (!slug || !displayName) return;
    setPendingId("new-principal");
    const result = await createServicePrincipal({
      input: {
        tenantId,
        slug,
        displayName,
        purpose: principalPurpose.trim() || null,
      },
    });
    setPendingId(null);
    if (
      surfaceOutcome(
        result.error,
        result.data?.createServicePrincipal,
        `Service principal ${displayName} created`,
      )
    ) {
      setPrincipalDialogOpen(false);
      setPrincipalSlug("");
      setPrincipalName("");
      setPrincipalPurpose("");
      refetchPrincipals({ requestPolicy: "network-only" });
    }
  }

  async function confirmRevokePrincipal() {
    if (!revokePrincipalTarget) return;
    const target = revokePrincipalTarget;
    setRevokePrincipalTarget(null);
    setPendingId(target.id);
    const result = await revokeServicePrincipal({
      tenantId,
      servicePrincipalId: target.id,
    });
    setPendingId(null);
    if (
      surfaceOutcome(
        result.error,
        result.data?.revokeServicePrincipal,
        `Service principal ${target.name} revoked`,
      )
    ) {
      refetchPrincipals({ requestPolicy: "network-only" });
      refetchBindings({ requestPolicy: "network-only" });
    }
  }

  const bindingRefsValid = useMemo(() => {
    if (!bindingCredentialRefs.trim()) return false;
    try {
      const parsed = JSON.parse(bindingCredentialRefs) as unknown;
      return parsed != null && typeof parsed === "object";
    } catch {
      return false;
    }
  }, [bindingCredentialRefs]);
  const bindingSubmittable =
    bindingVersionId !== "" &&
    bindingRefsValid &&
    (bindingMode !== "service" || bindingPrincipalId !== "");

  async function submitBinding() {
    if (!bindingSubmittable) return;
    setPendingId("new-binding");
    const result = await createBinding({
      input: {
        tenantId,
        definitionVersionId: bindingVersionId,
        principalMode: bindingMode,
        servicePrincipalId:
          bindingMode === "service" ? bindingPrincipalId : null,
        subjectUserId:
          bindingMode !== "service" && bindingSubjectUserId !== NONE_VALUE
            ? bindingSubjectUserId
            : null,
        credentialRefs: bindingCredentialRefs,
      },
    });
    setPendingId(null);
    if (
      surfaceOutcome(
        result.error,
        result.data?.createCredentialBinding,
        "Binding created — run Verify to probe it",
      )
    ) {
      setBindingDialogOpen(false);
      setBindingVersionId("");
      setBindingMode("requester");
      setBindingPrincipalId("");
      setBindingSubjectUserId(NONE_VALUE);
      setBindingCredentialRefs("");
      refetchBindings({ requestPolicy: "network-only" });
    }
  }

  if (bindingsResult.fetching && bindings.length === 0) {
    return (
      <div className="space-y-2 py-2" data-testid="bindings-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }
  if (bindingsResult.error) {
    return (
      <div className="space-y-2 py-6" data-testid="bindings-error">
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load credential bindings: {bindingsResult.error.message}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetchBindings({ requestPolicy: "network-only" });
            refetchPrincipals({ requestPolicy: "network-only" });
          }}
          data-testid="bindings-retry"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="capability-bindings-view">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPrincipalDialogOpen(true)}
            data-testid="open-new-service-principal"
          >
            New service principal
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBindingDialogOpen(true)}
            data-testid="open-new-binding"
          >
            New binding
          </Button>
        </div>
      ) : null}

      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Credential bindings
        </h3>
        {bindingsByVersion.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            No credential bindings yet. Create one for an admitted Connection
            version, then Verify to run its read-only probe.
          </p>
        ) : (
          bindingsByVersion.map(([versionId, versionBindings]) => (
            <div key={versionId} className="mb-4">
              <p
                className="mb-1 text-sm font-medium"
                data-testid={`bindings-group-${versionId}`}
              >
                {versionLabelById.get(versionId) ?? (
                  <span className="font-mono text-xs">{versionId}</span>
                )}
              </p>
              <div className="divide-y divide-border">
                {versionBindings.map((binding) => {
                  const evidence = evidenceSummary(binding.readinessEvidence);
                  const busy = pendingId === binding.id;
                  return (
                    <div
                      key={binding.id}
                      className="py-2.5"
                      data-testid={`binding-row-${binding.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          {binding.principalMode}
                        </Badge>
                        <span className="text-sm">{subjectLabel(binding)}</span>
                        <ReadinessChip readiness={binding.readiness} />
                        {binding.lastVerifiedAt ? (
                          <span className="text-xs text-muted-foreground">
                            verified{" "}
                            {new Date(binding.lastVerifiedAt).toLocaleString()}
                          </span>
                        ) : (
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid={`binding-never-verified-${binding.id}`}
                          >
                            never verified
                          </span>
                        )}
                        {binding.readiness !== "revoked" &&
                        binding.lastVerifiedAt &&
                        Date.now() -
                          new Date(binding.lastVerifiedAt).getTime() >
                          STALE_EVIDENCE_MS ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            title="Probe evidence is older than 24 hours — Verify again for fresh evidence."
                            data-testid={`binding-stale-${binding.id}`}
                          >
                            <TriangleAlert className="size-3" aria-hidden />
                            stale evidence
                          </Badge>
                        ) : null}
                        {canManage && binding.readiness !== "revoked" ? (
                          <span className="ml-auto flex items-center gap-2">
                            {/* ONE remediation action per row (plan UX): a
                                non-ready binding's remediation is Verify (the
                                cheap read-only probe); a ready binding's is
                                Revoke. Revoked rows are terminal. */}
                            {binding.readiness === "ready" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={pendingId !== null}
                                onClick={() =>
                                  setRevokeBindingTarget(binding.id)
                                }
                                data-testid={`binding-revoke-${binding.id}`}
                              >
                                Revoke
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pendingId !== null}
                                onClick={() => void runVerify(binding.id)}
                                data-testid={`binding-verify-${binding.id}`}
                              >
                                {busy ? "Probing…" : "Verify"}
                              </Button>
                            )}
                          </span>
                        ) : null}
                      </div>
                      {evidence ? (
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={evidence}
                          data-testid={`binding-evidence-${binding.id}`}
                        >
                          {evidence}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Service principals
        </h3>
        {principals.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            No service principals. Create one to hold service-mode credentials
            that aren&apos;t tied to a person.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {principals.map((principal) => (
              <div
                key={principal.id}
                className="flex flex-wrap items-center gap-2 py-2.5"
                data-testid={`service-principal-row-${principal.slug}`}
              >
                <span className="text-sm font-medium">
                  {principal.displayName}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {principal.slug}
                </span>
                <Badge
                  variant="outline"
                  className={
                    principal.status === "active"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground"
                  }
                >
                  {principal.status}
                </Badge>
                {principal.purpose ? (
                  <span className="text-xs text-muted-foreground">
                    {principal.purpose}
                  </span>
                ) : null}
                {canManage && principal.status === "active" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={pendingId !== null}
                    onClick={() =>
                      setRevokePrincipalTarget({
                        id: principal.id,
                        name: principal.displayName,
                      })
                    }
                    data-testid={`service-principal-revoke-${principal.slug}`}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* New service principal. */}
      <Dialog open={principalDialogOpen} onOpenChange={setPrincipalDialogOpen}>
        <DialogContent data-testid="new-service-principal-dialog">
          <DialogHeader>
            <DialogTitle>New service principal</DialogTitle>
            <DialogDescription>
              A tenant-scoped identity for service-mode credentials — API keys
              and workload credentials that don&apos;t belong to a person.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="principal-slug">Slug</Label>
              <Input
                id="principal-slug"
                value={principalSlug}
                onChange={(event) => setPrincipalSlug(event.target.value)}
                placeholder="billing-bot"
                data-testid="principal-slug-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="principal-name">Display name</Label>
              <Input
                id="principal-name"
                value={principalName}
                onChange={(event) => setPrincipalName(event.target.value)}
                placeholder="Billing automation"
                data-testid="principal-name-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="principal-purpose">Purpose (optional)</Label>
              <Input
                id="principal-purpose"
                value={principalPurpose}
                onChange={(event) => setPrincipalPurpose(event.target.value)}
                placeholder="What this principal is for"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPrincipalDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !principalSlug.trim() ||
                !principalName.trim() ||
                pendingId !== null
              }
              onClick={() => void submitServicePrincipal()}
              data-testid="principal-create-confirm"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New binding. */}
      <Dialog open={bindingDialogOpen} onOpenChange={setBindingDialogOpen}>
        <DialogContent data-testid="new-binding-dialog">
          <DialogHeader>
            <DialogTitle>New credential binding</DialogTitle>
            <DialogDescription>
              Bind vault credential references to an admitted Connection version
              for one explicit principal mode. Raw secret values are rejected —
              reference tenant credentials by id.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Definition version</Label>
              <Select
                value={bindingVersionId}
                onValueChange={setBindingVersionId}
              >
                <SelectTrigger data-testid="binding-version-select">
                  <SelectValue placeholder="Admitted version" />
                </SelectTrigger>
                <SelectContent>
                  {admittedVersionOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Principal mode</Label>
              <Select
                value={bindingMode}
                onValueChange={(value) =>
                  setBindingMode(value as (typeof PRINCIPAL_MODES)[number])
                }
              >
                <SelectTrigger data-testid="binding-mode-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINCIPAL_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {bindingMode === "service" ? (
              <div className="space-y-1.5">
                <Label>Service principal</Label>
                <Select
                  value={bindingPrincipalId}
                  onValueChange={setBindingPrincipalId}
                >
                  <SelectTrigger data-testid="binding-principal-select">
                    <SelectValue placeholder="Active service principal" />
                  </SelectTrigger>
                  <SelectContent>
                    {activePrincipals.map((principal) => (
                      <SelectItem key={principal.id} value={principal.id}>
                        {principal.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>User pin (optional)</Label>
                <Select
                  value={bindingSubjectUserId}
                  onValueChange={setBindingSubjectUserId}
                >
                  <SelectTrigger data-testid="binding-subject-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Any user</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="binding-credential-refs">
                Credential references (JSON)
              </Label>
              <Textarea
                id="binding-credential-refs"
                value={bindingCredentialRefs}
                onChange={(event) =>
                  setBindingCredentialRefs(event.target.value)
                }
                placeholder='{ "api_key": "<tenantCredentialId>" }'
                className="min-h-24 font-mono text-xs"
                data-testid="binding-credential-refs-input"
              />
              {bindingCredentialRefs.trim() && !bindingRefsValid ? (
                <p className="text-xs text-destructive">
                  Must be a JSON object of credentialKind → tenantCredentialId.
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBindingDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!bindingSubmittable || pendingId !== null}
              onClick={() => void submitBinding()}
              data-testid="binding-create-confirm"
            >
              Create binding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke binding confirm. */}
      <AlertDialog
        open={revokeBindingTarget !== null}
        onOpenChange={(open) => !open && setRevokeBindingTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this binding?</AlertDialogTitle>
            <AlertDialogDescription>
              The binding stops resolving immediately for its principal mode.
              Credential material in the vault is untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingId !== null}
              onClick={() => void confirmRevokeBinding()}
              data-testid="binding-revoke-confirm"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke service principal confirm. */}
      <AlertDialog
        open={revokePrincipalTarget !== null}
        onOpenChange={(open) => !open && setRevokePrincipalTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {revokePrincipalTarget?.name ?? "this service principal"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Service-mode bindings that reference this principal stop
              resolving. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingId !== null}
              onClick={() => void confirmRevokePrincipal()}
              data-testid="service-principal-revoke-confirm"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
