import {
  PROMPT_FILES,
  composeSystemPromptFromFiles,
  type PromptFileName,
} from "../../../../../packages/pi-extensions/src/system-prompt-compose";
import { defineExtension } from "./define-extension";
import type { ExtensionFactory } from "./types";
import type { WorkspaceTarget } from "@/lib/workspace-api";

type GetWorkspaceFile = (
  target: WorkspaceTarget,
  path: string,
) => Promise<{ content: string | null; source: string; sha256: string }>;

export interface WorkspaceContextExtensionOptions {
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  availableToolNames?: readonly string[];
  workspaceSkillsBlock?: string | null;
  now?: Date;
  deps?: {
    getWorkspaceFile?: GetWorkspaceFile;
  };
}

type WorkspaceContextCacheEntry = {
  expiresAt: number;
  files: Partial<Record<PromptFileName, string>>;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, WorkspaceContextCacheEntry>();

const MOBILE_HOST_GUIDANCE = [
  "## Mobile Host",
  "You are running inside ThinkWork mobile. Keep answers concise and phone-friendly.",
  "Use only capabilities available in this turn, and never claim code, shell commands, files, email, or connected services were used unless that fact came from a tool result.",
].join("\n");

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function cacheKey(options: WorkspaceContextExtensionOptions): string {
  return [
    normalized(options.userId),
    normalized(options.agentId),
    normalized(options.spaceId),
  ].join("|");
}

function targetForPromptFile(
  filename: PromptFileName,
  options: WorkspaceContextExtensionOptions,
): WorkspaceTarget | null {
  if (filename === "USER.md") {
    const userId = normalized(options.userId);
    return userId ? { userId } : null;
  }
  if (filename === "SPACE.md") {
    const spaceId = normalized(options.spaceId);
    return spaceId ? { spaceId } : null;
  }

  const agentId = normalized(options.agentId);
  return agentId ? { agentId } : null;
}

async function readPromptFile(
  filename: PromptFileName,
  options: WorkspaceContextExtensionOptions,
  getFile: GetWorkspaceFile,
): Promise<string | null> {
  const target = targetForPromptFile(filename, options);
  if (!target) return null;
  try {
    const file = await getFile(target, filename);
    const content = file.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

async function loadWorkspaceContext(
  options: WorkspaceContextExtensionOptions,
): Promise<Partial<Record<PromptFileName, string>>> {
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
  const entries = await Promise.all(
    PROMPT_FILES.map(
      async (filename) =>
        [filename, await readPromptFile(filename, options, getFile)] as const,
    ),
  );
  const files: Partial<Record<PromptFileName, string>> = {};
  for (const [filename, content] of entries) {
    if (content) files[filename] = content;
  }

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, files });
  return files;
}

function payloadFor(
  event: { systemPrompt: string; agentName?: string },
  options: WorkspaceContextExtensionOptions,
) {
  return {
    agent_name: event.agentName,
    system_prompt: event.systemPrompt,
    user_id: normalized(options.userId),
    current_user_name: normalized(options.userName),
    current_user_email: normalized(options.userEmail),
  };
}

export function clearWorkspaceContextCache(): void {
  cache.clear();
}

export function workspaceContextExtension(
  options: WorkspaceContextExtensionOptions,
): ExtensionFactory {
  return defineExtension({
    name: "workspace-context",
    description:
      "Composes the shared ThinkWork system prompt over mobile workspace files.",
    register(pi) {
      pi.on("before_agent_start", async (event) => {
        const files = await loadWorkspaceContext(options);
        const systemPrompt = await composeSystemPromptFromFiles({
          payload: payloadFor(event, options),
          availableToolNames: options.availableToolNames ?? event.toolNames,
          workspaceSkillsBlock: options.workspaceSkillsBlock ?? undefined,
          now: options.now,
          readPromptFile: async (filename) => files[filename] ?? null,
        });

        return {
          systemPrompt: `${systemPrompt}\n\n---\n\n${MOBILE_HOST_GUIDANCE}`,
        };
      });
    },
  });
}
