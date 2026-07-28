import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Copy } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
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
  Switch,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  createBrainApiKey,
  listBrainApiKeys,
  revokeBrainApiKey,
  type BrainApiKey,
  type CreatedBrainApiKey,
} from "@/lib/brain-api-keys-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

// The platform-provisioned connector key — revoking it breaks the
// platform-managed Brain connector until a re-provision (the backend also
// reserves the name on create).
const DEFAULT_KEY_NAME = "default";

const EXPIRATION_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function SettingsBrainApiKeys() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [keys, setKeys] = useState<BrainApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<BrainApiKey | null>(null);

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listBrainApiKeys(tenantSlug)
      .then((result) => setKeys(result.keys))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleKeys = useMemo(
    () => (keys ?? []).filter((key) => showRevoked || !key.revoked_at),
    [keys, showRevoked],
  );
  const hasRevoked = useMemo(
    () => (keys ?? []).some((key) => key.revoked_at),
    [keys],
  );

  const columns = useMemo<ColumnDef<BrainApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 180,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.name}
          </span>
        ),
      },
      {
        id: "key",
        header: "Key",
        size: 130,
        cell: ({ row }) =>
          row.original.key_suffix ? (
            <span className="font-mono text-xs text-muted-foreground">
              …{row.original.key_suffix}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "created",
        header: "Created",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: "expires",
        header: "Expires",
        size: 130,
        cell: ({ row }) => {
          const expiresAt = row.original.expires_at;
          if (!expiresAt)
            return <span className="text-muted-foreground">Never</span>;
          const expired = new Date(expiresAt).getTime() < Date.now();
          return (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              {formatDate(expiresAt)}
              {expired ? <Badge variant="secondary">Expired</Badge> : null}
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        size: 100,
        cell: ({ row }) =>
          row.original.revoked_at ? (
            <Badge variant="secondary">Revoked</Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-emerald-500/40 text-emerald-400"
            >
              Active
            </Badge>
          ),
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row }) =>
          row.original.revoked_at ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setRevokeTarget(row.original)}
            >
              Revoke
            </Button>
          ),
      },
    ],
    [],
  );

  return (
    <>
      <SettingsTablePane
        embedded
        title="Brain API keys"
        description="Bearer keys for the platform Company Brain MCP server. The raw key is shown once at creation; only its suffix is stored afterwards."
        loading={!keys && !error}
        toolbar={
          error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : hasRevoked ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={showRevoked}
                onCheckedChange={setShowRevoked}
                aria-label="Show revoked"
              />
              Show revoked
            </label>
          ) : undefined
        }
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={visibleKeys}
          scrollable
          allowHorizontalScroll={false}
          pageSize={0}
          tableClassName="table-fixed"
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              No Brain API keys yet.
            </div>
          }
        />
      </SettingsTablePane>
      <CreateBrainKeyDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) load();
        }}
        tenantSlug={tenantSlug}
      />
      <RevokeBrainKeyDialog
        target={revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        tenantSlug={tenantSlug}
        onRevoked={() => {
          setRevokeTarget(null);
          load();
        }}
      />
    </>
  );
}

function CreateBrainKeyDialog({
  open,
  onOpenChange,
  tenantSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string | null;
}) {
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState("90");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBrainApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setExpiration("90");
      setErrorMsg(null);
      setCreated(null);
      setCopied(false);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit = !!tenantSlug && name.trim().length > 0 && !submitting;

  async function onSubmit() {
    if (!tenantSlug || !canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await createBrainApiKey(tenantSlug, {
        name: name.trim(),
        ...(expiration === "never"
          ? {}
          : { expiresInDays: Number(expiration) }),
      });
      setCreated(result);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setSubmitting(false);
    }
  }

  async function onCopy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Brain API key created</DialogTitle>
              <DialogDescription>
                Copy the key now — you won&apos;t be able to see this key again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={created.token}
                  aria-label="Brain API key"
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" size="sm" onClick={onCopy}>
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only the key&apos;s last 8 characters (…{created.key_suffix})
                stay visible after this dialog closes.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create Brain API key</DialogTitle>
              <DialogDescription>
                Mint a bearer key for the platform Company Brain MCP server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="brain-key-name">Name</Label>
                <Input
                  id="brain-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ci-pipeline"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brain-key-expiration">Expiration</Label>
                <Select
                  value={expiration}
                  onValueChange={setExpiration}
                  aria-label="Expiration"
                >
                  <SelectTrigger id="brain-key-expiration" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {errorMsg ? (
                <p className="text-sm text-destructive">{errorMsg}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={!canSubmit}>
                {submitting ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeBrainKeyDialog({
  target,
  onOpenChange,
  tenantSlug,
  onRevoked,
}: {
  target: BrainApiKey | null;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string | null;
  onRevoked: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [target]);

  async function onConfirm() {
    if (!tenantSlug || !target || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await revokeBrainApiKey(tenantSlug, target.id);
      onRevoked();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to revoke key");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Brain API key</DialogTitle>
          <DialogDescription>
            Revoke <span className="font-medium">{target?.name}</span>? Clients
            using this key lose access immediately.
          </DialogDescription>
        </DialogHeader>
        {target?.name === DEFAULT_KEY_NAME ? (
          <p className="text-sm text-destructive">
            This is the platform-provisioned connector key — revoking it breaks
            the platform-managed Brain connector until it is re-provisioned.
          </p>
        ) : null}
        {errorMsg ? (
          <p className="text-sm text-destructive">{errorMsg}</p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? "Revoking…" : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
