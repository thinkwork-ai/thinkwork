import { describe, expect, it, vi } from "vitest";
import {
  composeHarnessSystemPrompt,
  computeHarnessProjectionFingerprints,
  forceDocumentSectionWaiver,
  HarnessDuplicateDeliveryError,
  normalizeDocumentContractMarkdown,
  normalizeFunnelAnalysisOrder,
  normalizeHarnessWireEvent,
  parseHarnessInvokeEvent,
  runHarnessTurn,
  type HarnessRunnerDeps,
  type HarnessStreamEvent,
} from "./runner.js";
import type { FinalizePayload } from "../chat-finalize/types.js";
import type { HarnessInvocationTool } from "./managed-profile.js";
import type { HarnessTool } from "@aws-sdk/client-bedrock-agentcore";

function stream(
  events: HarnessStreamEvent[],
): AsyncIterable<HarnessStreamEvent> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

describe("Harness projection fingerprints", () => {
  it("keeps one logical-agent base while participant projections differ", () => {
    const common = {
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      harnessConfigurationFingerprint: "harness-config",
      harnessVersion: "5",
      sessionStrategy: "fresh",
    };
    const alice = computeHarnessProjectionFingerprints({
      ...common,
      participantId: "alice",
      turnId: "turn-alice",
      configFingerprint: "alice-config",
      manifestFingerprint: "alice-manifest",
    });
    const bob = computeHarnessProjectionFingerprints({
      ...common,
      participantId: "bob",
      turnId: "turn-bob",
      configFingerprint: "bob-config",
      manifestFingerprint: "bob-manifest",
    });
    expect(alice.baseFingerprint).toBe(bob.baseFingerprint);
    expect(alice.participantFingerprint).not.toBe(bob.participantFingerprint);
  });
});

describe("document plate normalization", () => {
  it("moves a known waiver outside and removes the section it waives", () => {
    const normalized = normalizeDocumentContractMarkdown(
      [
        "## Quota Attainment",
        "",
        "No quota exists.",
        "",
        "```tw:waiver",
        "section: quota-attainment",
        "reason: Twenty CRM has no quota target.",
        "```",
        "",
        "## Pipeline Health",
        "",
        "Evidence.",
      ].join("\n"),
      {
        slug: "sales-rep-review",
        displayName: "Sales Rep Review",
        useFor: "rep reviews",
        sections: [
          {
            id: "quota-attainment",
            title: "Quota Attainment",
            tier: "required-if-material",
          },
        ],
      },
    );
    expect(normalized).not.toContain("## Quota Attainment");
    expect(normalized).toContain("## Pipeline Health");
    expect(normalized).toContain("section: quota-attainment");
  });

  it("forces unsupported quota math to a truthful waiver", () => {
    const plate = {
      slug: "sales-rep-review",
      displayName: "Sales Rep Review",
      useFor: "Rep review",
      sections: [
        {
          id: "quota-attainment",
          title: "Quota Attainment",
          tier: "required-if-material" as const,
        },
        {
          id: "coaching-notes",
          title: "Coaching Notes",
          tier: "required" as const,
        },
      ],
    };
    const normalized = forceDocumentSectionWaiver({
      markdown:
        "## Quota Attainment\n\n```tw:analysis\nanalysis: quota-attainment\nnumerator: 330250\ndenominator: 1\n```\n\n## Coaching Notes\n\nAdvance qualified deals.",
      plate,
      sectionId: "quota-attainment",
      analysisKey: "quota-attainment",
      reason: "No explicit quota target.",
    });
    expect(normalized).not.toContain("## Quota Attainment");
    expect(normalized).not.toContain("analysis: quota-attainment");
    expect(normalized).toContain("## Coaching Notes");
    expect(normalized).toContain("section: quota-attainment");
  });

  it("orders funnel stages widest-to-narrowest without changing counts", () => {
    const normalized = normalizeFunnelAnalysisOrder(
      "```tw:analysis\nanalysis: pipeline-conversion\nstages:\n  - { label: Identified, count: 8 }\n  - { label: Active, count: 1 }\n  - { label: Value Alignment, count: 2 }\n```",
    );
    expect(normalized.indexOf("count: 8")).toBeLessThan(
      normalized.indexOf("count: 2"),
    );
    expect(normalized.indexOf("count: 2")).toBeLessThan(
      normalized.indexOf("count: 1"),
    );
    expect(normalized.match(/count:/g)).toHaveLength(3);
  });
});

function textEvents(
  text: string,
  stopReason = "end_turn",
): HarnessStreamEvent[] {
  return [
    { messageStart: { role: "assistant" } },
    { contentBlockStart: { contentBlockIndex: 0 } },
    { contentBlockDelta: { contentBlockIndex: 0, delta: { text } } },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason } },
    { metadata: { usage: { inputTokens: 100, outputTokens: 20 } } },
  ];
}

function toolUseEvents(
  name: string,
  toolUseId: string,
  input: Record<string, unknown>,
  stopReason = "tool_use",
): HarnessStreamEvent[] {
  const json = JSON.stringify(input);
  return [
    { messageStart: { role: "assistant" } },
    {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId, name } },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { toolUse: { input: json.slice(0, 10) } },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { toolUse: { input: json.slice(10) } },
      },
    },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason } },
    { metadata: { usage: { inputTokens: 50, outputTokens: 10 } } },
  ];
}

function managedBrowserEvents(
  text: string,
  resultStatus: "success" | "error" = "success",
  resultText = "Browser action completed.",
): HarnessStreamEvent[] {
  return [
    { messageStart: { role: "assistant" } },
    {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId: "browser-1", name: "browser" } },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: {
          toolUse: {
            input: JSON.stringify({ url: "https://example.com" }),
          },
        },
      },
    },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason: "tool_use" } },
    { messageStart: { role: "user" } },
    {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: {
          toolResult: { toolUseId: "browser-1", status: resultStatus },
        },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { toolResult: [{ text: resultText }] },
      },
    },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason: "tool_result" } },
    { messageStart: { role: "assistant" } },
    { contentBlockStart: { contentBlockIndex: 0 } },
    { contentBlockDelta: { contentBlockIndex: 0, delta: { text } } },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason: "end_turn" } },
    { metadata: { usage: { inputTokens: 120, outputTokens: 30 } } },
  ];
}

const EMIT_INPUT = {
  genre: "qbr",
  title: "QBR: 777 Automotive",
  abstract: "Quarterly business review.",
  digest_markdown: "# QBR\n\ncontent",
};

