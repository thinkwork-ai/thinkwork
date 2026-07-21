#!/usr/bin/env npx tsx
/**
 * Provision TEI's LastMile sales reps as Twenty workspace members.
 *
 * TEI's Twenty does not serve the auth GraphQL schema (see lib/provision-
 * members-db.ts for the evidence), so members are written directly to Twenty's
 * Postgres. INSERT-only, idempotent by email, one transaction per rep.
 *
 * Environment:
 *   TWENTY_DATABASE_URL      Twenty's Postgres (secretsmanager thinkwork/tei-e2e/twenty/db-url)
 *   LASTMILE_DATABASE_URL    LastMile dispatch Postgres (read-only)
 *   TWENTY_REP_PASSWORD      Shared validation-window password. ROTATE AT CUTOVER.
 *   TWENTY_REP_EMAIL_DOMAIN  Fallback email domain (default texasenterprises.com)
 *   TWENTY_WORKSPACE_ID      Optional; resolved from core.workspace when single-workspace
 *
 * Usage:
 *   npx tsx scripts/provision-twenty-members.ts                 # dry-run: who would be created
 *   npx tsx scripts/provision-twenty-members.ts --apply         # create them
 *   npx tsx scripts/provision-twenty-members.ts --apply --only me@x.com   # one rep, for proof
 *
 * ROTATION (plan R5) — required at cutover, on abort, and on an over-long
 * validation window. The shared TWENTY_REP_PASSWORD must not outlive the phase
 * that needed it:
 *   npx tsx scripts/provision-twenty-members.ts --rotate           # dry-run: who rotates
 *   npx tsx scripts/provision-twenty-members.ts --rotate --apply   # unique random password each
 * Each rep gets an independent random password, printed once to stdout. Hand
 * them out, or have reps use Twenty's password reset.
 *
 * After provisioning, re-run migrate-lastmile.ts --apply so every company and
 * opportunity picks up its owner.
 */

import { randomBytes } from "node:crypto";
import process from "node:process";

import pg from "pg";

import { createLastmileReader } from "./lib/lastmile-reader";
import { deriveRepEmail } from "./lib/mappers";
import {
  provisionMembers,
  rotateMemberPasswords,
  type ProvisionRep,
} from "./lib/provision-members-db";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

interface WorkspaceContext {
  workspaceId: string;
  roleId: string;
  applicationId: string;
  workspaceSchema: string;
}

