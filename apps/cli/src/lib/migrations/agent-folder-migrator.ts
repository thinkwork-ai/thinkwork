/**
 * Agent-folder backfill/convert migrator (subagent-folders plan
 * 2026-07-15-001, U8 — R5 backfill half, R22 sweep half, AE4).
 *
 * Two jobs, both idempotent:
 *   (a) materialize the four built-in profiles as `agents/<slug>/`
 *       folders (content from @thinkwork/workspace-defaults) where the
 *       folder does not already exist;
 *   (b) convert legacy `agents/<slug>.md` profile files into the strict
 *       folder form — `INSTRUCTIONS.md` + signed child grant sidecars.
 *
 * The sweep PRESERVES legacy files: deletion happens only via U12's
 * delete-on-write once all four path gates are deployed dual-read.
 * Never deletes tenant-authored content, period.
 *
 * Field mapping (plan U8):
 *   description       ← description + routingGuidance (both absent →
 *                        folder written WITHOUT description: it compiles
 *                        withheld `invalid_definition` — the visible
 *                        operator flag — and is listed in the report)
 *   model             ← model | modelId
 *   enabled           ← enabled
 *   builtInTools      ← tools.builtInTools | toolPolicy.builtInTools
 *   execution         ← execution | executionControls (camelCase only;
 *                        maxSubagentDepth/foreground dropped — depth is
 *                        structural now)
 *   skills list       → agents/<slug>/skills/<s>/.assignment.json
 *                        signed reference markers
 *   mcpServers list   → agents/<slug>/connectors/<c>/.assignment.json
 *                        signed narrowing sidecars (root connection
 *                        folder must exist; unresolvable → NO grant
 *                        written, flagged — no silent grant loss)
 *   name/builtInKey   → dropped (identity = folder path); recorded in
 *                        the report for traceability
 *
 * Pure w.r.t. AWS: the object store and the sidecar signer are injected
 * (CLI wiring shells out to the aws CLI and fetches the platform
 * signing key from Secrets Manager). The signing envelope replicates
 * packages/api/src/lib/capabilities/sidecar-signing.ts EXACTLY —
 * canonical JSON (recursive key sort, no whitespace), sha256
 * payloadHash, Ed25519 signature, version 1. Child grant sidecars sign
 * over EMPTY definition bytes (the sidecar IS the grant — see
 * AGENT_CHILD_GRANT_SIGNING_BYTES in manifest-compile.ts).
 */

import { createHash, sign as edSign, type KeyObject } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { WorkspaceObjectStore } from "./folder-canon-migrator.js";

export type AgentFolderMode = "dry-run" | "apply";

export interface AgentFolderMigrationOptions {
  tenantSlug?: string;
  agentSlug?: string;
  mode: AgentFolderMode;
  store: WorkspaceObjectStore;
  /** Null = signing unavailable: grant sidecars are skipped + flagged. */
  signingKey: KeyObject | null;
  /** `agents/<slug>/INSTRUCTIONS.md` → content, from workspace-defaults. */
  builtInFolders: Record<string, string>;
  now?: () => string;
}

export interface AgentFolderFlag {
  path: string;
  reason:
    | "missing_description"
    | "unresolvable_connector"
    | "signing_unavailable"
    | "unparseable_legacy_file";
  detail?: string;
}

export interface AgentFolderAgentReport {
  prefix: string;
  status: "dry-run" | "migrated" | "noop" | "failed";
  builtInsMaterialized: string[];
  converted: string[];
  skipped: string[];
  droppedFields: Array<{ path: string; fields: string[] }>;
  flags: AgentFolderFlag[];
  writes: string[];
  message: string;
}

export interface AgentFolderMigrationSummary {
  mode: AgentFolderMode;
  reports: AgentFolderAgentReport[];
  pendingWrites: number;
  flags: AgentFolderFlag[];
}

