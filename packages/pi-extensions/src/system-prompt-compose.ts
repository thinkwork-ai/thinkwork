import {
  threadJsonRenderComponentNames,
  threadJsonRenderDomainComponentNames,
  threadJsonRenderPrimitiveComponentNames,
} from "@thinkwork/thread-json-render";

export interface PiInvocationPayload {
  agent_name?: unknown;
  system_prompt?: unknown;
  tenant_slug?: unknown;
  instance_id?: unknown;
  user_id?: unknown;
  current_user_email?: unknown;
  current_user_name?: unknown;
  eval_mode?: unknown;
  agent_profiles?: unknown;
}

// System-prompt composition order. LLM attention is strongest at the start
// and end; middle positions get less weight. The order below is deliberate:
//
//   1. AGENTS.md — Layer-1 routing map. The model needs to know the
//      territory (who-I-am-as-router, subagent table) before anything else.
//   2. CONTEXT.md — current per-thread / per-space context.
//   3. GUARDRAILS.md — safety floor; must apply everywhere.
//   4. SPACE.md — active Space context when a tuple renderer supplied one.
//   5. User/USER.md — who I'm talking to right now (materialized per-user in
//      the rendered workspace User root).
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
  "User/USER.md",
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
  const askUserQuestionAvailable = tools.has("ask_user_question");
  const jsonRenderAvailable = tools.has("emit_json_render_ui");
  const mcpAvailable =
    tools.has("mcp") || [...tools].some((name) => name.startsWith("mcp."));

  const askUserQuestionPolicy = askUserQuestionAvailable
    ? [
        "",
        "### Asking the user",
        "- The `ask_user_question` tool is available for structured clarifying questions.",
        "- Ask only when: (a) two or more valid approaches differ meaningfully in outcome, (b) a required parameter cannot be inferred from context, or (c) a wrong guess would waste significant effort.",
        "- Do not ask when: the task has a single obvious path, the answer is already in the conversation/workspace/memory, or the question is purely cosmetic.",
        "- Ask about ONE decision at a time. A single call may carry up to 4 questions ONLY when they are facets of the same decision — never bundle unrelated decisions.",
        "- NEVER write questions as a bulleted list or prose in your reply. If you still need answers — including follow-ups after the user answered a previous question — call `ask_user_question` again. A plain-text question list is a failure mode.",
        '- When you have a preferred default, mark exactly one option per question with a label ending " (Recommended)".',
        "- When a delegated specialist's handoff carries clarification questions: answer what you can from your own context first; consolidate the rest (plus any questions of your own) into one batch and pass the delegationContext.",
        "- After calling `ask_user_question` the turn ends; the user's answer arrives in your next turn.",
      ]
    : [];
  const jsonRenderPolicy = jsonRenderAvailable
    ? [
        "",
        "### Generated Thread UI",
        "- The `emit_json_render_ui` tool is available when a compact inline UI would help the current Thread.",
        "- Before your final response, run a quick presentation pass: if the answer contains scan-friendly structured results, prefer generated UI over markdown/prose.",
        "- Prefer `result.list` for homogeneous or repeated result sets such as Work Items/Linear-like issues, agent-authored user-question collections, approval/review queues, checklists, comparisons, timelines, deployment evidence, evaluation runs, connector records, and search results.",
        "- Use `result.list` question rows only for non-blocking question collections, answered-question summaries, or status displays. True blocking clarifications still use `ask_user_question` and end the turn; never mimic the HITL question card with generated UI.",
        "- Keep tiny, narrative, unsupported, open-ended, or clearer-as-text answers in normal prose instead of forcing UI.",
        "- Call `emit_json_render_ui` with one complete json-render spec object. Do not write UI JSON in prose, markdown fences, or `_type` payloads.",
        "- Specs must use the upstream json-render shape: top-level `root` plus `elements`; every element uses `type`, `props`, and `children`.",
        "- Use only catalog component `type` values from the allowed catalog below. Do not invent components, CSS classes, arbitrary code, remote fetches, or dynamic imports.",
        "- Always include a concise mobile fallback title, summary, and optional lines in the tool input so non-web clients can render the same part.",
        "- Keep generated UI display-safe: do not include secrets, OAuth tokens, API keys, raw connector payloads, unnecessary PII, arbitrary URLs, scripts, callbacks, imports, or route instructions in specs, action params, diagnostics, or mobile fallback text.",
        "- If approval, review, form, or result-list UI uses a component action reference such as `task.review.primaryActionId`, `form.action.submitActionId`, or `result.list` item action ids, include a matching `durableActions` descriptor with the same id.",
        '- For Work Item approval actions, use durable action params `target: "work_item_status"`, `workItemId`, and either `statusCategory` or `statusId`; the button label/kind does not decide the status by itself.',
        "- Display-only generated UI can omit `durableActions`; do not add action descriptors unless a user click should perform a bounded ThinkWork action.",
        "- If the generated UI would need unsupported components or open-ended custom behavior, answer in normal prose instead of emitting UI.",
        `- ThinkWork domain components: ${threadJsonRenderDomainComponentNames.join(", ")}.`,
        `- Upstream shadcn primitive components: ${threadJsonRenderPrimitiveComponentNames.join(", ")}.`,
        `- Total allowed json-render components: ${threadJsonRenderComponentNames.length}.`,
      ]
    : [];

  return [
    "## Runtime Tool Policy",
    "",
    "### Code execution",
    bashAvailable
      ? "- The Pi host `bash` tool is available. It runs inside the host's contained workspace sandbox. Prefer it for shell commands, repository work, package scripts, builds, tests, and command output."
      : "- The Pi host `bash` tool is not available for this turn.",
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
    ...askUserQuestionPolicy,
    ...jsonRenderPolicy,
    "",
    "### Connected services",
    mcpAvailable
      ? "- MCP-backed connected services are available through the tool surface for this turn. Use them only when they help complete the user's request."
      : "- MCP-backed connected services are not available for this turn.",
  ].join("\n");
}