const MANAGED_HARNESS_TOOLS: HarnessInvocationTool[] = [
  {
    type: "agentcore_gateway",
    name: "thinkwork_gateway",
    config: {
      agentCoreGateway: {
        gatewayArn: "arn:aws:bedrock-agentcore:us-east-1:123:gateway/g1",
      },
    },
  },
  {
    type: "agentcore_browser",
    name: "browser",
    config: { agentCoreBrowser: {} },
  },
  {
    type: "inline_function",
    name: "emit_document",
    config: {
      inlineFunction: {
        description: "Emit document",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
  },
  {
    type: "inline_function",
    name: "goal_complete",
    config: {
      inlineFunction: {
        description: "Complete goal",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
  },
  {
    type: "inline_function",
    name: "submit_skill_draft",
    config: {
      inlineFunction: {
        description: "Submit skill draft",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
  },
];

function basePayload(): Record<string, unknown> {
  return {
    tenant_id: "tenant-1",
    tenant_slug: "tenant-one",
    thread_id: "thread-1",
    assistant_id: "agent-1",
    thread_turn_id: "turn-1",
    trace_id: "trace-1",
    message: "Review 777 Automotive",
    system_prompt: "You are ThinkWork, the tenant platform agent.",
    messages_history: [],
    model: "moonshotai.kimi-k2.5",
    requested_model: "moonshotai.kimi-k2.5",
    instance_id: "thinkwork-agent",
    agent_name: "ThinkWork Agent",
    cost_owner_user_id: "user-1",
    user_id: "user-1",
    capabilities_manifest_fingerprint: "manifest-fp",
    config_fingerprint: "config-fp",
    skills: [
      {
        skillId: "document-composer",
        s3Key: "tenants/tei/agents/thinkwork-agent/skills/document-composer",
      },
    ],
    mcp_configs: [
      {
        name: "lastmile-data",
        url: "https://mcp.example.com/lastmile",
        transport: "streamable-http",
        auth: { type: "bearer", token: "tok" },
        tools: ["query"],
      },
    ],
    document_plates: [
      { slug: "qbr", displayName: "QBR", useFor: "quarterly business reviews" },
    ],
    agent_profiles: [],
    pi_extensions: [],
  };
}

interface TestDeps extends HarnessRunnerDeps {
  finalizePayloads: FinalizePayload[];
  invocations: Array<{
    runtimeSessionId: string;
    messages: unknown;
    modelId?: string;
    allowedTools?: string[];
    tools?: HarnessTool[];
    systemPrompt?: Array<{ text: string }>;
    maxIterations?: number;
  }>;
  emissions: Array<Record<string, unknown>>;
  skillDraftSubmissions: Array<Record<string, unknown>>;
  internalToolExecutions: Array<Record<string, unknown>>;
}

function makeDeps(
  streams: Array<AsyncIterable<HarnessStreamEvent>>,
  options: {
    emitResults?: Array<{ statusCode: number; body: Record<string, unknown> }>;
    goalRun?: Record<string, unknown> | null;
    recalledMemories?: Array<{
      scope: "user" | "space";
      text: string;
      score: number;
    }>;
  } = {},
): TestDeps {
  const finalizePayloads: FinalizePayload[] = [];
  const invocations: Array<{
    runtimeSessionId: string;
    messages: unknown;
    modelId?: string;
    allowedTools?: string[];
    tools?: HarnessTool[];
    systemPrompt?: Array<{ text: string }>;
    maxIterations?: number;
  }> = [];
  const emissions: Array<Record<string, unknown>> = [];
  const skillDraftSubmissions: Array<Record<string, unknown>> = [];
  const internalToolExecutions: Array<Record<string, unknown>> = [];
  const emitResults = [...(options.emitResults ?? [])];
  const queue = [...streams];
  return {
    finalizePayloads,
    invocations,
    emissions,
    skillDraftSubmissions,
    internalToolExecutions,
    workspaceBucket: "bucket-1",
    keepaliveIntervalMs: 0,
    resolveHarness: vi.fn(async () => ({
      harnessArn: "arn:aws:bedrock-agentcore:us-east-1:123:harness/h1",
      harnessId: "h1",
      harnessVersion: "3",
      modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      qualifier: "ThinkworkProof",
      configurationFingerprint: "harness-config-fp",
      sessionStrategy: "fresh" as const,
      gatewayUrl: "https://gateway.example.com/mcp",
      gatewayTargetName: "ThinkworkDevOwnerProof",
      identityWorkloadName: "thinkwork-dev-multiplayer-proof",
      identityCredentialProviderName: "thinkwork-dev-proof-oauth",
      invocationTools: MANAGED_HARNESS_TOOLS,
    })),
    mintHarnessAssertion: vi.fn(async () => ({
      token: "signed-turn-assertion",
      expiresAt: 2_000_000_000,
      jti: "jti-1",
    })),
    prepareFreshTurn: vi.fn(async () => ({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: "Review 777 Automotive",
      history: [],
    })),
    transitionFreshTurn: vi.fn(async () => {}),
    abandonFreshTurn: vi.fn(async () => {}),
    invokeHarness: vi.fn(async (input) => {
      invocations.push({
        runtimeSessionId: input.runtimeSessionId,
        messages: input.messages,
        modelId: input.modelId,
        allowedTools: input.allowedTools,
        tools: input.tools,
        systemPrompt: input.systemPrompt,
        maxIterations: input.maxIterations,
      });
      const next = queue.shift();
      if (!next) throw new Error("test: no more scripted streams");
      return next;
    }),
    emitDocument: vi.fn(async (input) => {
      emissions.push(input.raw);
      return (
        emitResults.shift() ?? {
          statusCode: 200,
          body: {
            ok: true,
            artifactId: "artifact-1",
            documentId: "doc-1",
            status: "draft",
            headVersion: 0,
          },
        }
      );
    }),
    submitSkillDraft: vi.fn(async (input) => {
      skillDraftSubmissions.push(input as unknown as Record<string, unknown>);
      return {
        status: "submitted" as const,
        draftId: "draft-1",
        slug: "account-brief",
        fileCount: 2,
        currentContentHash: "sha256:draft",
      };
    }),
    finalize: vi.fn(async (payload: FinalizePayload) => {
      finalizePayloads.push(payload);
      return { finalized: true, messageId: "msg-1" };
    }),
    bumpTurnActivity: vi.fn(async () => {}),
    recordInternalToolExecution: vi.fn(async (input) => {
      internalToolExecutions.push(input);
    }),
    loadToolExecutions: vi.fn(async () => [
      {
        operation: "mcp.tools.call",
        status: "completed",
        input_preview: JSON.stringify({
          connector: "twenty--crm",
          tool: "find_many_opportunities",
        }),
      },
    ]),
    loadGoalRun: vi.fn(async () => options.goalRun ?? null),
    collectConnectorEvidence: vi.fn(async () => ({
      connector: "twenty--crm",
      tool: "find_many_opportunities",
      evidence: {
        opportunities: [
          { name: "McPherson POC", amount: 8_750_000, stage: "ACTIVE" },
        ],
      },
    })),
    recallMemories: vi.fn(async () => options.recalledMemories ?? []),
    fetchWorkspaceText: vi.fn(async () => null),
  };
}

describe("parseHarnessInvokeEvent", () => {
  it("unwraps the API-GW-shaped body", () => {
    expect(
      parseHarnessInvokeEvent({
        rawPath: "/invocations",
        body: JSON.stringify({ tenant_id: "t" }),
      }),
    ).toEqual({ tenant_id: "t" });
  });

  it("passes through a bare payload", () => {
    expect(parseHarnessInvokeEvent({ tenant_id: "t" })).toEqual({
      tenant_id: "t",
    });
  });
});

describe("normalizeHarnessWireEvent", () => {
  it("adapts the live flat Harness stream union into the runner shape", () => {
    expect(normalizeHarnessWireEvent({ role: "assistant" })).toEqual({
      messageStart: { role: "assistant" },
    });
    expect(
      normalizeHarnessWireEvent({
        contentBlockIndex: 0,
        delta: { text: "hello" },
      }),
    ).toEqual({
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { text: "hello" },
      },
    });
    expect(normalizeHarnessWireEvent({ contentBlockIndex: 0 })).toEqual({
      contentBlockStop: { contentBlockIndex: 0 },
    });
    expect(normalizeHarnessWireEvent({ stopReason: "end_turn" })).toEqual({
      messageStop: { stopReason: "end_turn" },
    });
    expect(
      normalizeHarnessWireEvent({
        metrics: { latencyMs: 10 },
        usage: { inputTokens: 5, outputTokens: 2 },
      }),
    ).toEqual({
      metadata: { usage: { inputTokens: 5, outputTokens: 2 } },
    });
  });
});

describe("composeHarnessSystemPrompt", () => {
  it("hydrates lazy-mounted requester context from the rendered manifest", async () => {
    const prefix = "tenants/acme/threads/thread-1";
    const userSource = "tenants/acme/users/eric/USER.md";
    const objects = new Map<string, string>([
      [
        `${prefix}/.hydrate_manifest.json`,
        JSON.stringify({
          files: [
            {
              path: "User/USER.md",
              owner: "user",
              sourceKey: userSource,
            },
          ],
        }),
      ],
      [
        userSource,
        "# USER.md\n\n- **Name:** Eric Odom\n- **Email:** eric@thinkwork.ai",
      ],
    ]);
    const fetchWorkspaceText = vi.fn(
      async (key: string) => objects.get(key) ?? null,
    );

    const prompt = await composeHarnessSystemPrompt(
      {
        tenant_slug: "acme",
        user_id: "user-1",
        current_user_email: "eric@thinkwork.ai",
        rendered_workspace_prefix: `${prefix}/`,
        system_prompt: "fallback",
      },
      [],
      { fetchWorkspaceText },
    );

    expect(prompt).toContain("<current_requester>");
    expect(prompt).toContain("Email: eric@thinkwork.ai");
    expect(prompt).toContain("# USER.md");
    expect(prompt).toContain("Name:** Eric Odom");
    expect(fetchWorkspaceText).toHaveBeenCalledWith(`${prefix}/User/USER.md`);
    expect(fetchWorkspaceText).toHaveBeenCalledWith(userSource);
  });

  it("does not follow hydrate-manifest source keys outside the current tenant", async () => {
    const prefix = "tenants/acme/threads/thread-1";
    const fetchWorkspaceText = vi.fn(async (key: string) => {
      if (key === `${prefix}/.hydrate_manifest.json`) {
        return JSON.stringify({
          files: [
            {
              path: "User/USER.md",
              sourceKey: "tenants/other/users/victim/USER.md",
            },
          ],
        });
      }
      return null;
    });

    const prompt = await composeHarnessSystemPrompt(
      {
        tenant_slug: "acme",
        rendered_workspace_prefix: `${prefix}/`,
        system_prompt: "fallback",
      },
      [],
      { fetchWorkspaceText },
    );

    expect(prompt).toBe("fallback");
    expect(fetchWorkspaceText).not.toHaveBeenCalledWith(
      "tenants/other/users/victim/USER.md",
    );
  });
});

describe("runHarnessTurn — happy path", () => {
  it("projects only the current turn authorized skill ids as an advisory index", async () => {
    const deps = makeDeps([
      stream(textEvents("I used the current instructions.")),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        skills: [
          {
            skillId: "document-composer",
            s3Key:
              "tenants/tei/agents/thinkwork-agent/skills/document-composer",
            secretRef: "must-not-project",
          },
          {
            skillId: "customer-qbr",
            s3Key: "tenants/tei/spaces/default/skills/customer-qbr",
          },
          { skillId: "../invalid", s3Key: "tenants/tei/private" },
        ],
        pinned_skills: [
          {
            skillId: "sales-rep-review",
            s3Key: "tenants/tei/skill-catalog/sales-rep-review",
            secretRef: "must-not-project-pinned",
          },
        ],
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.invocations[0]?.modelId).toBe("moonshotai.kimi-k2.5");
    expect(deps.finalizePayloads[0].agent_model).toBe("moonshotai.kimi-k2.5");
    expect(deps.finalizePayloads[0].usage?.model).toBe("moonshotai.kimi-k2.5");
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      model_id: "moonshotai.kimi-k2.5",
      configured_model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      requested_model: "moonshotai.kimi-k2.5",
      model_source: "requested",
    });
    const messages = JSON.stringify(deps.invocations[0]?.messages);
    expect(messages).toContain(
      "authorized_workspace_skills=customer-qbr,document-composer",
    );
    expect(messages).toContain("message_pinned_skills=sales-rep-review");
    expect(messages).not.toContain("must-not-project");
    expect(messages).not.toContain("must-not-project-pinned");
    expect(messages).not.toContain("tenants/tei");
    expect(messages).not.toContain("../invalid");
  });

  it("keeps the Harness default model when the payload has no effective model", async () => {
    const deps = makeDeps([stream(textEvents("Default model response"))]);
    const payload = basePayload();
    delete payload.model;
    delete payload.requested_model;

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations[0]?.modelId).toBeUndefined();
    expect(deps.finalizePayloads[0].agent_model).toBe(
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    expect(deps.finalizePayloads[0].usage?.model).toBe(
      "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    );
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      configured_model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      requested_model: null,
      model_source: "harness_default",
    });
  });

  it("uses the ThinkWork configured model without labeling it user-requested", async () => {
    const deps = makeDeps([stream(textEvents("Configured model response"))]);
    const payload = basePayload();
    delete payload.requested_model;

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations[0]?.modelId).toBe("moonshotai.kimi-k2.5");
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      model_id: "moonshotai.kimi-k2.5",
      configured_model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      requested_model: null,
      model_source: "thinkwork_configured",
    });
  });

  it("projects only sanitized attachment metadata and directs governed reads", async () => {
    const deps = makeDeps([stream(textEvents("I read the attached file."))]);
    const attachmentId = "11111111-1111-4111-8111-111111111111";

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message_attachments: [
          {
            attachment_id: attachmentId,
            s3_key: `tenants/tenant-1/attachments/thread-1/${attachmentId}/pipeline.csv`,
            download_url: "https://secret.example/download",
            name: "pipeline.csv",
            mime_type: "text/csv",
            size_bytes: 42,
          },
        ],
      },
      deps,
    );

    expect(result.status).toBe("completed");
    const messages = JSON.stringify(deps.invocations[0]?.messages);
    expect(messages).toContain(attachmentId);
    expect(messages).toContain("pipeline.csv");
    expect(messages).toContain("list_message_attachments");
    expect(messages).toContain("read_message_attachment");
    expect(messages).not.toContain("tenants/tenant-1/attachments");
    expect(messages).not.toContain("secret.example");
  });

  it("recalls exact participant memory into a bounded untrusted context block", async () => {
    const deps = makeDeps([stream(textEvents("UserMarkerd01325ce"))], {
      recalledMemories: [
        {
          scope: "user",
          text: "User orbit checksum ca8bcc90 is UserMarkerd01325ce.",
          score: 0.98,
        },
      ],
    });

    const result = await runHarnessTurn(
      { ...basePayload(), use_memory: true },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.recallMemories).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      participantUserId: "user-1",
      query: "Review 777 Automotive",
    });
    const messages = JSON.stringify(deps.invocations[0]?.messages);
    expect(messages).toContain("thinkwork_recalled_memory");
    expect(messages).toContain("UserMarkerd01325ce");
    expect(messages).toContain("untrusted recalled context");
  });

  it("projects canonical pending-question answers as bounded user input", async () => {
    const deps = makeDeps([stream(textEvents("I continued with Enterprise."))]);
    (deps.prepareFreshTurn as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 2,
      currentMessage:
        "Continue the task using the canonical pending-question answer provided for this turn.",
      history: [],
      canonicalPendingQuestionAnswer: {
        question_id: "question-1",
        questions: [
          {
            header: "Scope",
            question: "Which segment should I analyze?",
            options: [
              { label: "Enterprise", description: "Large accounts" },
              { label: "All", description: "Every account" },
            ],
          },
        ],
        answers: { Scope: "Enterprise" },
        answered_via: "card",
        delegation_context: null,
      },
    });

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        pending_user_questions: {
          question_id: "question-1",
          questions: [
            {
              header: "Scope",
              question: "Which segment should I analyze?",
              options: [
                { label: "Enterprise", description: "Large accounts" },
                { label: "All", description: "Every account" },
              ],
            },
          ],
          answers: { Scope: "FORGED_FROM_INVOKE_PAYLOAD" },
          answered_via: "card",
          answered_by: "must-not-project-user-id",
          reply_message_id: "must-not-project-message-id",
        },
      },
      deps,
    );

    expect(result.status).toBe("completed");
    const messages = JSON.stringify(deps.invocations[0]?.messages);
    expect(messages).toContain("thinkwork_pending_question_answer");
    expect(messages).toContain("Which segment should I analyze?");
    expect(messages).toContain("Enterprise");
    expect(messages).not.toContain("FORGED_FROM_INVOKE_PAYLOAD");
    expect(messages).toContain("user-authored answer data");
    expect(messages).not.toContain("must-not-project-user-id");
    expect(messages).not.toContain("must-not-project-message-id");
    expect(deps.prepareFreshTurn).toHaveBeenCalledWith(
      expect.objectContaining({ questionAnswerResume: true }),
    );
    expect(deps.finalizePayloads[0]?.claim).toMatchObject({
      invocation_source: "question_answer",
      harness_session_id: "session-row-1",
      harness_participant_user_id: "user-1",
    });
  });

  it("fails closed when a card resume lacks a canonical database answer", async () => {
    const deps = makeDeps([]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        pending_user_questions: {
          question_id: "question-1",
          questions: [
            {
              header: "Scope",
              question: "Which segment should I analyze?",
              options: [{ label: "All", description: "Every account" }],
            },
          ],
          answers: { Scope: "All" },
          answered_via: "card",
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.invokeHarness).not.toHaveBeenCalled();
    expect(deps.finalizePayloads[0]?.error_message).toContain(
      "canonical pending-question answer",
    );
  });

  it("fulfills emit_document and finalizes completed with the evidence triple", async () => {
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
      stream(textEvents("Here is the QBR.")),
    ]);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    // Emission received the camelCase raw shape handleDocumentEmission parses.
    expect(deps.emissions).toEqual([
      {
        genre: "qbr",
        title: "QBR: 777 Automotive",
        abstract: "Quarterly business review.",
        digestMarkdown: "# QBR\n\ncontent",
      },
    ]);
    // Tool result went back on the same session as a toolResult block.
    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations.map((invocation) => invocation.modelId)).toEqual([
      "moonshotai.kimi-k2.5",
      "moonshotai.kimi-k2.5",
    ]);
    const followUp = deps.invocations[1].messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    // The continuation resends the stream-ending assistant message (the
    // harness never persists it) followed by the toolResult user message.
    expect(followUp).toHaveLength(2);
    expect(followUp[0].role).toBe("assistant");
    expect(followUp[0].content[0].toolUse).toMatchObject({
      toolUseId: "tool-1",
      name: "emit_document",
    });
    expect(followUp[1].role).toBe("user");
    expect(followUp[1].content[0].toolResult).toMatchObject({
      toolUseId: "tool-1",
      status: "success",
    });

    expect(deps.finalizePayloads).toHaveLength(1);
    const finalize = deps.finalizePayloads[0];
    expect(finalize).toMatchObject({
      thread_turn_id: "turn-1",
      status: "completed",
      runtime_type: "agentcore",
      agent_model: "moonshotai.kimi-k2.5",
      cost_owner_user_id: "user-1",
      changed_files: [],
    });
    expect(finalize.response?.content).toBe("Here is the QBR.");
    expect(finalize.usage).toMatchObject({
      model: "moonshotai.kimi-k2.5",
      input_tokens: 150,
      output_tokens: 30,
    });
    const harness = (finalize.response?.diagnostics as Record<string, unknown>)
      ?.harness as Record<string, unknown>;
    expect(harness).toMatchObject({
      harness_id: "h1",
      harness_version: "3",
      model_id: "moonshotai.kimi-k2.5",
      configured_model_id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      requested_model: "moonshotai.kimi-k2.5",
      model_source: "requested",
      manifest_fingerprint: "manifest-fp",
      config_fingerprint: "config-fp",
      artifact_id: "artifact-1",
      emission_attempts: 1,
      emission_successes: 1,
    });
    expect(harness.projection_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(finalize.response?.tool_invocations).toEqual([
      expect.objectContaining({
        tool_name: "emit_document",
        status: "completed",
      }),
    ]);
  });

  it("corrects an explicit HTML-artifact hallucination and requires a real emission", async () => {
    const deps = makeDeps([
      stream(textEvents("The HTML artifact was created.")),
      stream(
        textEvents(
          JSON.stringify({
            genre: "report",
            title: "Harness report",
            abstract: "Validated artifact envelope.",
            digest_markdown:
              "## Summary\n\nProof.\n\n## Evidence\n\nGreen.\n\n## Verdict\n\nPass.",
            status: "draft",
          }),
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message:
        "Create an HTML artifact using the report plate and call emit_document.",
    };
    (
      deps.prepareFreshTurn as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage:
        "Create an HTML artifact using the report plate and call emit_document.",
      history: [],
    });

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invokeHarness).toHaveBeenCalledTimes(2);
    expect(deps.invocations[0]?.allowedTools).toEqual([
      "@thinkwork_gateway/*",
      "emit_document",
      "goal_complete",
      "submit_skill_draft",
    ]);
    expect(deps.invocations[0]?.maxIterations).toBe(8);
    expect(deps.invocations[1]?.allowedTools).toEqual([
      "__thinkwork_document_envelope__",
    ]);
    expect(deps.invocations[1]?.maxIterations).toBe(2);
    expect(deps.invocations[0]?.tools).toBeUndefined();
    expect(deps.invocations[1]?.tools).toBeUndefined();
    expect(deps.emissions).toHaveLength(1);
    expect(deps.finalizePayloads[0]?.response?.content).toBe(
      "Done — Harness report is ready.",
    );
  });

  it("gathers data before compiling a named business plate with its chart contract", async () => {
    const salesPlate = {
      slug: "sales-rep-review",
      displayName: "Sales Rep Review",
      useFor: "A sales rep performance review.",
      sections: [
        {
          id: "quota-attainment",
          title: "Quota Attainment",
          tier: "required-if-material",
        },
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required-if-material",
        },
        {
          id: "coaching-notes",
          title: "Coaching Notes",
          tier: "required",
        },
      ],
      analyses: [
        {
          key: "pipeline-conversion",
          op: "funnel_conversion",
          inputHint: "ordered stages: [{ label, count }], >=2 stages",
        },
      ],
    };
    const deps = makeDeps([
      stream(textEvents("I gathered four live CRM opportunities.")),
      stream(
        textEvents(
          JSON.stringify({
            genre: "sales-rep-review",
            title: "Eric Odom — Sales Rep Review",
            abstract: "Live CRM pipeline review.",
            digest_markdown: [
              "## Pipeline Health",
              "",
              "```tw:analysis",
              "analysis: pipeline-conversion",
              "stages:",
              "  - { label: Identified, count: 4 }",
              "  - { label: Active, count: 2 }",
              "```",
              "",
              "```tw:waiver",
              "section: quota-attainment",
              "reason: No quota target was returned by Twenty CRM.",
              "```",
              "",
              "## Coaching Notes",
              "",
              "Prioritize the two active opportunities.",
            ].join("\n"),
            status: "draft",
          }),
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message: "Run a sales rep review report for Eric Odom",
      document_plates: [salesPlate],
    };
    (
      deps.prepareFreshTurn as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: "Run a sales rep review report for Eric Odom",
      history: [],
    });

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations[0]?.allowedTools).toEqual([
      "@thinkwork_gateway/*",
      "emit_document",
      "goal_complete",
      "submit_skill_draft",
    ]);
    expect(deps.invocations[0]?.maxIterations).toBe(8);
    expect(deps.invocations[1]?.allowedTools).toEqual([
      "__thinkwork_document_envelope__",
    ]);
    expect(deps.invocations[1]?.systemPrompt?.[0]?.text).toContain(
      'genre MUST be "sales-rep-review"',
    );
    expect(deps.invocations[1]?.systemPrompt?.[0]?.text).toContain(
      "pipeline-conversion",
    );
    expect(deps.emissions[0]).toMatchObject({
      genre: "sales-rep-review",
    });
    expect(String(deps.emissions[0]?.digestMarkdown)).toContain(
      "analysis: pipeline-conversion",
    );
    expect(deps.finalizePayloads[0]?.response?.content).toBe(
      "Done — Eric Odom — Sales Rep Review is ready.",
    );
  });

  it("refuses a connector-backed plate when no governed connector call exists", async () => {
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "premature-emit", EMIT_INPUT)),
      stream(textEvents("I can write a generic report without CRM data.")),
      stream(textEvents("I still did not call the connector.")),
    ]);
    (deps.loadToolExecutions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const payload = {
      ...basePayload(),
      message: "Create a live Twenty CRM Sales Rep Review for Eric Odom",
      mcp_configs: [
        {
          name: "twenty--crm",
          url: "https://mcp.example.com/twenty",
          transport: "streamable-http",
          tools: ["query"],
        },
      ],
      document_plates: [
        {
          slug: "sales-rep-review",
          displayName: "Sales Rep Review",
          useFor: "A sales rep performance review.",
        },
      ],
    };
    (
      deps.prepareFreshTurn as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: payload.message,
      history: [],
    });

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("failed");
    expect(deps.collectConnectorEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        connector: "twenty--crm",
        gatewayTargetName: "ThinkworkDevOwnerProof",
      }),
    );
    expect(deps.invocations).toHaveLength(0);
    expect(deps.emissions).toHaveLength(0);
    expect(deps.finalizePayloads[0]?.error_message).toContain(
      "governed call was not recorded",
    );
  });

  it("collects governed CRM evidence before one generation-only plate composition", async () => {
    const deps = makeDeps([
      stream(
        textEvents(
          JSON.stringify({
            genre: "sales-rep-review",
            title: "Eric Odom — Sales Rep Review",
            abstract: "Review from governed CRM evidence.",
            digest_markdown: [
              "## Pipeline Health",
              "",
              "```tw:analysis",
              "analysis: pipeline-conversion",
              "stages:",
              "  - { label: Active, count: 1 }",
              "  - { label: Won, count: 0 }",
              "```",
              "",
              "```tw:waiver",
              "section: quota-attainment",
              "reason: The CRM evidence contains no quota target.",
              "```",
              "",
              "## Coaching Notes",
              "",
              "Advance the active McPherson opportunity.",
            ].join("\n"),
            status: "draft",
          }),
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message: "Create a live Twenty CRM Sales Rep Review for Eric Odom",
      mcp_configs: [
        {
          name: "twenty--crm",
          url: "https://mcp.example.com/twenty",
          transport: "streamable-http",
          tools: ["query"],
        },
      ],
      document_plates: [
        {
          slug: "sales-rep-review",
          displayName: "Sales Rep Review",
          useFor: "A sales rep performance review.",
          sections: [
            {
              id: "quota-attainment",
              title: "Quota Attainment",
              tier: "required-if-material",
            },
            {
              id: "pipeline-health",
              title: "Pipeline Health",
              tier: "required-if-material",
            },
            {
              id: "coaching-notes",
              title: "Coaching Notes",
              tier: "required",
            },
          ],
          analyses: [
            {
              key: "pipeline-conversion",
              op: "funnel_conversion",
              inputHint: "ordered stages: [{ label, count }], >=2 stages",
            },
          ],
        },
      ],
    };
    (
      deps.prepareFreshTurn as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: payload.message,
      history: [],
    });

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.collectConnectorEvidence).toHaveBeenCalledTimes(1);
    expect(deps.invocations).toHaveLength(1);
    expect(deps.invocations[0]?.allowedTools).toEqual([
      "__thinkwork_document_envelope__",
    ]);
    expect(JSON.stringify(deps.invocations[0]?.messages)).toContain(
      "McPherson POC",
    );
    expect(deps.invocations[0]?.systemPrompt?.[0]?.text).toContain(
      "pipeline-conversion",
    );
    expect(deps.emissions).toHaveLength(1);
  });

  it("lets the document composer repair a compositor rejection once", async () => {
    const envelope = JSON.stringify({
      genre: "qbr",
      title: "Acme QBR",
      abstract: "Quarterly review.",
      digest_markdown:
        "## Business Outcomes\n\nEvidence.\n\n## Account Health\n\nHealthy.\n\n## Next Quarter Plan\n\nExecute.",
      status: "draft",
    });
    const deps = makeDeps(
      [
        stream(textEvents("I gathered the account evidence.")),
        stream(textEvents(envelope)),
        stream(textEvents(envelope)),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: {
              ok: false,
              code: "COMPILE_REJECTED",
              diagnostics: [
                {
                  code: "SECTION_WAIVER_CONFLICT",
                  message: "Remove the waiver because the section is present.",
                  location: "tw:waiver",
                },
              ],
            },
          },
          {
            statusCode: 200,
            body: {
              ok: true,
              artifactId: "artifact-fixed",
              documentId: "doc-fixed",
              status: "draft",
            },
          },
        ],
      },
    );
    const payload = {
      ...basePayload(),
      message: "Generate the QBR for Acme",
    };
    (
      deps.prepareFreshTurn as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: "Generate the QBR for Acme",
      history: [],
    });

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(2);
    expect(deps.invocations).toHaveLength(3);
    expect(deps.finalizePayloads[0]?.response?.content).toBe(
      "Done — Acme QBR is ready.",
    );
  });

  it("refreshes an expiring turn assertion before a tool continuation", async () => {
    let nowMs = 1_000_000;
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
      stream(textEvents("Published with a refreshed assertion.")),
    ]);
    (deps.mintHarnessAssertion as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        token: "assertion-1",
        expiresAt: 1_060,
        jti: "jti-1",
      })
      .mockResolvedValueOnce({
        token: "assertion-2",
        expiresAt: 1_360,
        jti: "jti-2",
      });
    (deps.invokeHarness as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => {
        nowMs = 1_040_000;
        return stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT));
      })
      .mockImplementationOnce(async () =>
        stream(textEvents("Published with a refreshed assertion.")),
      );
    deps.now = () => nowMs;

    await runHarnessTurn(basePayload(), deps);

    expect(deps.mintHarnessAssertion).toHaveBeenCalledTimes(2);
    expect(deps.invokeHarness).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bearerToken: "assertion-2" }),
    );
  });

  it("relays toolResults ONLY for the final assistant message's toolUses (internal builtin rounds excluded)", async () => {
    // One stream, three messages: the harness fulfilled a builtin tool
    // internally (assistant toolUse + user toolResult), then ended the
    // stream on an assistant emit_document toolUse. Relaying a result for
    // the builtin too corrupts the Bedrock conversation ("toolResult
    // blocks exceed toolUse blocks" — observed live, THINK-311 turn #12).
    const multiMessage: HarnessStreamEvent[] = [
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: "builtin-1", name: "memory_search" },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "{}" } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_use" } },
      { messageStart: { role: "user" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolResult: { toolUseId: "builtin-1", status: "success" },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolResult: [{ text: "Memory search completed." }] },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_result" } },
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "tool-9", name: "emit_document" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: JSON.stringify(EMIT_INPUT) } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_use" } },
      { metadata: { usage: { inputTokens: 80, outputTokens: 15 } } },
    ];
    const deps = makeDeps([
      stream(multiMessage),
      stream(textEvents("Published.")),
    ]);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(1);
    const followUp = deps.invocations[1].messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    // Assistant resend carries ONLY the final assistant message's toolUse,
    // and exactly ONE toolResult follows — never the builtin's.
    expect(followUp[0].role).toBe("assistant");
    expect(followUp[0].content).toHaveLength(1);
    expect(followUp[0].content[0].toolUse).toMatchObject({
      toolUseId: "tool-9",
      name: "emit_document",
    });
    expect(followUp[1].role).toBe("user");
    expect(followUp[1].content).toHaveLength(1);
    expect(followUp[1].content[0].toolResult).toMatchObject({
      toolUseId: "tool-9",
      status: "success",
    });
    expect(deps.finalizePayloads[0].response?.tool_invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: "memory_search",
          tool_use_id: "builtin-1",
          status: "completed",
          protocol: "agentcore_harness_internal_v1",
        }),
      ]),
    );
  });

  it("uses the attested control-plane tools when native Browser is enabled", async () => {
    const deps = makeDeps([stream(textEvents("Browsed successfully."))]);
    const payload = {
      ...basePayload(),
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations).toHaveLength(1);
    expect(deps.invocations[0].tools).toBeUndefined();
    expect(deps.invocations[0].allowedTools).toBeUndefined();
    expect(JSON.stringify(deps.invocations[0].messages)).toContain(
      "browser_automation=enabled",
    );
  });

  it("narrows an explicit Browser request to the configured managed Browser", async () => {
    const deps = makeDeps([
      stream(managedBrowserEvents("TITLE=Example Domain")),
    ]);
    const payload = {
      ...basePayload(),
      message:
        "Use the native managed Browser to open https://example.com and click More information.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations).toHaveLength(1);
    expect(deps.invocations[0].tools).toBeUndefined();
    expect(deps.invocations[0].allowedTools).toEqual(["browser"]);
  });

  it("fails closed when an explicit Browser request ends without managed execution evidence", async () => {
    const deps = makeDeps([
      stream(textEvents("TITLE=Example Domain\nHEADING=Example Domain")),
    ]);
    const payload = {
      ...basePayload(),
      message:
        "Use Browser Automation to open https://example.com and report the title.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("failed");
    expect(deps.invocations[0].allowedTools).toEqual(["browser"]);
    expect(deps.finalizePayloads[0].error_message).toContain(
      "no successful managed Browser invocation",
    );
  });

  it("rejects raw function-call markup instead of publishing a fabricated Browser success", async () => {
    const deps = makeDeps([
      stream(
        textEvents(
          '<function_calls>[{"type":"get_page_content"}]</function_calls>\nTITLE=Example Domain',
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message: "Use Browser Automation to inspect https://example.com.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "raw tool-call markup",
    );
  });

  it("accepts an explicit Browser request only with managed internal evidence", async () => {
    const deps = makeDeps([
      stream(
        managedBrowserEvents("TITLE=Example Domain\nHEADING=Example Domain"),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message:
        "Use Browser Automation to open https://example.com and report the title.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("completed");
    expect(deps.finalizePayloads[0].response?.tool_invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: "browser",
          protocol: "agentcore_harness_internal_v1",
          status: "completed",
        }),
      ]),
    );
    expect(deps.internalToolExecutions).toEqual([
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        turnId: "turn-1",
        principalUserId: "user-1",
        toolUseId: "browser-1",
        toolName: "browser",
        status: "completed",
        policyRevision: "manifest-fp",
      }),
    ]);
  });

  it("fails closed when the managed Browser streams an error tool result", async () => {
    const deps = makeDeps([
      stream(
        managedBrowserEvents(
          "I could not access the page.",
          "error",
          "Unknown tool: browser",
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message:
        "Use Browser Automation to open https://example.com and report the title.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "no successful managed Browser invocation",
    );
    expect(deps.finalizePayloads[0].response?.tool_invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: "browser",
          protocol: "agentcore_harness_internal_v1",
          status: "failed",
          result_summary: "Unknown tool: browser",
        }),
      ]),
    );
    expect(deps.internalToolExecutions).toEqual([
      expect.objectContaining({
        toolName: "browser",
        status: "failed",
        policyRevision: "manifest-fp",
      }),
    ]);
  });

  it("does not certify an internal Browser tool use without a terminal tool result", async () => {
    const events = managedBrowserEvents("TITLE=Example Domain").filter(
      (event) =>
        !event.contentBlockStart?.start?.toolResult &&
        !event.contentBlockDelta?.delta?.toolResult,
    );
    const deps = makeDeps([stream(events)]);
    const payload = {
      ...basePayload(),
      message:
        "Use Browser Automation to open https://example.com and report the title.",
      browser_automation_enabled: true,
    };

    const result = await runHarnessTurn(payload, deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].response?.tool_invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: "browser",
          status: "failed",
          result_summary:
            "AgentCore Harness did not stream a terminal tool result.",
        }),
      ]),
    );
  });

  it("redacts credential shapes and secret canaries from internal tool-result evidence", async () => {
    const deps = makeDeps([
      stream(
        managedBrowserEvents(
          "Browser failed.",
          "error",
          "Unknown tool; authorization=Bearer live-token-value SECRET_SENTINEL_BROWSER_RESULT",
        ),
      ),
    ]);
    const payload = {
      ...basePayload(),
      message: "Use Browser Automation to inspect https://example.com.",
      browser_automation_enabled: true,
    };

    await runHarnessTurn(payload, deps);

    const durable = JSON.stringify(deps.finalizePayloads[0]);
    expect(durable).not.toContain("live-token-value");
    expect(durable).not.toContain("SECRET_SENTINEL_BROWSER_RESULT");
    expect(durable).toContain("<redacted>");
  });

  it("removes only native Browser when the effective capability is disabled", async () => {
    const deps = makeDeps([stream(textEvents("No browser needed."))]);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations[0].tools).toBeUndefined();
    expect(deps.invocations[0].allowedTools).toEqual([
      "@thinkwork_gateway/*",
      "emit_document",
      "goal_complete",
      "submit_skill_draft",
    ]);
    expect(JSON.stringify(deps.invocations[0].messages)).toContain(
      "browser_automation=disabled",
    );
  });

  it("keeps turns available while the legacy profile is being upgraded", async () => {
    const deps = makeDeps([stream(textEvents("Migration-safe response."))]);
    const resolved = await deps.resolveHarness({
      tenantId: "tenant-1",
      tenantSlug: "sleek-squirrel-230",
    });
    const legacyHarness = { ...resolved };
    delete legacyHarness.invocationTools;
    (
      deps.resolveHarness as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(legacyHarness);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.invocations[0].tools).toBeUndefined();
    expect(deps.invocations[0].allowedTools).toEqual([
      "@thinkwork_gateway/*",
      "emit_document",
      "goal_complete",
      "submit_skill_draft",
    ]);
  });

  it("relays emission rejections as error tool results and lets the model retry", async () => {
    const deps = makeDeps(
      [
        stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
        stream(toolUseEvents("emit_document", "tool-2", EMIT_INPUT)),
        stream(textEvents("Fixed and emitted.")),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: {
              ok: false,
              code: "COMPILE_REJECTED",
              diagnostics: [
                {
                  code: "ANALYSIS_INVALID",
                  message: "trend needs 3-24 points",
                  location: "tw:analysis",
                },
              ],
            },
          },
          {
            statusCode: 200,
            body: {
              ok: true,
              artifactId: "artifact-2",
              documentId: "doc-2",
              status: "draft",
              headVersion: 0,
            },
          },
        ],
      },
    );

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(2);
    const firstResult = (
      deps.invocations[1].messages as Array<{
        content: Array<Record<string, unknown>>;
      }>
    )[1].content[0].toolResult as Record<string, unknown>;
    expect(firstResult.status).toBe("error");
    expect(JSON.stringify(firstResult.content)).toContain("ANALYSIS_INVALID");
    const harness = (
      deps.finalizePayloads[0].response?.diagnostics as Record<string, unknown>
    )?.harness as Record<string, unknown>;
    expect(harness).toMatchObject({
      emission_attempts: 2,
      emission_successes: 1,
      artifact_id: "artifact-2",
    });
  });
});

