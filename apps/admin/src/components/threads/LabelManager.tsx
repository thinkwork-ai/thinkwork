import { useCallback, useState } from "react";
import { graphql } from "@/gql";
import { useMutation, useQuery } from "urql";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tags } from "lucide-react";

// ---------------------------------------------------------------------------
// Queries & Mutations
// ---------------------------------------------------------------------------

const TenantLabelsQuery = graphql(`
  query TenantLabels($tenantId: ID!) {
    threadLabels(tenantId: $tenantId) {
      id
      name
      color
    }
  }
`);

const CreateThreadLabelMutation = graphql(`
  mutation CreateThreadLabel($input: CreateThreadLabelInput!) {
    createThreadLabel(input: $input) {
      id
      name
      color
    }
  }
`);

const AssignThreadLabelMutation = graphql(`
  mutation AssignThreadLabel($threadId: ID!, $labelId: ID!) {
    assignThreadLabel(threadId: $threadId, labelId: $labelId) {
      id
      labelId
    }
  }
`);

const RemoveThreadLabelMutation = graphql(`
  mutation RemoveThreadLabel($threadId: ID!, $labelId: ID!) {
    removeThreadLabel(threadId: $threadId, labelId: $labelId)
  }
`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThreadLabelAssignment {
  id: string;
  labelId: string;
  label: { id: string; name: string; color: string };
}

interface LabelManagerProps {
  threadId: string;
  tenantId: string;
  currentLabels: ThreadLabelAssignment[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LabelManager({ threadId, tenantId, currentLabels }: LabelManagerProps) {
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("#6366f1");

  const [labelsResult] = useQuery({
    query: TenantLabelsQuery,
    variables: { tenantId },
  });

  const [, createLabel] = useMutation(CreateThreadLabelMutation);
  const [, assignLabel] = useMutation(AssignThreadLabelMutation);
  const [, removeLabel] = useMutation(RemoveThreadLabelMutation);

  const tenantLabels = labelsResult.data?.threadLabels ?? [];
  const assignedLabelIds = new Set(currentLabels.map((l) => l.labelId));

  const handleToggle = useCallback(
    async (labelId: string, isAssigned: boolean) => {
      if (isAssigned) {
        await removeLabel({ threadId, labelId });
      } else {
        await assignLabel({ threadId, labelId });
      }
    },
    [threadId, assignLabel, removeLabel],
  );

  const handleCreateLabel = useCallback(async () => {
    const name = newLabelName.trim();
    if (!name) return;

    await createLabel({
      input: {
        tenantId,
        name,
        color: newLabelColor,
      },
    });

    setNewLabelName("");
    setNewLabelColor("#6366f1");
  }, [tenantId, newLabelName, newLabelColor, createLabel]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Tags className="h-3.5 w-3.5" />
          Labels ({currentLabels.length})
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 space-y-4" align="start">
        {/* Existing labels */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Tenant Labels</p>

          {tenantLabels.length === 0 && (
            <p className="text-xs text-muted-foreground">No labels defined yet.</p>
          )}

          {tenantLabels.map((label) => {
            const isAssigned = assignedLabelIds.has(label.id);
            return (
              <div key={label.id} className="flex items-center gap-2">
                <Checkbox
                  id={`label-${label.id}`}
                  checked={isAssigned}
                  onCheckedChange={() => handleToggle(label.id, isAssigned)}
                />
                <label
                  htmlFor={`label-${label.id}`}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Badge
                    variant="outline"
                    style={{ borderColor: label.color ?? undefined, color: label.color ?? undefined }}
                  >
                    {label.name}
                  </Badge>
                </label>
              </div>
            );
          })}
        </div>

        {/* New label */}
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">New Label</p>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-label-name" className="text-xs">
                Name
              </Label>
              <Input
                id="new-label-name"
                placeholder="Label name"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="new-label-color" className="text-xs">
                Color
              </Label>
              <Input
                id="new-label-color"
                type="color"
                value={newLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
                className="h-8 w-12 p-0.5"
              />
            </div>
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={handleCreateLabel}
            disabled={!newLabelName.trim()}
            className="w-full"
          >
            Add Label
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
