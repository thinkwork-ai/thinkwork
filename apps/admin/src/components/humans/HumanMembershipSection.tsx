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

function mapErrorToToast(message: string, code?: unknown) {
  if (code === "LAST_OWNER") {
    toast.error("Cannot remove or demote the last owner of a tenant.");
    return;
  }
  if (code === "FORBIDDEN") {
    toast.error("You don't have permission to make this change.");
    return;
  }
  toast.error(message);
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
      const code = result.error.graphQLErrors?.[0]?.extensions?.code;
      mapErrorToToast(result.error.message, code);
      setRole(currentRole); // revert UI
      return;
    }
    toast.success("Role updated");
  }

  async function handleRemove() {
    const result = await removeMember({ id: memberId });
    if (result.error) {
      const code = result.error.graphQLErrors?.[0]?.extensions?.code;
      mapErrorToToast(result.error.message, code);
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
