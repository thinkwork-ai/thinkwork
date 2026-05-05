import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PiInvocationPayload {
  agent_name?: unknown;
  system_prompt?: unknown;
  tenant_slug?: unknown;
  instance_id?: unknown;
}

// Order mirrors `_build_system_prompt` in
// packages/agentcore-strands/agent-container/container-sources/server.py:159.
// Materialize-at-write-time (docs/plans/2026-04-27-003) means PLATFORM /
// CAPABILITIES / GUARDRAILS / MEMORY_GUIDE now live in the agent's S3 prefix
// alongside the user files, so a single in-order read covers both groups.
const SYSTEM_FILES = [
  "PLATFORM.md",
  "CAPABILITIES.md",
  "GUARDRAILS.md",
  "MEMORY_GUIDE.md",
] as const;

const WORKSPACE_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "CONTEXT.md",
  "TOOLS.md",
] as const;

export type WorkspaceFileReader = (
  filePath: string,
) => Promise<string | null>;

export interface ComposeSystemPromptArgs {
  payload: PiInvocationPayload;
  workspaceDir: string;
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
    `You are ${name}, running inside ThinkWork's Flue AgentCore runtime.`,
    tenant ? `Tenant: ${tenant}.` : "",
    instance ? `Workspace instance: ${instance}.` : "",
    "Answer the user's request directly and concisely. Use only capabilities available in this runtime.",
  ]
    .filter(Boolean)
    .join("\n");
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

  const filenames = [...SYSTEM_FILES, ...WORKSPACE_FILES];
  let filesLoaded = 0;
  for (const filename of filenames) {
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
