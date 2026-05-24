import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AddSpaceMemberMutation,
  TenantMembersListQuery,
} from "@/lib/graphql-queries";

interface AddSpaceMemberDialogProps {
  spaceId: string;
  tenantId: string;
  existingUserIds: string[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onMemberAdded: () => void;
}

export function AddSpaceMemberDialog({
  spaceId,
  tenantId,
  existingUserIds,
  open,
  onOpenChange,
  onMemberAdded,
}: AddSpaceMemberDialogProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(
    undefined,
  );
  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId },
    pause: !open,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: adding }, addMember] = useMutation(AddSpaceMemberMutation);

  const options: ComboboxOption[] = useMemo(() => {
    const existing = new Set(existingUserIds);
    return (membersResult.data?.tenantMembers ?? [])
      .filter((member) => member.principalType.toUpperCase() === "USER")
      .filter((member) => member.user && !existing.has(member.user.id))
      .map((member) => ({
        value: member.user!.id,
        label:
          member.user!.name && member.user!.email
            ? `${member.user!.name} — ${member.user!.email}`
            : (member.user!.name ?? member.user!.email ?? member.user!.id),
      }));
  }, [membersResult.data, existingUserIds]);

  const loadingOptions = membersResult.fetching && !membersResult.data;

  async function handleConfirm() {
    if (!selectedUserId) return;
    const result = await addMember({ spaceId, userId: selectedUserId });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Member added.");
    setSelectedUserId(undefined);
    onOpenChange(false);
    onMemberAdded();
  }

  function handleOpenChange(next: boolean) {
    if (!next) setSelectedUserId(undefined);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {membersResult.error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {membersResult.error.message}
            </div>
          ) : null}
          <Combobox
            options={options}
            value={selectedUserId}
            onValueChange={setSelectedUserId}
            placeholder={
              loadingOptions
                ? "Loading users…"
                : options.length === 0
                  ? "No users available"
                  : "Select a user…"
            }
            searchPlaceholder="Search users…"
            emptyMessage="No users found."
            disabled={loadingOptions || adding}
          />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={adding}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedUserId || adding || loadingOptions}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
