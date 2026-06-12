#!/usr/bin/env tsx
/**
 * namespace-registry — ops CLI for the thinkwork.ai customer domain
 * namespace (plan 2026-06-12-002, U1; R3 — the ONLY writer to the zone).
 *
 *   pnpm --filter @thinkwork/namespace-registry cli -- check <name> [--skip-db]
 *   pnpm --filter @thinkwork/namespace-registry cli -- claim <name> --tenant-slug <slug> [--dry-run]
 *   pnpm --filter @thinkwork/namespace-registry cli -- claim <name> --tenant-slug <slug> \
 *        --set-targets ns1,ns2,ns3,ns4 [--dry-run]
 *   pnpm --filter @thinkwork/namespace-registry cli -- release <name> --owner <owner> [--dry-run]
 *
 * Reads CLOUDFLARE_API_TOKEN from env (matching CI / cloudflare-sync-mcp).
 * The tenants-table leg defaults to the SaaS PRODUCTION authority; an
 * explicit --tenant-db-stage override is loudly flagged. `--skip-db`
 * exists ONLY on the read-only `check` subcommand — claims always check
 * both sources (KTD1).
 *
 * Exit codes: 0 = success/available; 1 = taken/refused/API error; 2 = usage.
 */

import { pathToFileURL } from "node:url";
import {
  CloudflareNamespaceClient,
  formatCloudflareError,
  type NamespaceDnsApi,
} from "./cloudflare.js";
import {
  checkName,
  claimName,
  releaseName,
  type NamespaceDeps,
} from "./core.js";
import type { ClaimKind } from "./comment-format.js";
import {
  DEFAULT_TENANT_DB_STAGE,
  createStageTenantSource,
  type TenantSourceHandle,
} from "./db.js";

export interface CliDeps {
  env?: Record<string, string | undefined>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  createDns?: (token: string) => NamespaceDnsApi;
  createTenantSource?: (options: {
    stage: string;
    env: Record<string, string | undefined>;
    warn: (message: string) => void;
  }) => Promise<TenantSourceHandle>;
  today?: () => string;
}

const USAGE = `namespace-registry — check/claim/release names in the thinkwork.ai namespace

Usage:
  namespace-registry check <name> [--skip-db] [--tenant-db-stage <stage>]
  namespace-registry claim <name> --tenant-slug <slug> [--kind deployment|tenant]
                     [--owner <owner>] [--set-targets ns1,ns2,ns3,ns4]
                     [--dry-run] [--tenant-db-stage <stage>]
  namespace-registry release <name> --owner <owner> [--kind deployment|tenant] [--dry-run]

Subcommands:
  check     Read-only dual-source availability (Cloudflare + tenants table).
            --skip-db skips the tenants-table leg (check only; loudly flagged).
  claim     Phase one (no --set-targets): reserve <name> with a comment-stamped
            TXT placeholder. Phase two (--set-targets): replace the owner's TXT
            with 4 NS delegation records. Idempotent for the same owner.
            <name> must equal the customer stack's tenant slug (--tenant-slug).
  release   Delete the records owned by --owner (comment match). Refuses when
            the name is owned by another claim. Run BEFORE terraform destroy.

Flags:
  --tenant-slug <slug>       (claim) The customer stack's tenant slug; must
                             equal <name> (KTD8).
  --kind <kind>              Claim kind: deployment (default) or tenant.
  --owner <owner>            Owner stamped into record comments. Defaults to
                             the tenant slug on claim; required on release.
  --set-targets <ns,...>     (claim) Exactly 4 NS targets, comma-separated.
  --dry-run                  (claim/release) Plan only; write nothing.
  --skip-db                  (check ONLY) Skip the tenants-table leg.
  --tenant-db-stage <stage>  Override the tenants-table stage (default:
                             ${DEFAULT_TENANT_DB_STAGE} — the SaaS production
                             authority). Loudly flagged.
  -h, --help

Env:
  CLOUDFLARE_API_TOKEN  Required. Token with Zone.DNS:Edit on thinkwork.ai.
                        (Cloudflare error 10000 = the token has drifted.)
  DATABASE_URL          Optional. Bypasses stage resolution for the DB leg
                        (loudly flagged).`;

