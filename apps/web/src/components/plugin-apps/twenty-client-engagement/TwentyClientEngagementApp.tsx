import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";
import { Button } from "@thinkwork/ui";

import { AccountProfile } from "./components/AccountProfile";
import { AccountSidebar } from "./components/AccountSidebar";
import { OpportunityDetail } from "./components/OpportunityDetail";
import { useTwentyEngagementData } from "./data/useTwentyEngagementData";

export function TwentyClientEngagementApp({
  appDisplayName = "Client Engagement",
}: {
  appDisplayName?: string;
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(null);
  const data = useTwentyEngagementData(selectedOpportunityId);

  const accounts = data.accounts;
  const selectedAccount =
    accounts.find((account) => account.company.id === selectedAccountId) ??
    accounts[0] ??
    null;
  const selectedOpportunity = useMemo(() => {
    if (!selectedAccount || !selectedOpportunityId) return null;
    return (
      selectedAccount.opportunities.find(
        (item) => item.opportunity.id === selectedOpportunityId,
      ) ?? null
    );
  }, [selectedAccount, selectedOpportunityId]);

  useEffect(() => {
    if (!selectedAccountId && accounts[0]) {
      setSelectedAccountId(accounts[0].company.id);
    }
  }, [accounts, selectedAccountId]);

  if (data.dashboardFetching && accounts.length === 0) {
    return (
      <AppFrame title={appDisplayName} subtitle="Loading CRM records..." />
    );
  }

  if (data.dashboardError) {
    return (
      <AppFrame title={appDisplayName} subtitle="Twenty CRM">
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
      <AppFrame title={appDisplayName} subtitle="Twenty CRM">
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
    <AppFrame
      title={appDisplayName}
      subtitle="Twenty CRM projection"
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={data.refreshDashboard}
        >
          <RefreshCcw className="mr-2 size-3.5" />
          Refresh
        </Button>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <AccountSidebar
          accounts={accounts}
          selectedAccountId={selectedAccount?.company.id ?? null}
          onSelectAccount={(accountId) => {
            setSelectedAccountId(accountId);
            setSelectedOpportunityId(null);
          }}
        />
        <main className="min-w-0 overflow-auto bg-background">
          {selectedOpportunity && selectedAccount ? (
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
            />
          ) : selectedAccount ? (
            <AccountProfile
              account={selectedAccount}
              onSelectOpportunity={(opportunityId) =>
                setSelectedOpportunityId(opportunityId)
              }
            />
          ) : null}
        </main>
      </div>
    </AppFrame>
  );
}

function AppFrame({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </header>
      {children ?? <div className="min-h-0 flex-1" />}
    </section>
  );
}
