import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { WorkspaceTarget } from "@/lib/workspace-api";

type GetWorkspaceFile = (
  target: WorkspaceTarget,
  path: string,
) => Promise<{ content: string | null; source: string; sha256: string }>;

export interface WorkspaceContextExtensionOptions {
  userId?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  deps?: {
    getWorkspaceFile?: GetWorkspaceFile;
  };
}

type WorkspaceContextFile = {
  label: string;
  content: string;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<
  string,
  { expiresAt: number; files: WorkspaceContextFile[] }
>();

async function readFile(
  label: string,
  target: WorkspaceTarget,
  path: string,
  getFile: GetWorkspaceFile,
): Promise<WorkspaceContextFile | null> {
  try {
    const file = await getFile(target, path);
    const content = file.content?.trim();
    return content ? { label, content } : null;
  } catch {
    return null;
  }
}

function cacheKey(options: WorkspaceContextExtensionOptions): string {
  return [
    options.userId?.trim() ?? "",
    options.agentId?.trim() ?? "",
    options.spaceId?.trim() ?? "",
  ].join("|");
}

async function loadWorkspaceContext(
  options: WorkspaceContextExtensionOptions,
): Promise<WorkspaceContextFile[]> {
  const key = cacheKey(options);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.files;

  const getFile =
    options.deps?.getWorkspaceFile ??
    ((async (target, path) => {
      const api = await import("@/lib/workspace-api");
      return api.getWorkspaceFile(target, path);
    }) satisfies GetWorkspaceFile);
  const files: WorkspaceContextFile[] = [];
  const userId = options.userId?.trim();
  const spaceId = options.spaceId?.trim();
  const agentId = options.agentId?.trim();

  const candidates: Promise<WorkspaceContextFile | null>[] = [];
  if (userId) {
    candidates.push(readFile("USER.md", { userId }, "USER.md", getFile));
  }
  if (spaceId) {
    candidates.push(readFile("SPACE.md", { spaceId }, "SPACE.md", getFile));
  }
  if (agentId) {
    candidates.push(readFile("AGENTS.md", { agentId }, "AGENTS.md", getFile));
  }

  for (const file of await Promise.all(candidates)) {
    if (file) files.push(file);
  }

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, files });
  return files;
}

function renderWorkspaceContext(files: WorkspaceContextFile[]): string {
  if (files.length === 0) return "";
  const sections = files.map(
    (file) => `## ${file.label}\n${file.content.trim()}`,
  );
  return [
    "The following ThinkWork workspace context is available for this turn.",
    "Use USER.md for the human's identity and preferences.",
    "",
    ...sections,
  ].join("\n");
}

export function workspaceContextExtension(
  options: WorkspaceContextExtensionOptions,
): ExtensionFactory {
  return defineExtension({
    name: "workspace-context",
    description: "Injects ThinkWork workspace files into the mobile harness.",
    register(pi) {
      pi.on("before_agent_start", async (event) => {
        const files = await loadWorkspaceContext(options);
        const context = renderWorkspaceContext(files);
        if (!context) return;
        return {
          systemPrompt: `${event.systemPrompt}\n\n${context}`,
        };
      });
    },
  });
}
