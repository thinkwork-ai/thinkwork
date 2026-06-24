import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@thinkwork/ui";
import {
  WORK_ITEM_PRIORITY_ORDER,
  type WorkItemPriority,
  type WorkItemSpaceSummary,
  workItemPriorityLabel,
} from "./work-item-display";

interface NewWorkItemSheetProps {
  open: boolean;
  spaces: WorkItemSpaceSummary[];
  defaultSpaceId?: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NewWorkItemFormInput) => Promise<boolean | void>;
}

export interface NewWorkItemFormInput {
  spaceId: string;
  title: string;
  notes?: string;
  priority: WorkItemPriority;
  dueAt?: string;
  required: boolean;
  applicable: boolean;
  blocked: boolean;
}

export function NewWorkItemSheet({
  open,
  spaces,
  defaultSpaceId,
  saving,
  onOpenChange,
  onCreate,
}: NewWorkItemSheetProps) {
  const fallbackSpaceId = useMemo(
    () =>
      defaultSpaceId && spaces.some((space) => space.id === defaultSpaceId)
        ? defaultSpaceId
        : spaces[0]?.id,
    [defaultSpaceId, spaces],
  );
  const [spaceId, setSpaceId] = useState(fallbackSpaceId ?? "");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<WorkItemPriority>("NORMAL");
  const [dueDate, setDueDate] = useState("");
  const [required, setRequired] = useState(true);
  const [applicable, setApplicable] = useState(true);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (open) {
      setSpaceId(fallbackSpaceId ?? "");
      setTitle("");
      setNotes("");
      setPriority("NORMAL");
      setDueDate("");
      setRequired(true);
      setApplicable(true);
      setBlocked(false);
    }
  }, [fallbackSpaceId, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border/70 px-6 py-5 pr-12">
          <SheetTitle>New Work Item</SheetTitle>
          <SheetDescription>
            Create a ThinkWork-owned unit of work in a Space.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={async (event) => {
            event.preventDefault();
            const trimmedTitle = title.trim();
            if (!trimmedTitle || !spaceId) return;
            const created = await onCreate({
              spaceId,
              title: trimmedTitle,
              notes: notes.trim() || undefined,
              priority,
              dueAt: dueDate
                ? new Date(`${dueDate}T12:00:00`).toISOString()
                : undefined,
              required,
              applicable,
              blocked,
            });
            if (created === false) return;
            onOpenChange(false);
          }}
        >
          <div className="grid gap-4 px-6 py-5">
            <div className="grid gap-2">
              <Label htmlFor="new-work-item-space">Space</Label>
              <Select value={spaceId} onValueChange={setSpaceId}>
                <SelectTrigger id="new-work-item-space">
                  <SelectValue placeholder="Choose a Space" />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name?.trim() || "Space"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-work-item-title">Title</Label>
              <Input
                id="new-work-item-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Add onboarding checklist"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-work-item-notes">Notes</Label>
              <Textarea
                id="new-work-item-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Context, acceptance notes, or handoff details"
                rows={4}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-work-item-priority">Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(value) =>
                    setPriority(value as WorkItemPriority)
                  }
                >
                  <SelectTrigger id="new-work-item-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ITEM_PRIORITY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {workItemPriorityLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="new-work-item-due">Due date</Label>
                <Input
                  id="new-work-item-due"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-border/70 p-3">
              <Flag
                id="new-work-item-required"
                label="Required"
                checked={required}
                onCheckedChange={setRequired}
              />
              <Flag
                id="new-work-item-applicable"
                label="Applicable"
                checked={applicable}
                onCheckedChange={setApplicable}
              />
              <Flag
                id="new-work-item-blocked"
                label="Blocked"
                checked={blocked}
                onCheckedChange={setBlocked}
              />
            </div>
          </div>

          <SheetFooter className="mt-auto border-t border-border/70 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving || !title.trim() || !spaceId}
            >
              Create Work Item
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Flag({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-3 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
}
