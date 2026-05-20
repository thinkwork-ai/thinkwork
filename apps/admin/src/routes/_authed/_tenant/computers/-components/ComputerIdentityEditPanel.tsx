import { useEffect, useState } from "react";
import { useMutation } from "urql";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UpdateComputerMutation } from "@/lib/graphql-queries";
import { formatDateTime } from "@/lib/utils";
import { ComputerScope, type Computer } from "@/gql/graphql";

type ComputerSlice = Pick<
  Computer,
  | "id"
  | "name"
  | "slug"
  | "scope"
  | "budgetMonthlyCents"
  | "createdAt"
  | "updatedAt"
> & {
  owner?: { id: string; name?: string | null; email?: string | null } | null;
};

interface Props {
  computer: ComputerSlice;
  onUpdated?: () => void;
}

export function ComputerIdentityEditPanel({ computer, onUpdated }: Props) {
  const [{ fetching: saving }, updateComputer] = useMutation(
    UpdateComputerMutation,
  );

  const ownerLabel = computer.owner?.name ?? computer.owner?.email ?? "—";
  const isHistoricalPersonal =
    computer.scope === ComputerScope.HistoricalPersonal;

  // Name edit state. Resync drafts with the server-truth value whenever the
  // `computer` prop changes (e.g. after a successful save + refetch), so the
  // "dirty" indicator and Save button correctly reflect the new baseline.
  const [nameDraft, setNameDraft] = useState(computer.name);
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => {
    setNameDraft(computer.name);
    setNameError(null);
  }, [computer.name]);
  const nameDirty = nameDraft.trim() !== computer.name;

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    const result = await updateComputer({
      id: computer.id,
      input: { name: trimmed },
    });
    if (result.error) {
      setNameError(result.error.message);
      return;
    }
    onUpdated?.();
  }

  function cancelName() {
    setNameDraft(computer.name);
    setNameError(null);
  }

  // Budget edit state — resync with server truth on prop change.
  const initialBudgetDollars = centsToDollarString(computer.budgetMonthlyCents);
  const [budgetDraft, setBudgetDraft] = useState(initialBudgetDollars);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  useEffect(() => {
    setBudgetDraft(centsToDollarString(computer.budgetMonthlyCents));
    setBudgetError(null);
  }, [computer.budgetMonthlyCents]);
  const budgetDirty = budgetDraft.trim() !== initialBudgetDollars;

  async function saveBudget() {
    const parsed = parseBudgetInput(budgetDraft);
    if (parsed === "invalid") {
      setBudgetError("Enter a positive number or leave blank to clear");
      return;
    }
    setBudgetError(null);
    const result = await updateComputer({
      id: computer.id,
      input: { budgetMonthlyCents: parsed },
    });
    if (result.error) {
      setBudgetError(result.error.message);
      return;
    }
    onUpdated?.();
  }

  async function clearBudget() {
    setBudgetError(null);
    const result = await updateComputer({
      id: computer.id,
      input: { budgetMonthlyCents: null },
    });
    if (result.error) {
      setBudgetError(result.error.message);
      return;
    }
    setBudgetDraft("");
    onUpdated?.();
  }

  function cancelBudget() {
    setBudgetDraft(initialBudgetDollars);
    setBudgetError(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            Rename or set the monthly budget. Slug and creation metadata are
            read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-6">
            {/* Name */}
            <div>
              <dt className="mb-1 text-xs font-medium text-muted-foreground">
                Name
              </dt>
              <dd className="flex items-start gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="max-w-md text-sm"
                  aria-label="Computer name"
                />
                {nameDirty && (
                  <>
                    <Button size="sm" onClick={saveName} disabled={saving}>
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelName}
                      disabled={saving}
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </>
                )}
              </dd>
              {nameError && (
                <p className="mt-1 text-xs text-destructive">{nameError}</p>
              )}
            </div>

            {/* Budget */}
            <div>
              <dt className="mb-1 text-xs font-medium text-muted-foreground">
                Monthly Budget
              </dt>
              <dd className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Unbounded"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  className="max-w-[160px] text-sm"
                  aria-label="Monthly budget in dollars"
                />
                <span className="text-xs text-muted-foreground">USD / mo</span>
                {budgetDirty && (
                  <>
                    <Button size="sm" onClick={saveBudget} disabled={saving}>
                      {saving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelBudget}
                      disabled={saving}
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  </>
                )}
                {computer.budgetMonthlyCents != null && !budgetDirty && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearBudget}
                    disabled={saving}
                  >
                    Clear
                  </Button>
                )}
              </dd>
              {budgetError && (
                <p className="mt-1 text-xs text-destructive">{budgetError}</p>
              )}
            </div>

            {/* Read-only metadata */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  Scope
                </dt>
                <dd className="mt-1 truncate text-sm">
                  {isHistoricalPersonal ? "Historical personal" : "Shared"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  Slug
                </dt>
                <dd className="mt-1 break-all text-sm">{computer.slug}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  Updated
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDateTime(computer.updatedAt)}
                </dd>
              </div>
              {isHistoricalPersonal && computer.owner ? (
                <div className="min-w-0">
                  <dt className="text-xs font-medium text-muted-foreground">
                    Historical Owner
                  </dt>
                  <dd className="mt-1 truncate text-sm">{ownerLabel}</dd>
                </div>
              ) : null}
            </div>
          </dl>
        </CardContent>
      </Card>
    </>
  );
}

export function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toString();
}

/**
 * Parse the budget input field.
 * - "" or "   " → null (admin chose to clear)
 * - positive number → cents (Math.round)
 * - "invalid" sentinel for non-numeric or negative input
 *
 * Exported for unit testing.
 */
export function parseBudgetInput(input: string): number | null | "invalid" {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
}
