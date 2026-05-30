import { createFindTool } from "../tools/find-tool";
import { createGrepTool } from "../tools/grep-tool";
import { createLsTool } from "../tools/ls-tool";
import { createReadTool } from "../tools/read-tool";
import type { WorkspaceToolOptions } from "../tools/workspace-tool-context";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";

export const WORKSPACE_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

export function workspaceToolsExtension(
  options: WorkspaceToolOptions,
): ExtensionFactory {
  return defineExtension({
    name: "workspace-tools",
    description:
      "Adds Pi-style read-only tools over the cached ThinkWork workspace.",
    toolNames: WORKSPACE_TOOL_NAMES,
    register(pi) {
      pi.registerTool(createReadTool(options));
      pi.registerTool(createGrepTool(options));
      pi.registerTool(createFindTool(options));
      pi.registerTool(createLsTool(options));
      pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\nYou can inspect the cached ThinkWork workspace with \`read\`, \`grep\`, \`find\`, and \`ls\`. These tools are read-only and cannot access files outside the workspace cache.`,
      }));
    },
  });
}
