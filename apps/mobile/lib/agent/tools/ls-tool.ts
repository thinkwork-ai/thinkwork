import { assertSafeRelativePath } from "../workspace-cache";
import type { Tool } from "../types";
import {
  ensureWorkspaceCache,
  type WorkspaceToolOptions,
} from "./workspace-tool-context";

export function createLsTool(options: WorkspaceToolOptions): Tool {
  return {
    name: "ls",
    description:
      "List files and immediate child directories in the cached ThinkWork workspace.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional relative directory path. Defaults to workspace root.",
        },
      },
    },
    execute: async (args) => {
      try {
        await ensureWorkspaceCache(options);
        const scope =
          typeof args.path === "string" && args.path.trim()
            ? assertSafeRelativePath(args.path)
            : "";
        const files = await options.cache.listFiles(options.partition, scope);
        const prefix = scope ? `${scope}/` : "";
        const entries = new Set<string>();
        for (const file of files) {
          const rest = file.path.slice(prefix.length);
          if (!rest) continue;
          const [first, ...tail] = rest.split("/");
          entries.add(tail.length > 0 ? `${first}/` : first);
        }
        const out = [...entries].sort((a, b) => a.localeCompare(b));
        return { content: out.length > 0 ? out.join("\n") : "No files." };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}
