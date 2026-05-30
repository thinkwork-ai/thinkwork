import { assertSafeRelativePath } from "../workspace-cache";
import type { Tool } from "../types";
import {
  ensureWorkspaceCache,
  type WorkspaceToolOptions,
} from "./workspace-tool-context";

export function createFindTool(options: WorkspaceToolOptions): Tool {
  return {
    name: "find",
    description:
      "Find files in the cached ThinkWork workspace by relative path substring.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional path substring to filter by.",
        },
        path: {
          type: "string",
          description: "Optional relative directory path to search under.",
        },
        maxResults: { type: "number" },
      },
    },
    execute: async (args) => {
      try {
        await ensureWorkspaceCache(options);
        const scope =
          typeof args.path === "string" && args.path.trim()
            ? assertSafeRelativePath(args.path)
            : "";
        const query =
          typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const maxResults =
          typeof args.maxResults === "number" && args.maxResults > 0
            ? Math.min(Math.floor(args.maxResults), 200)
            : 100;
        const files = await options.cache.listFiles(options.partition, scope);
        const paths = files
          .map((file) => file.path)
          .filter((path) => !query || path.toLowerCase().includes(query))
          .slice(0, maxResults);
        return { content: paths.length > 0 ? paths.join("\n") : "No files." };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}
