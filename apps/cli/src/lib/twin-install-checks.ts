/**
 * Prereq checks for `thinkwork twin install` (THINK-334).
 *
 * Pure `evaluateX` functions follow the Check/CheckResult pattern from
 * lib/checks.ts so the doctor-style report machinery renders them. The
 * install command aggregates these before any Terraform or API call; a
 * blocking failure exits 1 without touching anything.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Check, CheckResult } from "./checks.js";
import { checkAwsCli, checkAwsIdentity, checkTerraformCli } from "./checks.js";

// ── etl-repo checkout ─────────────────────────────────────────────────────────
//
// The etl/platform repo is thinkwork-ai/company-brain (formerly
// McPherson-Data/thinkwork). Identity is established by the marker layout
// (etl-platform/ with terraform stacks), not the git remote, so checkouts of
// either repo pass during the transition window (U8, KTD-10) — the
// stacks/ + accounts/ layout contract is identical in both.

export interface EtlCheckoutProbe {
  /** Resolved path the engineer pointed at (flag or THINKWORK_ETL_REPO). */
  path: string | null;
  dirExists: boolean;
  /** True when the dir carries the etl repo's marker layout (etl-platform/). */
  isEtlRepo: boolean;
}

export function evaluateEtlCheckout(probe: EtlCheckoutProbe): CheckResult {
  if (!probe.path) {
    return {
      pass: false,
      detail:
        "No etl repo checkout configured. Pass --etl-repo-dir <path> or set THINKWORK_ETL_REPO " +
        "to a local checkout of thinkwork-ai/company-brain (a McPherson-Data/thinkwork " +
        "checkout is also accepted during the transition).",
    };
  }
  if (!probe.dirExists) {
    return {
      pass: false,
      detail: `etl repo dir not found: ${probe.path}`,
    };
  }
  if (!probe.isEtlRepo) {
    return {
      pass: false,
      detail:
        `${probe.path} does not look like the etl repo (expected an etl-platform/ ` +
        "directory with terraform stacks). Point --etl-repo-dir at a checkout of " +
        "thinkwork-ai/company-brain (or, during the transition, McPherson-Data/thinkwork).",
    };
  }
  return { pass: true, detail: `etl repo checkout at ${probe.path}` };
}

export function probeEtlCheckout(path: string | null): EtlCheckoutProbe {
  if (!path) return { path: null, dirExists: false, isEtlRepo: false };
  const dirExists = existsSync(path);
  const isEtlRepo = dirExists && existsSync(join(path, "etl-platform"));
  return { path, dirExists, isEtlRepo };
}

export function checkEtlCheckout(path: string | null): Check {
  return {
    name: "etl repo checkout",
    run: () => evaluateEtlCheckout(probeEtlCheckout(path)),
  };
}

// ── Tenant resolution (KTD-5) ────────────────────────────────────────────────

export interface TenantResolution {
  /** Resolved slug, or null when resolution failed. */
  tenant: string | null;
  result: CheckResult;
}

/**
 * KTD-5: `--tenant` is required whenever the stage has more than one tenant;
 * with exactly one tenant it may be inferred. Never "first tenant wins".
 */
export function evaluateTenantResolution(
  tenants: string[],
  flag: string | undefined,
): TenantResolution {
  if (flag) {
    if (!tenants.includes(flag)) {
      return {
        tenant: null,
        result: {
          pass: false,
          detail: `Tenant "${flag}" not found on this stage. Known tenants: ${tenants.join(", ") || "(none)"}.`,
        },
      };
    }
    return {
      tenant: flag,
      result: { pass: true, detail: `tenant ${flag} (explicit)` },
    };
  }
  if (tenants.length === 1) {
    return {
      tenant: tenants[0],
      result: {
        pass: true,
        detail: `tenant ${tenants[0]} (only tenant on stage)`,
      },
    };
  }
  if (tenants.length === 0) {
    return {
      tenant: null,
      result: {
        pass: false,
        detail:
          "No tenants found on this stage — nothing to register the twin MCP server for.",
      },
    };
  }
  return {
    tenant: null,
    result: {
      pass: false,
      detail:
        `Stage has ${tenants.length} tenants (${tenants.join(", ")}); pass --tenant <slug> ` +
        "to pick the install target explicitly.",
    },
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface TwinPrereqContext {
  etlRepoDir: string | null;
}

export function twinInstallChecks(ctx: TwinPrereqContext): Check[] {
  return [
    checkAwsCli(),
    checkTerraformCli(),
    checkAwsIdentity(),
    checkEtlCheckout(ctx.etlRepoDir),
  ];
}

/** Best-effort read of the etl repo's origin remote for the report detail. */
export function readEtlRepoOrigin(path: string): string | null {
  try {
    const cfg = readFileSync(join(path, ".git", "config"), "utf8");
    const m = cfg.match(/url\s*=\s*(\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
