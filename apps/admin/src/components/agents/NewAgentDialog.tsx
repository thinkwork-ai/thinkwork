import { useDialog } from "@/context/DialogContext";
import { AgentFormDialog } from "@/components/agents/AgentFormDialog";

export function NewAgentDialog() {
  const { dialogs, closeDialog } = useDialog();
  const { open, defaults } = dialogs.newAgent;

  return (
    <AgentFormDialog
      mode="create"
      open={open}
      onOpenChange={() => closeDialog("newAgent")}
      initial={defaults ? { name: defaults.name } : undefined}
    />
  );
}