/** Read the workspace's own wiring rather than hardcode ids. */
async function readWorkspaceContext(
  databaseUrl: string,
  workspaceIdOverride: string | undefined,
): Promise<WorkspaceContext> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    // core.workspace has no schemaName column on this version; the data
    // schema is resolved from information_schema below.
    const workspaces = await pool.query<{
      id: string;
      defaultRoleId: string | null;
    }>(
      `select id, "defaultRoleId" from core.workspace where "deletedAt" is null`,
    );
    if (workspaces.rows.length === 0) throw new Error("No workspace found.");
    const workspace = workspaceIdOverride
      ? workspaces.rows.find((row) => row.id === workspaceIdOverride)
      : workspaces.rows[0];
    if (!workspace)
      throw new Error(`Workspace ${workspaceIdOverride} not found.`);
    if (workspaces.rows.length > 1 && !workspaceIdOverride) {
      throw new Error("Multiple workspaces — set TWENTY_WORKSPACE_ID.");
    }
    if (!workspace.defaultRoleId) {
      throw new Error(
        "Workspace has no defaultRoleId; refusing to guess a role.",
      );
    }

    // Reuse the applicationId the workspace's existing roleTargets carry.
    const roleTarget = await pool.query<{ applicationId: string }>(
      `select "applicationId" from core."roleTarget" where "workspaceId" = $1 limit 1`,
      [workspace.id],
    );
    if (roleTarget.rows.length === 0) {
      throw new Error("No existing roleTarget to copy applicationId from.");
    }

    const schemas = await pool.query<{ schema_name: string }>(
      `select schema_name from information_schema.schemata where schema_name like 'workspace\\_%'`,
    );
    if (schemas.rows.length !== 1) {
      throw new Error(
        `Expected exactly one workspace_* data schema, found ${schemas.rows.length}.`,
      );
    }
    const schemaName = schemas.rows[0].schema_name;

    return {
      workspaceId: workspace.id,
      roleId: workspace.defaultRoleId,
      applicationId: roleTarget.rows[0].applicationId,
      workspaceSchema: schemaName,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let apply = false;
  let only: string | null = null;
  let rotate = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--rotate") rotate = true;
    else if (arg === "--only") {
      only = argv[++index] ?? null;
      if (!only) throw new Error("--only requires an email");
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  const dryRun = !apply;

  const twentyDbUrl = requireEnv("TWENTY_DATABASE_URL");
  const lastmileUrl = requireEnv("LASTMILE_DATABASE_URL");
  // Rotation mints its own passwords; provisioning uses the shared one.
  const password = rotate ? "" : requireEnv("TWENTY_REP_PASSWORD");
  const emailDomain =
    process.env.TWENTY_REP_EMAIL_DOMAIN ?? "texasenterprises.com";

  const context = await readWorkspaceContext(
    twentyDbUrl,
    process.env.TWENTY_WORKSPACE_ID,
  );
  log(
    `workspace ${context.workspaceId} schema ${context.workspaceSchema} role ${context.roleId}`,
  );

  const reader = createLastmileReader(lastmileUrl);
  let reps: ProvisionRep[];
  try {
    const sourceReps = await reader.readReps();
    const seen = new Set<string>();
    reps = [];
    let derived = 0;
    for (const rep of sourceReps) {
      if (rep.archived) continue;
      const email =
        rep.email ?? deriveRepEmail(rep.firstName, rep.lastName, emailDomain);
      if (!email) continue; // house/intercompany/placeholder rows get no login
      if (!rep.email) derived += 1;
      // Two rep rows can share an email (a house row reusing a real address,
      // or one person duplicated). Email is the login identity: one user.
      if (seen.has(email)) continue;
      seen.add(email);
      reps.push({
        repId: rep.id,
        email,
        firstName: rep.firstName,
        lastName: rep.lastName,
      });
    }
    log(
      `reps: ${reps.length} provisionable (${derived} with derived @${emailDomain} emails), ` +
        `${sourceReps.filter((rep) => !rep.archived).length - reps.length} unprovisionable`,
    );
  } finally {
    await reader.close();
  }

  if (only) {
    const target = only.toLowerCase();
    reps = reps.filter((rep) => rep.email.toLowerCase() === target);
    if (reps.length === 0) throw new Error(`--only ${only} matched no rep`);
  }

  if (rotate) {
    const minted = new Map<string, string>();
    const result = await rotateMemberPasswords({
      databaseUrl: twentyDbUrl,
      emails: reps.map((rep) => rep.email),
      passwordFor: (email: string) => {
        // 18 bytes of base64url ~= 24 chars, well inside bcrypt's 72-byte limit.
        const secret = randomBytes(18).toString("base64url");
        minted.set(email, secret);
        return secret;
      },
      dryRun,
      log,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: dryRun ? "rotate-dry-run" : "rotate",
          rotated: result.rotated,
          notFound: result.notFound,
          // Printed once, never persisted. Hand these out, then discard.
          passwords: dryRun ? undefined : Object.fromEntries(minted),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await provisionMembers({
    databaseUrl: twentyDbUrl,
    workspaceId: context.workspaceId,
    roleId: context.roleId,
    applicationId: context.applicationId,
    workspaceSchema: context.workspaceSchema,
    password,
    reps,
    dryRun,
    log,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        workspaceId: context.workspaceId,
        created: result.created,
        existing: result.existing,
        failed: result.failed,
        rows: result.rows.slice(0, 200),
      },
      null,
      2,
    )}\n`,
  );
  if (result.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
