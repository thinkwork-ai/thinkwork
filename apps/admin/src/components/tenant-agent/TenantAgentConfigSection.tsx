import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "urql";
import { ModelSelect } from "@/components/agents/ModelSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type TenantAgentQuery,
  type UpdateTenantAgentInput,
} from "@/gql/graphql";
import { UpdateTenantAgentMutation } from "@/lib/graphql-queries";

type TenantAgent = NonNullable<TenantAgentQuery["agent"]>;

export function TenantAgentConfigSection({
  tenantId,
  agent,
  onSaved,
}: {
  tenantId: string;
  agent: TenantAgent;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role ?? "");
  const [model, setModel] = useState(agent.model ?? "");
  const [budgetMonthlyCents, setBudgetMonthlyCents] = useState(
    agent.budgetMonthlyCents?.toString() ?? "",
  );
  const [{ fetching }, updateTenantAgent] = useMutation(
    UpdateTenantAgentMutation,
  );

  useEffect(() => {
    setName(agent.name);
    setRole(agent.role ?? "");
    setModel(agent.model ?? "");
    setBudgetMonthlyCents(agent.budgetMonthlyCents?.toString() ?? "");
  }, [agent]);

  const budgetValue = useMemo(() => {
    const trimmed = budgetMonthlyCents.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }, [budgetMonthlyCents]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: UpdateTenantAgentInput = {
      name: name.trim(),
      role: role.trim() || null,
      model: model || null,
      budgetMonthlyCents: budgetValue,
    };

    const result = await updateTenantAgent({ tenantId, input });
    if (result.error) {
      toast.error(`Could not update agent: ${result.error.message}`);
      return;
    }
    toast.success("Agent configuration saved.");
    onSaved();
  }

  return (
    <form
      className="w-full max-w-[750px] space-y-4"
      onSubmit={handleSubmit}
    >
      <section className="rounded-md border p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tenant-agent-name">Name</Label>
            <Input
              id="tenant-agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-agent-role">Role</Label>
            <Input
              id="tenant-agent-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-agent-model">Model</Label>
            <ModelSelect value={model} onValueChange={setModel} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-agent-budget">Monthly budget cents</Label>
            <Input
              id="tenant-agent-budget"
              inputMode="numeric"
              value={budgetMonthlyCents}
              onChange={(event) => setBudgetMonthlyCents(event.target.value)}
              placeholder="Inherit account default"
            />
          </div>
        </div>
      </section>
      <div className="flex justify-end">
        <Button type="submit" disabled={fetching || !name.trim()}>
          {fetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </form>
  );
}
