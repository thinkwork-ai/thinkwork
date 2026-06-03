import { Box, Cpu, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { BadgeSelectorSelect } from "@/components/ui/badge-selector";
import {
  AgentRuntime,
  type TenantAgentQuery,
  type UpdateTenantAgentInput,
} from "@/gql/graphql";
import {
  ModelCatalogQuery,
  UpdateTenantAgentMutation,
} from "@/lib/graphql-queries";

type TenantAgent = NonNullable<TenantAgentQuery["agent"]>;

export function TenantAgentHeaderControls({
  tenantId,
  agent,
  onSaved,
}: {
  tenantId: string;
  agent: TenantAgent;
  onSaved: () => void;
}) {
  const [{ data: catalogData }] = useQuery({ query: ModelCatalogQuery });
  const [{ fetching }, updateTenantAgent] = useMutation(
    UpdateTenantAgentMutation,
  );

  const models = catalogData?.modelCatalog ?? [];
  const modelOptions = models.map((model) => ({
    value: model.modelId,
    label: model.displayName,
  }));
  const currentModel = agent.model ?? null;
  const modelLabel =
    models.find((model) => model.modelId === currentModel)?.displayName ??
    currentModel ??
    "Model";

  async function save(input: UpdateTenantAgentInput) {
    const result = await updateTenantAgent({ tenantId, input });
    if (result.error) {
      toast.error(`Could not update agent: ${result.error.message}`);
      return;
    }
    toast.success("Agent configuration saved.");
    onSaved();
  }

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      {fetching ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : null}
      <BadgeSelectorSelect
        icon={<Cpu className="h-3.5 w-3.5" />}
        value={agent.runtime}
        options={[{ value: AgentRuntime.Flue, label: "Pi" }]}
        onSelect={(value) =>
          value ? save({ runtime: value as AgentRuntime }) : Promise.resolve()
        }
        className="text-xs"
      />
      <BadgeSelectorSelect
        icon={<Box className="h-3.5 w-3.5" />}
        value={currentModel}
        emptyLabel={modelLabel}
        options={modelOptions}
        searchable
        searchPlaceholder="Search models..."
        onSelect={(value) => save({ model: value })}
        className="max-w-[14rem] truncate text-xs"
      />
    </div>
  );
}
