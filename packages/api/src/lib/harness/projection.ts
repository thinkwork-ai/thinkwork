/**
 * Manifest→Harness projection (THINK-311 U3).
 *
 * Pure module: compiles the RESOLVED runtime shapes of a chat dispatch —
 * the same post-policy inputs the Pi invoke payload is built from — into
 * the field sets AWS AgentCore Harness `CreateHarness` / `InvokeHarness`
 * accept, or rejects with the precise unsupported capability (AE2).
 *
 * Contract notes:
 * - Inputs are the POST-policy, post-render resolved shapes (`McpConfig[]`,
 *   `SkillConfig[]`, fingerprints). The projection never re-reads folders,
 *   manifests, or the DB (KTD-2), and it treats the manifest fingerprint as
 *   an opaque evidence string — deliberately insulated from the THINK-302
 *   manifest rewrite landing in parallel.
 * - Rejection taxonomy: `harness_unsupported` names a genuine Harness gap
 *   (a legitimate AE2 trial outcome); `adapter_unimplemented` names
 *   something Harness could express but this trial's adapter deliberately
 *   does not build. The distinction feeds the U6 go/no-go verdict.
 * - Project-or-record, never silently drop: capabilities outside the trial
 *   scope that do not block the reference run (dossier: think311-u1) are
 *   recorded as `exclusions` in the evidence block; capabilities the run
 *   cannot safely proceed without are fatal rejections.
 * - SDK shapes verified against @aws-sdk/client-bedrock-agentcore(-control)
 *   3.1088.0. This module emits plain data (no SDK imports); the U5 runner
 *   maps it onto SDK commands.
 */

import { createHash } from "node:crypto";
import type {
  McpConfig,
  SkillConfig,
} from "../resolve-agent-runtime-config.js";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The agent capability surface the dispatch resolved beyond skills/MCP.
 * Each field either projects, records an exclusion, or rejects — see
 * `projectHarnessConfig` for the disposition of every field.
 */
export interface HarnessCapabilitySurface {
  piExtensionCount: number;
  /** Sub-agent delegation profiles active for the turn (slugs). */
  agentProfileSlugs: string[];
  browserAutomationEnabled: boolean;
  /** Agent has a sandbox template configured (execute_code surface). */
  sandboxConfigured: boolean;
  /** Agent or tenant-default Bedrock guardrail resolved for the turn. */
  guardrailConfigured: boolean;
  sendEmailEnabled: boolean;
  webSearchEnabled: boolean;
  webExtractEnabled: boolean;
  contextEngineEnabled: boolean;
  jsonRenderUiEnabled: boolean;
  knowledgeGraphEnabled: boolean;
  /** Message attachments on the triggering message. */
  attachmentCount: number;
}

