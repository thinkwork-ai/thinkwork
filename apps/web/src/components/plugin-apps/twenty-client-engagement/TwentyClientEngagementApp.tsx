import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ExternalLink,
  RefreshCcw,
} from "lucide-react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from "@thinkwork/ui";

import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { AccountIndexPage } from "./components/AccountIndexPage";
import { AccountProfile } from "./components/AccountProfile";
import { OpportunityDetail } from "./components/OpportunityDetail";
import { ToolWorkspace } from "./components/ToolWorkspace";
import type { PrototypePageId } from "./data/model";
import {
  type EngagementAccount,
  useTwentyEngagementData,
} from "./data/useTwentyEngagementData";

const TWENTY_CRM_FALLBACK_ORIGIN = "https://crm.thinkwork.ai";

export function TwentyClientEngagementApp({
  appDisplayName = "Client Engagement",
  pluginDisplayName = "Twenty CRM",
}: {
  appDisplayName?: string;
  pluginDisplayName?: string;
}) {
  const navigate = useNavigate();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(null);
  const [activeToolPageId, setActiveToolPageId] =
    useState<PrototypePageId | null>(null);
  const data = useTwentyEngagementData(
    selectedOpportunityId,
    selectedAccountId,
  );

  const accounts = data.accounts;
  const selectedAccount =
    accounts.find((account) => account.company.id === selectedAccountId) ??
    null;
  const selectedOpportunity = useMemo(() => {
    if (!selectedAccount || !selectedOpportunityId) return null;
    return (
      selectedAccount.opportunities.find(
        (item) => item.opportunity.id === selectedOpportunityId,
      ) ?? null
    );
  }, [selectedAccount, selectedOpportunityId]);

  const rawCrmUrl =
    selectedOpportunity?.opportunity.crmUrl ?? selectedAccount?.company.crmUrl;
  const crmUrl = absoluteUrl(rawCrmUrl);
  const showCrmAction = Boolean(rawCrmUrl && selectedAccount);

  const headerAction = useMemo(
    () => (
      <div className="flex items-center gap-2">
        {accounts.length > 0 && !data.dashboardError ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setActiveToolPageId("opportunity-pipeline")}
          >
            Pipeline
          </Button>
        ) : null}
        {showCrmAction ? (
          crmUrl ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              asChild
              title="Open in CRM"
              aria-label="Open in CRM"
              className="text-muted-foreground hover:text-foreground"
            >
              <a href={crmUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                <span className="sr-only">Open in CRM</span>
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              disabled
              title="Open in CRM unavailable until Twenty URL is absolute"
              aria-label="Open in CRM"
            >
              <ExternalLink className="size-3.5" />
            </Button>
          )
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={data.refreshDashboard}
          disabled={data.dashboardFetching}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCcw
            className={`size-3.5 ${data.dashboardFetching ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    ),
    [
      accounts,
      crmUrl,
      data.dashboardError,
      data.dashboardFetching,
      data.refreshDashboard,
      showCrmAction,
    ],
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
      {
        label: appDisplayName,
        onClick: selectedAccount
          ? () => {
              setSelectedAccountId(null);
              setSelectedOpportunityId(null);
              setActiveToolPageId(null);
            }
          : undefined,
      },
      ...(selectedAccount ? [{ label: selectedAccount.company.name }] : []),
    ],
    titleContent:
      selectedAccount && accounts.length > 0 && !data.dashboardError ? (
        <AccountBreadcrumbPicker
          accounts={accounts}
          selectedAccount={selectedAccount}
          onSelectAccount={(accountId) => {
            setSelectedAccountId(accountId);
            setSelectedOpportunityId(null);
            setActiveToolPageId(null);
          }}
        />
      ) : undefined,
    action: headerAction,
    actionKey: [
      pluginDisplayName,
      appDisplayName,
      accounts.length,
      selectedAccount?.company.id ?? "no-account",
      selectedOpportunity?.opportunity.id ?? "no-opportunity",
      crmUrl ?? "no-crm-url",
      "apps-breadcrumb",
      data.dashboardFetching ? "fetching" : "idle",
      data.dashboardError ? "error" : "ready",
    ].join(":"),
  });

  if (data.dashboardFetching && accounts.length === 0) {
    return (
      <AppFrame>
        <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
          Loading CRM records...
        </div>
      </AppFrame>
    );
  }

  if (data.dashboardError) {
    return (
      <AppFrame>
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md rounded-md border border-destructive/30 bg-destructive/10 p-5 text-sm text-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <AlertCircle className="size-4 text-destructive" />
              Client engagement data unavailable
            </div>
            <p className="text-muted-foreground">
              {data.dashboardError.message}
            </p>
          </div>
        </div>
      </AppFrame>
    );
  }

  if (accounts.length === 0) {
    return (
      <AppFrame>
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              No engagement records
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add companies and opportunities in Twenty CRM to populate this
              app.
            </p>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <main className="min-h-0 flex-1 overflow-auto bg-background">
        {activeToolPageId ? (
          <ToolWorkspace
            activePageId={activeToolPageId}
            selectedAccount={selectedAccount}
            selectedOpportunity={selectedOpportunity}
            appOverlayBySection={data.appOverlayBySection}
            opportunityOverlayBySection={data.overlayBySection}
            appOverlayError={data.appOverlayError?.message ?? null}
            onBack={() => setActiveToolPageId(null)}
            onPageChange={setActiveToolPageId}
            onSaveAppOverlay={data.saveAppOverlay}
            onSaveOpportunityOverlay={data.saveOpportunityOverlay}
          />
        ) : selectedOpportunity && selectedAccount ? (
          <OpportunityDetail
            account={selectedAccount}
            opportunityWithLayers={selectedOpportunity}
            overlayBySection={data.overlayBySection}
            overlayFetching={data.overlayFetching}
            overlayError={data.overlayError?.message ?? null}
            onBack={() => setSelectedOpportunityId(null)}
            onSaveOverlay={data.saveOpportunityOverlay}
            onUpdateStage={data.updateOpportunityStage}
            onUpdateLayerStatus={data.updateLayerStatus}
            onOpenTool={setActiveToolPageId}
          />
        ) : selectedAccount ? (
          <AccountProfile
            account={selectedAccount}
            overlay={data.companyOverlayBySection.get("account-profile") ?? {}}
            onSaveOverlay={(payload) =>
              data.saveCompanyOverlay(
                selectedAccount.company.id,
                "account-profile",
                payload,
              )
            }
            onSaveStakeholder={data.saveStakeholder}
            onSelectOpportunity={(opportunityId) =>
              setSelectedOpportunityId(opportunityId)
            }
          />
        ) : (
          <AccountIndexPage
            accounts={accounts}
            onSelectAccount={(accountId) => {
              setSelectedAccountId(accountId);
              setSelectedOpportunityId(null);
              setActiveToolPageId(null);
            }}
          />
        )}
      </main>
    </AppFrame>
  );
}

function AccountBreadcrumbPicker({
  accounts,
  selectedAccount,
  onSelectAccount,
}: {
  accounts: EngagementAccount[];
  selectedAccount: EngagementAccount | null;
  onSelectAccount: (accountId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!selectedAccount) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 max-w-[280px] gap-1 px-1.5 text-sm font-medium"
          aria-label="Account picker"
        >
          <span className="truncate">{selectedAccount.company.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[320px] gap-0 rounded-lg p-0"
      >
        <Command>
          <CommandInput placeholder="Search accounts..." className="text-sm" />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup className="max-h-[320px] overflow-y-auto p-1">
              {accounts.map((account) => (
                <CommandItem
                  key={account.company.id}
                  value={`${account.company.name} ${account.company.domainName ?? ""}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm"
                  onSelect={() => {
                    onSelectAccount(account.company.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      selectedAccount.company.id === account.company.id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {account.company.name}
                    </div>
                    {account.company.domainName ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {account.company.domainName}
                      </div>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AppFrame({ children }: { children?: ReactNode }) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {children ?? <div className="min-h-0 flex-1" />}
    </section>
  );
}

function absoluteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    if (!value.startsWith("/")) return null;
    return new URL(
      normalizeTwentyObjectPath(value),
      TWENTY_CRM_FALLBACK_ORIGIN,
    ).toString();
  }
}

function normalizeTwentyObjectPath(path: string): string {
  const companyMatch = path.match(/^\/objects\/companies\/([^/?#]+)(.*)$/);
  if (companyMatch)
    return `/object/company/${companyMatch[1]}${companyMatch[2]}`;

  const opportunityMatch = path.match(
    /^\/objects\/opportunities\/([^/?#]+)(.*)$/,
  );
  if (opportunityMatch) {
    return `/object/opportunity/${opportunityMatch[1]}${opportunityMatch[2]}`;
  }

  return path;
}
