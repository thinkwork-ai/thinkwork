import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { normalizeN8nPackageConfig } from "@thinkwork/plugin-n8n/package-config";
import { Badge, Button, Input, Label } from "@thinkwork/ui";
import {
  Copy,
  KeyRound,
  PackagePlus,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  SettingsManagedApplicationDeploymentQuery,
  SettingsN8nPluginSettingsQuery,
  SettingsUpdateN8nPluginPackageSettingsMutation,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { ManagedApplicationPlanDialog } from "@/components/settings/managed-applications/ManagedApplicationPlanDialog";

const TERMINAL_JOB_STATUSES = new Set([
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
  "canceled",
]);

export function N8nSettings({
  installId,
  installState,
  onChanged,
}: {
  installId: string;
  installState: string;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<string[]>([""]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const firstInvalidRef = useRef<HTMLInputElement | null>(null);

  const [settingsResult, refreshSettings] = useQuery({
    query: SettingsN8nPluginSettingsQuery,
    variables: { installId },
    requestPolicy: "cache-and-network",
  });
  const [jobResult, refreshJob] = useQuery({
    query: SettingsManagedApplicationDeploymentQuery,
    variables: { jobId: selectedJobId ?? "" },
    pause: !selectedJobId,
    requestPolicy: "cache-and-network",
  });
  const [updateState, updatePackages] = useMutation(
    SettingsUpdateN8nPluginPackageSettingsMutation,
  );

  const settings = settingsResult.data?.n8nPluginSettings ?? null;
  const currentPackageConfig = settings?.currentPackageConfig ?? null;
  const job = jobResult.data?.managedApplicationDeployment ?? null;
  const inFlightJob =
    settings?.lastJobStatus &&
    !TERMINAL_JOB_STATUSES.has(settings.lastJobStatus)
      ? settings.lastJobStatus
      : null;

  useEffect(() => {
    if (!currentPackageConfig) return;
    setRows(
      currentPackageConfig.packageSpecs.length
        ? currentPackageConfig.packageSpecs
        : [""],
    );
    setServerError(null);
  }, [currentPackageConfig?.digest]);

  const local = useMemo(() => {
    try {
      const rawSpecs = rows.map((row) => row.trim()).filter(Boolean);
      const normalized = normalizeN8nPackageConfig(rawSpecs);
      const duplicateCount = rawSpecs.length - normalized.packageSpecs.length;
      return {
        config: normalized,
        duplicateCount,
        error: null as string | null,
      };
    } catch (error) {
      return {
        config: null,
        duplicateCount: 0,
        error: (error as Error).message,
      };
    }
  }, [rows]);

  const dirty =
    local.config && currentPackageConfig
      ? local.config.digest !== currentPackageConfig.digest
      : false;
  const disabled =
    !settings ||
    settingsResult.fetching ||
    updateState.fetching ||
    installState === "uninstalling" ||
    Boolean(inFlightJob);
  const canSubmit = Boolean(local.config && dirty && !disabled);

  function setRow(index: number, value: string) {
    setServerError(null);
    const pasted = splitPackageSpecs(value);
    if (pasted.length > 1) {
      setRows((current) => [
        ...current.slice(0, index),
        ...pasted,
        ...current.slice(index + 1),
      ]);
      return;
    }
    setRows((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? value : entry,
      ),
    );
  }

  function addRow() {
    setServerError(null);
    setRows((current) => [...current, ""]);
  }

  function removeRow(index: number) {
    setServerError(null);
    setRows((current) => {
      const next = current.filter((_, entryIndex) => entryIndex !== index);
      return next.length ? next : [""];
    });
  }

  async function submit() {
    setServerError(null);
    if (!local.config || !currentPackageConfig) {
      firstInvalidRef.current?.focus();
      return;
    }
    const result = await updatePackages({
      input: {
        installId,
        customPackageSpecs: local.config.packageSpecs,
        expectedCurrentDigest: currentPackageConfig.digest,
        idempotencyKey: [
          "n8n",
          "packages",
          local.config.digest.slice(0, 12),
          Date.now().toString(36),
        ].join("-"),
      },
    });
    if (result.error) {
      setServerError(result.error.message);
      toast.error(`Could not create n8n package plan: ${result.error.message}`);
      firstInvalidRef.current?.focus();
      return;
    }
    const deploymentJob =
      result.data?.updateN8nPluginPackageSettings.deploymentJob ?? null;
    if (deploymentJob) {
      setSelectedJobId(deploymentJob.id);
      setDialogOpen(true);
    }
    toast.success("n8n package plan created.");
    refreshSettings({ requestPolicy: "network-only" });
    onChanged();
  }

  function openLatestJob() {
    if (settings?.lastJobId) {
      setSelectedJobId(settings.lastJobId);
      setDialogOpen(true);
    }
  }

  async function copyBridgeEndpoint() {
    const endpoint = settings?.agentStepBridgeEndpointPath;
    if (!endpoint) return;
    await navigator.clipboard.writeText(endpoint);
    toast.success("n8n bridge endpoint copied.");
  }

  const firstError = local.error ?? serverError;
  const packageSpecs = local.config?.packageSpecs ?? [];

  return (
    <SettingsSection label="n8n Settings">
      <SettingsRow
        label="Agent-step bridge"
        description="Tenant-scoped HTTP entrypoint for n8n workflows that delegate one workflow step to a ThinkWork agent."
      >
        <div className="w-full space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                settings?.agentStepBridgeCredentialConfigured
                  ? "default"
                  : "outline"
              }
            >
              <KeyRound className="size-3.5" />
              {settings?.agentStepBridgeCredentialConfigured
                ? "Credential configured"
                : "Credential missing"}
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <code className="min-h-9 rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
              {settings?.agentStepBridgeEndpointPath ??
                "/api/integrations/n8n/agent-steps"}
            </code>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label="Copy n8n bridge endpoint"
              title="Copy endpoint"
              disabled={!settings?.agentStepBridgeEndpointPath}
              onClick={() => void copyBridgeEndpoint()}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        label="Custom packages"
        description="Pinned public npm packages injected into the n8n image and allow-listed for Code nodes."
        layout="stacked"
      >
        <div className="w-full space-y-3">
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_2rem]"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor={`n8n-package-${index}`} className="sr-only">
                    n8n package {index + 1}
                  </Label>
                  <Input
                    ref={
                      index === 0
                        ? (element) => {
                            firstInvalidRef.current = element;
                          }
                        : undefined
                    }
                    id={`n8n-package-${index}`}
                    value={row}
                    placeholder="lodash@4.17.21"
                    autoComplete="off"
                    disabled={disabled}
                    aria-invalid={Boolean(firstError)}
                    onChange={(event) =>
                      setRow(index, event.currentTarget.value)
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove n8n package ${index + 1}`}
                  title="Remove package"
                  disabled={disabled || rows.length === 1}
                  onClick={() => removeRow(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {firstError ? (
            <p role="alert" className="text-sm text-destructive">
              {firstError}
            </p>
          ) : null}
          {local.duplicateCount > 0 ? (
            <p className="text-sm text-muted-foreground">
              {local.duplicateCount} duplicate package{" "}
              {local.duplicateCount === 1 ? "entry was" : "entries were"}{" "}
              collapsed in the preview.
            </p>
          ) : null}

          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {packageSpecs.length} package
                {packageSpecs.length === 1 ? "" : "s"}
              </Badge>
              {local.config ? (
                <code className="break-all font-mono text-xs text-muted-foreground">
                  {local.config.digest}
                </code>
              ) : null}
            </div>
            <div className="mt-2 space-y-1">
              {packageSpecs.length ? (
                packageSpecs.map((spec) => (
                  <code
                    key={spec}
                    className="block font-mono text-xs text-foreground"
                  >
                    {spec}
                  </code>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No custom packages configured.
                </p>
              )}
            </div>
          </div>

          {settings?.packageImageConfigDigest ? (
            <p className="text-sm text-muted-foreground">
              Current package image digest: {settings.packageImageConfigDigest}
            </p>
          ) : null}
          {inFlightJob ? (
            <p className="text-sm text-muted-foreground">
              Package changes are locked while job {settings?.lastJobId} is{" "}
              {inFlightJob}.
            </p>
          ) : null}
          {settings?.lastJobError ? (
            <p className="text-sm text-destructive">
              Last package plan failed: {settings.lastJobError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={addRow}
            >
              <Plus className="size-4" />
              Add package
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              <PackagePlus className="size-4" />
              Create package plan
            </Button>
            {settings?.lastJobId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={openLatestJob}
              >
                <ShieldCheck className="size-4" />
                Review latest plan
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsRow>

      <ManagedApplicationPlanDialog
        job={job}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobChanged={(next) => {
          setSelectedJobId(next.id);
          refreshJob({ requestPolicy: "network-only" });
          refreshSettings({ requestPolicy: "network-only" });
          onChanged();
        }}
      />
    </SettingsSection>
  );
}

function splitPackageSpecs(value: string): string[] {
  if (!/[\n,]/.test(value)) return [];
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
