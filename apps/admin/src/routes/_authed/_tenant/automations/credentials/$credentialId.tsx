import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, RotateCw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { TenantCredentialStatus } from "@/gql/graphql";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  credentialKindLabel,
  prettyJson,
  TenantCredentialForm,
} from "@/components/credentials/TenantCredentialForm";
import { TenantCredentialStatusBadge } from "@/components/credentials/TenantCredentialStatusBadge";
import { TenantCredentialUsageList } from "@/components/credentials/TenantCredentialUsageList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CredentialRoutineUsageQuery,
  DeleteTenantCredentialMutation,
  RotateTenantCredentialMutation,
  TenantCredentialsQuery,
  UpdateTenantCredentialMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/credentials/$credentialId",
)({
  component: TenantCredentialDetailPage,
});

function TenantCredentialDetailPage() {
  const { credentialId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showRotate, setShowRotate] = useState(false);

  const [result, refetchCredentials] = useQuery({
    query: TenantCredentialsQuery,
    variables: { tenantId: tenantId!, status: null },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [usageResult] = useQuery({
    query: CredentialRoutineUsageQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [updateState, updateCredential] = useMutation(
    UpdateTenantCredentialMutation,
  );
  const [rotateState, rotateCredential] = useMutation(
    RotateTenantCredentialMutation,
  );
  const [deleteState, deleteCredential] = useMutation(
    DeleteTenantCredentialMutation,
  );

  const credential = useMemo(
    () =>
      result.data?.tenantCredentials.find((item) => item.id === credentialId) ??
      null,
    [credentialId, result.data?.tenantCredentials],
  );

  useBreadcrumbs([
    { label: "Credentials", href: "/automations/credentials" },
    { label: credential?.displayName ?? "Credential" },
  ]);

  if (!tenantId || (result.fetching && !result.data)) return <PageSkeleton />;

  if (!credential) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: "/automations/credentials" })}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Credentials
        </Button>
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            Credential not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  async function updateStatus(status: TenantCredentialStatus) {
    setMutationError(null);
    const response = await updateCredential({
      id: credential.id,
      input: { status },
    });
    if (response.error) {
      setMutationError(response.error.message);
      return;
    }
    refetchCredentials({ requestPolicy: "network-only" });
  }

  async function deleteCurrentCredential() {
    setMutationError(null);
    const response = await deleteCredential({ id: credential.id });
    if (response.error) {
      setMutationError(response.error.message);
      return;
    }
    navigate({ to: "/automations/credentials" });
  }

  const metadata = safePrettyJson(credential.metadataJson);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate({ to: "/automations/credentials" })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader
            title={credential.displayName}
            description={credentialKindLabel(credential.kind)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TenantCredentialStatusBadge status={credential.status} />
          {credential.status === TenantCredentialStatus.Active ? (
            <Button
              variant="outline"
              size="sm"
              disabled={updateState.fetching}
              onClick={() => updateStatus(TenantCredentialStatus.Disabled)}
            >
              Disable
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={updateState.fetching}
              onClick={() => updateStatus(TenantCredentialStatus.Active)}
            >
              Re-enable
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRotate((open) => !open)}
          >
            <RotateCw className="mr-1 h-4 w-4" />
            Rotate
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete credential?</AlertDialogTitle>
                <AlertDialogDescription>
                  This disables the credential record and schedules the backing
                  secret for deletion.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteState.fetching}
                  onClick={deleteCurrentCredential}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {mutationError && (
        <p className="text-sm text-destructive">{mutationError}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Metadata
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <MetadataItem label="Kind">
                <Badge variant="outline">
                  {credentialKindLabel(credential.kind)}
                </Badge>
              </MetadataItem>
              <MetadataItem label="Status">
                <TenantCredentialStatusBadge status={credential.status} />
              </MetadataItem>
              <MetadataItem label="Created">
                {relativeTime(credential.createdAt)}
              </MetadataItem>
              <MetadataItem label="Updated">
                {relativeTime(credential.updatedAt)}
              </MetadataItem>
              <MetadataItem label="Last validated">
                {credential.lastValidatedAt
                  ? relativeTime(credential.lastValidatedAt)
                  : "Never"}
              </MetadataItem>
              <MetadataItem label="Last used">
                {credential.lastUsedAt
                  ? relativeTime(credential.lastUsedAt)
                  : "Never"}
              </MetadataItem>
              {credential.eventbridgeConnectionArn && (
                <div className="md:col-span-2">
                  <MetadataItem label="EventBridge connection">
                    <code className="break-all text-xs">
                      {credential.eventbridgeConnectionArn}
                    </code>
                  </MetadataItem>
                </div>
              )}
              <div className="md:col-span-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Metadata JSON
                </p>
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                  {metadata || "{}"}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Routine usage</CardTitle>
            </CardHeader>
            <CardContent>
              <TenantCredentialUsageList
                credential={credential}
                routines={usageResult.data?.routines ?? []}
                loading={usageResult.fetching && !usageResult.data}
              />
            </CardContent>
          </Card>
        </div>

        {showRotate && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rotate secret</CardTitle>
            </CardHeader>
            <CardContent>
              <TenantCredentialForm
                mode="rotate"
                initialKind={credential.kind}
                submitting={rotateState.fetching}
                onSubmit={async (values) => {
                  setMutationError(null);
                  const response = await rotateCredential({
                    input: {
                      id: credential.id,
                      secretJson: values.secretJson,
                    },
                  });
                  if (response.error) throw new Error(response.error.message);
                  setShowRotate(false);
                  refetchCredentials({ requestPolicy: "network-only" });
                }}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MetadataItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function safePrettyJson(value: unknown): string {
  try {
    return prettyJson(value);
  } catch {
    return "";
  }
}
