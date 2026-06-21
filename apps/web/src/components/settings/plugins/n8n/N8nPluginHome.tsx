import { useLocation } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Badge } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsPluginCatalogQuery,
  SettingsPluginInstallsQuery,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
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
import { N8nPluginWorkflows } from "./N8nPluginWorkflows";

const N8N_WORKFLOWS = "/settings/plugins/n8n/workflows";
const N8N_SETTINGS = "/settings/plugins/n8n/settings";

export type N8nPluginTab = "workflows" | "settings";

export function N8nPluginHome({ tab }: { tab: N8nPluginTab }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = pathname.startsWith(N8N_SETTINGS) ? "settings" : tab;

  const [catalogResult] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [installsResult, refreshInstalls] = useQuery({
    query: SettingsPluginInstallsQuery,
    requestPolicy: "cache-and-network",
  });

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
  const description =
    entry?.description ??
    "Self-hosted n8n workflow automation runtime with managed workflow access.";

  usePageHeaderActions({
    title: displayName,
    breadcrumbs: [
      { label: "Plugins", href: "/settings/plugins" },
      { label: displayName },
    ],
    tabs: [
      { to: N8N_WORKFLOWS, label: "Workflows" },
      { to: N8N_SETTINGS, label: "Settings" },
    ],
  });

  return (
    <SettingsPane className="max-w-[880px]">
      <SettingsPageTitle
        title={displayName}
        description={description}
        badge={
          install ? (
            <Badge
              variant="outline"
              className={installStateChipClassName(install.state)}
            >
              {installStateLabel(install.state)}
            </Badge>
          ) : null
        }
      />

      <SettingsSection label="Components">
        <div className="overflow-hidden rounded-md border border-border">
          {(install?.components ?? []).map((component) => (
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
          {install?.components.length ? null : (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              n8n is not installed for this tenant.
            </div>
          )}
        </div>
      </SettingsSection>

      {activeTab === "workflows" ? (
        <N8nPluginWorkflows installId={install?.id ?? null} />
      ) : (
        <N8nPluginSettings
          installId={install?.id ?? null}
          installState={install?.state ?? "missing"}
          onChanged={() => refreshInstalls({ requestPolicy: "network-only" })}
        />
      )}
    </SettingsPane>
  );
}
