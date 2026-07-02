/**
 * Governance-file reseed — Composer plan 2026-07-02-001 U6 (R6/AE3).
 *
 * Defaults materialize into an agent's S3 prefix once, at bootstrap
 * (`workspace-bootstrap.ts` copies at write time); AGENTS.md / CONTEXT.md
 * are live-class files a defaults-version bump never rewrites. New default
 * content therefore reaches newly bootstrapped agents only. This module
 * closes AE3's "tenant that never customized" gap: it rewrites an existing
 * agent's governance file when — and ONLY when — the live content is
 * byte-identical to a previously shipped default version. Anything
 * hand-edited (or recomposed by the map path with real workspace state) is
 * left alone.
 *
 * Matching is substitution-aware: bootstrap bakes `{{AGENT_NAME}}` /
 * `{{TENANT_NAME}}` into the live bytes, so each historical default is
 * substituted with the agent's own values (through the exact same
 * `substitute()` the bootstrap uses) before the byte-identity check. The
 * rewrite writes the current default substituted the same way, which also
 * makes the reseed idempotent by construction: the rewritten content
 * matches the CURRENT default on the next run and is skipped.
 *
 * Wired where the seeding machinery already runs — the
 * `seed-workspace-defaults` handler's per-tenant loop (the defaults-version
 * bump path) — not as a new operator surface.
 */

import { createHash } from "node:crypto";
import {
  HISTORICAL_GOVERNANCE_DEFAULTS,
  RESEEDABLE_GOVERNANCE_FILES,
  loadFile,
  type ReseedableGovernanceFile,
} from "@thinkwork/workspace-defaults";
import {
  substitute,
  type PlaceholderValues,
} from "./placeholder-substitution.js";

export type { ReseedableGovernanceFile };

// ---------------------------------------------------------------------------
// Decision core (pure)
// ---------------------------------------------------------------------------

export type GovernanceReseedDecision =
  | {
      action: "rewrite";
      nextContent: string;
      /** Index into the historical corpus that matched (diagnostics only). */
      matchedHistoricalIndex: number;
    }
  | { action: "skip-missing" }
  | { action: "skip-current" }
  | { action: "skip-customized" };

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Decide whether a live governance file should be reseeded. Hash-compares
 * the live bytes against every previously shipped default version after
 * per-agent placeholder substitution.
 */
export function decideGovernanceReseed(input: {
  file: ReseedableGovernanceFile;
  liveContent: string | null;
  placeholderValues: PlaceholderValues;
}): GovernanceReseedDecision {
  if (input.liveContent === null) {
    // Never bootstrapped (or deliberately removed) — bootstrap owns
    // first materialization, not the reseed.
    return { action: "skip-missing" };
  }

  const liveHash = sha256(input.liveContent);
  const current = substitute(input.placeholderValues, loadFile(input.file));
  if (liveHash === sha256(current)) {
    return { action: "skip-current" };
  }

  const historical = HISTORICAL_GOVERNANCE_DEFAULTS[input.file];
  for (let index = 0; index < historical.length; index++) {
    const candidate = substitute(input.placeholderValues, historical[index]);
    if (liveHash === sha256(candidate)) {
      return {
        action: "rewrite",
        nextContent: current,
        matchedHistoricalIndex: index,
      };
    }
  }

  return { action: "skip-customized" };
}

// ---------------------------------------------------------------------------
// Tenant walker (store + agent list injected; the handler wires S3 + DB)
// ---------------------------------------------------------------------------

export interface ReseedObjectStore {
  getText(key: string): Promise<string | null>;
  putText(key: string, content: string): Promise<void>;
}

export interface ReseedAgentRef {
  agentId: string;
  agentSlug: string;
  agentName: string;
}

export interface AgentReseedResult {
  agentId: string;
  agentSlug: string;
  rewritten: ReseedableGovernanceFile[];
  skippedCustomized: ReseedableGovernanceFile[];
  skippedCurrent: ReseedableGovernanceFile[];
  skippedMissing: ReseedableGovernanceFile[];
}

export interface TenantReseedSummary {
  tenantSlug: string;
  agentsChecked: number;
  agentsRewritten: number;
  filesRewritten: number;
  results: AgentReseedResult[];
}

/**
 * Reseed the governance files of every supplied agent in a tenant.
 * Idempotent: a second run finds every rewritten file byte-identical to
 * the current default and no-ops.
 *
 * `afterAgentRewrite` fires once per agent that had at least one file
 * rewritten — the handler uses it to refresh derived AGENTS.md sections
 * and regenerate the workspace manifest.
 */
export async function reseedTenantGovernanceDefaults(input: {
  tenantSlug: string;
  tenantName: string;
  agents: readonly ReseedAgentRef[];
  store: ReseedObjectStore;
  afterAgentRewrite?: (
    agent: ReseedAgentRef,
    rewritten: readonly ReseedableGovernanceFile[],
  ) => Promise<void>;
}): Promise<TenantReseedSummary> {
  const results: AgentReseedResult[] = [];
  let filesRewritten = 0;

  for (const agent of input.agents) {
    const placeholderValues: PlaceholderValues = {
      AGENT_NAME: agent.agentName,
      TENANT_NAME: input.tenantName,
    };
    const result: AgentReseedResult = {
      agentId: agent.agentId,
      agentSlug: agent.agentSlug,
      rewritten: [],
      skippedCustomized: [],
      skippedCurrent: [],
      skippedMissing: [],
    };

    for (const file of RESEEDABLE_GOVERNANCE_FILES) {
      const key = `tenants/${input.tenantSlug}/agents/${agent.agentSlug}/${file}`;
      const liveContent = await input.store.getText(key);
      const decision = decideGovernanceReseed({
        file,
        liveContent,
        placeholderValues,
      });
      switch (decision.action) {
        case "rewrite":
          await input.store.putText(key, decision.nextContent);
          result.rewritten.push(file);
          filesRewritten++;
          break;
        case "skip-current":
          result.skippedCurrent.push(file);
          break;
        case "skip-customized":
          result.skippedCustomized.push(file);
          break;
        case "skip-missing":
          result.skippedMissing.push(file);
          break;
      }
    }

    if (result.rewritten.length > 0 && input.afterAgentRewrite) {
      await input.afterAgentRewrite(agent, result.rewritten);
    }
    results.push(result);
  }

  return {
    tenantSlug: input.tenantSlug,
    agentsChecked: input.agents.length,
    agentsRewritten: results.filter((r) => r.rewritten.length > 0).length,
    filesRewritten,
    results,
  };
}
