import type {
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  DynamicPiExtensionLoadEvidence,
  PiExtensionRuntimeDescriptor,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";
import { runDynamicExtension } from "./dynamic-extension-runner.js";

type DynamicExtensionLog = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export interface LoadDynamicPiExtensionsResult {
  extensionFactories: ExtensionFactory[];
  extensionToolNames: string[];
  evidence: DynamicPiExtensionLoadEvidence[];
}

export interface LoadDynamicPiExtensionsOptions {
  value: unknown;
  targetType: "default_agent" | "agent_profile";
  agentProfileId?: string | null;
  reservedToolNames?: Iterable<string>;
  log?: DynamicExtensionLog;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_HEX_RE = /^[a-f0-9]{64}$/i;
const COMMIT_RE = /^[a-f0-9]{40,64}$/i;
const NAME_RE = /^[a-z][a-z0-9_-]{1,62}$/;
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const HOOK_NAME_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
const PERMISSION_CLASS_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

export function loadDynamicPiExtensions(
  options: LoadDynamicPiExtensionsOptions,
): LoadDynamicPiExtensionsResult {
  const extensionFactories: ExtensionFactory[] = [];
  const extensionToolNames: string[] = [];
  const evidence: DynamicPiExtensionLoadEvidence[] = [];
  const reserved = new Set(options.reservedToolNames ?? []);

  for (const raw of Array.isArray(options.value) ? options.value : []) {
    const parsed = parseDynamicPiExtensionDescriptor(raw, {
      targetType: options.targetType,
      agentProfileId: options.agentProfileId ?? null,
      reservedToolNames: reserved,
    });
    if (!parsed.ok) {
      const partial = partialEvidence(raw, options.targetType, parsed.reason);
      evidence.push(partial);
      options.log?.("dynamic_pi_extension_skipped", { ...partial });
      continue;
    }

    const descriptor = parsed.descriptor;
    for (const toolName of descriptor.toolNames) reserved.add(toolName);
    extensionToolNames.push(...descriptor.toolNames);
    extensionFactories.push(createDynamicExtensionFactory(descriptor));
    const loaded = loadEvidence(descriptor, "loaded");
    evidence.push(loaded);
    options.log?.("dynamic_pi_extension_loaded", { ...loaded });
  }

  return {
    extensionFactories,
    extensionToolNames: [...new Set(extensionToolNames)],
    evidence,
  };
}

function createDynamicExtensionFactory(
  descriptor: PiExtensionRuntimeDescriptor,
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const toolName of descriptor.toolNames) {
      pi.registerTool(dynamicToolDefinition(descriptor, toolName));
    }
    for (const hook of descriptor.lifecycleHooks) {
      const registerHook = pi.on as unknown as (
        event: string,
        handler: (event: unknown) => Promise<void>,
      ) => void;
      registerHook(hook, async (event: unknown) => {
        const result = await runDynamicExtension({
          descriptor,
          operation: "hook",
          name: hook,
          input: event,
        });
        if (!result.ok) {
          console.warn("[dynamic-extension] hook failed", {
            extensionId: descriptor.extensionId,
            versionId: descriptor.versionId,
            hook,
            error: result.error ?? "Dynamic extension hook failed.",
          });
        }
      });
    }
  };
}

function dynamicToolDefinition(
  descriptor: PiExtensionRuntimeDescriptor,
  toolName: string,
): ToolDefinition {
  return {
    name: toolName,
    label: descriptor.displayName ?? descriptor.name ?? toolName,
    description:
      `Proxy tool for reviewed Pi extension ${descriptor.displayName ?? descriptor.name ?? descriptor.extensionId}.`,
    parameters: Type.Object({}, { additionalProperties: true }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = await runDynamicExtension({
        descriptor,
        operation: "tool",
        name: toolName,
        input: params,
      });
      if (!result.ok) {
        throw new Error(
          result.error ?? `Dynamic extension tool ${toolName} failed.`,
        );
      }
      return {
        content: [
          {
            type: "text",
            text:
              typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output ?? null),
          },
        ],
        details: {
          ok: true,
          extension_id: descriptor.extensionId,
          version_id: descriptor.versionId,
          tool_name: toolName,
          duration_ms: result.durationMs,
        },
      };
    },
  };
}