describe("runHarnessTurn — governed AgentCore Skill Creator", () => {
  const command = {
    type: "skill_creator",
    source: "slash_command",
    command: "/skill-creator",
  };
  const skillMarkdown = [
    "---",
    "name: account-brief",
    "description: Creates a governed account brief.",
    "---",
    "",
    "# Account Brief",
  ].join("\n");

  it("submits through the exact participant and carries canonical registration into finalize", async () => {
    const deps = makeDeps([
      stream(
        toolUseEvents("submit_skill_draft", "skill-tool-1", {
          skill_markdown: skillMarkdown,
        }),
      ),
      stream(textEvents("The account-brief draft is ready for review.")),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create this account brief skill and submit it for review",
        skill_creator_command: command,
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.skillDraftSubmissions).toEqual([
      expect.objectContaining({
        tenantId: "tenant-1",
        requesterUserId: "user-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
      }),
    ]);
    expect(deps.finalizePayloads[0]).toMatchObject({
      runtime_type: "agentcore",
      skill_creator_command: command,
      skill_draft_registration: {
        status: "submitted",
        draftId: "draft-1",
        slug: "account-brief",
      },
    });
    expect(JSON.stringify(deps.invocations[0].messages)).toContain(
      "skill_creator_mode=enabled",
    );
  });

  it("keeps interview-only turns conversational without creating a draft", async () => {
    const deps = makeDeps([
      stream(textEvents("What should trigger this skill?")),
    ]);
    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Help me design a new skill",
        skill_creator_command: command,
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.skillDraftSubmissions).toHaveLength(0);
    expect(deps.finalizePayloads[0].skill_draft_registration).toBeUndefined();
  });

  it("never false-passes an explicit submission request without a draft", async () => {
    const deps = makeDeps([
      stream(textEvents("I drafted the skill.")),
      stream(textEvents("It is all done.")),
    ]);
    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Submit the new skill for review",
        skill_creator_command: command,
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "without a validated draft submission",
    );
    expect(JSON.stringify(deps.invocations[1].messages)).toContain(
      "submit_skill_draft exactly once",
    );
  });
});

