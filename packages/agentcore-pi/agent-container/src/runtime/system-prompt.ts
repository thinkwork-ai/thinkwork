import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PiInvocationPayload {
  agent_name?: unknown;
  system_prompt?: unknown;
  tenant_slug?: unknown;
  instance_id?: unknown;
}

// System-prompt composition order. LLM attention is strongest at the start
// and end; middle positions get less weight. The order below is deliberate:
//
//   1. AGENTS.md — Layer-1 routing map. The model needs to know the
//      territory (who-I-am-as-router, subagent table) before anything else.
//   2. GUARDRAILS.md — safety floor; must apply everywhere.
//   3. SOUL.md / IDENTITY.md — personality and surface identity.
//   4. USER.md — who I'm talking to right now (materialized per-user at
//      assignment time by user-md-writer.ts).
//   5. CONTEXT.md — current per-thread / per-space context.
//   6. PLATFORM.md — platform-level rules (tool response, escalation,
//      date, Slack). Less hot; lives toward the back where the model still
//      re-reads but doesn't anchor on it.
//   7. MEMORY_GUIDE.md — how to use memory tools.
//   8. TOOLS.md — static tool-usage policy (the dynamic tool-availability
//      block sits at the very top, right after the date line).
//
// CAPABILITIES.md was dropped from this loader on 2026-05-24 — its content
// was duplicate-platform-rules + conditional tool guidance better handled
// by PLATFORM.md and the dynamic runtime tool policy block. The file may
// still exist in agent workspaces and the workspace-defaults package; the
// runtime simply no longer reads it.
//
// Strands' `_build_system_prompt` in
// packages/agentcore-strands/agent-container/container-sources/server.py
// mirrors this order — keep them in sync when editing.
const PROMPT_FILES = [
  "AGENTS.md",
  "GUARDRAILS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "CONTEXT.md",
  "PLATFORM.md",
  "MEMORY_GUIDE.md",
  "TOOLS.md",
] as const;

export type WorkspaceFileReader = (
  filePath: string,
) => Promise<string | null>;

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
  const executeCodeAvailable = tools.has("execute_code");
  const sendEmailAvailable = tools.has("send_email");

  return [
    "## Runtime Tool Policy",
    "",
    "### Code execution",
    executeCodeAvailable
      ? "- The `execute_code` tool is available. Use it for Python execution, script validation, data analysis, calculations, and generated output from code."
      : "- The `execute_code` tool is not available for this turn. Do not run code, simulate code execution, or claim generated output from code.",
    "- Never claim that code ran, tests passed, a script produced output, or calculated code results unless those facts came from an `execute_code` tool result in this turn.",
    "- You may provide source code as text without running it, but if the user asks to run, execute, test, debug, calculate with, or provide output from code and `execute_code` is unavailable, say the Code Sandbox is not enabled for this agent instead of inventing results.",
    "",
    "### Email",
    sendEmailAvailable
      ? "- The `send_email` tool is available. Use it only when the user explicitly asks to email something or the active task is already an email reply."
      : "- The `send_email` tool is not available for this turn.",
    "- Do not treat vague phrases like \"send me\", \"share with me\", or \"give me\" as email permission by themselves; answer in chat unless the user specifically requests email.",
  ].join("\n");
}

/**
 * Build the agent's system prompt by reading workspace files from disk.
 *
 * Mirrors Strands' `_build_system_prompt`: date prefix → system files
 * (PLATFORM/CAPABILITIES/GUARDRAILS/MEMORY_GUIDE) → workspace files
 * (SOUL/IDENTITY/USER/AGENTS/CONTEXT/TOOLS) → workspace skills block.
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
  parts.push(buildRuntimeToolPolicy(args.availableToolNames));

  let filesLoaded = 0;
  for (const filename of PROMPT_FILES) {
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