function parseDynamicPiExtensionDescriptor(
  value: unknown,
  context: {
    targetType: "default_agent" | "agent_profile";
    agentProfileId: string | null;
    reservedToolNames: Set<string>;
  },
): { ok: true; descriptor: PiExtensionRuntimeDescriptor } | {
  ok: false;
  reason: string;
} {
  const record = objectRecord(value);
  if (!record) return { ok: false, reason: "descriptor_not_object" };
  const descriptor = {
    extensionId: requiredString(record.extensionId),
    versionId: requiredString(record.versionId),
    assignmentId: requiredString(record.assignmentId),
    sourceId: requiredString(record.sourceId),
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : null,
    displayName:
      typeof record.displayName === "string" && record.displayName.trim()
        ? record.displayName.trim()
        : null,
    repositoryUrl: requiredString(record.repositoryUrl),
    repositoryOwner:
      typeof record.repositoryOwner === "string"
        ? record.repositoryOwner.trim()
        : null,
    repositoryName:
      typeof record.repositoryName === "string"
        ? record.repositoryName.trim()
        : null,
    sourceRef: requiredString(record.sourceRef),
    commitSha: requiredString(record.commitSha),
    manifestHash: requiredString(record.manifestHash),
    artifactHash: requiredString(record.artifactHash),
    artifactUri: requiredString(record.artifactUri),
    runtimeTarget: record.runtimeTarget,
    targetType: record.targetType,
    agentProfileId:
      typeof record.agentProfileId === "string"
        ? record.agentProfileId.trim()
        : null,
    toolNames: stringArray(record.toolNames),
    lifecycleHooks: stringArray(record.lifecycleHooks),
    permissionClasses: stringArray(record.permissionClasses),
    grantedPermissionClasses: stringArray(record.grantedPermissionClasses),
  };

  for (const id of [
    descriptor.extensionId,
    descriptor.versionId,
    descriptor.assignmentId,
    descriptor.sourceId,
  ]) {
    if (!UUID_RE.test(id)) return { ok: false, reason: "malformed_id" };
  }
  if (descriptor.name && !NAME_RE.test(descriptor.name)) {
    return { ok: false, reason: "malformed_name" };
  }
  if (descriptor.runtimeTarget !== "agentcore-pi") {
    return { ok: false, reason: "unsupported_runtime_target" };
  }
  if (descriptor.targetType !== context.targetType) {
    return { ok: false, reason: "target_type_mismatch" };
  }
  if (
    context.targetType === "agent_profile" &&
    descriptor.agentProfileId !== context.agentProfileId
  ) {
    return { ok: false, reason: "agent_profile_mismatch" };
  }
  if (
    context.targetType === "default_agent" &&
    descriptor.agentProfileId !== null
  ) {
    return { ok: false, reason: "default_agent_has_profile" };
  }
  if (!COMMIT_RE.test(descriptor.commitSha)) {
    return { ok: false, reason: "malformed_commit_sha" };
  }
  if (
    !SHA_HEX_RE.test(descriptor.manifestHash) ||
    !SHA_HEX_RE.test(descriptor.artifactHash)
  ) {
    return { ok: false, reason: "malformed_hash" };
  }
  if (!validGithubArtifactUri(descriptor)) {
    return { ok: false, reason: "artifact_uri_mismatch" };
  }
  const toolSeen = new Set<string>();
  for (const toolName of descriptor.toolNames) {
    if (!TOOL_NAME_RE.test(toolName)) {
      return { ok: false, reason: "malformed_tool_name" };
    }
    if (toolSeen.has(toolName) || context.reservedToolNames.has(toolName)) {
      return { ok: false, reason: "duplicate_tool_name" };
    }
    toolSeen.add(toolName);
  }
  for (const hook of descriptor.lifecycleHooks) {
    if (!HOOK_NAME_RE.test(hook)) {
      return { ok: false, reason: "malformed_lifecycle_hook" };
    }
  }
  for (const permission of [
    ...descriptor.permissionClasses,
    ...descriptor.grantedPermissionClasses,
  ]) {
    if (!PERMISSION_CLASS_RE.test(permission)) {
      return { ok: false, reason: "malformed_permission_class" };
    }
  }
  const requested = new Set(descriptor.permissionClasses);
  if (
    descriptor.grantedPermissionClasses.some(
      (permission) => !requested.has(permission),
    )
  ) {
    return { ok: false, reason: "unrequested_permission_grant" };
  }
  if (descriptor.permissionClasses.length > descriptor.grantedPermissionClasses.length) {
    return { ok: false, reason: "missing_granted_provider" };
  }
  if (descriptor.grantedPermissionClasses.length > 0) {
    return { ok: false, reason: "unavailable_provider" };
  }

  return {
    ok: true,
    descriptor: descriptor as PiExtensionRuntimeDescriptor,
  };
}

function validGithubArtifactUri(
  descriptor: Pick<
    PiExtensionRuntimeDescriptor,
    "artifactUri" | "repositoryOwner" | "repositoryName" | "commitSha"
  >,
): boolean {
  if (!descriptor.repositoryOwner || !descriptor.repositoryName) return false;
  return (
    descriptor.artifactUri ===
    `github://${descriptor.repositoryOwner}/${descriptor.repositoryName}/${descriptor.commitSha}`
  );
}

function loadEvidence(
  descriptor: PiExtensionRuntimeDescriptor,
  status: DynamicPiExtensionLoadEvidence["status"],
  reason?: string,
): DynamicPiExtensionLoadEvidence {
  return {
    extensionId: descriptor.extensionId,
    versionId: descriptor.versionId,
    assignmentId: descriptor.assignmentId,
    name: descriptor.name,
    artifactHashPrefix: descriptor.artifactHash.slice(0, 12),
    targetType: descriptor.targetType,
    agentProfileId: descriptor.agentProfileId,
    toolNames: descriptor.toolNames,
    lifecycleHooks: descriptor.lifecycleHooks,
    grantedPermissionClasses: descriptor.grantedPermissionClasses,
    status,
    ...(reason ? { reason } : {}),
  };
}

function partialEvidence(
  value: unknown,
  targetType: "default_agent" | "agent_profile",
  reason: string,
): DynamicPiExtensionLoadEvidence {
  const record = objectRecord(value) ?? {};
  return {
    extensionId: requiredString(record.extensionId) || "unknown",
    versionId: requiredString(record.versionId) || "unknown",
    assignmentId: requiredString(record.assignmentId) || "unknown",
    name: typeof record.name === "string" ? record.name : null,
    artifactHashPrefix:
      typeof record.artifactHash === "string"
        ? record.artifactHash.slice(0, 12)
        : "",
    targetType,
    agentProfileId:
      typeof record.agentProfileId === "string" ? record.agentProfileId : null,
    toolNames: stringArray(record.toolNames).filter((name) =>
      TOOL_NAME_RE.test(name),
    ),
    lifecycleHooks: stringArray(record.lifecycleHooks).filter((hook) =>
      HOOK_NAME_RE.test(hook),
    ),
    grantedPermissionClasses: stringArray(record.grantedPermissionClasses),
    status: "skipped",
    reason,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    out.push(trimmed);
    seen.add(trimmed);
  }
  return out;
}