describe("runHarnessTurn — ThinkWork-managed Goal mode", () => {
  it("bounds document discovery and composes from retained evidence at the cutoff", async () => {
    const deps = makeDeps([
      stream(
        textEvents(
          "Gathered the evidence required for the QBR.",
          "max_iterations_exceeded",
        ),
      ),
      stream(
        textEvents(
          JSON.stringify({
            genre: "qbr",
            title: "Bounded QBR",
            abstract: "A bounded Goal-mode report.",
            digest_markdown:
              "## Summary\n\nEvidence retained.\n\n## Verdict\n\nReady.",
            status: "draft",
          }),
        ),
      ),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create an HTML artifact using the QBR plate.",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Create the QBR",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations[0]?.maxIterations).toBe(3);
    expect(deps.invocations[1]?.maxIterations).toBe(1);
    expect(
      deps.invocations.map((invocation) => invocation.runtimeSessionId),
    ).toEqual(["tw-harness-turn-turn-1", "tw-harness-turn-turn-1"]);
    expect(deps.invocations[1]?.allowedTools).toEqual([
      "__thinkwork_document_envelope__",
    ]);
    expect(JSON.stringify(deps.invocations[1]?.messages)).toContain(
      "evidence you gathered in this turn",
    );
    expect(deps.emissions).toHaveLength(1);
    expect(deps.finalizePayloads[0].response?.content).toBe(
      "Done — Bounded QBR is ready.",
    );
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      document_composition_transition: "max_iterations_exceeded",
      goal_document_phase_limits: {
        discovery_max_iterations: 3,
        composition_max_iterations: 1,
        discovery_invocations: 1,
        composition_invocations: 1,
      },
    });
  });

  it("moves a premature caller tool directly into the bounded composition phase", async () => {
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "premature-doc", EMIT_INPUT)),
      stream(
        textEvents(
          JSON.stringify({
            genre: "qbr",
            title: "Corrected bounded QBR",
            abstract: "Composed after bounded discovery.",
            digest_markdown:
              "## Summary\n\nEvidence retained.\n\n## Verdict\n\nReady.",
            status: "draft",
          }),
        ),
      ),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create an HTML artifact using the QBR plate.",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Create the QBR",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations[0]?.maxIterations).toBe(3);
    expect(deps.invocations[1]?.maxIterations).toBe(1);
    expect(JSON.stringify(deps.invocations[1]?.messages)).toContain(
      "Discovery is now closed",
    );
    expect(JSON.stringify(deps.invocations[1]?.messages)).toContain(
      "exactly one JSON document envelope",
    );
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      document_composition_transition: "caller_tool_continuation",
      goal_document_phase_limits: {
        discovery_invocations: 1,
        composition_invocations: 1,
      },
    });
  });

  it("does not grant a corrective second Goal composition invocation", async () => {
    const deps = makeDeps([
      stream(textEvents("Evidence gathered.", "max_iterations_exceeded")),
      stream(textEvents("not a valid document envelope")),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create an HTML artifact using the QBR plate.",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Create the QBR",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.finalizePayloads[0].error_message).toContain(
      "one-invocation phase budget",
    );
  });

  it("does not retry a Goal composition after document validation rejects it", async () => {
    const deps = makeDeps(
      [
        stream(textEvents("Evidence gathered.", "max_iterations_exceeded")),
        stream(
          textEvents(
            JSON.stringify({
              genre: "qbr",
              title: "Rejected bounded QBR",
              abstract: "Rejected by the document compiler.",
              digest_markdown:
                "## Summary\n\nEvidence retained.\n\n## Verdict\n\nReady.",
              status: "draft",
            }),
          ),
        ),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: { ok: false, code: "COMPILE_REJECTED", diagnostics: [] },
          },
        ],
      },
    );

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create an HTML artifact using the QBR plate.",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Create the QBR",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.finalizePayloads[0].error_message).toContain(
      "one-invocation phase budget",
    );
  });

  it("keeps a composition max-iteration stop as an explicit failure", async () => {
    const deps = makeDeps([
      stream(textEvents("Evidence gathered.", "max_iterations_exceeded")),
      stream(textEvents("partial envelope", "max_iterations_exceeded")),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        message: "Create an HTML artifact using the QBR plate.",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Create the QBR",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.invocations).toHaveLength(2);
    expect(deps.finalizePayloads[0].error_message).toContain(
      'stopReason "max_iterations_exceeded"',
    );
  });

  it("completes through the explicit goal_complete contract", async () => {
    const deps = makeDeps([
      stream(
        toolUseEvents("goal_complete", "goal-tool-1", {
          summary: "AgentCore parity is complete.",
          completion_notes: "All requested work shipped.",
          verification_notes: ["Focused tests passed", "E2E passed"],
        }),
      ),
    ]);
    const result = await runHarnessTurn(
      {
        ...basePayload(),
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Ship AgentCore parity",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.finalizePayloads[0].response?.goal_run).toMatchObject({
      status: "complete",
      goal_id: "agentcore:turn-1",
      objective: "Ship AgentCore parity",
      completion_summary: "AgentCore parity is complete.",
      verification_notes: ["Focused tests passed", "E2E passed"],
      tokens_used: 60,
      resume_eligible: false,
    });
    expect(deps.finalizePayloads[0].usage?.goal_run).toEqual(
      deps.finalizePayloads[0].response?.goal_run,
    );
    expect(deps.finalizePayloads[0].response?.tool_invocations).toEqual([
      expect.objectContaining({
        tool_name: "goal_complete",
        status: "completed",
      }),
    ]);
  });

  it("fails closed when goal completion evidence contains forbidden publication content", async () => {
    const deps = makeDeps([
      stream(
        toolUseEvents("goal_complete", "goal-tool-secret", {
          summary: "Completed with SECRET_SENTINEL_GOAL_EVIDENCE",
          verification_notes: ["Focused tests passed"],
        }),
      ),
    ]);

    const result = await runHarnessTurn(
      {
        ...basePayload(),
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Ship AgentCore parity",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "synthetic_secret_sentinel",
    );
    expect(deps.finalizePayloads[0].response?.goal_run).toBeUndefined();
  });

  it("persists an incomplete bounded step as resumable progress", async () => {
    const deps = makeDeps([stream(textEvents("Implemented the first slice."))]);
    await runHarnessTurn(
      {
        ...basePayload(),
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Ship all slices",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(deps.invocations).toHaveLength(1);
    expect(deps.finalizePayloads[0].response?.goal_run).toMatchObject({
      status: "paused",
      summary: "Implemented the first slice.",
      tokens_used: 120,
      iteration: 1,
      resume_eligible: true,
    });
    expect(JSON.stringify(deps.invocations[0].messages)).toContain(
      "agentcore:turn-1",
    );
    expect(
      deps.finalizePayloads[0].response?.diagnostics?.harness,
    ).toMatchObject({
      goal_document_phase_limits: null,
    });
  });

  it("gives an AgentLoop one corrective chance to return governed completion evidence", async () => {
    const deps = makeDeps([
      stream(textEvents("AGENTCORE_SCHEDULE_PROOF")),
      stream(
        toolUseEvents("goal_complete", "goal-tool-correction", {
          summary: "AGENTCORE_SCHEDULE_PROOF",
          verification_notes: ["Returned the exact requested response"],
        }),
      ),
    ]);

    await runHarnessTurn(
      {
        ...basePayload(),
        invocation_source: "agent_loop",
        browser_automation_enabled: true,
        message: "Reply with exactly AGENTCORE_SCHEDULE_PROOF",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Reply with exactly AGENTCORE_SCHEDULE_PROOF",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations[0]?.tools).toBeUndefined();
    expect(deps.invocations[0]?.allowedTools).toBeUndefined();
    expect(deps.invocations[1]?.tools).toEqual([
      expect.objectContaining({
        type: "inline_function",
        name: "goal_complete",
      }),
    ]);
    expect(deps.invocations[1]?.allowedTools).toBeUndefined();
    expect(JSON.stringify(deps.invocations[1].messages)).toContain(
      "without governed completion evidence",
    );
    expect(deps.finalizePayloads[0].response?.goal_run).toMatchObject({
      status: "complete",
      completion_summary: "AGENTCORE_SCHEDULE_PROOF",
      verification_notes: ["Returned the exact requested response"],
      resume_eligible: false,
    });
  });

  it("keeps an AgentLoop resumable when the completion correction still reports progress", async () => {
    const deps = makeDeps([
      stream(textEvents("Implemented the first slice.")),
      stream(textEvents("More work remains after verification.")),
    ]);

    await runHarnessTurn(
      {
        ...basePayload(),
        invocation_source: "agent_loop",
        goal_mode: {
          enabled: true,
          action: "start",
          objective: "Ship all slices",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(deps.invocations).toHaveLength(2);
    expect(deps.invocations[1]?.tools).toEqual([
      expect.objectContaining({
        type: "inline_function",
        name: "goal_complete",
      }),
    ]);
    expect(deps.invocations[1]?.allowedTools).toBeUndefined();
    expect(deps.finalizePayloads[0].response?.goal_run).toMatchObject({
      status: "paused",
      summary: "More work remains after verification.",
      resume_eligible: true,
    });
  });

  it("resumes from canonical persisted progress and accumulates usage", async () => {
    const deps = makeDeps(
      [
        stream(
          toolUseEvents("goal_complete", "goal-tool-2", {
            summary: "Second slice complete.",
          }),
        ),
      ],
      {
        goalRun: {
          goal_id: "agentcore:turn-original",
          objective: "Ship all slices",
          status: "paused",
          token_budget: 100_000,
          tokens_used: 1_200,
          iteration: 1,
          time_used_seconds: 10,
          started_at: "2026-07-18T12:00:00.000Z",
          resume_eligible: true,
        },
      },
    );
    await runHarnessTurn(
      {
        ...basePayload(),
        thread_turn_id: "turn-2",
        goal_mode: {
          enabled: true,
          action: "resume",
          objective: "Ship all slices",
          goal_run_id: "agentcore:turn-original",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(deps.loadGoalRun).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      goalId: "agentcore:turn-original",
    });
    expect(deps.finalizePayloads[0].response?.goal_run).toMatchObject({
      status: "complete",
      tokens_used: 1_260,
      iteration: 2,
    });
  });

  it("fails closed when resume state is missing instead of trusting composer metadata", async () => {
    const deps = makeDeps([]);
    const result = await runHarnessTurn(
      {
        ...basePayload(),
        goal_mode: {
          enabled: true,
          action: "resume",
          objective: "Forged objective",
          goal_run_id: "missing-goal",
          resolved_budget: { token_budget: 100_000 },
        },
      },
      deps,
    );

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "canonical prior goal state",
    );
    expect(deps.invocations).toHaveLength(0);
  });
});

describe("runHarnessTurn — explicit failures (AE2/KTD-4)", () => {
  it("fails on a non-end_turn terminal stopReason naming the reason", async () => {
    const deps = makeDeps([
      stream(textEvents("partial...", "max_iterations_exceeded")),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "max_iterations_exceeded",
    );
    expect(deps.invocations).toHaveLength(1);
  });

  it("fails on runtimeClientError", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        { runtimeClientError: { message: "MCP endpoint unreachable" } },
      ]),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "runtime_client_error",
    );
  });

  it("fails when the run ends without a successful emission after rejections (never a false pass)", async () => {
    const deps = makeDeps(
      [
        stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
        stream(textEvents("Sorry, giving up.")),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: { ok: false, code: "COMPILE_REJECTED", diagnostics: [] },
          },
        ],
      },
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "without a successful document emission",
    );
  });

  it("fails fatally on COMPILER_DEFECT instead of looping", async () => {
    const deps = makeDeps(
      [stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT))],
      {
        emitResults: [
          {
            statusCode: 500,
            body: { ok: false, code: "COMPILER_DEFECT", error: "boom" },
          },
        ],
      },
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain("COMPILER_DEFECT");
  });

  it("fails a projection rejection before any Harness call, naming the capability", async () => {
    const deps = makeDeps([]);
    const payload = {
      ...basePayload(),
      guardrail_config: { guardrailIdentifier: "g" },
    };
    const result = await runHarnessTurn(payload, deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "bedrock_guardrail",
    );
    expect(deps.resolveHarness).not.toHaveBeenCalled();
    expect(deps.invocations).toHaveLength(0);
  });

  it("fails the pi-ai analog: empty content + zero output tokens on end_turn", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        { messageStop: { stopReason: "end_turn" } },
        { metadata: { usage: { inputTokens: 10, outputTokens: 0 } } },
      ]),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "empty content and zero output tokens",
    );
  });

  it("returns malformed tool input as an error tool result and continues", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "tool-1", name: "emit_document" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: "{not json" } },
          },
        },
        { messageStop: { stopReason: "tool_use" } },
      ]),
      stream(textEvents("Answered without a document.")),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(0);
    const toolResult = (
      deps.invocations[1].messages as Array<{
        content: Array<Record<string, unknown>>;
      }>
    )[1].content[0].toolResult as Record<string, unknown>;
    expect(toolResult.status).toBe("error");
    expect(JSON.stringify(toolResult.content)).toContain(
      "malformed tool input",
    );
  });
});

