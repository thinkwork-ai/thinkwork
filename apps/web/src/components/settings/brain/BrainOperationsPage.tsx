import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  Coins,
  GitBranch,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Badge, Button, cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsCompanyBrainStatusQuery,
  SettingsRequestCompanyBrainProductionMigrationMutation,
  SettingsUpdateCompanyBrainMigrationMutation,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import type {
  SettingsCompanyBrainStatusQuery as CompanyBrainStatusQueryData,
} from "@/gql/graphql";

type CompanyBrainStatus = CompanyBrainStatusQueryData["companyBrainStatus"];
type CompanyBrainEvidence = NonNullable<CompanyBrainStatus["evidence"]>;
type CompanyBrainCapability =
  CompanyBrainStatus["capabilities"]["launch"][number];

const ACTIVE_MIGRATION_STATUSES = new Set(["requested", "running"]);

export function BrainOperationsPage() {
  const [statusResult, refreshStatus] = useQuery({
    query: SettingsCompanyBrainStatusQuery,
    requestPolicy: "cache-and-network",
  });
  const [requestMigrationState, requestMigration] = useMutation(
    SettingsRequestCompanyBrainProductionMigrationMutation,
  );
  const [updateMigrationState, updateMigration] = useMutation(
    SettingsUpdateCompanyBrainMigrationMutation,
  );

  const status = statusResult.data?.companyBrainStatus ?? null;
  const migration = status?.migration ?? null;
  const evidence = status?.evidence ?? null;
  const busy = requestMigrationState.fetching || updateMigrationState.fetching;
  const hasActiveMigration =
    Boolean(migration?.id) && ACTIVE_MIGRATION_STATUSES.has(migration!.status);

  usePageHeaderActions({
    title: "Brain operations",
    breadcrumbs: [
      { label: "Plugins", href: "/settings/plugins" },
      {
        label: "Company Brain",
        href: "/settings/plugins/company-brain",
      },
      { label: "Brain operations" },
    ],
  });

  async function requestProductionMigration() {
    const result = await requestMigration({ input: {} });
    if (result.error) {
      toast.error(`Could not request migration: ${result.error.message}`);
      return;
    }
    toast.success("Company Brain production migration requested.");
    refreshStatus({ requestPolicy: "network-only" });
  }

  async function recordMigrationFailure() {
    if (!migration?.id) return;
    const result = await updateMigration({
      input: {
        migrationId: migration.id,
        phase: "failed",
        status: "failed",
        errorMessage: "Recorded from Brain operations.",
      },
    });
    if (result.error) {
      toast.error(
        `Could not record migration failure: ${result.error.message}`,
      );
      return;
    }
    toast.success("Company Brain migration marked failed.");
    refreshStatus({ requestPolicy: "network-only" });
  }

  async function markRolledBack() {
    if (!migration?.id) return;
    const result = await updateMigration({
      input: {
        migrationId: migration.id,
        phase: "rolled_back",
        status: "rolled_back",
      },
    });
    if (result.error) {
      toast.error(`Could not mark rollback: ${result.error.message}`);
      return;
    }
    toast.success("Company Brain migration marked rolled back.");
    refreshStatus({ requestPolicy: "network-only" });
  }

  const canRequestMigration =
    Boolean(status) &&
    status?.status === "ready" &&
    status.storageTier === "default" &&
    status.activeBackend === "default" &&
    !hasActiveMigration;
  const canRecordFailure = hasActiveMigration;
  const canMarkRolledBack =
    Boolean(migration?.id) && migration?.status === "failed";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SettingsPane className="max-w-6xl">
        <SettingsPageTitle
          title="Brain operations"
          description="Tenant-scoped Company Brain substrate posture, migration controls, and operator evidence."
          badge={
            status ? (
              <Badge variant="outline" className={statusBadge(status.status)}>
                {label(status.status)}
              </Badge>
            ) : undefined
          }
        />

        {statusResult.fetching && !status ? (
          <div className="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading Brain operations...
          </div>
        ) : null}
        {statusResult.error ? (
          <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {statusResult.error.message}
          </div>
        ) : null}
        {status ? (
          <>
            <OperationsSummary
              status={status}
              busy={busy}
              canRequestMigration={canRequestMigration}
              canRecordFailure={canRecordFailure}
              canMarkRolledBack={canMarkRolledBack}
              onRequestMigration={() => void requestProductionMigration()}
              onRecordFailure={() => void recordMigrationFailure()}
              onMarkRolledBack={() => void markRolledBack()}
            />
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
              <div className="min-w-0">
                <IngestionSection status={status} />
                <OntologySection status={status} />
                <GraphVectorSection status={status} evidence={evidence} />
                <VaultSection status={status} />
                <MigrationSection status={status} />
              </div>
              <div className="min-w-0">
                <McpAccessSection status={status} />
                <CostSection status={status} evidence={evidence} />
                <FailureSection status={status} />
                <EvidenceSection evidence={evidence} />
              </div>
            </div>
          </>
        ) : null}
      </SettingsPane>
    </div>
  );
}

