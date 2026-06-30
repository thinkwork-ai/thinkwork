import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataTable } from "@thinkwork/ui";

import type { EngagementAccount } from "../data/useTwentyEngagementData";

type AccountRow = {
  id: string;
  name: string;
  domain: string;
  opportunities: number;
  mappedLayers: number;
  readyLayers: number;
};

export function AccountIndexPage({
  accounts,
  onSelectAccount,
}: {
  accounts: EngagementAccount[];
  onSelectAccount: (accountId: string) => void;
}) {
  const rows = useMemo<AccountRow[]>(
    () =>
      accounts.map((account) => {
        const metrics = accountMetrics(account);
        return {
          id: account.company.id,
          name: account.company.name,
          domain: account.company.domainName ?? "No domain",
          opportunities: metrics.opportunities,
          mappedLayers: metrics.mappedLayers,
          readyLayers: metrics.readyLayers,
        };
      }),
    [accounts],
  );

  const columns = useMemo<ColumnDef<AccountRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Account",
        cell: ({ row }) => (
          <span
            className="block truncate text-sm font-semibold text-foreground"
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "domain",
        header: "Domain",
        cell: ({ row }) => (
          <span
            className="block truncate text-sm text-muted-foreground"
            title={row.original.domain}
          >
            {row.original.domain}
          </span>
        ),
      },
      {
        accessorKey: "opportunities",
        header: "Opportunities",
        meta: {
          headClassName: "text-center",
          cellClassName: "text-center",
        },
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.opportunities}
          </span>
        ),
      },
      {
        accessorKey: "mappedLayers",
        header: "Mapped",
        meta: {
          headClassName: "text-center",
          cellClassName: "text-center",
        },
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {row.original.mappedLayers}
          </span>
        ),
      },
      {
        accessorKey: "readyLayers",
        header: "Ready",
        meta: {
          headClassName: "text-center",
          cellClassName: "text-center",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="min-w-8 justify-center">
            {row.original.readyLayers}
          </Badge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="p-5">
      <DataTable
        columns={columns}
        data={rows}
        onRowClick={(row) => onSelectAccount(row.id)}
        allowHorizontalScroll={false}
        pageSize={10}
        tableClassName="table-fixed"
        emptyState="No Twenty CRM accounts found."
      />
    </div>
  );
}

function accountMetrics(account: EngagementAccount) {
  return {
    opportunities: account.opportunities.length,
    mappedLayers: account.opportunities.reduce(
      (total, item) => total + item.layers.length,
      0,
    ),
    readyLayers: account.opportunities.reduce(
      (total, item) =>
        total +
        item.layers.filter(
          (layer) =>
            layer.layerStatus === "READY_FOR_SOW" ||
            layer.layerStatus === "APPROVED",
        ).length,
      0,
    ),
  };
}
