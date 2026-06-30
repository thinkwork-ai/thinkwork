import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  ChevronRight,
  Github,
  GitBranch,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useMutation } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  Textarea,
  cn,
} from "@thinkwork/ui";
import {
  PiExtensionAssignmentTargetType,
  PiExtensionVersionStatus,
  type SettingsPiExtensionFieldsFragment,
} from "@/gql/graphql";
import {
  SettingsApprovePiExtensionVersionMutation,
  SettingsImportPiExtensionFromGitHubMutation,
  SettingsRejectPiExtensionVersionMutation,
  SettingsUpdatePiExtensionAssignmentMutation,
} from "@/lib/settings-queries";
import { SettingsSection } from "@/components/settings/SettingsContent";

type PiExtensionRow = SettingsPiExtensionFieldsFragment;

export type SettingsAgentExtensionProfile = {
  id: string;
  name: string;
  slug: string;
};

type SettingsAgentExtensionsProps = {
  tenantId: string;
  extensions: readonly PiExtensionRow[];
  profiles: readonly SettingsAgentExtensionProfile[];
  fetching: boolean;
  errorMessage?: string | null;
  onChanged: () => void;
};

type JsonRecord = Record<string, unknown>;

export function SettingsAgentExtensions({
  tenantId,
  extensions,
  profiles,
  fetching,
  errorMessage,
  onChanged,
}: SettingsAgentExtensionsProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [rejectReason, setRejectReason] = useState("");
  const [importState, importExtension] = useMutation(
    SettingsImportPiExtensionFromGitHubMutation,
  );
  const [approveState, approveExtension] = useMutation(
    SettingsApprovePiExtensionVersionMutation,
  );
  const [rejectState, rejectExtension] = useMutation(
    SettingsRejectPiExtensionVersionMutation,
  );
  const [assignmentState, updateAssignment] = useMutation(
    SettingsUpdatePiExtensionAssignmentMutation,
  );

  const rows = useMemo(
    () =>
      [...extensions].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      ),
    [extensions],
  );
  const selectedExtension =
    rows.find((extension) => extension.id === selectedId) ?? null;

  const columns = useMemo<ColumnDef<PiExtensionRow>[]>(
    () => [
      {
        id: "extension",
        header: "Extension",
        accessorFn: (row) => extensionDisplayName(row),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {extensionDisplayName(row.original)}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Pi extension
            </div>
          </div>
        ),
      },
      {
        id: "source",
        header: "Source/ref",
        accessorFn: (row) =>
          `${row.repositoryOwner ?? ""}/${row.repositoryName ?? ""} ${row.sourceRef}`,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-sm">
              {sourceDisplayName(row.original)}
            </div>
            <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{row.original.sourceRef}</span>
            </div>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => formatPiExtensionStatus(row.status),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "tools",
        header: "Tools",
        accessorFn: (row) => row.toolNames.length,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.toolNames.length}
          </span>
        ),
      },
      {
        id: "permissions",
        header: "Permissions",
        accessorFn: (row) => row.permissionClasses.length,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.permissionClasses.length}
          </span>
        ),
      },
      {
        id: "assigned",
        header: "Assigned to",
        accessorFn: assignmentSummaryLabel,
        cell: ({ row }) => (
          <span className="text-sm">
            {assignmentSummaryLabel(row.original)}
          </span>
        ),
      },
      {
        id: "verified",
        header: "Last verified",
        accessorFn: (row) => checkedAtLabel(row.verificationReport),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {checkedAtLabel(row.original.verificationReport)}
          </span>
        ),
      },
      {
        id: "open",
        header: "",
        cell: () => (
          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
        ),
      },
    ],
    [],
  );

  async function submitImport() {
    if (!tenantId) return;
    const trimmedUrl = repositoryUrl.trim();
    const trimmedRef = ref.trim();
    if (!trimmedUrl || !trimmedRef) {
      toast.error("Repository URL and ref are required");
      return;
    }
    const result = await importExtension({
      input: {
        tenantId,
        repositoryUrl: trimmedUrl,
        ref: trimmedRef,
      },
    });
    if (result.error) {
      toast.error("Could not import Pi extension", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Pi extension imported for review");
    setImportOpen(false);
    setRepositoryUrl("");
    setRef("main");
    onChanged();
  }

  async function approve(extension: PiExtensionRow) {
    const result = await approveExtension({
      input: { tenantId, versionId: extension.id },
    });
    if (result.error) {
      toast.error("Could not approve Pi extension", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Pi extension approved");
    onChanged();
  }

  async function reject(extension: PiExtensionRow) {
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("Rejection reason is required");
      return;
    }
    const result = await rejectExtension({
      input: { tenantId, versionId: extension.id, reason },
    });
    if (result.error) {
      toast.error("Could not reject Pi extension", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Pi extension rejected");
    setRejectReason("");
    onChanged();
  }

  async function setAssignment(input: {
    extension: PiExtensionRow;
    targetType: PiExtensionAssignmentTargetType;
    agentProfileId?: string | null;
    enabled: boolean;
  }) {
    const result = await updateAssignment({
      input: {
        tenantId,
        versionId: input.extension.id,
        targetType: input.targetType,
        agentProfileId: input.agentProfileId ?? null,
        enabled: input.enabled,
        grantedPermissions: {
          permissionClasses: input.extension.permissionClasses,
        },
      },
    });
    if (result.error) {
      toast.error("Could not update Pi extension assignment", {
        description: result.error.message,
      });
      return;
    }
    toast.success("Pi extension assignment updated");
    onChanged();
  }

  return (
    <SettingsSection
      label="Extensions"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
        >
          <Github className="mr-2 size-4" />
          GitHub import
        </Button>
      }
    >
      {errorMessage ? (
        <div className="p-4 text-sm text-destructive">{errorMessage}</div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          tableClassName="w-full table-auto [&_tbody_tr]:h-14"
          allowHorizontalScroll={false}
          onRowClick={(row) => setSelectedId(row.id)}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {fetching
                ? "Loading Pi extensions..."
                : "No Pi extensions imported yet."}
            </div>
          }
        />
      )}

      <ImportPiExtensionDialog
        open={importOpen}
        repositoryUrl={repositoryUrl}
        sourceRef={ref}
        fetching={importState.fetching}
        onRepositoryUrlChange={setRepositoryUrl}
        onRefChange={setRef}
        onSubmit={() => void submitImport()}
        onOpenChange={setImportOpen}
      />

      <PiExtensionReviewSheet
        extension={selectedExtension}
        profiles={profiles}
        rejectReason={rejectReason}
        approving={approveState.fetching}
        rejecting={rejectState.fetching}
        assigning={assignmentState.fetching}
        onRejectReasonChange={setRejectReason}
        onApprove={(extension) => void approve(extension)}
        onReject={(extension) => void reject(extension)}
        onSetAssignment={(input) => void setAssignment(input)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </SettingsSection>
  );
}

function ImportPiExtensionDialog({
  open,
  repositoryUrl,
  sourceRef,
  fetching,
  onRepositoryUrlChange,
  onRefChange,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  repositoryUrl: string;
  sourceRef: string;
  fetching: boolean;
  onRepositoryUrlChange: (value: string) => void;
  onRefChange: (value: string) => void;
  onSubmit: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Pi extension</DialogTitle>
          <DialogDescription>
            Import a GitHub repository and ref so operators can review the
            extension before assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pi-extension-repository-url">
              GitHub repository URL
            </Label>
            <Input
              id="pi-extension-repository-url"
              value={repositoryUrl}
              onChange={(event) =>
                onRepositoryUrlChange(event.currentTarget.value)
              }
              placeholder="https://github.com/acme/pi-extension"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pi-extension-ref">Ref</Label>
            <Input
              id="pi-extension-ref"
              value={sourceRef}
              onChange={(event) => onRefChange(event.currentTarget.value)}
              placeholder="main"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={fetching}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={fetching}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PiExtensionReviewSheet({
  extension,
  profiles,
  rejectReason,
  approving,
  rejecting,
  assigning,
  onRejectReasonChange,
  onApprove,
  onReject,
  onSetAssignment,
  onOpenChange,
}: {
  extension: PiExtensionRow | null;
  profiles: readonly SettingsAgentExtensionProfile[];
  rejectReason: string;
  approving: boolean;
  rejecting: boolean;
  assigning: boolean;
  onRejectReasonChange: (value: string) => void;
  onApprove: (extension: PiExtensionRow) => void;
  onReject: (extension: PiExtensionRow) => void;
  onSetAssignment: (input: {
    extension: PiExtensionRow;
    targetType: PiExtensionAssignmentTargetType;
    agentProfileId?: string | null;
    enabled: boolean;
  }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const report = jsonRecord(extension?.verificationReport);
  const manifest = jsonRecord(extension?.manifest);
  const approved = extension?.status === PiExtensionVersionStatus.Approved;
  const reviewable =
    extension?.status === PiExtensionVersionStatus.Imported ||
    extension?.status === PiExtensionVersionStatus.NeedsReview;
  const defaultAssignment = extension
    ? findAssignment(extension, PiExtensionAssignmentTargetType.DefaultAgent)
    : null;
  const assignmentReason = extension
    ? assignmentUnavailableReason(extension)
    : null;

  return (
    <Sheet open={Boolean(extension)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(680px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
        {extension ? (
          <>
            <SheetHeader className="border-b border-border/70 px-6 py-5 pr-14">
              <div className="flex min-w-0 items-center gap-3">
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">
                    {extensionDisplayName(extension)}
                  </SheetTitle>
                  <SheetDescription className="truncate">
                    {sourceDisplayName(extension)} - {extension.sourceRef}
                  </SheetDescription>
                </div>
                <StatusBadge status={extension.status} className="ml-auto" />
              </div>
            </SheetHeader>

            <div className="space-y-6 px-6 py-5">
              <DetailBlock title="Review">
                <DetailGrid
                  rows={[
                    ["Source URL", extension.repositoryUrl],
                    ["Input ref", extension.sourceRef],
                    ["Resolved commit", extension.commitSha ?? "Not resolved"],
                    ["Artifact hash", extension.artifactHash ?? "Unavailable"],
                    ["Artifact URI", extension.artifactUri ?? "Unavailable"],
                    ["Runtime target", extension.runtimeTarget ?? "Pi"],
                    ["Manifest hash", extension.manifestHash ?? "Unavailable"],
                    [
                      "Verification",
                      `${stringValue(report.status) ?? "unknown"} at ${checkedAtLabel(
                        extension.verificationReport,
                      )}`,
                    ],
                  ]}
                />
                {extension.statusReason ? (
                  <p className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {extension.statusReason}
                  </p>
                ) : null}
                <Findings report={report} />
              </DetailBlock>

              <DetailBlock title="Declared capabilities">
                <ChipList label="Tools" values={extension.toolNames} />
                <ChipList
                  label="Lifecycle"
                  values={extension.lifecycleHooks}
                  emptyLabel="No lifecycle hooks declared"
                />
                <ChipList
                  label="Requested permissions"
                  values={extension.permissionClasses}
                  emptyLabel="No permission classes requested"
                />
                <DetailGrid
                  rows={[
                    ["Manifest name", stringValue(manifest.name) ?? "Unknown"],
                    [
                      "Manifest version",
                      stringValue(manifest.version) ?? "Unknown",
                    ],
                  ]}
                />
              </DetailBlock>

              <DetailBlock title="Approval">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!reviewable || approving || rejecting}
                      onClick={() => onApprove(extension)}
                    >
                      <CheckCircle2 className="mr-2 size-4" />
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!reviewable || approving || rejecting}
                      onClick={() => onReject(extension)}
                    >
                      <XCircle className="mr-2 size-4" />
                      Reject
                    </Button>
                    {!reviewable ? (
                      <span className="text-sm text-muted-foreground">
                        {approvalStateLabel(extension)}
                      </span>
                    ) : null}
                  </div>
                  {reviewable ? (
                    <div className="space-y-2">
                      <Label htmlFor="pi-extension-reject-reason">
                        Rejection reason
                      </Label>
                      <Textarea
                        id="pi-extension-reject-reason"
                        value={rejectReason}
                        rows={3}
                        onChange={(event) =>
                          onRejectReasonChange(event.currentTarget.value)
                        }
                        placeholder="Reason shown to operators when this version is rejected."
                      />
                    </div>
                  ) : null}
                </div>
              </DetailBlock>

              <DetailBlock title="Assignments">
                {assignmentReason ? (
                  <p className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {assignmentReason}
                  </p>
                ) : null}
                <AssignmentRow
                  label="Default Agent"
                  description="Make this approved Pi extension available to the parent Agent."
                  checked={defaultAssignment?.enabled === true}
                  disabled={!approved || assigning}
                  onCheckedChange={(enabled) =>
                    onSetAssignment({
                      extension,
                      targetType: PiExtensionAssignmentTargetType.DefaultAgent,
                      enabled,
                    })
                  }
                />
                <div className="divide-y divide-border rounded-md border border-border">
                  {profiles.map((profile) => {
                    const assignment = findAssignment(
                      extension,
                      PiExtensionAssignmentTargetType.AgentProfile,
                      profile.id,
                    );
                    return (
                      <AssignmentRow
                        key={profile.id}
                        label={profile.name}
                        description={`Profile slug: ${profile.slug}`}
                        checked={assignment?.enabled === true}
                        disabled={!approved || assigning}
                        nested
                        onCheckedChange={(enabled) =>
                          onSetAssignment({
                            extension,
                            targetType:
                              PiExtensionAssignmentTargetType.AgentProfile,
                            agentProfileId: profile.id,
                            enabled,
                          })
                        }
                      />
                    );
                  })}
                  {profiles.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      No Agent Profiles configured.
                    </div>
                  ) : null}
                </div>
                <GrantedPermissions extension={extension} />
              </DetailBlock>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AssignmentRow({
  label,
  description,
  checked,
  disabled,
  nested,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  nested?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4",
        nested ? "px-3 py-3" : "mb-3 rounded-md border border-border px-3 py-3",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={`Assign ${label}`}
      />
    </div>
  );
}

function DetailBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="min-w-0 rounded-md border border-border p-3"
        >
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 truncate font-mono text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChipList({
  label,
  values,
  emptyLabel = "None",
}: {
  label: string;
  values: readonly string[];
  emptyLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="outline" className="font-mono text-xs">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  );
}

function Findings({ report }: { report: JsonRecord }) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (findings.length === 0) return null;
  return (
    <div className="space-y-2">
      <Label>Verification findings</Label>
      <div className="space-y-2">
        {findings.map((finding, index) => {
          const item = jsonRecord(finding);
          return (
            <div
              key={`${stringValue(item.code) ?? "finding"}:${index}`}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              <div className="font-medium">
                {stringValue(item.severity) ?? "info"} -{" "}
                {stringValue(item.code) ?? "finding"}
              </div>
              <div className="text-muted-foreground">
                {stringValue(item.message) ?? "No message"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GrantedPermissions({ extension }: { extension: PiExtensionRow }) {
  const enabledAssignments = extension.assignments.filter(
    (assignment) => assignment.enabled,
  );
  if (enabledAssignments.length === 0) return null;
  return (
    <div className="space-y-2 pt-2">
      <Label>Granted permissions</Label>
      <div className="space-y-2">
        {enabledAssignments.map((assignment) => (
          <div
            key={assignment.id}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <div className="font-medium">
              {assignment.targetType ===
              PiExtensionAssignmentTargetType.DefaultAgent
                ? "Default Agent"
                : `Profile ${assignment.agentProfileId ?? "unknown"}`}
            </div>
            <div className="text-muted-foreground">
              {permissionClassesLabel(assignment.grantedPermissions)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  className,
}: {
  status: PiExtensionVersionStatus;
  className?: string;
}) {
  const destructive =
    status === PiExtensionVersionStatus.Rejected ||
    status === PiExtensionVersionStatus.FailedVerification;
  const approved = status === PiExtensionVersionStatus.Approved;
  return (
    <Badge
      variant={destructive ? "destructive" : approved ? "default" : "outline"}
      className={cn("whitespace-nowrap", className)}
    >
      {formatPiExtensionStatus(status)}
    </Badge>
  );
}

export function formatPiExtensionStatus(
  status: PiExtensionVersionStatus,
): string {
  switch (status) {
    case PiExtensionVersionStatus.Approved:
      return "Approved";
    case PiExtensionVersionStatus.FailedVerification:
      return "Failed verification";
    case PiExtensionVersionStatus.Imported:
      return "Imported";
    case PiExtensionVersionStatus.NeedsReview:
      return "Needs review";
    case PiExtensionVersionStatus.Rejected:
      return "Rejected";
  }
}

function assignmentUnavailableReason(extension: PiExtensionRow): string | null {
  switch (extension.status) {
    case PiExtensionVersionStatus.Approved:
      return null;
    case PiExtensionVersionStatus.FailedVerification:
      return "Assignment unavailable: this Pi extension failed verification.";
    case PiExtensionVersionStatus.Rejected:
      return "Assignment unavailable: this Pi extension was rejected.";
    case PiExtensionVersionStatus.Imported:
    case PiExtensionVersionStatus.NeedsReview:
      return "Assignment unavailable until an operator approves this Pi extension.";
  }
}

function approvalStateLabel(extension: PiExtensionRow): string {
  switch (extension.status) {
    case PiExtensionVersionStatus.Approved:
      return extension.approvedAt
        ? `Approved ${formatDateTime(extension.approvedAt)}`
        : "Approved";
    case PiExtensionVersionStatus.Rejected:
      return extension.rejectedAt
        ? `Rejected ${formatDateTime(extension.rejectedAt)}`
        : "Rejected";
    case PiExtensionVersionStatus.FailedVerification:
      return "Failed verification before review.";
    case PiExtensionVersionStatus.Imported:
    case PiExtensionVersionStatus.NeedsReview:
      return "Ready for review.";
  }
}

function extensionDisplayName(extension: PiExtensionRow): string {
  return (
    extension.displayName?.trim() ||
    extension.repositoryName?.trim() ||
    extension.repositoryUrl
  );
}

function sourceDisplayName(extension: PiExtensionRow): string {
  if (extension.repositoryOwner && extension.repositoryName) {
    return `${extension.repositoryOwner}/${extension.repositoryName}`;
  }
  return extension.repositoryUrl;
}

function assignmentSummaryLabel(extension: PiExtensionRow): string {
  const parts: string[] = [];
  if (extension.assignmentSummary.defaultAgentEnabled) parts.push("Default");
  if (extension.assignmentSummary.enabledProfileCount > 0) {
    parts.push(`${extension.assignmentSummary.enabledProfileCount} profiles`);
  }
  if (parts.length === 0) return "None";
  return parts.join(", ");
}

function checkedAtLabel(value: unknown): string {
  const report = jsonRecord(value);
  const checkedAt = stringValue(report.checkedAt);
  return checkedAt ? formatDateTime(checkedAt) : "Not verified";
}

function findAssignment(
  extension: PiExtensionRow,
  targetType: PiExtensionAssignmentTargetType,
  agentProfileId?: string | null,
) {
  return (
    extension.assignments.find(
      (assignment) =>
        assignment.targetType === targetType &&
        (targetType === PiExtensionAssignmentTargetType.DefaultAgent ||
          assignment.agentProfileId === agentProfileId),
    ) ?? null
  );
}

function permissionClassesLabel(value: unknown): string {
  const permissions = jsonRecord(value);
  const classes = Array.isArray(permissions.permissionClasses)
    ? permissions.permissionClasses.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  return classes.length > 0 ? classes.join(", ") : "No permission classes";
}

function jsonRecord(value: unknown): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return jsonRecord(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