export async function migrateAgentFolders(
  options: AgentFolderMigrationOptions,
): Promise<AgentFolderMigrationSummary> {
  const prefixes = await discoverPrefixes(options);
  const reports: AgentFolderAgentReport[] = [];
  for (const prefix of prefixes) {
    try {
      reports.push(await migratePrefix(prefix, options));
    } catch (error) {
      reports.push({
        prefix,
        status: "failed",
        builtInsMaterialized: [],
        converted: [],
        skipped: [],
        droppedFields: [],
        flags: [],
        writes: [],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    mode: options.mode,
    reports,
    pendingWrites: reports.reduce((n, r) => n + r.writes.length, 0),
    flags: reports.flatMap((r) => r.flags),
  };
}

async function discoverPrefixes(
  options: AgentFolderMigrationOptions,
): Promise<string[]> {
  if (options.agentSlug) {
    if (!options.tenantSlug) {
      throw new Error("--tenant is required when --agent is provided");
    }
    return [`tenants/${options.tenantSlug}/agents/${options.agentSlug}/`];
  }
  const rootPrefix = options.tenantSlug
    ? `tenants/${options.tenantSlug}/`
    : "tenants/";
  const keys = await options.store.list(rootPrefix);
  const prefixes = new Set<string>();
  for (const key of keys) {
    // Central agent workspaces live at tenants/<t>/agents/<folder>/
    // directly (resolveAgentWorkspacePrefix — no /workspace/ suffix).
    // `_catalog/` holds template/defaults copies, not live workspaces.
    let match = key.match(/^(tenants\/[^/]+\/agents\/(?!_catalog\/)[^/]+\/)./);
    if (match) {
      prefixes.add(match[1]!);
      continue;
    }
    // Space sources hold space-local profile files (converted in place,
    // scope semantics untouched): tenants/<t>/spaces/<s>/agents/<x>.md
    match = key.match(/^(tenants\/[^/]+\/spaces\/[^/]+\/)agents\/[^/]+\.md$/);
    if (match) prefixes.add(match[1]!);
  }
  return [...prefixes].sort();
}

async function migratePrefix(
  prefix: string,
  options: AgentFolderMigrationOptions,
): Promise<AgentFolderAgentReport> {
  const isSpacePrefix = /\/spaces\/[^/]+\/$/.test(prefix);
  const keys = await options.store.list(`${prefix}agents/`);
  const relative = keys.map((key) => key.slice(prefix.length));
  const report: AgentFolderAgentReport = {
    prefix,
    status: options.mode === "apply" ? "noop" : "dry-run",
    builtInsMaterialized: [],
    converted: [],
    skipped: [],
    droppedFields: [],
    flags: [],
    writes: [],
    message: "",
  };
  const write = async (key: string, body: string) => {
    report.writes.push(key);
    if (options.mode === "apply") await options.store.write(key, body);
  };
  const folderExists = (slug: string) =>
    relative.some((path) => path.startsWith(`agents/${slug}/`));

  // (a) Built-in materialization — central agent workspaces only.
  if (!isSpacePrefix) {
    for (const [path, content] of Object.entries(options.builtInFolders)) {
      const slug = path.match(/^agents\/([^/]+)\//)?.[1];
      if (!slug) continue;
      if (folderExists(slug)) {
        report.skipped.push(`${prefix}${path} (already_installed)`);
        continue;
      }
      await write(`${prefix}${path}`, content);
      if (!report.builtInsMaterialized.includes(slug)) {
        report.builtInsMaterialized.push(slug);
      }
    }
  }

  // (b) Legacy file conversion — agents/<slug>.md directly under agents/.
  const legacyFiles = relative.filter((path) =>
    /^agents\/[a-z0-9][a-z0-9-]*\.md$/.test(path),
  );
  for (const legacyPath of legacyFiles) {
    const slug = legacyPath.match(/^agents\/([a-z0-9][a-z0-9-]*)\.md$/)![1]!;
    if (folderExists(slug) || report.builtInsMaterialized.includes(slug)) {
      report.skipped.push(`${prefix}${legacyPath} (folder exists)`);
      continue;
    }
    const raw = await options.store.read(`${prefix}${legacyPath}`);
    if (raw === null) continue;
    const parsed = parseLegacyProfileFile(raw);
    if (!parsed) {
      report.flags.push({
        path: `${prefix}${legacyPath}`,
        reason: "unparseable_legacy_file",
      });
      continue;
    }
    const conversion = convertLegacyProfile(slug, parsed);
    if (!conversion.description) {
      report.flags.push({
        path: `${prefix}agents/${slug}/INSTRUCTIONS.md`,
        reason: "missing_description",
        detail:
          "legacy file had neither description nor routingGuidance — folder compiles withheld until an operator adds one",
      });
    }
    if (conversion.droppedFields.length > 0) {
      report.droppedFields.push({
        path: `${prefix}${legacyPath}`,
        fields: conversion.droppedFields,
      });
    }
    await write(
      `${prefix}agents/${slug}/INSTRUCTIONS.md`,
      conversion.instructionsMd,
    );

    // Grant folders. Root connection presence gates connector grants —
    // no silent grant loss: unresolvable names are flagged, not dropped
    // quietly (they never grant anyway without a root connection).
    for (const skill of conversion.skills) {
      await writeGrantSidecar({
        options,
        report,
        write,
        key: `${prefix}agents/${slug}/skills/${skill}/.assignment.json`,
        childClass: "skill",
        childSlug: skill,
      });
    }
    for (const server of conversion.mcpServers) {
      const rootConnection = await options.store.read(
        `${prefix}connections/${server}/CONNECTION.md`,
      );
      if (rootConnection === null) {
        report.flags.push({
          path: `${prefix}agents/${slug}/connectors/${server}/.assignment.json`,
          reason: "unresolvable_connector",
          detail: `no root connections/${server}/ folder — grant not written`,
        });
        continue;
      }
      await writeGrantSidecar({
        options,
        report,
        write,
        key: `${prefix}agents/${slug}/connectors/${server}/.assignment.json`,
        childClass: "connection",
        childSlug: server,
      });
    }
    // (c) The legacy file is PRESERVED for the dual-read window —
    // deletion is U12's delete-on-write, never this sweep.
    report.converted.push(`${prefix}${legacyPath}`);
  }

  if (options.mode === "apply") {
    report.status = report.writes.length > 0 ? "migrated" : "noop";
  }
  report.message = `${report.builtInsMaterialized.length} built-ins, ${report.converted.length} conversions, ${report.skipped.length} skips, ${report.flags.length} flags`;
  return report;
}

async function writeGrantSidecar(input: {
  options: AgentFolderMigrationOptions;
  report: AgentFolderAgentReport;
  write: (key: string, body: string) => Promise<void>;
  key: string;
  childClass: "skill" | "connection";
  childSlug: string;
  operations?: string[];
}): Promise<void> {
  if (!input.options.signingKey) {
    input.report.flags.push({
      path: input.key,
      reason: "signing_unavailable",
      detail: "platform signing key not resolved — grant sidecar skipped",
    });
    return;
  }
  const base: Record<string, unknown> = {
    slug: input.childSlug,
    class: input.childClass,
    updated_at: input.options.now?.() ?? new Date().toISOString(),
    ...(input.operations
      ? { permissions: { operations: input.operations } }
      : {}),
  };
  const signed = signSidecar(base, input.options.signingKey, input.options);
  await input.write(input.key, `${JSON.stringify(signed, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Legacy parse (tolerant — mirrors the FROZEN legacy parser's aliases)
// ---------------------------------------------------------------------------

interface LegacyProfile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseLegacyProfileFile(source: string): LegacyProfile | null {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1] ?? "") ?? {};
  } catch {
    return null;
  }
  if (
    !frontmatter ||
    typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    return null;
  }
  return {
    frontmatter: frontmatter as Record<string, unknown>,
    body: match[2] ?? "",
  };
}

interface LegacyConversion {
  description: string | null;
  instructionsMd: string;
  skills: string[];
  mcpServers: string[];
  droppedFields: string[];
}

export function convertLegacyProfile(
  slug: string,
  legacy: LegacyProfile,
): LegacyConversion {
  const fm = legacy.frontmatter;
  const record = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  const strings = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
      : [];
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const description = str(fm.description);
  const routing = str(fm.routingGuidance ?? fm.routing_guidance);
  const merged = [description, routing].filter(Boolean).join(" ") || null;

  const tools = record(fm.tools ?? fm.toolPolicy);
  const builtInTools = strings(
    tools.builtInTools ?? tools.builtIn ?? fm.builtInTools,
  );
  const mcpServers = strings(tools.mcpServers ?? tools.mcp ?? fm.mcpServers);
  const skillPolicy = record(fm.skillPolicy);
  const skills = strings(
    fm.skills ?? skillPolicy.skillSlugs ?? skillPolicy.skills,
  );
  const model = str(fm.model ?? fm.modelId ?? fm.model_id);
  const enabled = fm.enabled !== false;

  const legacyExecution = record(fm.execution ?? fm.executionControls);
  const execution: Record<string, unknown> = {};
  const positiveNumber = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const pick = (target: string, ...sources: unknown[]) => {
    for (const value of sources) {
      const n = positiveNumber(value);
      if (n !== undefined) {
        execution[target] = target === "costBudgetUsd" ? n : Math.floor(n);
        return;
      }
    }
  };
  if (legacyExecution.clarify === true) execution.clarify = true;
  pick(
    "maxRuntimeMs",
    legacyExecution.maxRuntimeMs,
    legacyExecution.max_runtime_ms,
    legacyExecution.maxExecutionTimeMs,
  );
  pick("maxTokens", legacyExecution.maxTokens, legacyExecution.max_tokens);
  pick(
    "costBudgetUsd",
    legacyExecution.costBudgetUsd,
    legacyExecution.cost_budget_usd,
  );
  pick("maxQueriesPerRun", legacyExecution.maxQueriesPerRun);
  pick("maxReviewLoops", legacyExecution.maxReviewLoops);
  if (legacyExecution.reviewGate === true) execution.reviewGate = true;
  if (
    typeof legacyExecution.thinking === "string" &&
    legacyExecution.thinking
  ) {
    execution.thinking = legacyExecution.thinking;
  }

  const knownKeys = new Set([
    "description",
    "routingGuidance",
    "routing_guidance",
    "tools",
    "toolPolicy",
    "builtInTools",
    "mcpServers",
    "skillPolicy",
    "skills",
    "model",
    "modelId",
    "model_id",
    "enabled",
    "execution",
    "executionControls",
    "instructions",
    "spaces",
    "spaceIds",
  ]);
  const droppedFields = ["name", "builtInKey"]
    .filter((key) => fm[key] !== undefined)
    .concat(
      Object.keys(fm).filter(
        (key) => !knownKeys.has(key) && key !== "name" && key !== "builtInKey",
      ),
    );

  const instructions =
    str(fm.instructions) ?? stripInstructionsHeading(legacy.body);

  const folderFrontmatter: Record<string, unknown> = {};
  if (merged) folderFrontmatter.description = merged;
  if (model) folderFrontmatter.model = model;
  if (!enabled) folderFrontmatter.enabled = false;
  if (builtInTools.length > 0) folderFrontmatter.builtInTools = builtInTools;
  if (Object.keys(execution).length > 0) {
    folderFrontmatter.execution = execution;
  }
  const yaml = stringifyYaml(folderFrontmatter, {
    collectionStyle: "block",
  }).trim();
  const instructionsMd = `---\n${yaml}\n---\n\n${instructions.trim()}\n`;

  return {
    description: merged,
    instructionsMd,
    skills,
    mcpServers,
    droppedFields,
  };
}

function stripInstructionsHeading(body: string): string {
  return body.replace(/^\s*#\s*Instructions\s*\n+/i, "").trim();
}

// ---------------------------------------------------------------------------
// Signing — replicates packages/api/src/lib/capabilities/sidecar-signing.ts
// byte-for-byte. Envelope version 1, Ed25519, canonical key-sorted JSON.
// Child grants sign over EMPTY definition bytes.
// ---------------------------------------------------------------------------

function canonicalizePayload(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}

export function signSidecar(
  base: Record<string, unknown>,
  key: KeyObject,
  options?: { now?: () => string },
): Record<string, unknown> {
  const signed_content_sha = createHash("sha256").update("").digest("hex");
  const payload = { ...base, signed_content_sha };
  const canonical = canonicalizePayload(payload);
  const payloadHash = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
  const signature = edSign(null, Buffer.from(canonical, "utf8"), key).toString(
    "hex",
  );
  return {
    ...payload,
    signature: {
      version: 1,
      algorithm: "Ed25519",
      payloadHash,
      signature,
      signed_by: "backfill",
      signed_at: options?.now?.() ?? new Date().toISOString(),
    },
  };
}
