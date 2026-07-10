#!/usr/bin/env npx tsx
/**
 * LastMile CRM → TEI's Twenty CRM migration (one-off, idempotent, re-runnable).
 * Plan: docs/plans/2026-07-09-002-feat-tei-lastmile-twenty-migration-plan.md
 *
 * OPERATOR RUNBOOK
 * ================
 * Environment (all required unless noted):
 *   TWENTY_PUBLIC_URL      TEI's Twenty base URL, e.g. https://crm.tei.thinkwork.ai
 *   TWENTY_API_KEY         Workspace API key (Settings → API & Webhooks)
 *   LASTMILE_DATABASE_URL  LastMile dispatch Postgres connection string (read access)
 *   TWENTY_ADMIN_EMAIL     Admin user email — required only when --apply provisions members
 *   TWENTY_ADMIN_PASSWORD  Admin user password — same
 *   TWENTY_REP_PASSWORD    Shared test password for provisioned reps (R5; value lives
 *                          outside the repo). ROTATE OR DEACTIVATE every rep account at
 *                          cutover, on abort, or if the validation window drags on.
 *   TWENTY_WORKSPACE_ID    Optional override; otherwise resolved from the admin session
 *   TWENTY_REP_EMAIL_DOMAIN  Domain for reps with no LastMile email
 *                          (default texasenterprises.com; <first-initial><lastname>@)
 *   AWS_PROFILE / AWS_REGION  Needed for attachment binaries (LastMile S3 bucket)
 *
 * Invocations (dry-run is the default; nothing is written without --apply):
 *   npx tsx scripts/migrate-lastmile.ts                 # full dry-run + planned mutations
 *   npx tsx scripts/migrate-lastmile.ts --apply         # seed (or delta re-sync — same command)
 *   npx tsx scripts/migrate-lastmile.ts --rollback      # list the sourceId-owned record set
 *   npx tsx scripts/migrate-lastmile.ts --rollback --apply  # soft-delete that set (restorable)
 *   --skip-invites        with --apply: load schema+records but provision no new
 *                         members (owners heal on a later re-run once members exist)
 *
 * Cutover day, in order:
 *   1. Freeze LastMile CRM edits.
 *   2. Re-run with --apply (delta re-sync; upserts by sourceId, mirrors deletions).
 *   3. Check the parity report + spot checks (this script's stdout JSON).
 *   4. Rotate every rep password / enforce resets — the shared test password must not
 *      outlive the validation phase.
 *
 * The parity report prints to stdout as JSON; all other logging goes to stderr.
 * Secrets are never logged. One invocation at a time (KTD3).
 */

import process from "node:process";

