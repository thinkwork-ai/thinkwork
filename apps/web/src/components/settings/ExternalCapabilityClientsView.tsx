// External confidential capability clients (THINK-280 U8).
//
// Operator-only management for the scoped /mcp/capabilities external search
// facade. Each client maps one-to-one to an ACTIVE service principal and is
// permitted EXACTLY the capabilities resource + capabilities:search scope. The
// generated secret is revealed ONCE (create/rotate) in a copy-now dialog and
// is never retrievable afterward — only its slow hash is stored server-side.
//
// Keeps a local `joinClasses` helper rather than @thinkwork/ui's cn (shared UI
// mocks lack cn — see thinkwork_ui_mocks_lack_cn).
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Ban, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";
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
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@thinkwork/ui";
import {
  CreateExternalCapabilityClientMutation,
  ExternalCapabilityClientsQuery,
  RevokeExternalCapabilityClientMutation,
  RotateExternalCapabilityClientMutation,
  TenantServicePrincipalsQuery,
} from "@/lib/capability-runtime-queries";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface RevealedSecret {
  clientId: string;
  clientSecret: string;
  kind: "created" | "rotated";
}

export function ExternalCapabilityClientsView({
  tenantId,
  canManage,
}: {
  tenantId: string;
  canManage: boolean;
}) {
  const [clientsResult, refetchClients] = useQuery({
    query: ExternalCapabilityClientsQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [principalsResult] = useQuery({
    query: TenantServicePrincipalsQuery,
    variables: { tenantId },
    pause: !tenantId,
  });

  const [, createClient] = useMutation(CreateExternalCapabilityClientMutation);
  const [, rotateClient] = useMutation(RotateExternalCapabilityClientMutation);
  const [, revokeClient] = useMutation(RevokeExternalCapabilityClientMutation);

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPrincipal, setSelectedPrincipal] = useState<string>("");
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  const clients = clientsResult.data?.externalCapabilityClients ?? [];
  const activePrincipals = useMemo(
    () =>
      (principalsResult.data?.tenantServicePrincipals ?? []).filter(
        (p) => p.status === "active",
      ),
    [principalsResult.data],
  );

  async function onCreate() {
    if (!selectedPrincipal) return;
    setPendingId("create");
    try {
      const result = await createClient({
        input: { tenantId, servicePrincipalId: selectedPrincipal },
      });
      const payload = result.data?.createExternalCapabilityClient;
      if (result.error || !payload || payload.outcome !== "applied") {
        toast.error("Couldn't create client", {
          description: payload?.reason ?? result.error?.message,
        });
        return;
      }
      const client = payload.client;
      if (client?.clientSecret) {
        setRevealed({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          kind: "created",
        });
      }
      setCreateOpen(false);
      setSelectedPrincipal("");
      refetchClients({ requestPolicy: "network-only" });
    } finally {
      setPendingId(null);
    }
  }

  async function onRotate(clientId: string) {
    setPendingId(clientId);
    try {
      const result = await rotateClient({ tenantId, clientId });
      const payload = result.data?.rotateExternalCapabilityClient;
      if (result.error || !payload || payload.outcome !== "applied") {
        toast.error("Couldn't rotate secret", {
          description: payload?.reason ?? result.error?.message,
        });
        return;
      }
      if (payload.client?.clientSecret) {
        setRevealed({
          clientId: payload.client.clientId,
          clientSecret: payload.client.clientSecret,
          kind: "rotated",
        });
      }
      refetchClients({ requestPolicy: "network-only" });
    } finally {
      setPendingId(null);
    }
  }

  async function onConfirmRevoke() {
    if (!revokeTarget) return;
    setPendingId(revokeTarget);
    try {
      const result = await revokeClient({ tenantId, clientId: revokeTarget });
      const payload = result.data?.revokeExternalCapabilityClient;
      if (result.error || !payload || payload.outcome === "rejected") {
        toast.error("Couldn't revoke client", {
          description: payload?.reason ?? result.error?.message,
        });
        return;
      }
      toast.success("External client revoked");
      refetchClients({ requestPolicy: "network-only" });
    } finally {
      setPendingId(null);
      setRevokeTarget(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="external-capability-clients">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">External search clients</h3>
          <p className="text-xs text-muted-foreground">
            Confidential M2M clients for the read-only /mcp/capabilities search
            facade. Each acts as one service principal and can only search.
          </p>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={activePrincipals.length === 0}
            data-testid="external-client-create-open"
          >
            <KeyRound className="mr-1 size-4" aria-hidden />
            New client
          </Button>
        )}
      </div>

      {clientsResult.fetching ? (
        <Skeleton className="h-16 w-full" />
      ) : clients.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No external clients yet.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {clients.map((client) => (
            <li
              key={client.id}
              className="flex items-center justify-between gap-3 p-3"
              data-testid="external-client-row"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="truncate text-xs">{client.clientId}</code>
                  <Badge
                    variant={
                      client.status === "active" ? "secondary" : "outline"
                    }
                    className={joinClasses(
                      client.status === "revoked" && "text-muted-foreground",
                    )}
                  >
                    {client.status}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  principal {client.servicePrincipalId} ·{" "}
                  {client.allowedScopes.join(" ")}
                </p>
              </div>
              {canManage && client.status === "active" && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingId !== null}
                    onClick={() => void onRotate(client.clientId)}
                    data-testid="external-client-rotate"
                  >
                    {pendingId === client.clientId ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-4" aria-hidden />
                    )}
                    <span className="ml-1">Rotate</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingId !== null}
                    onClick={() => setRevokeTarget(client.clientId)}
                    data-testid="external-client-revoke"
                  >
                    <Ban className="size-4" aria-hidden />
                    <span className="ml-1">Revoke</span>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New external search client</DialogTitle>
            <DialogDescription>
              Bind a confidential client to one active service principal. The
              secret is shown once — copy it now.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Service principal</Label>
            <Select
              value={selectedPrincipal}
              onValueChange={setSelectedPrincipal}
            >
              <SelectTrigger data-testid="external-client-principal-select">
                <SelectValue placeholder="Select a service principal" />
              </SelectTrigger>
              <SelectContent>
                {activePrincipals.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName} ({p.slug})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedPrincipal || pendingId !== null}
              onClick={() => void onCreate()}
              data-testid="external-client-create-confirm"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal-secret-once dialog */}
      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => !open && setRevealed(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Client secret{" "}
              {revealed?.kind === "rotated" ? "rotated" : "created"}
            </DialogTitle>
            <DialogDescription>
              Copy this secret now — it is shown only once and cannot be
              retrieved again.
            </DialogDescription>
          </DialogHeader>
          {revealed && (
            <div className="space-y-2">
              <Label>client_id</Label>
              <Input readOnly value={revealed.clientId} />
              <Label>client_secret</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={revealed.clientSecret}
                  data-testid="external-client-secret"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(revealed.clientSecret)
                      .then(() => toast.success("Secret copied"));
                  }}
                  aria-label="Copy secret"
                >
                  <Copy className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke external client?</AlertDialogTitle>
            <AlertDialogDescription>
              Revocation is immediate and fails closed: outstanding tokens stop
              resolving on the next request. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingId !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingId !== null}
              onClick={() => void onConfirmRevoke()}
              data-testid="external-client-revoke-confirm"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
