import { assertSafeRelativePath } from "../workspace-cache";
import type { Tool } from "../types";
import {
  ensureWorkspaceCache,
  requiredStringArg,
  type WorkspaceToolOptions,
} from "./workspace-tool-context";

const DEFAULT_MAX_RESULTS = 25;

export function createGrepTool(options: WorkspaceToolOptions): Tool {
  return {
    name: "grep",
    description:
      "Search cached ThinkWork workspace files for text. Returns matching file paths and line snippets.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Text or regular expression to search for.",
        },
        path: {
          type: "string",
          description: "Optional relative directory/file path to limit search.",
        },
        caseSensitive: { type: "boolean" },
        maxResults: { type: "number" },
      },
      required: ["pattern"],
    },
    execute: async (args) => {
      const rawPattern = requiredStringArg(args, "pattern");
      if (!rawPattern) {
        return {
          content: 'Missing required string argument "pattern".',
          isError: true,
        };
      }
      try {
        await ensureWorkspaceCache(options);
        const scope =
          typeof args.path === "string" && args.path.trim()
            ? assertSafeRelativePath(args.path)
            : "";
        const caseSensitive = args.caseSensitive === true;
        const maxResults =
          typeof args.maxResults === "number" && args.maxResults > 0
            ? Math.min(Math.floor(args.maxResults), 100)
            : DEFAULT_MAX_RESULTS;
        const needle = caseSensitive ? rawPattern : rawPattern.toLowerCase();
        const files = await options.cache.listFiles(options.partition, scope);
        const matches: string[] = [];

        for (const file of files) {
          const lines = file.content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase();
            if (!haystack.includes(needle)) continue;
            matches.push(`${file.path}:${i + 1}: ${lines[i]}`);
            if (matches.length >= maxResults) {
              return { content: matches.join("\n") };
            }
          }
        }

        return {
          content: matches.length > 0 ? matches.join("\n") : "No matches.",
        };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}
