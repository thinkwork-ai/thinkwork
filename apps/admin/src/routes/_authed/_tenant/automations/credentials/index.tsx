import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { KeyRound, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { TenantCredentialKind, TenantCredentialStatus } from "@/gql/graphql";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  credentialKindLabel,
  TenantCredentialForm,
} from "@/components/credentials/TenantCredentialForm";
import { TenantCredentialStatusBadge } from "@/components/credentials/TenantCredentialStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  CreateTenantCredentialMutation,
  TenantCredentialsQuery,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/credentials/",
)({
  component: TenantCredentialsPage,
});

type CredentialRow = {
  id: string;
  displayName: string;
  kind: TenantCredentialKind;
  status: TenantCredentialStatus;
  lastUsedAt: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
};

const columns: ColumnDef<CredentialRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <TenantCredentialStatusBadge status={row.original.status} />
    ),
    size: 110,
  },
  {
    accessorKey: "displayName",
    header: "Name",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{row.original.displayName}</div>
      </div>
    ),
    size: 260,
  },
  {
    accessorKey: "kind",
    header: "Kind",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs">
        {credentialKindLabel(row.original.kind)}
      </Badge>
    ),
    size: 170,
  },
  {
    accessorKey: "lastValidatedAt",
    header: "Validated",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.lastValidatedAt
          ? relativeTime(row.original.lastValidatedAt)
          : "Never"}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: "lastUsedAt",
    header: "Last Used",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.lastUsedAt
          ? relativeTime(row.original.lastUsedAt)
          : "Never"}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {relativeTime(row.original.updatedAt)}
      </span>
    ),
    size: 100,
  },
];

function TenantCredentialsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  useBreadcrumbs([{ label: "Credentials" }]);

  const [result, refetch] = useQuery({
    query: TenantCredentialsQuery,
    variables: { tenantId: tenantId!, status: null },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [createState, createCredential] = useMutation(
    CreateTenantCredentialMutation,
  );

  const rows: CredentialRow[] = useMemo(
    () =>
      (result.data?.tenantCredentials ?? [])
        .filter(
          (credential) => credential.status !== TenantCredentialStatus.Deleted,
        )
        .map((credential) => ({
          id: credential.id,
          displayName: credential.displayName,
          kind: credential.kind,
          status: credential.status,
          lastUsedAt: credential.lastUsedAt ?? null,
          lastValidatedAt: credential.lastValidatedAt ?? null,
          updatedAt: credential.updatedAt,
        })),
    [result.data?.tenantCredentials],
  );

  if (!tenantId) return <PageSkeleton />;

  const isLoading = result.fetching && !result.data;
  const activeCount = rows.filter(
    (row) => row.status === TenantCredentialStatus.Active,
  ).length;
  const disabledCount = rows.filter(
    (row) => row.status === TenantCredentialStatus.Disabled,
  ).length;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Credentials"
            description={`${activeCount} active, ${disabledCount} disabled`}
            actions={
              <Button size="sm" onClick={() => setShowCreate((open) => !open)}>
                {showCreate ? (
                  <X className="mr-1 h-4 w-4" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                {showCreate ? "Close" : "New Credential"}
              </Button>
            }
          />

          {rows.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <div className="relative max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search credentials..."
                  className="pl-7 text-sm"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Refresh
              </Button>
            </div>
          )}
        </>
      }
    >
      {showCreate && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Create tenant credential
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TenantCredentialForm
              mode="create"
              submitting={createState.fetching}
              onSubmit={async (values) => {
                const response = await createCredential({
                  input: {
                    tenantId,
                    displayName: values.displayName ?? "",
                    kind: values.kind,
                    metadataJson: values.metadataJson,
                    secretJson: values.secretJson,
                  },
                });
                if (response.error) throw new Error(response.error.message);
                setShowCreate(false);
                refetch({ requestPolicy: "network-only" });
              }}
            />
          </CardContent>
        </Card>
      )}

      {result.error && (
        <p className="mb-3 text-sm text-destructive">{result.error.message}</p>
      )}

      {isLoading ? (
        <PageSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No credentials"
          description="Create a tenant-shared credential for routine HTTP and code steps."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          filterValue={search}
          tableClassName="table-fixed"
          onRowClick={(row) =>
            navigate({
              to: "/automations/credentials/$credentialId",
              params: { credentialId: row.id },
            })
          }
        />
      )}
    </PageLayout>
  );
}
