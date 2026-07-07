/**
 * Artifact Share dialog (THINK-208 U5).
 *
 * Documents only (the caller gates rendering, R1). Two audiences at share
 * time: "Workspace members" copies the canonical signed-in app URL — no
 * backend involved; "Anyone with the link" mints (get-or-create) the public
 * tokenized URL and copies it. The active public link renders with creator
 * attribution; Revoke shows only for the creator or an operator, behind a
 * confirmation warning that recipients lose access immediately.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Copy, Globe, Link2, Users } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@thinkwork/ui";
import {
  ArtifactSharesQuery,
  MintArtifactShareLinkMutation,
  RevokeArtifactShareLinkMutation,
} from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";

export interface ArtifactShareInfo {
  id: string;
  artifactId: string;
  artifactTitle: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}

export interface ArtifactShareDialogProps {
  artifactId: string;
  artifactTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ArtifactShareDialog({
  artifactId,
  artifactTitle,
  open,
  onOpenChange,
}: ArtifactShareDialogProps) {
  const { userId, isOperator, roleResolved } = useTenant();
  const [mintError, setMintError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"members" | "public" | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const [{ data: sharesData }, reexecuteShares] = useQuery<{
    artifactShares: ArtifactShareInfo[];
  }>({
    query: ArtifactSharesQuery,
    variables: { artifactId },
    pause: !open,
  });
  const activeShare = sharesData?.artifactShares?.[0] ?? null;
  const canRevoke =
    !!activeShare &&
    (activeShare.createdBy === userId || (roleResolved && isOperator));

  const [, mintShareLink] = useMutation(MintArtifactShareLinkMutation);
  const [, revokeShareLink] = useMutation(RevokeArtifactShareLinkMutation);

  // urql's doc cache doesn't invalidate across components — refetch
  // network-only whenever the dialog opens or after mint/revoke.
  const refetchShares = useCallback(() => {
    reexecuteShares({ requestPolicy: "network-only" });
  }, [reexecuteShares]);
  useEffect(() => {
    if (open) {
      setMintError(null);
      setCopied(null);
      refetchShares();
    }
  }, [open, refetchShares]);

  const copyMembersLink = useCallback(() => {
    void navigator.clipboard?.writeText(
      `${window.location.origin}/artifacts/${artifactId}`,
    );
    setCopied("members");
    toast.success("Workspace link copied.");
  }, [artifactId]);

  const copyPublicLink = useCallback(async () => {
    setWorking(true);
    setMintError(null);
    try {
      const result = await mintShareLink({ artifactId });
      const url = result.data?.mintArtifactShareLink?.url;
      if (result.error || !url) {
        setMintError("Couldn't create the link — try again.");
        return;
      }
      void navigator.clipboard?.writeText(url);
      setCopied("public");
      toast.success("Public link copied.");
      refetchShares();
    } finally {
      setWorking(false);
    }
  }, [artifactId, mintShareLink, refetchShares]);

  async function handleRevokeConfirm() {
    if (!activeShare) return;
    setWorking(true);
    try {
      const result = await revokeShareLink({ shareId: activeShare.id });
      if (result.error) {
        toast.error(`Could not revoke link: ${result.error.message}`);
        return;
      }
      toast.success("Public link revoked.");
      setRevokeOpen(false);
      setCopied(null);
      refetchShares();
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="artifact-share-dialog"
        >
          <DialogHeader>
            <DialogTitle>Share &ldquo;{artifactTitle}&rdquo;</DialogTitle>
            <DialogDescription>
              Choose who can open the link you copy.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-sm font-medium">Workspace members</div>
                  <div className="text-xs text-muted-foreground">
                    Sign-in required. Copies this document&rsquo;s app URL.
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={copyMembersLink}
                data-testid="share-copy-members"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {copied === "members" ? "Copied" : "Copy link"}
              </Button>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Globe className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-sm font-medium">
                    Anyone with the link
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Public, read-only page showing the live document. Revocable
                    below.
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => void copyPublicLink()}
                data-testid="share-copy-public"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {copied === "public" ? "Copied" : "Copy link"}
              </Button>
            </div>

            {mintError ? (
              <p
                className="text-sm text-destructive"
                data-testid="share-mint-error"
              >
                {mintError}
              </p>
            ) : null}

            {activeShare ? (
              <div
                className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2"
                data-testid="share-active-row"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Public link active — shared by{" "}
                    {activeShare.createdBy === userId
                      ? "you"
                      : (activeShare.createdByName ?? "a teammate")}
                  </span>
                </div>
                {canRevoke ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working}
                    onClick={() => setRevokeOpen(true)}
                    data-testid="share-revoke"
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent data-testid="share-revoke-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this public link?</AlertDialogTitle>
            <AlertDialogDescription>
              Everyone with the link loses access immediately. Sharing again
              later creates a different URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="share-revoke-confirm"
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