export interface HarnessProjectionInput {
  tenantId: string;
  agentId: string;
  agentSlug: string;
  /** Composed system prompt — what the Pi dispatch would send. */
  systemPrompt: string;
  /** Agent's resolved model id. Absent → rejection, never a default. */
  modelId: string | null;
  /**
   * Model catalog provider for `modelId`. Only "bedrock" projects; the
   * trial does not carry ThinkWork's non-Bedrock credentials into Harness.
   */
  modelProvider: string | null;
  /** Post-policy skills (the Pi payload's `skills`/`effectiveSkillsConfig`). */
  skills: SkillConfig[];
  /** Post-policy MCP configs (the Pi payload's `mcp_configs`). */
  mcpConfigs: McpConfig[];
  /** Compiled capabilities manifest fingerprint — opaque evidence (R9). */
  manifestFingerprint: string | null;
  /** Dispatch config fingerprint (capability-fingerprint helper) — evidence. */
  configFingerprint: string | null;
  /** The caller-fulfilled emit_document tool projection (KTD-3). */
  emitDocument: {
    description: string;
    /** JSON Schema for the tool input — must match the document-emission input contract. */
    inputSchema: Record<string, unknown>;
  };
  /** Stage workspace bucket — skill folders resolve to s3:// URIs under it. */
  workspaceBucket: string;
  capabilitySurface: HarnessCapabilitySurface;
  limits?: {
    maxIterations?: number;
    maxTokens?: number;
    timeoutSeconds?: number;
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type HarnessRejectionKind =
  /** A genuine Harness capability gap — a legitimate AE2 trial outcome. */
  | "harness_unsupported"
  /** Harness could express it; this trial's adapter deliberately does not. */
  | "adapter_unimplemented"
  /** The R9 evidence contract cannot be satisfied. */
  | "evidence_missing"
  /** The input itself is malformed or incomplete. */
  | "invalid_input";

export interface HarnessProjectionRejection {
  kind: HarnessRejectionKind;
  /** The precise capability that failed to project (AE2). */
  capability: string;
  detail: string;
}

export class HarnessProjectionError extends Error {
  constructor(public readonly rejection: HarnessProjectionRejection) {
    super(
      `Harness projection rejected [${rejection.kind}] ${rejection.capability}: ${rejection.detail}`,
    );
    this.name = "HarnessProjectionError";
  }
}

export interface HarnessProjectedRemoteMcpTool {
  type: "mcp";
  name: string;
  remoteMcp: {
    url: string;
    headers?: Record<string, string>;
  };
}

export interface HarnessProjectedInlineFunctionTool {
  type: "inline_function";
  name: string;
  inlineFunction: {
    description: string;
    inputSchema: Record<string, unknown>;
  };
}

export type HarnessProjectedTool =
  | HarnessProjectedRemoteMcpTool
  | HarnessProjectedInlineFunctionTool;

/**
 * A skill folder the runner must materialize into an AgentSkills-shaped
 * bundle before CreateHarness. The projection stays pure — it describes
 * the materialization; the U5 runner performs it (S3 copy/synthesis) and
 * substitutes the final bundle URI.
 */
export interface HarnessSkillMaterialization {
  slug: string;
  /** Source folder in the stage workspace bucket. */
  sourceS3Uri: string;
  /**
   * Whether the source folder already carries SKILL.md at its root
   * (installed workspace skills do) — false means the runner must
   * synthesize a bundle manifest around the folder's files.
   */
  hasSkillMd: boolean;
}

export interface HarnessProjectionExclusion {
  capability: string;
  disposition: /** Replaced by the caller-fulfilled inline emit_document tool. */
    | "replaced_by_inline_tool"
    /** Platform-side behavior that never enters the model/tool loop. */
    | "platform_side"
    /** Deliberately outside the trial's scoped parity (dossier-bounded). */
    | "not_projected_trial_scope";
  detail: string;
}

export interface HarnessProjectedConfig {
  /** CreateHarness harnessName (letter start, alnum/underscore only). */
  harnessName: string;
  systemPrompt: string;
  model: { bedrockModelConfig: { modelId: string } };
  tools: HarnessProjectedTool[];
  /** Bundles the runner materializes, then maps to `skills: [{s3:{uri}}]`. */
  skillMaterializations: HarnessSkillMaterialization[];
  allowedTools: string[];
  maxIterations: number;
  timeoutSeconds: number;
  maxTokens?: number;
  evidence: {
    manifestFingerprint: string;
    configFingerprint: string;
    /** sha256 over the canonical projected config — pins what ran (R9). */
    projectionFingerprint: string;
    exclusions: HarnessProjectionExclusion[];
  };
}

export type HarnessProjectionResult =
  | { ok: true; config: HarnessProjectedConfig }
  | { ok: false; rejection: HarnessProjectionRejection };

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Platform default script skills: always present in `skillsConfig`, never
 * content bundles. `artifacts` is superseded by the projected inline
 * emit_document tool; the other two are platform services that ride the
 * Pi Lambda callback seam, which does not exist for a Harness microVM.
 */
const PLATFORM_SKILL_DISPOSITIONS: Record<string, HarnessProjectionExclusion> =
  {
    artifacts: {
      capability: "skill:artifacts",
      disposition: "replaced_by_inline_tool",
      detail:
        "document emission projects as the caller-fulfilled emit_document inline function (KTD-3)",
    },
    "agent-thread-management": {
      capability: "skill:agent-thread-management",
      disposition: "platform_side",
      detail:
        "thread/task status tools are platform callbacks outside the trial's model loop",
    },
    "workspace-memory": {
      capability: "skill:workspace-memory",
      disposition: "platform_side",
      detail:
        "memory retention is a post-turn platform pipeline; the reference run made no recall calls",
    },
  };

/**
 * Built-in credentialed platform tools that can appear in `skillsConfig`
 * (web-search etc.). Their toggle disposition is handled via the
 * capability surface; the skill-config entry itself is recorded once.
 */
const BUILTIN_TOOL_SKILL_SLUGS = new Set([
  "web-search",
  "web-extract",
  "send-email",
  "json-render-ui",
]);

const SECRETY_ENV_KEY = /SECRET|TOKEN|API_KEY|PASSWORD|CREDENTIAL/i;

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_TIMEOUT_SECONDS = 900;

export function projectHarnessConfig(
  input: HarnessProjectionInput,
): HarnessProjectionResult {
  const reject = (
    rejection: HarnessProjectionRejection,
  ): HarnessProjectionResult => ({ ok: false, rejection });

  // --- Evidence contract first (R9): no fingerprints, no projection. ----
  if (!input.manifestFingerprint) {
    return reject({
      kind: "evidence_missing",
      capability: "capabilities_manifest_fingerprint",
      detail:
        "no compiled capabilities manifest fingerprint for this dispatch; the trial cannot prove which folder state ran",
    });
  }
  if (!input.configFingerprint) {
    return reject({
      kind: "evidence_missing",
      capability: "config_fingerprint",
      detail:
        "no dispatch config fingerprint; the R9 evidence triple cannot be recorded",
    });
  }

  // --- Fatal capability gates ------------------------------------------
  const surface = input.capabilitySurface;
  if (surface.guardrailConfigured) {
    return reject({
      kind: "harness_unsupported",
      capability: "bedrock_guardrail",
      detail:
        "CreateHarness/InvokeHarness carry no guardrail configuration (SDK 3.1088.0); a guardrail-required agent must not run ungated",
    });
  }
  if (surface.piExtensionCount > 0) {
    return reject({
      kind: "harness_unsupported",
      capability: "pi_extensions",
      detail: `${surface.piExtensionCount} Pi extension(s) are assigned; extension tools are Pi-runtime code with no Harness analogue`,
    });
  }
  if (surface.browserAutomationEnabled) {
    return reject({
      kind: "adapter_unimplemented",
      capability: "browser_automation",
      detail:
        "agent has browser automation enabled; Harness offers agentCoreBrowser but the trial adapter does not project it",
    });
  }
  if (surface.attachmentCount > 0) {
    return reject({
      kind: "adapter_unimplemented",
      capability: "message_attachments",
      detail: `${surface.attachmentCount} attachment(s) on the triggering message; the trial adapter projects text-only invocations`,
    });
  }

  // --- Model -------------------------------------------------------------
  if (!input.modelId) {
    return reject({
      kind: "invalid_input",
      capability: "model",
      detail:
        "agent has no configured model; the projection never substitutes a default",
    });
  }
  if (input.modelProvider !== "bedrock") {
    return reject({
      kind: "harness_unsupported",
      capability: `model_provider:${input.modelProvider ?? "unknown"}`,
      detail:
        "only Bedrock-provider models project; the trial does not carry ThinkWork's external model credentials into Harness",
    });
  }
  if (!input.systemPrompt.trim()) {
    return reject({
      kind: "invalid_input",
      capability: "system_prompt",
      detail: "composed system prompt is empty",
    });
  }
  if (
    !input.emitDocument.description.trim() ||
    Object.keys(input.emitDocument.inputSchema).length === 0
  ) {
    return reject({
      kind: "invalid_input",
      capability: "emit_document_tool",
      detail:
        "emit_document projection requires a description and a non-empty input schema",
    });
  }

  const exclusions: HarnessProjectionExclusion[] = [];

  // --- Trial-scope toggles: recorded, not fatal (dossier-bounded) --------
  const toggleExclusions: Array<[boolean, string, string]> = [
    // Sandbox is baseline agent config ({environment: default-public} on
    // every agent), so it is trial-scope excluded rather than fatal —
    // Harness offers agentCoreCodeInterpreter but the trial adapter does
    // not project it; an execute_code attempt has no tool to call.
    [surface.sandboxConfigured, "sandbox_execute_code", "sandbox template"],
    [surface.sendEmailEnabled, "send_email", "platform callback tool"],
    [surface.webSearchEnabled, "web_search", "credentialed platform tool"],
    [surface.webExtractEnabled, "web_extract", "credentialed platform tool"],
    [
      surface.contextEngineEnabled,
      "context_engine",
      "Hindsight-backed platform tool",
    ],
    [
      surface.jsonRenderUiEnabled,
      "json_render_ui_canvas",
      "platform canvas tooling",
    ],
    [
      surface.knowledgeGraphEnabled,
      "knowledge_graph",
      "Hindsight-backed platform tool",
    ],
  ];
  for (const [enabled, capability, kindDetail] of toggleExclusions) {
    if (enabled) {
      exclusions.push({
        capability,
        disposition: "not_projected_trial_scope",
        detail: `${kindDetail}; enabled on the agent but outside the trial's scoped parity — its absence fails visibly, never silently`,
      });
    }
  }
  if (surface.agentProfileSlugs.length > 0) {
    exclusions.push({
      capability: `sub_agent_delegation:${surface.agentProfileSlugs.join(",")}`,
      disposition: "not_projected_trial_scope",
      detail:
        "sub-agent delegation profiles are Pi governed-delegation; not projected — a delegation attempt has no tool to call",
    });
  }

  // --- Skills -------------------------------------------------------------
  const skillMaterializations: HarnessSkillMaterialization[] = [];
  for (const skill of input.skills) {
    const platformDisposition = PLATFORM_SKILL_DISPOSITIONS[skill.skillId];
    if (platformDisposition) {
      exclusions.push(platformDisposition);
      continue;
    }
    if (BUILTIN_TOOL_SKILL_SLUGS.has(skill.skillId)) {
      // Covered by the capability-surface toggle exclusions above.
      continue;
    }
    const secretyKeys = Object.keys(skill.envOverrides ?? {}).filter((key) =>
      SECRETY_ENV_KEY.test(key),
    );
    if (secretyKeys.length > 0) {
      return reject({
        kind: "adapter_unimplemented",
        capability: `skill_env:${skill.skillId}`,
        detail: `skill carries credential-bearing env overrides (${secretyKeys.join(", ")}); secrets cannot ride into a Harness skill bundle`,
      });
    }
    if (!skill.s3Key) {
      return reject({
        kind: "invalid_input",
        capability: `skill:${skill.skillId}`,
        detail: "skill config has no S3 source key",
      });
    }
    skillMaterializations.push({
      slug: skill.skillId,
      sourceS3Uri: `s3://${input.workspaceBucket}/${skill.s3Key.replace(/\/+$/, "")}/`,
      hasSkillMd: true,
    });
  }

  // --- Tools: remote MCP + inline emit_document ---------------------------
  const tools: HarnessProjectedTool[] = [];
  const allowedTools: string[] = [];
  for (const mcp of input.mcpConfigs) {
    const name = mcp.name?.trim();
    if (!name) {
      return reject({
        kind: "invalid_input",
        capability: "mcp_server",
        detail: "MCP config with no name cannot project",
      });
    }
    if (!/^https:\/\//.test(mcp.url ?? "")) {
      return reject({
        kind: "harness_unsupported",
        capability: `mcp:${name}`,
        detail: `remote_mcp requires a public https endpoint; got "${mcp.url}"`,
      });
    }
    if ((mcp.transport ?? "streamable-http") !== "streamable-http") {
      return reject({
        kind: "harness_unsupported",
        capability: `mcp:${name}`,
        detail: `transport "${mcp.transport}" is not streamable HTTP`,
      });
    }
    const headers = projectMcpAuthHeaders(mcp);
    if (headers === null) {
      return reject({
        kind: "adapter_unimplemented",
        capability: `mcp_auth:${name}`,
        detail:
          "MCP auth shape is neither bearer nor static headers; the trial adapter cannot project it",
      });
    }
    tools.push({
      type: "mcp",
      name,
      remoteMcp: {
        url: mcp.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    });
    const narrowed =
      mcp.tools && mcp.tools.length > 0
        ? mcp.tools
        : (mcp.availableTools ?? []);
    if (narrowed.length > 0) {
      for (const toolName of narrowed) {
        allowedTools.push(`@${name}/${toolName}`);
      }
    } else {
      allowedTools.push(`@${name}/*`);
    }
  }

  tools.push({
    type: "inline_function",
    name: "emit_document",
    inlineFunction: {
      description: input.emitDocument.description,
      inputSchema: input.emitDocument.inputSchema,
    },
  });
  allowedTools.push("emit_document");

  if (skillMaterializations.length > 0) {
    // Skill loading/reading rides Harness built-in tools; granting
    // @builtin is what makes projected bundles reachable. Verified live
    // in U6 — recorded here so the verdict can cite it.
    allowedTools.push("@builtin");
  }

  // --- Assemble + fingerprint ---------------------------------------------
  const config: Omit<HarnessProjectedConfig, "evidence"> = {
    harnessName: deriveHarnessName(
      input.agentSlug,
      input.tenantId,
      input.agentId,
    ),
    systemPrompt: input.systemPrompt,
    model: { bedrockModelConfig: { modelId: input.modelId } },
    tools,
    skillMaterializations,
    allowedTools,
    maxIterations: input.limits?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    timeoutSeconds: input.limits?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    ...(input.limits?.maxTokens ? { maxTokens: input.limits.maxTokens } : {}),
  };

  return {
    ok: true,
    config: {
      ...config,
      evidence: {
        manifestFingerprint: input.manifestFingerprint,
        configFingerprint: input.configFingerprint,
        projectionFingerprint: sha256(canonicalize(config)),
        exclusions,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a resolved McpConfig auth union onto static request headers.
 * Returns null for shapes the adapter cannot express (→ rejection).
 */
function projectMcpAuthHeaders(mcp: McpConfig): Record<string, string> | null {
  const auth = mcp.auth as
    | { type?: string; token?: string; headers?: Record<string, string> }
    | undefined;
  if (!auth) return {};
  if (auth.type === "bearer" && typeof auth.token === "string") {
    return {
      ...(auth.headers ?? {}),
      Authorization: `Bearer ${auth.token}`,
    };
  }
  if (auth.type === "headers" && auth.headers) {
    return { ...auth.headers };
  }
  return null;
}

/** CreateHarness name rule: starts with a letter, [A-Za-z0-9_] only. */
export function deriveHarnessName(
  agentSlug: string,
  tenantId: string,
  agentId: string,
): string {
  const sanitizedSlug = agentSlug
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 32);
  const idHash = sha256(`${tenantId}:${agentId}`).slice(0, 10);
  return `tw_${sanitizedSlug || "agent"}_${idHash}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable stringify: recursively sorted object keys; arrays keep order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`)
    .join(",")}}`;
}
