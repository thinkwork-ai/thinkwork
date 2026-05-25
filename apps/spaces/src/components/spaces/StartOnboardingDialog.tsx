import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { useMutation } from "urql";
import {
  Button,
  Checkbox,
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
  const [taxExempt, setTaxExempt] = useState(false);
  const [creditTermsRequested, setCreditTermsRequested] = useState(false);
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(false);
  const [{ fetching }, startOnboarding] = useMutation<StartOnboardingResult>(
    StartCustomerOnboardingMutation,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const salesRep = compactPerson({
      name: stringValue(form.get("salesRepName")),
      email: stringValue(form.get("salesRepEmail")),
    });
    const primaryContact = compactPerson({
      name: stringValue(form.get("primaryContactName")),
      email: stringValue(form.get("primaryContactEmail")),
      phone: stringValue(form.get("primaryContactPhone")),
    });
    const accountsPayableContact = compactPerson({
      name: stringValue(form.get("accountsPayableName")),
      email: stringValue(form.get("accountsPayableEmail")),
      phone: stringValue(form.get("accountsPayablePhone")),
    });
    const docusignRecipient = compactPerson({
      name: stringValue(form.get("docusignRecipientName")),
      email: stringValue(form.get("docusignRecipientEmail")),
    });
    const opportunity = compactOpportunity({
      opportunityId: stringValue(form.get("opportunityId")),
      opportunityUrl: stringValue(form.get("opportunityUrl")),
      customerName: stringValue(form.get("customerName")),
      companyName: stringValue(form.get("companyName")),
      salesRep,
      dealValue: stringValue(form.get("dealValue")),
      productPlan: stringValue(form.get("productPlan")),
      closeDate: stringValue(form.get("closeDate")),
      contacts: primaryContact ? [primaryContact] : undefined,
      primaryContact,
      accountsPayableContact,
      billingAddress: stringValue(form.get("billingAddress")),
      shippingAddress: stringValue(form.get("shippingAddress")),
      billingSameAsShipping,
      taxExempt,
      taxExemptionType: stringValue(form.get("taxExemptionType")),
      creditTermsRequested,
      requestedTerms: stringValue(form.get("requestedTerms")),
      estimatedFirstOrderValue: stringValue(
        form.get("estimatedFirstOrderValue"),
      ),
      docusignRecipient,
      dunAndBradstreetId: stringValue(form.get("dunAndBradstreetId")),
      p21CustomerId: stringValue(form.get("p21CustomerId")),
      accountSetupBlockers: stringValue(form.get("accountSetupBlockers")),
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
          Start onboarding
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start customer onboarding</DialogTitle>
          <DialogDescription>
            Create the Space Thread and native onboarding checklist.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldGroup title="Customer">
            <Field label="Opportunity ID" name="opportunityId" required />
            <Field label="Customer" name="customerName" required />
            <Field label="Company" name="companyName" />
            <Field label="Opportunity URL" name="opportunityUrl" type="url" />
            <Field label="Deal value" name="dealValue" />
            <Field label="Product / plan" name="productPlan" />
            <Field label="Close date" name="closeDate" type="date" />
          </FieldGroup>

          <FieldGroup title="Contacts">
            <Field label="Primary contact name" name="primaryContactName" />
            <Field
              label="Primary contact email"
              name="primaryContactEmail"
              type="email"
            />
            <Field label="Primary contact phone" name="primaryContactPhone" />
            <Field label="AP contact name" name="accountsPayableName" />
            <Field
              label="AP contact email"
              name="accountsPayableEmail"
              type="email"
            />
            <Field label="AP contact phone" name="accountsPayablePhone" />
            <Field label="Sales rep name" name="salesRepName" />
            <Field label="Sales rep email" name="salesRepEmail" type="email" />
            <Field
              label="DocuSign recipient email"
              name="docusignRecipientEmail"
              type="email"
            />
            <Field
              label="DocuSign recipient name"
              name="docusignRecipientName"
            />
          </FieldGroup>

          <FieldGroup title="Setup">
            <Field label="Billing address" name="billingAddress" />
            <Field label="Shipping address" name="shippingAddress" />
            <BooleanField
              label="Billing same as shipping"
              checked={billingSameAsShipping}
              onCheckedChange={setBillingSameAsShipping}
            />
            <BooleanField
              label="Tax exempt"
              checked={taxExempt}
              onCheckedChange={setTaxExempt}
            />
            <Field label="Tax exemption type" name="taxExemptionType" />
            <BooleanField
              label="Credit terms requested"
              checked={creditTermsRequested}
              onCheckedChange={setCreditTermsRequested}
            />
            <Field label="Requested terms" name="requestedTerms" />
            <Field
              label="Estimated first order"
              name="estimatedFirstOrderValue"
            />
            <Field label="Dun & Bradstreet ID" name="dunAndBradstreetId" />
            <Field label="P21 customer ID" name="p21CustomerId" />
            <Field label="Document URL" name="documentUrl" type="url" />
          </FieldGroup>

          <div className="space-y-2">
            <Label htmlFor="start-onboarding-notes">Notes</Label>
            <Textarea id="start-onboarding-notes" name="notes" rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="start-onboarding-blockers">Blockers</Label>
            <Textarea
              id="start-onboarding-blockers"
              name="accountSetupBlockers"
              rows={2}
            />
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

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
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

function BooleanField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `start-onboarding-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="flex items-center gap-2 pt-7">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function compactOpportunity(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function compactPerson(value: Record<string, string | undefined>) {
  const compacted = compactOpportunity(value);
  return Object.keys(compacted).length ? compacted : undefined;
}

function stringValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
