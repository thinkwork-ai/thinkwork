// Tool registry for the mobile agent harness.
//
// Tools are mobile-safe capabilities (camera, contacts, calendar, location, voice,
// local documents) and network actions (MCP-over-HTTP, platform/CRM calls) — never
// shell/bash/filesystem mutation. The registry is capability-agnostic: it stores tool
// specs to advertise to the model and dispatches calls by name. A failing handler is
// surfaced as an error tool result so the model can recover, rather than aborting the turn.

import type { Tool, ToolContext, ToolResult, ToolSpec } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.spec.name)) {
      throw new Error(`Tool already registered: ${tool.spec.name}`);
    }
    this.tools.set(tool.spec.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Specs to advertise to the model, in registration order. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map((t) => t.spec);
  }

  /**
   * Execute a tool by name. Unknown tools and thrown handlers both resolve to an error
   * ToolResult (never reject) so the loop can feed the failure back to the model.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }
    if (ctx.signal?.aborted) {
      return { content: `Aborted before tool "${name}" ran`, isError: true };
    }
    try {
      return await tool.execute(args, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool "${name}" failed: ${message}`, isError: true };
    }
  }
}
