import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Check, ChevronDown, ExternalLink, RefreshCcw } from "lucide-react";
import {
  Button,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@thinkwork/ui";
import {
  ThinkWorkN8nWorkflowsApp,
  type N8nAppData,
} from "@thinkwork/plugin-n8n/n8n-app";

import { usePageHeaderActions } from "@/context/PageHeaderContext";
import type {
  N8nAppDataQuery as N8nAppDataQueryResult,
  N8nAppDataQueryVariables,
} from "@/gql/graphql";
import { N8nAppDataQuery } from "@/lib/plugin-app-queries";

type N8nAppViewMode = "workflows" | "executions";
const N8N_APP_VIEWS: Array<{ id: N8nAppViewMode; label: string }> = [
  { id: "workflows", label: "Workflows" },
  { id: "executions", label: "Executions" },
];

export function N8nWorkflowOperationsApp({
  pluginInstallId,
  appDisplayName = "n8n Workflows",
  pluginDisplayName = "n8n",
}: {
  pluginInstallId: string;
  appDisplayName?: string;
  pluginDisplayName?: string;
}) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<N8nAppViewMode>("workflows");
  const [result, reexecuteQuery] = useQuery<
    N8nAppDataQueryResult,
    N8nAppDataQueryVariables
  >({
    query: N8nAppDataQuery,
    variables: {
      installId: pluginInstallId,
      executionLimit: 50,
    },
    requestPolicy: "cache-and-network",
  });
  const refresh = useCallback(() => {
    reexecuteQuery({ requestPolicy: "network-only" });
  }, [reexecuteQuery]);
  const data = (result.data?.n8nAppData as N8nAppData | undefined) ?? null;
  const nativeBaseUrl = absoluteUrl(data?.nativeBaseUrl);
  const breadcrumbAppLabel =
    N8N_APP_VIEWS.find((view) => view.id === viewMode)?.label ??
    appDisplayName.replace(/^n8n\s+/i, "") ??
    appDisplayName;

  const headerAction = useMemo(
    () => (
      <div className="flex items-center gap-1">
        {nativeBaseUrl ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            asChild
            title="Open in n8n"
            aria-label="Open in n8n"
            className="text-muted-foreground hover:text-foreground"
          >
            <a href={nativeBaseUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Open in n8n</span>
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            disabled
            title="Open in n8n unavailable until n8n URL is absolute"
            aria-label="Open in n8n"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={refresh}
          disabled={result.fetching}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCcw
            className={`size-3.5 ${result.fetching ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    ),
    [nativeBaseUrl, refresh, result.fetching],
  );

  usePageHeaderActions({
    title: appDisplayName,
    documentTitle: `${pluginDisplayName} · ${appDisplayName}`,
    breadcrumbs: [
      {
        label: "Apps",
        onClick: () => {
          void navigate({ to: "/apps" });
        },
      },
      { label: pluginDisplayName },
      { label: breadcrumbAppLabel },
    ],
    titleContent: (
      <N8nViewBreadcrumbPicker
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
    ),
    action: headerAction,
    actionKey: [
      pluginDisplayName,
      appDisplayName,
      breadcrumbAppLabel,
      viewMode,
      nativeBaseUrl ?? "no-n8n-url",
      result.fetching ? "fetching" : "idle",
      result.error ? "error" : "ready",
    ].join(":"),
  });

  return (
    <ThinkWorkN8nWorkflowsApp
      appDisplayName={appDisplayName}
      pluginDisplayName={pluginDisplayName}
      data={data}
      fetching={result.fetching}
      error={result.error}
      onRefresh={refresh}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
    />
  );
}

function N8nViewBreadcrumbPicker({
  viewMode,
  onViewModeChange,
}: {
  viewMode: N8nAppViewMode;
  onViewModeChange: (viewMode: N8nAppViewMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedView =
    N8N_APP_VIEWS.find((view) => view.id === viewMode) ?? N8N_APP_VIEWS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 max-w-[220px] gap-1 px-1.5 text-sm font-medium"
          aria-label="n8n app view"
        >
          <span className="truncate">{selectedView.label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[220px] gap-0 rounded-lg p-0"
      >
        <Command>
          <CommandList>
            <CommandGroup className="p-1">
              {N8N_APP_VIEWS.map((view) => (
                <CommandItem
                  key={view.id}
                  value={view.label}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm"
                  onSelect={() => {
                    onViewModeChange(view.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`size-4 shrink-0 ${
                      view.id === viewMode ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span>{view.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function absoluteUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
