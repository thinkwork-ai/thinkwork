import { type FormEvent, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "urql";
import { ModelSelect } from "@/components/agents/ModelSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AgentRuntime,
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
  const [model, setModel] = useState(agent.model ?? "");
  const [runtime, setRuntime] = useState<AgentRuntime>(agent.runtime);
  const [{ fetching }, updateTenantAgent] = useMutation(
    UpdateTenantAgentMutation,
  );

  useEffect(() => {
    setModel(agent.model ?? "");
    setRuntime(agent.runtime);
  }, [agent]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: UpdateTenantAgentInput = {
      model: model || null,
      runtime,
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
            <Label htmlFor="tenant-agent-model">Model</Label>
            <ModelSelect value={model} onValueChange={setModel} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tenant-agent-runtime">Runtime</Label>
            <Select
              value={runtime}
              onValueChange={(value) => setRuntime(value as AgentRuntime)}
            >
              <SelectTrigger id="tenant-agent-runtime" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AgentRuntime.Strands}>Strands</SelectItem>
                <SelectItem value={AgentRuntime.Flue}>Pi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
      <div className="flex justify-end">
        <Button type="submit" disabled={fetching}>
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
