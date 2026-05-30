import { assertSafeRelativePath } from "../workspace-cache";
import type { Tool } from "../types";
import {
  ensureWorkspaceCache,
  requiredStringArg,
  type WorkspaceToolOptions,
} from "./workspace-tool-context";

export function createReadTool(options: WorkspaceToolOptions): Tool {
  return {
    name: "read",
    description:
      "Read a UTF-8 file from the cached ThinkWork workspace. Paths must be relative to the workspace root.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path to read, such as USER.md or docs/notes.md.",
        },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const rawPath = requiredStringArg(args, "path");
      if (!rawPath) {
        return {
          content: 'Missing required string argument "path".',
          isError: true,
        };
      }
      try {
        const path = assertSafeRelativePath(rawPath);
        await ensureWorkspaceCache(options);
        const file = await options.cache.readFile(options.partition, path);
        if (!file) {
          return { content: `File not found: ${path}`, isError: true };
        }
        return { content: file.content };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}