type Subcommand = "check" | "claim" | "release";

interface ParsedArgs {
  subcommand: Subcommand;
  name: string;
  tenantSlug?: string;
  kind: ClaimKind;
  owner?: string;
  targets?: string[];
  dryRun: boolean;
  skipDb: boolean;
  tenantDbStage?: string;
}

class UsageError extends Error {}

const FLAGS_BY_SUBCOMMAND: Record<Subcommand, Set<string>> = {
  check: new Set(["--skip-db", "--tenant-db-stage"]),
  claim: new Set([
    "--tenant-slug",
    "--kind",
    "--owner",
    "--set-targets",
    "--dry-run",
    "--tenant-db-stage",
  ]),
  release: new Set(["--owner", "--kind", "--dry-run"]),
};

const VALUE_FLAGS = new Set([
  "--tenant-slug",
  "--kind",
  "--owner",
  "--set-targets",
  "--tenant-db-stage",
]);

export function parseCliArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  if (!first || first === "-h" || first === "--help") {
    throw new UsageError(USAGE);
  }
  if (first !== "check" && first !== "claim" && first !== "release") {
    throw new UsageError(
      `unknown subcommand: "${first}" (expected check, claim, or release)`,
    );
  }
  const subcommand = first as Subcommand;
  const allowed = FLAGS_BY_SUBCOMMAND[subcommand];

  const parsed: ParsedArgs = {
    subcommand,
    name: "",
    kind: "deployment",
    dryRun: false,
    skipDb: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "-h" || arg === "--help") {
      throw new UsageError(USAGE);
    }
    if (arg.startsWith("-")) {
      if (!allowed.has(arg)) {
        throw new UsageError(
          `unknown flag for "${subcommand}": ${arg}\n\n${USAGE}`,
        );
      }
      let value: string | undefined;
      if (VALUE_FLAGS.has(arg)) {
        value = rest[++i];
        if (value === undefined || value.startsWith("-")) {
          throw new UsageError(`flag ${arg} requires a value`);
        }
      }
      switch (arg) {
        case "--tenant-slug":
          parsed.tenantSlug = value;
          break;
        case "--kind":
          if (value !== "deployment" && value !== "tenant") {
            throw new UsageError(
              `--kind must be "deployment" or "tenant", got "${value}"`,
            );
          }
          parsed.kind = value;
          break;
        case "--owner":
          parsed.owner = value;
          break;
        case "--set-targets":
          parsed.targets = value!.split(",").map((t) => t.trim());
          break;
        case "--tenant-db-stage":
          parsed.tenantDbStage = value;
          break;
        case "--dry-run":
          parsed.dryRun = true;
          break;
        case "--skip-db":
          parsed.skipDb = true;
          break;
      }
      continue;
    }
    if (parsed.name) {
      throw new UsageError(`unexpected positional argument: "${arg}"`);
    }
    parsed.name = arg;
  }

  if (!parsed.name) {
    throw new UsageError(
      `${subcommand} requires a <name> argument\n\n${USAGE}`,
    );
  }
  if (subcommand === "claim" && !parsed.tenantSlug) {
    throw new UsageError(
      "claim requires --tenant-slug <slug> (the customer stack's tenant slug; " +
        "must equal <name> — KTD8)",
    );
  }
  if (subcommand === "release" && !parsed.owner) {
    throw new UsageError("release requires --owner <owner>");
  }
  return parsed;
}

