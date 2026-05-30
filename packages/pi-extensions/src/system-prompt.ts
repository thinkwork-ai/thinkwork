import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

/**
 * System-prompt composition (plan §004 U6). Moved here from
 * agentcore-pi/runtime/system-prompt.ts so both hosts share one composition
 * path, and exposed as a Pi extension whose `before_agent_start` hook produces
 * the prompt inside the session lifecycle instead of the host hand-building a
 * string and passing it in.
 *
 * Strands' `_build_system_prompt` in
 * packages/agentcore-strands/agent-container/container-sources/server.py
 * mirrors the file order below — keep them in sync when editing.
 */

export interface PiInvocationPayload {
  agent_name?: unknown;
  system_prompt?: unknown;
  tenant_slug?: unknown;
  instance_id?: unknown;
  user_id?: unknown;
  current_user_email?: unknown;
  current_user_name?: unknown;
  eval_mode?: unknown;
}

// System-prompt composition order. LLM attention is strongest at the start
// and end; middle positions get less weight. The order below is deliberate:
//
//   1. AGENTS.md — Layer-1 routing map. The model needs to know the
//      territory (who-I-am-as-router, subagent table) before anything else.
//   2. CONTEXT.md — current per-thread / per-space context.
//   3. GUARDRAILS.md — safety floor; must apply everywhere.
//   4. SPACE.md — active Space context when a tuple renderer supplied one.
//   5. USER.md — who I'm talking to right now (materialized per-user at
//      assignment time by user-md-writer.ts).
//
// SOUL.md, IDENTITY.md, PLATFORM.md, CAPABILITIES.md, MEMORY_GUIDE.md, and
// TOOLS.md may still exist during the migration window; their content has
// moved into AGENTS.md sections or dynamic runtime policy, so this loader no
// longer reads them.
const PROMPT_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "GUARDRAILS.md",
  "SPACE.md",
  "USER.md",
] as const;

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

function formatDate(now: Date): string {
  const tz = "America/Chicago";
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  });
  const tzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const date = dateFmt.format(now);
  return tzAbbr ? `${date} (${tzAbbr})` : date;
}

function buildFallback(payload: PiInvocationPayload): string {
  const explicit =
    typeof payload.system_prompt === "string"
      ? payload.system_prompt.trim()
      : "";
  if (explicit) return explicit;

  const name =
    typeof payload.agent_name === "string" && payload.agent_name.trim()
      ? payload.agent_name.trim()
      : "ThinkWork agent";
  const tenant =
    typeof payload.tenant_slug === "string" ? payload.tenant_slug.trim() : "";
  const instance =
    typeof payload.instance_id === "string" ? payload.instance_id.trim() : "";

  return [
    `You are ${name}, running inside ThinkWork's Pi AgentCore runtime.`,
    tenant ? `Tenant: ${tenant}.` : "",
    instance ? `Workspace instance: ${instance}.` : "",
    "Answer the user's request directly and concisely. Use only capabilities available in this runtime.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRuntimeToolPolicy(toolNames: string[] | undefined): string {
  const tools = new Set(toolNames ?? []);
  const bashAvailable = tools.has("bash");
  const executeCodeAvailable = tools.has("execute_code");
  const sendEmailAvailable = tools.has("send_email");

  return [
    "## Runtime Tool Policy",
    "",
    "### Code execution",
    bashAvailable
      ? "- The Pi built-in `bash` tool is available. Prefer it for shell commands, repository work, package scripts, builds, tests, and command output."
      : "- The Pi built-in `bash` tool is not available for this turn.",
    executeCodeAvailable
      ? "- The `execute_code` tool is available as a Thinkwork Code Interpreter sandbox for isolated Python/data-analysis work and generated output from that sandbox."
      : "- The `execute_code` tool is not available for this turn.",
    "- Treat `bash` and `execute_code` as distinct execution environments, not duplicates: use `bash` for the Pi workspace/shell, and `execute_code` only when the tenant Code Interpreter sandbox is the right isolation boundary.",
    "- Never claim that code ran, tests passed, a command produced output, or calculated code results unless those facts came from a `bash` or `execute_code` tool result in this turn.",
    !bashAvailable && !executeCodeAvailable
      ? "- You may provide source code as text, but do not run code, simulate execution, or invent command output."
      : "",
    "",
    "### Email",
    sendEmailAvailable
      ? "- The `send_email` tool is available. Use it only when the user explicitly asks to email something or the active task is already an email reply."
      : "- The `send_email` tool is not available for this turn.",
    '- Do not treat vague phrases like "send me", "share with me", or "give me" as email permission by themselves; answer in chat unless the user specifically requests email.',
  ].join("\n");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCurrentRequesterContext(payload: PiInvocationPayload): string {
  const userId = asString(payload.user_id);
  const name = asString(payload.current_user_name);
  const email = asString(payload.current_user_email);
  if (!userId && !name && !email) return "";

  return [
    "<current_requester>",
    "This is the signed-in user who triggered the current turn.",
    name ? `Name: ${name}` : "",
    email ? `Email: ${email}` : "",
    userId ? `User ID: ${userId}` : "",
    email
      ? 'When the user asks you to email "me", "my email", or "the current user", send to this email address.'
      : "Do not invent a recipient email address for the current user.",
    "</current_requester>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the agent's system prompt by reading workspace files from disk.
 *
 * Mirrors Strands' `_build_system_prompt`: date prefix → runtime policy →
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
  const now = args.now ?? new Date();
  const parts: string[] = [`Current date: ${formatDate(now)}`];
  const requesterContext = buildCurrentRequesterContext(args.payload);
  if (requesterContext) parts.push(requesterContext);
  parts.push(buildRuntimeToolPolicy(args.availableToolNames));

  let filesLoaded = 0;
  const includeUserMd =
    typeof args.payload.user_id === "string" &&
    args.payload.user_id.trim().length > 0;
  for (const filename of PROMPT_FILES) {
    if (filename === "USER.md" && !includeUserMd) continue;
    const content = await reader(path.join(args.workspaceDir, filename));
    if (content) {
      parts.push(content);
      filesLoaded++;
    }
  }

  if (filesLoaded === 0) {
    parts.push(buildFallback(args.payload));
  }

  const skills = args.workspaceSkillsBlock?.trim();
  if (skills) parts.push(skills);

  return parts.join("\n\n---\n\n");
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