describe("runHarnessTurn — turn lifecycle (KTD-9)", () => {
  it("acknowledges a duplicate delivery without finalizing the live turn", async () => {
    const deps = makeDeps([]);
    (deps.prepareFreshTurn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new HarnessDuplicateDeliveryError("running"),
    );

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.finalize).not.toHaveBeenCalled();
    expect(deps.invokeHarness).not.toHaveBeenCalled();
  });

  it("bumps last_activity_at while streaming", async () => {
    const deps = makeDeps([stream(textEvents("done"))]);
    await runHarnessTurn(basePayload(), deps);
    expect(deps.bumpTurnActivity).toHaveBeenCalledWith({
      turnId: "turn-1",
      tenantId: "tenant-1",
    });
  });

  it("finalizes-through-failure when the SDK throws mid-run", async () => {
    const deps = makeDeps([]);
    (deps.invokeHarness as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ValidationException: bad session id"),
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads).toHaveLength(1);
    expect(deps.finalizePayloads[0]).toMatchObject({
      status: "failed",
      runtime_type: "agentcore",
    });
    expect(deps.finalizePayloads[0].error_message).toContain(
      "ValidationException",
    );
  });

  it("preserves allowlisted SDK failure diagnostics without object coercion", async () => {
    const deps = makeDeps([]);
    (deps.invokeHarness as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "AccessDeniedException",
      message: "model access is not enabled",
    });

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "AccessDeniedException",
    );
    expect(deps.finalizePayloads[0].error_message).not.toContain(
      "[object Object]",
    );
  });

  it("redacts secrets and arbitrary provider metadata from durable SDK failures", async () => {
    const deps = makeDeps([]);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    (deps.invokeHarness as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      code: "AccessDeniedException",
      message:
        "authorization=Bearer secret-auth token=secret-token " +
        'token: "secret-quoted-token" {"token":"secret-json-token"} ' +
        'password="secret quoted pass" authorization: "Basic secret-basic" ' +
        '{"access_token":"oauth-secret"} refresh_token="refresh-secret" ' +
        'client_secret: "client-secret" sessionToken=aws-session-secret ' +
        "SecretAccessKey=aws-secret-key " +
        "https://example.test/object?X-Amz-Signature=secret-signature",
      cookie: "secret-cookie",
      secret: "secret-value",
      response: {
        body: "secret-response-body",
        headers: { authorization: "secret-nested-auth" },
      },
    });

    const result = await runHarnessTurn(basePayload(), deps);
    const durableFailure = JSON.stringify(deps.finalizePayloads[0]);
    const loggedFailure = JSON.stringify(errorLog.mock.calls);

    expect(result.status).toBe("failed");
    expect(durableFailure).toContain("AccessDeniedException");
    expect(durableFailure).toContain("<redacted>");
    for (const secret of [
      "secret-auth",
      "secret-token",
      "secret-quoted-token",
      "secret-json-token",
      "secret quoted pass",
      "secret-basic",
      "oauth-secret",
      "refresh-secret",
      "client-secret",
      "aws-session-secret",
      "aws-secret-key",
      "secret-signature",
      "secret-cookie",
      "secret-value",
      "secret-response-body",
      "secret-nested-auth",
    ]) {
      expect(durableFailure).not.toContain(secret);
      expect(loggedFailure).not.toContain(secret);
    }
    expect(durableFailure).not.toContain("X-Amz-Signature");
    expect(deps.finalizePayloads[0].error_message?.length).toBeLessThanOrEqual(
      512,
    );

    errorLog.mockRestore();
  });

  it("publishes only through the Harness authorization fence", async () => {
    const deps = makeDeps([stream(textEvents("authorized answer"))]);
    (deps.finalize as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async (payload: FinalizePayload) => {
        deps.finalizePayloads.push(payload);
        return { finalized: false, messageId: null };
      })
      .mockImplementationOnce(async (payload: FinalizePayload) => {
        deps.finalizePayloads.push(payload);
        return { finalized: true, messageId: "failure-message" };
      });

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0]).toMatchObject({
      status: "completed",
      claim: {
        status: "running",
        harness_session_id: "session-row-1",
        harness_participant_user_id: "user-1",
      },
    });
    expect(deps.finalizePayloads[1]).toMatchObject({ status: "failed" });
    expect(deps.abandonFreshTurn).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "turn_failed" }),
    );
    expect(deps.transitionFreshTurn).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "completed" }),
    );
  });
});
