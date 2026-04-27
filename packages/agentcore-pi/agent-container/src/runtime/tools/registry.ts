import type { AgentTool } from "@mariozechner/pi-agent-core";
import { buildExecuteCodeTool } from "./execute-code.js";
import { buildHindsightTools } from "./hindsight.js";
import { buildMcpTools } from "./mcp.js";
import { buildWebSearchTool } from "./web-search.js";
import type { PiToolContext } from "./types.js";

export async function buildPiTools(
  context: PiToolContext,
): Promise<AgentTool<any>[]> {
  const tools: AgentTool<any>[] = [];

  const webSearch = buildWebSearchTool(context.payload);
  if (webSearch) tools.push(webSearch);

  const executeCode = buildExecuteCodeTool(
    context.payload,
    context.state.cleanup,
  );
  if (executeCode) tools.push(executeCode);

  tools.push(
    ...buildHindsightTools(context.payload, context.state.hindsightUsage),
  );

  tools.push(...(await buildMcpTools(context.payload, context.state.cleanup)));

  return tools;
}
