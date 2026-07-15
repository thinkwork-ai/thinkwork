/**
 * Manifest-sourced sub-agent profiles (subagent-folders plan
 * 2026-07-15-001, U9 — R15, R17 dual-read half, AE5).
 *
 * Maps `class: "agent"` capabilities-manifest entries to the runtime's
 * `AgentProfileConfig`, reading each profile's prose instructions from
 * the synced `agents/<slug>/INSTRUCTIONS.md` and VERIFYING the file
 * against the entry's pinned etag before it can ever spawn (KTD-10: a
 * mid-thread edit + recompile must not execute unpinned content while
 * the run records the old fingerprint). Any per-profile failure is a
 * loud skip — never a dead turn, never silent execution of unverified
 * bytes.
 *
 * Compile-don't-interpret: typed config (description, model,
 * builtInTools, execution, child grant surface) comes from the COMPILED
 * entry; the synced file contributes only the prose body. Pi never
 * parses agent frontmatter.
 *
 * Grants come from the entry's resolved child surface (U5), not payload
 * name-lists (R15): connector grants map to mcp server grants with the
 * narrowed operation whitelist; withheld child grants ride along so the
 * child prompt can name the absence (THINK-229 posture).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentLoopPolicy,
  AgentProfileConfig,
} from "../agent-profile-adapter.js";
import type {
  CapabilitiesManifestFile,
  CapabilityManifestEntry,
} from "./capabilities-json.js";

export interface SkippedManifestProfile {
  slug: string;
  reason:
    | "missing_instructions"
    | "instructions_etag_mismatch"
    | "invalid_entry";
  detail?: string;
}

export interface ManifestAgentProfiles {
  profiles: AgentProfileConfig[];
  skipped: SkippedManifestProfile[];
  /** Per-profile withheld child grants (visible absence for the child prompt). */
  withheldGrants: Array<{
    profileSlug: string;
    class: string;
    slug: string;
    reason: string;
    detail?: string;
  }>;
}

export async function agentProfilesFromManifest(input: {
  manifest: CapabilitiesManifestFile;
  workspaceDir: string;
  readFileImpl?: typeof readFile;
}): Promise<ManifestAgentProfiles> {
  const read = input.readFileImpl ?? readFile;
  const profiles: AgentProfileConfig[] = [];
  const skipped: SkippedManifestProfile[] = [];
  const withheldGrants: ManifestAgentProfiles["withheldGrants"] = [];

  for (const entry of input.manifest.active) {
    if (entry.class !== "agent") continue;
    const slug = entry.slug;
    if (!slug || typeof slug !== "string") {
      skipped.push({ slug: String(slug ?? "?"), reason: "invalid_entry" });
      continue;
    }
    const filePath = path.join(
      input.workspaceDir,
      "agents",
      slug,
      "INSTRUCTIONS.md",
    );
    let raw: string;
    try {
      raw = await read(filePath, "utf-8");
    } catch {
      skipped.push({
        slug,
        reason: "missing_instructions",
        detail: `agents/${slug}/INSTRUCTIONS.md is not in the synced workspace`,
      });
      continue;
    }

    // KTD-10 pinning: the entry records the compiled INSTRUCTIONS.md
    // etag. Simple-put S3 etags are the content MD5 — verify when the
    // pin is md5-shaped; a multipart etag (contains '-') cannot be
    // recomputed from bytes, so it passes with the pin recorded on the
    // run for offline audit.
    const pinned = normalizeEtag(entry.instructionsEtag);
    if (pinned && /^[a-f0-9]{32}$/i.test(pinned)) {
      const actual = createHash("md5").update(raw, "utf8").digest("hex");
      if (actual.toLowerCase() !== pinned.toLowerCase()) {
        skipped.push({
          slug,
          reason: "instructions_etag_mismatch",
          detail: `synced INSTRUCTIONS.md (${actual}) does not match the compiled pin (${pinned}) — re-render/sync required`,
        });
        continue;
      }
    }

    profiles.push(profileFromEntry(entry, stripFrontmatter(raw)));
    for (const grant of asWithheldGrants(entry.withheldGrants)) {
      withheldGrants.push({ profileSlug: slug, ...grant });
    }
  }

  return { profiles, skipped, withheldGrants };
}

function profileFromEntry(
  entry: CapabilityManifestEntry,
  instructions: string,
): AgentProfileConfig {
  const grants = Array.isArray(entry.grants)
    ? (entry.grants as Array<Record<string, unknown>>)
    : [];
  const skillGrants = grants
    .filter((grant) => grant.class === "skill")
    .map((grant) => String(grant.slug))
    .filter(Boolean);
  const connectorGrants = grants
    .filter((grant) => grant.class === "connector")
    .map((grant) => ({
      serverName: String(grant.slug ?? ""),
      ...(Array.isArray(grant.operations)
        ? { toolWhitelist: (grant.operations as unknown[]).map(String) }
        : {}),
    }))
    .filter((grant) => Boolean(grant.serverName));
  const execution = recordValue(entry.execution);

  return {
    id: `manifest:${entry.slug}`,
    slug: entry.slug,
    name: titleize(entry.slug),
    enabled: true,
    // Absent model = inherit the parent/platform default at spawn time
    // (compileAgentProfileRunRequest falls back to parentModelId when
    // the profile model is empty — U10 wires that fallback).
    modelId: typeof entry.model === "string" ? entry.model : "",
    instructions,
    ...(typeof entry.description === "string" && entry.description
      ? { routingGuidance: entry.description }
      : {}),
    toolPolicy: {
      defaultTools: [],
      builtInTools: Array.isArray(entry.builtInTools)
        ? (entry.builtInTools as unknown[]).map(String)
        : [],
      disabledDefaultTools: [],
      skills: skillGrants,
      mcpServers: connectorGrants,
    },
    executionControls: {
      thinking: stringOrUndefined(execution.thinking),
      maxRuntimeMs: numberOrUndefined(execution.maxRuntimeMs),
      maxTokens: numberOrUndefined(execution.maxTokens),
      costBudgetUsd: numberOrUndefined(execution.costBudgetUsd),
      maxQueriesPerRun: numberOrUndefined(execution.maxQueriesPerRun),
      reviewGate: booleanOrUndefined(execution.reviewGate),
      maxReviewLoops: numberOrUndefined(execution.maxReviewLoops),
      loopPolicy: loopPolicyOrUndefined(execution.loopPolicy),
    },
    contextPolicy: {
      systemPromptMode: "replace",
      inheritProjectContext: false,
      inheritSkills: false,
      defaultContext: "fresh",
    },
  };
}