function OperationsSummary({
  status,
  busy,
  canRequestMigration,
  canRecordFailure,
  canMarkRolledBack,
  onRequestMigration,
  onRecordFailure,
  onMarkRolledBack,
}: {
  status: CompanyBrainStatus;
  busy: boolean;
  canRequestMigration: boolean;
  canRecordFailure: boolean;
  canMarkRolledBack: boolean;
  onRequestMigration: () => void;
  onRecordFailure: () => void;
  onMarkRolledBack: () => void;
}) {
  const blocking = blockingStatus(status);
  return (
    <section className="mb-8 border-y border-border bg-muted/30 px-4 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={statusBadge(status.status)}>
              {label(status.status)}
            </Badge>
            <Badge
              variant="outline"
              className={statusBadge(status.healthStatus)}
            >
              {label(status.healthStatus)}
            </Badge>
            <Badge variant="outline">{label(status.storageTier)} tier</Badge>
            <Badge variant="outline">
              {label(status.activeBackend)} active
            </Badge>
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">
            {blocking ? blocking.title : "Brain substrate is operational"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {blocking
              ? blocking.description
              : "Context Engine reads use the active backend, while migration and vault posture stay visible here for operators."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Button
            type="button"
            size="sm"
            disabled={busy || !canRequestMigration}
            onClick={onRequestMigration}
          >
            <GitBranch className="mr-2 size-4" />
            Request production migration
          </Button>
          {canRecordFailure ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onRecordFailure}
            >
              <AlertTriangle className="mr-2 size-4" />
              Record migration failure
            </Button>
          ) : null}
          {canMarkRolledBack ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onMarkRolledBack}
            >
              <RotateCcw className="mr-2 size-4" />
              Mark rolled back
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function IngestionSection({ status }: { status: CompanyBrainStatus }) {
  return (
    <SettingsSection label="Ingestion">
      <SettingsRow label="Queue depth" description="Pending Brain ingest work.">
        <Value>{status.counters.ingestionQueueDepth}</Value>
      </SettingsRow>
      <SettingsRow
        label="Failed ingests"
        description="Failures requiring operator review."
      >
        <Badge
          variant="outline"
          className={
            status.counters.failedIngestCount > 0
              ? statusBadge("failed")
              : undefined
          }
        >
          {status.counters.failedIngestCount}
        </Badge>
      </SettingsRow>
      <SettingsRow
        label="Source artifacts"
        description="Canonical replayable source artifacts."
      >
        <Value>
          {formatNullableNumber(status.counters.sourceArtifactCount)}
        </Value>
      </SettingsRow>
      <SettingsRow label="Latest ingest">
        <Value>{formatDate(status.counters.latestIngestAt)}</Value>
      </SettingsRow>
    </SettingsSection>
  );
}

function OntologySection({ status }: { status: CompanyBrainStatus }) {
  return (
    <SettingsSection label="Ontology">
      <SettingsRow
        label="Ontology version"
        description="Gate used for trusted graph facts."
      >
        <Value>{status.counters.ontologyVersion ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Launch capabilities">
        <CapabilityList capabilities={status.capabilities.launch} />
      </SettingsRow>
      <SettingsRow
        label="Ontology workspace"
        description="Review entity and relationship posture."
      >
        <Button asChild type="button" size="sm" variant="outline">
          <Link to="/settings/memory/knowledge-graph">
            <Brain className="mr-2 size-4" />
            Open Ontology
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function GraphVectorSection({
  status,
  evidence,
}: {
  status: CompanyBrainStatus;
  evidence: CompanyBrainEvidence | null;
}) {
  return (
    <SettingsSection label="Graph / vector">
      <SettingsRow label="Graph entities">
        <Value>{formatNullableNumber(status.counters.graphEntityCount)}</Value>
      </SettingsRow>
      <SettingsRow label="Graph edges">
        <Value>{formatNullableNumber(status.counters.graphEdgeCount)}</Value>
      </SettingsRow>
      <SettingsRow label="Embedding model">
        <Value>
          {evidence?.embeddingModel ?? "Operator evidence unavailable"}
        </Value>
      </SettingsRow>
      <SettingsRow label="Vector dimension">
        <Value>{formatNullableNumber(evidence?.vectorDimension)}</Value>
      </SettingsRow>
    </SettingsSection>
  );
}

function VaultSection({ status }: { status: CompanyBrainStatus }) {
  return (
    <SettingsSection label="Vault">
      <SettingsRow
        label="Vault projections"
        description="Materialized views used for provenance and review."
      >
        <Value>
          {formatNullableNumber(status.counters.vaultProjectionCount)}
        </Value>
      </SettingsRow>
      <SettingsRow label="Latest projection">
        <Value>{formatDate(status.counters.latestProjectionAt)}</Value>
      </SettingsRow>
    </SettingsSection>
  );
}

function MigrationSection({ status }: { status: CompanyBrainStatus }) {
  const migration = status.migration;
  const validation = parseJsonRecord(migration.validationSummary);
  return (
    <SettingsSection label="Migration">
      <SettingsRow label="Phase">
        <Badge variant="outline" className={statusBadge(migration.phase)}>
          {label(migration.phase)}
        </Badge>
      </SettingsRow>
      <SettingsRow label="Status">
        <Badge variant="outline" className={statusBadge(migration.status)}>
          {label(migration.status)}
        </Badge>
      </SettingsRow>
      <SettingsRow label="Tier path">
        <Value>
          {migration.fromStorageTier && migration.toStorageTier
            ? `${label(migration.fromStorageTier)} -> ${label(migration.toStorageTier)}`
            : "No active migration"}
        </Value>
      </SettingsRow>
      <SettingsRow label="Validation">
        <ValidationSummary validation={validation} />
      </SettingsRow>
      {migration.errorMessage ? (
        <SettingsRow label="Migration error">
          <span className="text-sm text-destructive">
            {migration.errorMessage}
          </span>
        </SettingsRow>
      ) : null}
      <SettingsRow label="Rollback window">
        <Value>{formatDate(migration.rollbackWindowClosesAt)}</Value>
      </SettingsRow>
    </SettingsSection>
  );
}

function McpAccessSection({ status }: { status: CompanyBrainStatus }) {
  return (
    <SettingsSection label="MCP access">
      <SettingsRow
        label="Context Engine tool"
        description="Agents query Brain through ThinkWork-controlled Context Engine access."
      >
        <Badge variant="outline">query_brain_context</Badge>
      </SettingsRow>
      <SettingsRow label="Optional capabilities">
        <CapabilityList capabilities={status.capabilities.optional} />
      </SettingsRow>
      <SettingsRow label="Tool policy">
        <Button asChild type="button" size="sm" variant="outline">
          <Link to="/settings/tools">
            <KeyRound className="mr-2 size-4" />
            Open Tools
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function CostSection({
  status,
  evidence,
}: {
  status: CompanyBrainStatus;
  evidence: CompanyBrainEvidence | null;
}) {
  return (
    <SettingsSection label="Cost posture">
      <SettingsRow label="Storage tier">
        <Badge variant="outline">{label(status.storageTier)}</Badge>
      </SettingsRow>
      <SettingsRow label="Production posture">
        <Value>{evidence?.productionPosture ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Billing">
        <Button asChild type="button" size="sm" variant="outline">
          <Link to="/settings/billing">
            <Coins className="mr-2 size-4" />
            Open Billing
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function FailureSection({ status }: { status: CompanyBrainStatus }) {
  const blocking = blockingStatus(status);
  return (
    <SettingsSection label="Failure actions">
      <SettingsRow
        label={blocking ? blocking.title : "No blocking Brain failure"}
        description={
          blocking
            ? blocking.description
            : "Degraded and failed states are promoted here when action is required."
        }
      >
        <Badge
          variant="outline"
          className={blocking ? statusBadge("failed") : statusBadge("ready")}
        >
          {blocking ? "Action required" : "Clear"}
        </Badge>
      </SettingsRow>
      <SettingsRow label="Plugin lifecycle">
        <Button asChild type="button" size="sm" variant="outline">
          <Link
            to="/settings/plugins/$pluginKey"
            params={{ pluginKey: "company-brain" }}
          >
            <ShieldCheck className="mr-2 size-4" />
            Open Plugin
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

function EvidenceSection({
  evidence,
}: {
  evidence: CompanyBrainEvidence | null;
}) {
  if (!evidence) {
    return (
      <SettingsSection label="Operator evidence">
        <SettingsRow
          label="Evidence hidden"
          description="Backend identifiers are available only to ThinkWork operators."
        >
          <Badge variant="outline">Redacted</Badge>
        </SettingsRow>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection label="Operator evidence">
      <SettingsRow label="Managed application">
        <Value>{evidence.managedApplicationId ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Deployment job">
        <Value>{evidence.latestDeploymentJobId ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Backend mode">
        <Value>{evidence.backendMode ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Graph provider">
        <Value>{evidence.graphProvider ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Vector provider">
        <Value>{evidence.vectorProvider ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Cognee version">
        <Value>{evidence.cogneeVersion ?? "Not reported"}</Value>
      </SettingsRow>
      <SettingsRow label="Cognee endpoint">
        <SecretValue value={evidence.cogneeEndpoint} />
      </SettingsRow>
      <SettingsRow label="S3 artifact root">
        <SecretValue value={evidence.s3ArtifactRoot} />
      </SettingsRow>
      <SettingsRow label="S3 manifest root">
        <SecretValue value={evidence.s3ManifestRoot} />
      </SettingsRow>
      <SettingsRow label="S3 vault projection root">
        <SecretValue value={evidence.s3VaultProjectionRoot} />
      </SettingsRow>
      <SettingsRow label="Neptune graph">
        <SecretValue value={evidence.neptuneGraphId} />
      </SettingsRow>
      <SettingsRow label="Neptune endpoint">
        <SecretValue value={evidence.neptuneEndpoint} />
      </SettingsRow>
      <SettingsRow label="EFS file system">
        <SecretValue value={evidence.efsFileSystemId} />
      </SettingsRow>
      <SettingsRow label="Migration evidence">
        <JsonPreview value={evidence.migrationEvidence} />
      </SettingsRow>
      <SettingsRow label="Operator evidence">
        <JsonPreview value={evidence.operatorEvidence} />
      </SettingsRow>
    </SettingsSection>
  );
}

function CapabilityList({
  capabilities,
}: {
  capabilities: CompanyBrainCapability[];
}) {
  if (capabilities.length === 0) {
    return <Value>None reported</Value>;
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {capabilities.map((capability) => (
        <Badge
          key={capability.key}
          variant="outline"
          className={statusBadge(capability.status)}
          title={capability.message ?? undefined}
        >
          {capability.key}: {label(capability.status)}
        </Badge>
      ))}
    </div>
  );
}

function ValidationSummary({
  validation,
}: {
  validation: Record<string, unknown>;
}) {
  const entries = [
    ["validation", booleanLabel(validation.validationPassed)],
    ["vector index", booleanLabel(validation.vectorIndexHealthy)],
    ["retrieval parity", booleanLabel(validation.retrievalParityPassed)],
    ["manifests", formatUnknown(validation.replayManifestCount)],
    ["sources", formatUnknown(validation.sourceCount)],
  ].filter(([, value]) => value !== "Not reported");
  if (entries.length === 0) return <Value>Not reported</Value>;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="outline">
          {key}: {value}
        </Badge>
      ))}
    </div>
  );
}

function SecretValue({ value }: { value?: string | null }) {
  return (
    <code className="max-w-[18rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {value || "Not reported"}
    </code>
  );
}

function JsonPreview({ value }: { value?: unknown }) {
  const record = parseJsonRecord(value);
  const keys = Object.keys(record);
  if (keys.length === 0) return <Value>None reported</Value>;
  return (
    <code className="max-w-[18rem] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {keys.slice(0, 4).join(", ")}
      {keys.length > 4 ? ` +${keys.length - 4}` : ""}
    </code>
  );
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-sm text-foreground">{children}</span>;
}

function blockingStatus(status: CompanyBrainStatus) {
  if (status.status === "failed" || status.healthStatus === "failed") {
    return {
      title: "Brain substrate failed",
      description:
        "Review operator evidence, migration state, and plugin lifecycle before retrying reads or migration.",
    };
  }
  if (status.status === "migrating") {
    return {
      title: "Production migration in progress",
      description:
        "Context Engine reads remain on the active backend while shadow production validation progresses.",
    };
  }
  if (status.status === "degraded" || status.healthStatus === "degraded") {
    return {
      title: "Brain substrate degraded",
      description:
        "Inspect ingestion failures, graph/vector counters, and migration evidence before cutover.",
    };
  }
  if (status.status === "provisioning") {
    return {
      title: "Brain substrate provisioning",
      description:
        "Infrastructure is still converging; agent reads should wait for ready status.",
    };
  }
  if (status.status === "not_installed" || status.status === "disabled") {
    return {
      title: "Brain substrate unavailable",
      description:
        "Install or re-enable Company Brain before relying on Brain context.",
    };
  }
  return null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseJsonRecord(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatDate(value?: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatNullableNumber(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "Not reported";
}

function formatUnknown(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value) return value;
  return "Not reported";
}

function booleanLabel(value: unknown) {
  if (value === true) return "passed";
  if (value === false) return "pending";
  return "Not reported";
}

function label(value: string) {
  return value.replace(/_/g, " ");
}

function statusBadge(value: string) {
  const normalized = value.toLowerCase();
  return cn(
    (normalized === "ready" ||
      normalized === "healthy" ||
      normalized === "enabled" ||
      normalized === "completed" ||
      normalized === "production") &&
      "border-emerald-500/40 text-emerald-500",
    (normalized === "migrating" ||
      normalized === "provisioning" ||
      normalized === "requested" ||
      normalized === "running") &&
      "border-sky-500/40 text-sky-500",
    (normalized === "degraded" || normalized === "unknown") &&
      "border-amber-500/40 text-amber-500",
    (normalized === "failed" ||
      normalized === "disabled" ||
      normalized === "not_installed") &&
      "border-destructive/50 text-destructive",
  );
}