function buildAgentProfileRoutingPolicy(
  payload: PiInvocationPayload,
  toolNames: readonly string[] | undefined,
): string {
  const profiles = Array.isArray(payload.agent_profiles)
    ? payload.agent_profiles.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }
        const record = value as Record<string, unknown>;
        const slug = asString(record.slug);
        const name = asString(record.name);
        const modelId = asString(record.modelId ?? record.model_id);
        if (!slug || !name || !modelId) return [];
        return [
          {
            slug,
            name,
            modelId,
            description: asString(record.description),
            routingGuidance: asString(
              record.routingGuidance ?? record.routing_guidance,
            ),
          },
        ];
      })
    : [];
  const toolAvailable = new Set(toolNames ?? []).has(
    "delegate_to_agent_profile",
  );
  if (!toolAvailable || profiles.length === 0) return "";

  const profileLines = profiles.map((profile) => {
    const notes = [
      profile.description,
      profile.routingGuidance
        ? `Routing guidance: ${profile.routingGuidance}`
        : "",
    ].filter(Boolean);
    return `- ${profile.name} (#${profile.slug}, model ${profile.modelId})${
      notes.length ? `: ${notes.join(" ")}` : ""
    }`;
  });

  return [
    "## Agent Profile Delegation",
    "",
    "The `delegate_to_agent_profile` tool is available for specialized subtasks. Use it when a bounded part of the user's request matches an Agent Profile's routing guidance or expertise, including research, source finding, coding, implementation, testing, data analysis, spreadsheets, CRM, or quantitative review.",
    "Delegate only the bounded subtask. After the profile returns, use its handoff summary to answer the user. Do not delegate when the user only needs a direct answer that you can complete with the parent agent's current context and tools.",
    "",
    "Available Agent Profiles:",
    ...profileLines,
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

function buildRequesterProfilePolicy(includeUserMd: boolean): string {
  if (!includeUserMd) return "";
  return [
    "## Requester Profile Policy",
    "",
    "The rendered workspace includes `User/USER.md` for the signed-in user who triggered this turn.",
    "For profile, preference, family, identity, contact, timezone, and personal facts, use `User/USER.md` as the first source of truth.",
    "When `User/USER.md` contains the needed fact, answer directly from it. Do not call `recall`, `reflect`, or other memory tools to re-fetch facts already present in `User/USER.md`.",
    "Use memory tools only when `User/USER.md` does not contain the needed fact, the user explicitly asks to search memory, or the task requires broader prior-context synthesis.",
  ].join("\n");
}

export async function composeSystemPromptFromFiles(
  args: ComposeSystemPromptFromFilesArgs,
): Promise<string> {
  const now = args.now ?? new Date();
  const parts: string[] = [`Current date: ${formatDate(now)}`];
  const requesterContext = buildCurrentRequesterContext(args.payload);
  if (requesterContext) parts.push(requesterContext);
  const includeUserMd =
    typeof args.payload.user_id === "string" &&
    args.payload.user_id.trim().length > 0;
  const requesterProfilePolicy = buildRequesterProfilePolicy(includeUserMd);
  if (requesterProfilePolicy) parts.push(requesterProfilePolicy);
  parts.push(buildRuntimeToolPolicy(args.availableToolNames));
  const agentProfilePolicy = buildAgentProfileRoutingPolicy(
    args.payload,
    args.availableToolNames,
  );
  if (agentProfilePolicy) parts.push(agentProfilePolicy);

  let filesLoaded = 0;
  for (const filename of PROMPT_FILES) {
    if (filename === "User/USER.md" && !includeUserMd) continue;
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
