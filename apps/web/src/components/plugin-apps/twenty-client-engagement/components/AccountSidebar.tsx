import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge, Input, cn } from "@thinkwork/ui";

import type { EngagementAccount } from "../data/useTwentyEngagementData";

export function AccountSidebar({
  accounts,
  selectedAccountId,
  onSelectAccount,
}: {
  accounts: EngagementAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return accounts;
    return accounts.filter((account) =>
      account.company.name.toLowerCase().includes(normalized),
    );
  }, [accounts, query]);

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Search accounts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search accounts"
            className="h-8 pl-8 text-sm"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.map((account) => {
          const active = account.company.id === selectedAccountId;
          const readyCount = account.opportunities.filter(({ layers }) =>
            layers.some(
              (layer) =>
                layer.layerStatus === "READY_FOR_SOW" ||
                layer.layerStatus === "APPROVED",
            ),
          ).length;
          return (
            <button
              key={account.company.id}
              type="button"
              onClick={() => onSelectAccount(account.company.id)}
              className={cn(
                "mb-1 w-full rounded-md border p-3 text-left transition-colors",
                active
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-muted",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {account.company.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {account.company.domainName ?? "No domain"}
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {account.opportunities.length}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {readyCount} SOW-ready opportunities
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
