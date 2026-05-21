import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { useMutation } from "urql";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Textarea,
} from "@thinkwork/ui";
import { StartCustomerOnboardingMutation } from "@/lib/graphql-queries";

interface StartOnboardingDialogProps {
  tenantId: string;
  spaceId: string;
  onStarted?: (threadId: string) => void;
}

interface StartOnboardingResult {
  startCustomerOnboarding?: {
    threadId: string;
    idempotent: boolean;
    missingFields?: string[] | null;
  } | null;
}

export function StartOnboardingDialog({
  tenantId,
  spaceId,
  onStarted,
}: StartOnboardingDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [{ fetching }, startOnboarding] = useMutation<StartOnboardingResult>(
    StartCustomerOnboardingMutation,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const opportunity = compactOpportunity({
      opportunityId: stringValue(form.get("opportunityId")),
      opportunityUrl: stringValue(form.get("opportunityUrl")),
      customerName: stringValue(form.get("customerName")),
      companyName: stringValue(form.get("companyName")),
      salesRep: stringValue(form.get("salesRep")),
      dealValue: stringValue(form.get("dealValue")),
      productPlan: stringValue(form.get("productPlan")),
      closeDate: stringValue(form.get("closeDate")),
      notes: stringValue(form.get("notes")),
      documents: stringValue(form.get("documentUrl"))
        ? [
            {
              title: "Onboarding document",
              url: stringValue(form.get("documentUrl")),
            },
          ]
        : undefined,
    });

    const result = await startOnboarding({
      input: {
        tenantId,
        spaceId,
        opportunity,
      },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    const threadId = result.data?.startCustomerOnboarding?.threadId;
    if (!threadId) {
      setError("Customer onboarding did not return a Thread.");
      return;
    }
    setOpen(false);
    onStarted?.(threadId);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Start
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start customer onboarding</DialogTitle>
          <DialogDescription>
            Create the Space Thread and linked LastMile checklist.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opportunity ID" name="opportunityId" required />
            <Field label="Customer" name="customerName" required />
            <Field label="Company" name="companyName" />
            <Field label="Opportunity URL" name="opportunityUrl" type="url" />
            <Field label="Sales rep" name="salesRep" />
            <Field label="Deal value" name="dealValue" />
            <Field label="Product / plan" name="productPlan" />
            <Field label="Close date" name="closeDate" type="date" />
            <Field label="Document URL" name="documentUrl" type="url" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="start-onboarding-notes">Notes</Label>
            <Textarea id="start-onboarding-notes" name="notes" rows={3} />
          </div>
          {error ? (
            <div className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={fetching}>
              {fetching ? <Loader2 className="size-4 animate-spin" /> : null}
              Create Thread
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  const id = `start-onboarding-${name}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} required={required} />
    </div>
  );
}

function compactOpportunity(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function stringValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
