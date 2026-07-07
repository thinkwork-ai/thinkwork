/**
 * Operator share list (THINK-208 U6): every active public "anyone with the
 * link" share in the tenant, with revoke-any. Rendered as the Shares tab of
 * the operator-gated Artifacts settings surface — the parent layout route
 * supplies the OperatorGuard; the server re-enforces requireTenantAdmin.
 */

import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@thinkwork/ui";
import {
  RevokeArtifactShareLinkMutation,
  TenantArtifactSharesQuery,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import type { ArtifactShareInfo } from "@/components/artifacts/ArtifactShareDialog";

export function SettingsArtifactSharesBody() {
  const { tenantId } = useTenant();
  const [revokeTarget, setRevokeTarget] = useState<ArtifactShareInfo | null>(
    null,
  );
  const [working, setWorking] = useState(false);

  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{
    tenantArtifactShares: ArtifactShareInfo[];
  }>({
    query: TenantArtifactSharesQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const shares = data?.tenantArtifactShares ?? [];

  const [, revokeShareLink] = useMutation(RevokeArtifactShareLinkMutation);

  const refetch = useCallback(() => {
    reexecuteQuery({ requestPolicy: "network-only" });
  }, [reexecuteQuery]);

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    setWorking(true);
    try {
      const result = await revokeShareLink({ shareId: revokeTarget.id });
      if (result.error) {
        toast.error(`Could not revoke link: ${result.error.message}`);
        return;
      }
      toast.success("Public link revoked.");
      setRevokeTarget(null);
      refetch();
    } finally {
      setWorking(false);
    }
  }

  if (!tenantId || fetching) {
    return (
      <p className="p-4 text-sm text-muted-foreground">Loading share links…</p>
    );
  }
  if (error) {
    return (
      <p className="p-4 text-sm text-destructive">
        Could not load share links: {error.message}
      </p>
    );
  }
  if (shares.length === 0) {
    return (
      <p
        className="p-4 text-sm text-muted-foreground"
        data-testid="shares-empty-state"
      >
        No public share links yet — members create them from a document&rsquo;s
        Share action.
      </p>
    );
  }

  return (
    <>
      <Table data-testid="shares-table">
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Shared by</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shares.map((share) => (
            <TableRow key={share.id} data-testid={`share-row-${share.id}`}>
              <TableCell>
                <Link
                  to="/settings/artifacts/$id"
                  params={{ id: share.artifactId }}
                  className="underline-offset-2 hover:underline"
                >
                  {share.artifactTitle}
                </Link>
              </TableCell>
              <TableCell>{share.createdByName ?? share.createdBy}</TableCell>
              <TableCell>
                {new Date(share.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeTarget(share)}
                  data-testid={`share-revoke-${share.id}`}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent data-testid="shares-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this public link?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone with the link to{" "}
              {revokeTarget ? (
                <>&ldquo;{revokeTarget.artifactTitle}&rdquo; </>
              ) : null}
              loses access immediately. Sharing again later creates a different
              URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="shares-revoke-confirm"
              disabled={working}
              onClick={(event) => {
                event.preventDefault();
                void handleRevokeConfirm();
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
