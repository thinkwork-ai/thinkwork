import { useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ExternalLink, RefreshCcw } from "lucide-react";
import { Button } from "@thinkwork/ui";
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
    appDisplayName.replace(/^n8n\s+/i, "") || appDisplayName;

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
    action: headerAction,
    actionKey: [
      pluginDisplayName,
      appDisplayName,
      breadcrumbAppLabel,
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
    />
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
