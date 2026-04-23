import { useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UpdateTenantMemberMutation,
  RemoveTenantMemberMutation,
} from "@/lib/graphql-queries";
import { RemoveHumanConfirmDialog } from "./RemoveHumanConfirmDialog";
import type { CombinedError } from "urql";

export interface HumanMembershipSectionProps {
  memberId: string;
  currentRole: string;
  currentStatus: string;
  humanName: string;
  /** True when the target is the signed-in admin themselves. */
  isSelf: boolean;
  /** True when the signed-in caller is an `owner` in this tenant. */
  callerIsOwner: boolean;
  /** Called after a successful remove so the route can navigate away. */
  onRemoved: () => void;
}

/**
 * Match uncoded pg connection-class error messages that surface as GraphQL
 * errors without an `extensions.code`. Once the server's Yoga `maskError`
 * hook is in production every such error carries
 * `extensions.code: "SERVICE_UNAVAILABLE"` — but we keep the message-level
 * heuristic as defense in depth for any resolver that throws before
 * reaching the mask, and so admin users on older backends still get a
 * readable toast instead of a raw libpq string.
 */
function looksLikePgConnectionError(message: string | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("Connection terminated unexpectedly") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED")
  );
}

function mapMutationErrorToToast(error: CombinedError) {
  // Network-layer failures (fetch rejected, CORS, browser offline) arrive
  // with `networkError` set and no `graphQLErrors`. Show a plain-language
  // message rather than urql's default `[Network] …` wrapper.
  if (error.networkError && error.graphQLErrors.length === 0) {
    toast.error("Couldn't reach the server. Check your connection and try again.");
    return;
  }

  const first = error.graphQLErrors[0];
  const code = first?.extensions?.code;
  if (code === "LAST_OWNER") {
    toast.error("Cannot remove or demote the last owner of a tenant.");
    return;
  }
  if (code === "FORBIDDEN") {
    toast.error("You don't have permission to make this change.");
    return;
  }
  if (code === "SERVICE_UNAVAILABLE" || looksLikePgConnectionError(first?.message)) {
    toast.error("The server is temporarily unavailable. Try again in a moment.");
    return;
  }
  // Any other coded or uncoded GraphQL error: show the server's message so
  // the operator sees something actionable, not the urql `[GraphQL] …`
  // wrapper.
  toast.error(first?.message ?? error.message);
}

export function HumanMembershipSection({
  memberId,
  currentRole,
  currentStatus,
  humanName,
  isSelf,
  callerIsOwner,
  onRemoved,
}: HumanMembershipSectionProps) {
  const [{ fetching: updating }, updateMember] = useMutation(UpdateTenantMemberMutation);
  const [{ fetching: removing }, removeMember] = useMutation(RemoveTenantMemberMutation);
  const [role, setRole] = useState(currentRole);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Admins can only choose admin/member. Owners can also choose owner.
  // When the target already has role "owner" we must keep that option so the
  // select reflects reality; owners can then demote a non-last owner.
  const roleOptions =
    callerIsOwner || currentRole === "owner"
      ? ["owner", "admin", "member"]
      : ["admin", "member"];

  const controlsDisabled = isSelf;

  async function handleRoleChange(newRole: string) {
    setRole(newRole);
    if (newRole === currentRole) return;
    const result = await updateMember({
      id: memberId,
      input: { role: newRole },
    });
    if (result.error) {
      mapMutationErrorToToast(result.error);
      setRole(currentRole); // revert UI
      return;
    }
    toast.success("Role updated");
  }

  async function handleRemove() {
    const result = await removeMember({ id: memberId });
    if (result.error) {
      mapMutationErrorToToast(result.error);
      return;
    }
    setConfirmOpen(false);
    toast.success(`Removed ${humanName}`);
    onRemoved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenant Membership</CardTitle>
        <CardDescription>
          Role and status for this tenant. These controls do not affect other tenants the user may belong to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Role</Label>
          <Select
            value={role}
            onValueChange={handleRoleChange}
            disabled={controlsDisabled || updating}
          >
            <SelectTrigger className="text-sm w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((r) => (
                <SelectItem key={r} value={r} className="text-sm">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {controlsDisabled && (
            <p className="text-xs text-muted-foreground">
              You can't change your own membership here.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <p className="text-sm">{currentStatus}</p>
        </div>

        <div className="pt-4 border-t">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={controlsDisabled || removing}
            onClick={() => setConfirmOpen(true)}
          >
            {removing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Remove from tenant
          </Button>
        </div>
      </CardContent>

      <RemoveHumanConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        humanName={humanName}
        onConfirm={handleRemove}
        submitting={removing}
      />
    </Card>
  );
}