export async function runCli(
  argv: string[],
  deps: CliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((m: string) => console.log(m));
  const stderr = deps.stderr ?? ((m: string) => console.error(m));
  const createDns =
    deps.createDns ??
    ((token: string) => new CloudflareNamespaceClient({ token }));
  const createTenantSource =
    deps.createTenantSource ??
    (({ stage, env: e, warn }) => createStageTenantSource(stage, e, warn));

  let args: ParsedArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr(err.message);
      return 2;
    }
    throw err;
  }

  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    stderr(
      "Error: CLOUDFLARE_API_TOKEN env var is required.\n" +
        "Create a token at https://dash.cloudflare.com/profile/api-tokens with\n" +
        "Zone.DNS:Edit on thinkwork.ai.",
    );
    return 2;
  }

  const stage = args.tenantDbStage ?? DEFAULT_TENANT_DB_STAGE;
  if (args.tenantDbStage && args.tenantDbStage !== DEFAULT_TENANT_DB_STAGE) {
    stderr(
      `!!! WARNING: --tenant-db-stage=${args.tenantDbStage} overrides the SaaS ` +
        `PRODUCTION tenant authority (default: ${DEFAULT_TENANT_DB_STAGE}).\n` +
        "!!! Availability verified against a non-production tenants table can " +
        "collide with real production tenant slugs. Only use this for testing.",
    );
  }

  const dns = createDns(token);
  let tenantHandle: TenantSourceHandle | null = null;

  try {
    const needsDb = args.subcommand !== "release" && !args.skipDb;
    if (needsDb) {
      tenantHandle = await createTenantSource({
        stage,
        env,
        warn: stderr,
      });
    }
    if (args.subcommand === "check" && args.skipDb) {
      stderr(
        "!!! WARNING: --skip-db — the tenants-table leg was SKIPPED. This " +
          "availability result is Cloudflare-only and can be WRONG for tenant " +
          "slugs that hold no DNS record (most of them — KTD1). Never claim " +
          "based on a --skip-db check.",
      );
    }

    const coreDeps: NamespaceDeps = {
      dns,
      tenants: tenantHandle?.source ?? null,
      today: deps.today,
    };

    switch (args.subcommand) {
      case "check": {
        const result = await checkName(coreDeps, args.name, {
          skipDb: args.skipDb,
        });
        stdout(`name:    ${args.name}`);
        stdout(`fqdn:    ${result.fqdn}`);
        stdout(`status:  ${result.status}`);
        stdout(
          `sources: cloudflare${result.dbChecked ? " + tenants table" : " ONLY (--skip-db)"}`,
        );
        if (result.records.length > 0) {
          for (const record of result.records) {
            stdout(
              `  record: ${record.type} ${record.name} → ${record.content}` +
                (record.comment ? ` (comment: ${record.comment})` : ""),
            );
          }
        }
        return result.status === "available" ? 0 : 1;
      }
      case "claim": {
        const result = await claimName(coreDeps, {
          name: args.name,
          tenantSlug: args.tenantSlug!,
          kind: args.kind,
          owner: args.owner ?? args.tenantSlug!,
          targets: args.targets,
          dryRun: args.dryRun,
        });
        if (result.ok) {
          stdout(`claim ${args.name}: ${result.action}`);
          stdout(result.detail);
          return 0;
        }
        stderr(
          `claim ${args.name} REFUSED (${result.reason}): ${result.detail}`,
        );
        return 1;
      }
      case "release": {
        const result = await releaseName(coreDeps, {
          name: args.name,
          kind: args.kind,
          owner: args.owner!,
          dryRun: args.dryRun,
        });
        if (result.ok) {
          stdout(`release ${args.name}: ${result.action}`);
          stdout(result.detail);
          return 0;
        }
        stderr(
          `release ${args.name} REFUSED (${result.reason}): ${result.detail}`,
        );
        return 1;
      }
      default: {
        const exhaustive: never = args.subcommand;
        throw new Error(`unreachable subcommand: ${String(exhaustive)}`);
      }
    }
  } catch (err) {
    stderr(formatCloudflareError(err));
    return 1;
  } finally {
    if (tenantHandle) {
      await tenantHandle.close().catch(() => {});
    }
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
