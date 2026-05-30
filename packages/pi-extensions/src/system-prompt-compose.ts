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
export const PROMPT_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "GUARDRAILS.md",
  "SPACE.md",
  "USER.md",
] as const;

export type PromptFileName = (typeof PROMPT_FILES)[number];

export interface ComposeSystemPromptFromFilesArgs {
  payload: PiInvocationPayload;
  readPromptFile: (filename: PromptFileName) => Promise<string | null>;
  availableToolNames?: readonly string[];
  workspaceSkillsBlock?: string;
  now?: Date;
}

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

function buildRuntimeToolPolicy(
  toolNames: readonly string[] | undefined,
): string {
  const tools = new Set(toolNames ?? []);
  const bashAvailable = tools.has("bash");
  const executeCodeAvailable = tools.has("execute_code");
  const sendEmailAvailable = tools.has("send_email");
  const mcpAvailable =
    tools.has("mcp") || [...tools].some((name) => name.startsWith("mcp."));

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
    "",
    "### Connected services",
    mcpAvailable
      ? "- MCP-backed connected services are available through the tool surface for this turn. Use them only when they help complete the user's request."
      : "- MCP-backed connected services are not available for this turn.",
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

export async function composeSystemPromptFromFiles(
  args: ComposeSystemPromptFromFilesArgs,
): Promise<string> {
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
    const content = await args.readPromptFile(filename);
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
