import { defaultAgentLoopPolicy } from "../../../lib/agent-profile-loop-policy.js";

export const BUILT_IN_AGENT_PROFILE_KEYS = [
  "research",
  "coding",
  "analyst",
  "reviewer",
] as const;

export const DEFAULT_PROFILE_MODEL_ID =
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

export type BuiltInProfileKey = (typeof BUILT_IN_AGENT_PROFILE_KEYS)[number];

export interface BuiltInProfileSeed {
  built_in_key: BuiltInProfileKey;
  slug: string;
  name: string;
  description: string;
  routing_guidance: string;
  instructions: string;
  tool_policy: Record<string, unknown>;
  skill_policy: Record<string, unknown>;
  execution_controls: Record<string, unknown>;
}

export const BUILT_IN_PROFILE_SEEDS: BuiltInProfileSeed[] = [
  {
    built_in_key: "research",
    slug: "research",
    name: "Research",
    description: "Delegates focused research, source finding, and synthesis.",
    routing_guidance:
      "Use for web, document, and knowledge-gathering subtasks that need citations or source comparison.",
    instructions:
      "Research the assigned question, cite the sources you used, and return a concise answer with relevant evidence.",
    tool_policy: { builtInTools: ["web-search", "web-extract"] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      loopPolicy: defaultAgentLoopPolicy(),
    },
  },
  {
    built_in_key: "coding",
    slug: "coding",
    name: "Coding",
    description: "Delegates code inspection, implementation, and test tasks.",
    routing_guidance:
      "Use for software engineering subtasks in Spaces where coding work is allowed.",
    instructions:
      "Inspect the relevant files, make scoped code recommendations or changes, and report verification clearly.",
    tool_policy: { builtInTools: ["execute_code", "bash"] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      loopPolicy: defaultAgentLoopPolicy(),
    },
  },
  {
    built_in_key: "analyst",
    slug: "analyst",
    name: "Analyst",
    description:
      "Delegates data analysis, metric review, and structured reporting.",
    routing_guidance:
      "Use for data, spreadsheet, CRM, database, SQL, and quantitative analysis subtasks.",
    instructions: [
      "Analyze the assigned data or tool results with code when useful, state assumptions, and return decision-ready findings.",
      "When a registered data source is available (a connections/<slug>/ folder with a query tool): ALWAYS read connections/<slug>/SCHEMA.md before writing SQL — only tables and columns listed there are granted, and it carries join hints and enum legends. Write one read-only statement per query call; a rejected query returns the verbatim database error — fix the SQL and retry. Prefer aggregated queries (GROUP BY) sized for presentation; large results land as a CSV file path in the tool result — analyze it with execute_code (pandas) instead of asking for raw rows.",
      "Present quantitative answers as GenUI live components: emit_json_render_ui with chart/table components bound to your query results (pass sourceToolCallId so widgets stay refreshable). Never paste ASCII/markdown tables of raw rows into your reply. If emission validation fails (for example the 50-row component cap), re-aggregate to a coarser grain and retry.",
    ].join("\n\n"),
    tool_policy: {
      builtInTools: ["execute_code", "file_read"],
      // THINK-228: the dev Postgres connector (slug). Resolution drops it
      // with a diagnostic unless the tenant_mcp_servers row is
      // approved+enabled, so seeding the slug everywhere is fail-closed.
      mcpServers: ["postgres-dev"],
    },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      // THINK-228 R9: hard cap on query calls per delegated run,
      // enforced in-process by the delegation loop (KTD3).
      maxQueriesPerRun: 12,
      // THINK-232: per-run dollar budget, now REAL — enforced in the
      // delegation loop (DB query cost fast-fails; token cost is checked at
      // run end). Provisional default; the signed sidecar budget wins when
      // present (resolve-agent-runtime-config KTD6 override).
      costBudgetUsd: 0.5,
      loopPolicy: defaultAgentLoopPolicy(),
    },
  },
  {
    built_in_key: "reviewer",
    slug: "reviewer",
    name: "Reviewer",
    description:
      "Reviews agent outputs for quality, correctness, and completeness.",
    routing_guidance:
      "Use before final response when an answer, artifact, or delegated result needs a quality gate, or when the parent Agent is uncertain whether the output is good enough.",
    instructions:
      "Review the candidate agent output against the user's request and available evidence. Return a concise verdict with one of: pass, revise, or fail. If the output should not be sent, explain exactly what must change and give actionable feedback for the parent Agent to improve it. Do not rewrite the full answer unless asked; focus on decision-quality review.",
    tool_policy: { builtInTools: [] },
    skill_policy: { skillSlugs: [] },
    execution_controls: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      reviewGate: true,
      maxReviewLoops: 2,
      loopPolicy: defaultAgentLoopPolicy({
        reviewGate: true,
        maxReviewLoops: 2,
        externalReviewerPolicy: "never",
      }),
    },
  },
];