import {
  createLastmileReader,
  type LastmileReader,
} from "./lib/lastmile-reader";
import { loadCrmAttachments } from "./lib/load-attachments";
import {
  checkNoteTargetPairing,
  COMPANY,
  emptyCounters,
  mirrorDeletions,
  NOTE,
  OPPORTUNITY,
  OPPORTUNITY_PRODUCT,
  PERSON,
  rollbackEntity,
  upsertNotes,
  upsertOpportunityProducts,
  upsertRecords,
  type EntityCounters,
} from "./lib/load-records";
import {
  buildOwnerIndex,
  deriveRepEmail,
  mapAccount,
  mapContact,
  mapCrmComment,
  mapCustomerNote,
  mapLead,
  mapOpportunity,
  mapOpportunityProduct,
  sourceId,
} from "./lib/mappers";
import {
  adminSignIn,
  ensureMembers,
  type RepToProvision,
} from "./lib/members-ensure";
import {
  applySchemaEnsure,
  ensureOpportunityProductObject,
  fetchObjectMetadata,
  planSchemaEnsure,
} from "./lib/schema-ensure";
import { TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

interface CliArgs {
  apply: boolean;
  rollback: boolean;
  /** Provision no new members this run: match existing members only. Owner
   * refs for unprovisioned reps stay null and heal on a later re-run once the
   * members exist (content hash changes when ownerId resolves). */
  skipInvites: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, rollback: false, skipInvites: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--rollback") args.rollback = true;
    else if (arg === "--skip-invites") args.skipInvites = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !args.apply;

  const baseUrl = normalizeBaseUrl(requireEnv("TWENTY_PUBLIC_URL"));
  const apiKey = requireEnv("TWENTY_API_KEY");
  const lastmileUrl = requireEnv("LASTMILE_DATABASE_URL");
  const repPassword = process.env.TWENTY_REP_PASSWORD ?? "";

  const client = new TwentyClient({ baseUrl, authToken: apiKey });
  const reader = createLastmileReader(lastmileUrl);

  const report: Record<string, unknown> = {
    mode: args.rollback
      ? dryRun
        ? "rollback-dry-run"
        : "rollback"
      : dryRun
        ? "dry-run"
        : "apply",
    startedAt: new Date().toISOString(),
  };

  try {
    if (args.rollback) {
      await runRollback(client, report, dryRun);
      return;
    }
    await runMigration({
      client,
      reader,
      baseUrl,
      repPassword,
      report,
      dryRun,
      skipInvites: args.skipInvites,
    });
  } finally {
    await reader.close();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

async function runRollback(
  client: TwentyClient,
  report: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  const entities = [
    { entity: NOTE, prefixes: ["task_comment:", "note:"] },
    { entity: OPPORTUNITY_PRODUCT, prefixes: ["opportunity_item:"] },
    { entity: OPPORTUNITY, prefixes: ["lead:", "opportunity:"] },
    { entity: PERSON, prefixes: ["contact:"] },
    { entity: COMPANY, prefixes: ["account:"] },
  ];
  for (const { entity, prefixes } of entities) {
    const counters = emptyCounters();
    log(
      `rollback: ${entity.plural} (${dryRun ? "listing" : "soft-deleting"})...`,
    );
    await rollbackEntity({
      client,
      entity,
      ownedPrefixes: prefixes,
      dryRun,
      counters,
    });
    report[`rollback_${entity.plural}`] = counters;
  }
  // Custom-field metadata is never rolled back (fields are inert; deleting
  // them destroys data). Workspace members are never un-created — rotate
  // passwords or deactivate instead. (Plan: Risks & Rollback.)
}

async function runMigration(options: {
  client: TwentyClient;
  reader: LastmileReader;
  baseUrl: string;
  repPassword: string;
  report: Record<string, unknown>;
  dryRun: boolean;
  skipInvites: boolean;
}): Promise<void> {
  const { client, reader, baseUrl, repPassword, report, dryRun, skipInvites } =
    options;

  // Phase A: preflight ------------------------------------------------------
  log("preflight: connecting to LastMile and Twenty...");
  const [reps, accounts] = await Promise.all([
    reader.readReps(),
    reader.readAccounts(),
  ]);
  await fetchObjectMetadata(client); // proves Twenty metadata access early
  log(`preflight ok: ${reps.length} reps, ${accounts.length} accounts visible`);

  // Phase B: schema ensure --------------------------------------------------
  log("schema: ensuring custom fields and stage options...");
  let objects = await fetchObjectMetadata(client);
  const objectEnsure = await ensureOpportunityProductObject(
    client,
    objects,
    dryRun,
  );
  if (!dryRun && (objectEnsure.created || objectEnsure.relationCreated)) {
    // Re-read metadata so the field plan addresses the real object id.
    objects = await fetchObjectMetadata(client);
  }
  report.opportunityProductObject = objectEnsure;
  const schemaPlan = planSchemaEnsure(objects);
  if (dryRun) {
    report.schema = {
      plannedFields: schemaPlan.createFields.map(
        (f) => `${f.object}.${f.name}`,
      ),
      plannedStageOptions: schemaPlan.stageOptionsToAdd,
    };
  } else {
    report.schema = await applySchemaEnsure(client, schemaPlan);
  }

  // Phase C: members --------------------------------------------------------
  log("members: ensuring workspace members...");
  const repEmailDomain =
    process.env.TWENTY_REP_EMAIL_DOMAIN ?? "texasenterprises.com";
  const derivedEmails: string[] = [];
  const repsToProvision: RepToProvision[] = reps
    .filter((rep) => !rep.archived)
    .map((rep) => {
      let email = rep.email;
      if (!email) {
        // Reps with no LastMile email get <first-initial><lastname>@<domain>;
        // house/intercompany/placeholder rows derive to null and stay
        // unprovisionable.
        email = deriveRepEmail(rep.firstName, rep.lastName, repEmailDomain);
        if (email) derivedEmails.push(`${rep.id} -> ${email}`);
      }
      return {
        repId: rep.id,
        email,
        firstName: rep.firstName,
        lastName: rep.lastName,
        archived: rep.archived,
      };
    });
  report.derivedRepEmails = {
    domain: repEmailDomain,
    count: derivedEmails.length,
    sample: derivedEmails.slice(0, 20),
  };

  let adminClient: TwentyClient | null = null;
  let workspaceId = process.env.TWENTY_WORKSPACE_ID ?? null;
  if (!dryRun) {
    const adminEmail = process.env.TWENTY_ADMIN_EMAIL;
    const adminPassword = process.env.TWENTY_ADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      if (!repPassword)
        throw new Error(
          "Missing required environment variable: TWENTY_REP_PASSWORD",
        );
      const session = await adminSignIn({
        baseUrl,
        email: adminEmail,
        password: adminPassword,
      });
      adminClient = new TwentyClient({
        baseUrl,
        authToken: session.accessToken,
      });
      workspaceId = workspaceId ?? session.workspaceId;
    }
  }
  const members = await ensureMembers({
    dataClient: client,
    adminClient,
    reps: repsToProvision,
    repPassword,
    workspaceId,
    // --skip-invites: match existing members only, invite nobody this run.
    dryRun: dryRun || skipInvites,
  });
  if (skipInvites) {
    report.membersMode =
      "skip-invites (existing members matched; no invitations sent)";
  }
  report.members = {
    report: members.report,
    provisionable: members.ownerMap.size,
    hadFailures: members.hadFailures,
  };
  // Archived reps still resolve for historical ownership when a member with a
  // matching email already exists; unprovisioned owners map to null and are
  // flagged per record (U5 edge case).
  const ownerMap = new Map(members.ownerMap);
  if (dryRun) {
    // Planned members don't have ids yet; placeholders keep the dry-run's
    // owner resolution (and its planned-mutation list) representative. Apply
    // runs always resolve real member ids.
    for (const row of members.report) {
      if (row.action === "planned" && row.email && !ownerMap.has(row.repId)) {
        ownerMap.set(row.repId, `planned-member:${row.email}`);
      }
    }
    for (const row of members.report) {
      if (
        row.action === "merged-duplicate-email" &&
        row.email &&
        !ownerMap.has(row.repId)
      ) {
        const primary = ownerMap.get(
          members.report.find(
            (r) => r.email === row.email && r.repId !== row.repId,
          )?.repId ?? "",
        );
        if (primary) ownerMap.set(row.repId, primary);
      }
    }
  }

  // Owner refs in LastMile mix rep ids, aliases, and display names; the index
  // adds unique alias/name keys on top of the provisioned rep→member map.
  const ownerIndex = buildOwnerIndex(reps, ownerMap);

  // Phase D: records — companies → people → opportunities -------------------
  log("records: loading companies...");
  const companyCounters = emptyCounters();
  const mappedCompanies = accounts.map((account) =>
    mapAccount(account, ownerIndex),
  );
  const companyIdBySourceId = await upsertRecords({
    client,
    entity: COMPANY,
    mapped: mappedCompanies,
    dryRun,
    counters: companyCounters,
  });
  if (dryRun) {
    for (const record of mappedCompanies) {
      if (!companyIdBySourceId.has(record.sourceId)) {
        companyIdBySourceId.set(record.sourceId, `planned:${record.sourceId}`);
      }
    }
  }
  report.companies = "pending";

  log("records: loading people...");
  const contacts = await reader.readContacts();
  const personCounters = emptyCounters();
  await upsertRecords({
    client,
    entity: PERSON,
    mapped: contacts.map((contact) => mapContact(contact, companyIdBySourceId)),
    dryRun,
    counters: personCounters,
  });
  report.people = "pending";

  log("records: loading opportunities (leads + opportunities)...");
  const [leads, opportunities] = await Promise.all([
    reader.readLeads(),
    reader.readOpportunities(),
  ]);
  const opportunityCounters = emptyCounters();
  const mappedOpportunities = [
    ...leads.map((lead) => mapLead(lead, ownerIndex)),
    ...opportunities.map((opportunity) =>
      mapOpportunity(opportunity, ownerIndex, companyIdBySourceId),
    ),
  ];
  const opportunityIdBySourceId = await upsertRecords({
    client,
    entity: OPPORTUNITY,
    mapped: mappedOpportunities,
    dryRun,
    counters: opportunityCounters,
  });
  if (dryRun) {
    for (const record of mappedOpportunities) {
      if (!opportunityIdBySourceId.has(record.sourceId)) {
        opportunityIdBySourceId.set(
          record.sourceId,
          `planned:${record.sourceId}`,
        );
      }
    }
  }
  report.opportunities = "pending";

  log("records: loading opportunity product lines...");
  const items = await reader.readOpportunityItems();
  const productCounters = emptyCounters();
  await upsertOpportunityProducts({
    client,
    products: items.map(mapOpportunityProduct),
    opportunityIdBySourceId,
    dryRun,
    counters: productCounters,
  });
  report.opportunityProducts = summarizeCounters(productCounters);

  // Phase E: notes + attachments -------------------------------------------
  log("annexes: loading notes...");
  const [comments, customerNotes] = await Promise.all([
    reader.readCrmComments(),
    reader.readCustomerNotes(),
  ]);
  const noteCounters = emptyCounters();
  const noteTargets = new Map<string, string>([
    ...opportunityIdBySourceId,
    ...companyIdBySourceId,
  ]);
  const mappedNotes = [
    ...comments.map(mapCrmComment),
    ...customerNotes.flatMap((note) => {
      const mapped = mapCustomerNote(note);
      if (!mapped) {
        noteCounters.sourceTotal += 1;
        noteCounters.skipped += 1;
        noteCounters.gaps.push(
          `customer note note:${note.id} skipped: customer "${note.customerName ?? note.customerId}" has no unique account match`,
        );
        return [];
      }
      return [mapped];
    }),
  ];
  await upsertNotes({
    client,
    notes: mappedNotes,
    targetIdBySourceId: noteTargets,
    dryRun,
    counters: noteCounters,
  });
  report.notes = summarizeCounters(noteCounters);

  log("annexes: loading attachments...");
  const attachments = await reader.readCrmAttachments();
  const attachmentCounters = emptyCounters();
  await loadCrmAttachments({
    client,
    authToken: process.env.TWENTY_API_KEY as string,
    baseUrl,
    attachments,
    targetIdBySourceId: opportunityIdBySourceId,
    dryRun,
    counters: attachmentCounters,
  });
  report.attachments = summarizeCounters(attachmentCounters);

  // Phase F: deletion mirror -------------------------------------------------
  log("deletion mirror: diffing live source ids...");
  await mirrorDeletions({
    client,
    entity: COMPANY,
    liveSourceIds: new Set(
      accounts.map((account) => sourceId("account", account.id)),
    ),
    ownedPrefixes: ["account:"],
    dryRun,
    counters: companyCounters,
  });
  await mirrorDeletions({
    client,
    entity: PERSON,
    liveSourceIds: new Set(
      contacts.map((contact) => sourceId("contact", contact.id)),
    ),
    ownedPrefixes: ["contact:"],
    dryRun,
    counters: personCounters,
  });
  await mirrorDeletions({
    client,
    entity: OPPORTUNITY,
    liveSourceIds: new Set([
      ...leads.map((lead) => sourceId("lead", lead.id)),
      ...opportunities.map((opportunity) =>
        sourceId("opportunity", opportunity.id),
      ),
    ]),
    ownedPrefixes: ["lead:", "opportunity:"],
    dryRun,
    counters: opportunityCounters,
  });

  report.companies = summarizeCounters(companyCounters);
  report.people = summarizeCounters(personCounters);
  report.opportunities = summarizeCounters(opportunityCounters);

  await mirrorDeletions({
    client,
    entity: OPPORTUNITY_PRODUCT,
    liveSourceIds: new Set(
      items.map(
        (item) =>
          `${sourceId("opportunity_item", item.opportunityId)}#${item.index}`,
      ),
    ),
    ownedPrefixes: ["opportunity_item:"],
    dryRun,
    counters: productCounters,
  });
  report.opportunityProducts = summarizeCounters(productCounters);

  // Phase G: parity + invariants ---------------------------------------------
  log("parity: checking invariants...");
  const invariants = dryRun ? [] : await checkNoteTargetPairing(client);
  report.invariants = {
    noteTargetPairing: invariants,
    // Duplicate live sourceIds abort mid-run inside fetchExistingBySourceIds;
    // reaching this point means zero duplicates were observed.
    duplicateSourceIds: [],
  };
  report.reconciliation = buildReconciliation({
    companies: companyCounters,
    people: personCounters,
    opportunities: opportunityCounters,
  });

  const anyFailures =
    members.hadFailures ||
    [
      companyCounters,
      personCounters,
      opportunityCounters,
      productCounters,
      noteCounters,
      attachmentCounters,
    ].some((counters) => counters.failed > 0);
  report.ok = !anyFailures;
  if (anyFailures) process.exitCode = 2;
}

/** Keep the report readable: long lists collapse to count + grouped summary +
 * a bounded sample. The full detail is reproducible by re-running dry-run with
 * MIGRATE_LASTMILE_FULL_REPORT=1. */
function summarizeList(items: string[]): unknown {
  const full = process.env.MIGRATE_LASTMILE_FULL_REPORT === "1";
  if (full || items.length <= 50) return items;
  const groups = new Map<string, number>();
  for (const item of items) {
    const key = item
      .replace(
        /(account|contact|lead|opportunity|task_comment|note|task_attachment):[\w]+/g,
        "$1:*",
      )
      .replace(/"[^"]*"/g, '"*"')
      .replace(/rep_\w+/g, "rep_*");
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return {
    count: items.length,
    grouped: Object.fromEntries(
      [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    ),
    sample: items.slice(0, 20),
  };
}

function summarizeCounters(counters: EntityCounters): Record<string, unknown> {
  return {
    ...counters,
    plannedMutations: summarizeList(counters.plannedMutations),
    gaps: summarizeList(counters.gaps),
    warnings: summarizeList(counters.warnings),
  };
}

function buildReconciliation(
  entries: Record<string, EntityCounters>,
): Record<string, string> {
  const reconciliation: Record<string, string> = {};
  for (const [name, counters] of Object.entries(entries)) {
    const accounted =
      counters.created +
      counters.updated +
      counters.restored +
      counters.skipped;
    reconciliation[name] =
      `created(${counters.created}) + updated(${counters.updated}) + restored(${counters.restored}) + skipped(${counters.skipped}) = ${accounted} of sourceTotal(${counters.sourceTotal}); failed=${counters.failed}, deleted=${counters.deleted}`;
  }
  return reconciliation;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