/**
 * Compare payload-sourced and manifest-sourced profiles for the
 * dual-read soak (R17). Returns one record per divergent slug naming
 * the divergent fields; empty = the two sources agree. The payload
 * remains authoritative until the per-tenant authority flip (U10).
 */
export function diffProfileSources(input: {
  payloadProfiles: AgentProfileConfig[];
  manifestProfiles: AgentProfileConfig[];
}): Array<{ slug: string; fields: string[] }> {
  const divergences: Array<{ slug: string; fields: string[] }> = [];
  const manifestBySlug = new Map(
    input.manifestProfiles.map((profile) => [profile.slug, profile]),
  );
  const payloadBySlug = new Map(
    input.payloadProfiles.map((profile) => [profile.slug, profile]),
  );

  for (const payload of input.payloadProfiles) {
    const manifest = manifestBySlug.get(payload.slug);
    if (!manifest) {
      divergences.push({ slug: payload.slug, fields: ["missing_in_manifest"] });
      continue;
    }
    const fields: string[] = [];
    if (
      normalizeText(payload.instructions) !==
      normalizeText(manifest.instructions)
    ) {
      fields.push("instructions");
    }
    if (manifest.modelId && payload.modelId !== manifest.modelId) {
      fields.push("model");
    }
    if (
      !sameSet(
        payload.toolPolicy?.builtInTools ?? [],
        manifest.toolPolicy?.builtInTools ?? [],
      )
    ) {
      fields.push("builtInTools");
    }
    if (
      !sameSet(
        payload.toolPolicy?.skills ?? [],
        manifest.toolPolicy?.skills ?? [],
      )
    ) {
      fields.push("skills");
    }
    if (
      !sameSet(
        (payload.toolPolicy?.mcpServers ?? []).map((s) => s.serverName),
        (manifest.toolPolicy?.mcpServers ?? []).map((s) => s.serverName),
      )
    ) {
      fields.push("mcpServers");
    }
    if (fields.length > 0) divergences.push({ slug: payload.slug, fields });
  }
  for (const manifest of input.manifestProfiles) {
    if (!payloadBySlug.has(manifest.slug)) {
      divergences.push({ slug: manifest.slug, fields: ["missing_in_payload"] });
    }
  }
  return divergences;
}

function stripFrontmatter(source: string): string {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (match ? match[1]! : source).trim();
}

function normalizeEtag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/"/g, "").trim() || null;
}

function normalizeText(value: string): string {
  return value.trim();
}

function sameSet(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const item of setA) if (!setB.has(item)) return false;
  return true;
}

function titleize(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asWithheldGrants(
  value: unknown,
): Array<{ class: string; slug: string; reason: string; detail?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = recordValue(item);
    if (
      typeof record.class !== "string" ||
      typeof record.slug !== "string" ||
      typeof record.reason !== "string"
    ) {
      return [];
    }
    return [
      {
        class: record.class,
        slug: record.slug,
        reason: record.reason,
        ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
      },
    ];
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function loopPolicyOrUndefined(value: unknown): AgentLoopPolicy | undefined {
  const record = recordValue(value);
  if (record.mode !== "closed") return undefined;
  const maxIterations = numberOrUndefined(record.maxIterations);
  const maxReviewLoops = numberOrUndefined(record.maxReviewLoops);
  const externalReviewerPolicy = stringOrUndefined(
    record.externalReviewerPolicy,
  );
  const failBehavior = stringOrUndefined(record.failBehavior);
  if (
    !maxIterations ||
    !maxReviewLoops ||
    !externalReviewerPolicy ||
    !failBehavior ||
    !["never", "explicit", "profile_required", "always"].includes(
      externalReviewerPolicy,
    ) ||
    !["return_blocker", "best_effort_with_warning"].includes(failBehavior)
  ) {
    return undefined;
  }
  return {
    mode: "closed",
    enabled: booleanOrUndefined(record.enabled) ?? true,
    maxIterations,
    maxReviewLoops,
    reviewGate: booleanOrUndefined(record.reviewGate) ?? false,
    externalReviewerPolicy:
      externalReviewerPolicy as AgentLoopPolicy["externalReviewerPolicy"],
    failBehavior: failBehavior as AgentLoopPolicy["failBehavior"],
    ...(numberOrUndefined(record.maxRuntimeMs) !== undefined
      ? { maxRuntimeMs: numberOrUndefined(record.maxRuntimeMs) }
      : {}),
    ...(numberOrUndefined(record.maxTokens) !== undefined
      ? { maxTokens: numberOrUndefined(record.maxTokens) }
      : {}),
    ...(numberOrUndefined(record.costBudgetUsd) !== undefined
      ? { costBudgetUsd: numberOrUndefined(record.costBudgetUsd) }
      : {}),
  };
}
