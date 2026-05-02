import { listSystemWorkflowDefinitions } from "./registry.js";
import { buildSystemWorkflowAsl } from "./asl.js";

export function exportedSystemWorkflowAsl(): Record<string, unknown> {
  return Object.fromEntries(
    listSystemWorkflowDefinitions().map((definition) => [
      definition.id,
      buildSystemWorkflowAsl(definition),
    ]),
  );
}
