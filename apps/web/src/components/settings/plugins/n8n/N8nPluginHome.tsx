import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@thinkwork/ui/collapsible";
import { ArrowDownToLine, ChevronDown, ExternalLink } from "lucide-react";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsDeploymentStatusQuery,
  SettingsInstallPluginMutation,
  SettingsPluginCatalogQuery,
  SettingsPluginInstallsQuery,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import {
  componentStateChipClassName,
  componentStateLabel,
  componentTypeLabel,
  installStateChipClassName,
  installStateLabel,
} from "../plugin-state";
import { N8nPluginSettings } from "./N8nPluginSettings";

export function N8nPluginHome() {
  const { isOperator, roleResolved } = useTenant();
  const showOperatorActions = roleResolved && isOperator;
  const [recentAgentStepsAction, setRecentAgentStepsAction] =
    useState<ReactNode | null>(null);

  const [catalogResult, refreshCatalog] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [deploymentResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    requestPolicy: "cache-and-network",
  });
  const [installsResult, refreshInstalls] = useQuery({
    query: SettingsPluginInstallsQuery,
    requestPolicy: "cache-and-network",
  });
  const [installMutationState, installPlugin] = useMutation(
    SettingsInstallPluginMutation,
  );

  const entry =
    catalogResult.data?.pluginCatalog.find(
      (candidate) => candidate.pluginKey === "n8n",
    ) ?? null;
  const install =
    installsResult.data?.pluginInstalls.find(
      (candidate) => candidate.pluginKey === "n8n",
    ) ??
    entry?.install ??
    null;
  const displayName = entry?.displayName ?? install?.pluginKey ?? "n8n";
  const n8nRuntime =
    deploymentResult.data?.deploymentStatus.managedApplications.find(
      (candidate) => candidate.key === "n8n",
    );
  const launchUrl = n8nRuntime?.url ?? entry?.launchUrl ?? null;
  const description =
    entry?.description ??
    "Self-hosted n8n workflow automation runtime with managed workflow access.";
  const components = install?.components ?? [];
  const allComponentsProvisioned =
    components.length > 0 &&
    components.every((component) => component.state === "provisioned");

  function refreshAll() {
    refreshInstalls({ requestPolicy: "network-only" });
    refreshCatalog({ requestPolicy: "network-only" });
  }

  async function installN8n() {
    const idempotencyKey = [
      "plugins",
      "n8n",
      "install",
      Date.now().toString(36),
    ].join("-");
    const result = await installPlugin({
      input: { pluginKey: "n8n", idempotencyKey },
    });
    if (result.error) {
      toast.error(`Could not install ${displayName}: ${result.error.message}`);
      return;
    }
    toast.success(`Installing ${displayName}.`);
    refreshAll();
  }

  usePageHeaderActions({
    title: displayName,
    breadcrumbs: [
      { label: "Plugins", href: "/settings/plugins" },
      { label: displayName },
    ],
    action:
      recentAgentStepsAction || launchUrl ? (
        <div className="flex items-center gap-1">
          {recentAgentStepsAction}
          {launchUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open n8n UI"
              title="Open n8n UI"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                window.open(launchUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null,
    actionKey: [
      install?.id ?? "missing",
      launchUrl ?? "no-launch-url",
      recentAgentStepsAction ? "recent-agent-steps" : "no-recent-agent-steps",
    ].join(":"),
  });

  return (
    <SettingsPane className="max-w-[880px]">
      <SettingsPageTitle
        title={displayName}
        description={description}
        badge={
          install ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={installStateChipClassName(install.state)}
              >
                {installStateLabel(install.state)}
              </Badge>
            </span>
          ) : null
        }
      />

      {!install && entry && showOperatorActions ? (
        <SettingsSection label="Install">
          <SettingsRow
            label={`Install ${entry.displayName}`}
            description={`Latest version v${entry.latestVersion}.`}
          >
            <Button
              type="button"
              size="sm"
              disabled={installMutationState.fetching}
              onClick={() => void installN8n()}
            >
              <ArrowDownToLine className="mr-2 size-4" />
              Install
            </Button>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <Collapsible
        defaultOpen={!allComponentsProvisioned}
        className="group/components"
      >
        <section className="mb-8">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="mb-3 flex w-full items-center gap-2 text-left text-base font-medium text-foreground"
            >
              <span>Components</span>
              {components.length ? (
                <Badge
                  variant={allComponentsProvisioned ? "outline" : "secondary"}
                  className={
                    allComponentsProvisioned
                      ? "border-emerald-500/40 text-emerald-400"
                      : undefined
                  }
                >
                  {components.length} provisioned
                </Badge>
              ) : null}
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=closed]/components:-rotate-90" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {components.map((component) => (
                <div
                  key={component.id}
                  className="grid gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-foreground">
                      {component.componentKey}
                    </span>
                    <Badge variant="outline">
                      {componentTypeLabel(component.componentType)}
                    </Badge>
                  </div>
                  <Badge
                    variant="outline"
                    className={componentStateChipClassName(component.state)}
                  >
                    {componentStateLabel(component.state)}
                  </Badge>
                </div>
              ))}
              {components.length ? null : (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  n8n is not installed for this tenant.
                </div>
              )}
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>
      <N8nPluginSettings
        installId={install?.id ?? null}
        installState={install?.state ?? "missing"}
        onChanged={() => refreshInstalls({ requestPolicy: "network-only" })}
        onRecentAgentStepsActionChange={setRecentAgentStepsAction}
      />
    </SettingsPane>
  );
}
