import type { AgentTool } from "@mariozechner/pi-agent-core";
import { buildExecuteCodeTool } from "./execute-code.js";
import { buildContextEngineTool } from "./context-engine.js";
import { buildHindsightTools } from "./hindsight.js";
import { buildMcpTools } from "./mcp.js";
import { buildSendEmailTool } from "./send-email.js";
import { buildWebSearchTool } from "./web-search.js";
import { buildWorkspaceSkillTool } from "./workspace-skills.js";
import type { PiToolContext } from "./types.js";

export async function buildPiTools(
  context: PiToolContext,
): Promise<AgentTool<any>[]> {
  const tools: AgentTool<any>[] = [];

  const webSearch = buildWebSearchTool(context.payload);
  if (webSearch) tools.push(webSearch);

  const sendEmail = buildSendEmailTool(context.payload);
  if (sendEmail) tools.push(sendEmail);

  const executeCode = buildExecuteCodeTool(
    context.payload,
    context.state.cleanup,
  );
  if (executeCode) tools.push(executeCode);

  const contextEngine = buildContextEngineTool(context.payload);
  if (contextEngine) tools.push(contextEngine);

  tools.push(
    ...buildHindsightTools(context.payload, context.state.hindsightUsage),
  );

  tools.push(...(await buildMcpTools(context.payload, context.state.cleanup)));

  const workspaceSkill = buildWorkspaceSkillTool(context.workspaceSkills ?? []);
  if (workspaceSkill) tools.push(workspaceSkill);

  return tools;
}
