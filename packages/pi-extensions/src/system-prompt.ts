import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";
import {
  composeSystemPromptFromFiles,
  type PiInvocationPayload,
} from "./system-prompt-compose.js";
export type { PiInvocationPayload } from "./system-prompt-compose.js";

/**
 * System-prompt composition (plan §004 U6). Moved here from
 * agentcore-pi/runtime/system-prompt.ts so both hosts share one composition
 * path, and exposed as a Pi extension whose `before_agent_start` hook produces
 * the prompt inside the session lifecycle instead of the host hand-building a
 * string and passing it in.
 */

export type WorkspaceFileReader = (filePath: string) => Promise<string | null>;

export interface ComposeSystemPromptArgs {
  payload: PiInvocationPayload;
  workspaceDir: string;
  availableToolNames?: string[];
  workspaceSkillsBlock?: string;
  now?: Date;
  /** Test seam — defaults to a filesystem reader that returns null for
   * missing files. Tests inject a virtual reader to bypass disk I/O. */
  fileReader?: WorkspaceFileReader;
}

const defaultFileReader: WorkspaceFileReader = async (filePath) => {
  try {
    const content = await readFile(filePath, "utf-8");
    const trimmed = content.trim();
    return trimmed || null;
  } catch {
    return null;
  }
};

/**
 * Build the agent's system prompt by reading workspace files from disk.
 *
 * Composes the runtime system prompt as date prefix → runtime policy →
 * workspace files (AGENTS/CONTEXT/GUARDRAILS/SPACE/USER) → workspace skills
 * block.
 *
 * Falls back to `payload.system_prompt` (or a short default) only when
 * none of the workspace files exist — necessary for unit tests that
 * synthesize an invocation without a populated `/tmp/workspace`.
 */
export async function composeSystemPrompt(
  args: ComposeSystemPromptArgs,
): Promise<string> {
  const reader = args.fileReader ?? defaultFileReader;
  return composeSystemPromptFromFiles({
    payload: args.payload,
    availableToolNames: args.availableToolNames,
    workspaceSkillsBlock: args.workspaceSkillsBlock,
    now: args.now,
    readPromptFile: async (filename) =>
      reader(path.join(args.workspaceDir, filename)),
  });
}

export interface SystemPromptExtensionOptions extends ComposeSystemPromptArgs {
  /**
   * Optional text appended after the composed prompt (separated by the same
   * `---` divider) — the cloud host passes its per-turn message-attachment
   * preamble here so it survives the move into the hook.
   */
  suffix?: string;
  /**
   * Called with the final composed prompt once `before_agent_start` runs. The
   * host uses it to populate `composed_system_prompt` on the response, since the
   * prompt is now assembled inside the session rather than by the host.
   */
  onComposed?: (prompt: string) => void;
}

/**
 * Build the system-prompt extension. Its `before_agent_start` hook composes the
 * prompt from workspace defaults + tool policy + skills (+ optional suffix) and
 * returns it as the turn's system prompt, replacing the host's prebuilt string.
 */
export function createSystemPromptExtension(
  options: SystemPromptExtensionOptions,
): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-system-prompt",
    register(pi) {
      pi.on("before_agent_start", async () => {
        const base = await composeSystemPrompt(options);
        const suffix = options.suffix?.trim();
        const systemPrompt = suffix ? `${base}\n\n---\n\n${suffix}` : base;
        options.onComposed?.(systemPrompt);
        return { systemPrompt };
      });
    },
  });
}
