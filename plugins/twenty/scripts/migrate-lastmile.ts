#!/usr/bin/env npx tsx
/**
 * LastMile CRM → TEI's Twenty CRM migration (one-off, idempotent, re-runnable).
 * Plan: docs/plans/2026-07-09-002-feat-tei-lastmile-twenty-migration-plan.md
 *
 * OPERATOR RUNBOOK
 * ================
 * PREREQUISITE — Twenty's stock workflow "Create company when adding a new person"
 * MUST be deactivated (Settings -> Workflows) before any --apply run. It fires on
 * every person insert, invents a company from the email domain, and repoints the
 * person at it; it once mislinked 21,989 of 24,028 migrated people. The workspace
 * API key is forbidden from toggling workflows, so this is a human step.
 *
 * NIGHTLY AUTOMATION — during TEI's cutover this runs unattended via
 * `.github/workflows/tei-lastmile-sync.yml` (scheduled `--apply` delta re-sync).
 * The run is idempotent (upsert by sourceId + deletion mirror), never provisions
 * members, and needs no AWS credentials — the ~4 CRM attachments TEI's Twenty
 * cannot ingest are reported as gaps, not failures. Two invariants the workflow
 * cannot enforce and that a human owns: (1) the person->company workflow above
 * stays deactivated, and (2) the shared TWENTY_REP_PASSWORD is rotated once the
 * validation window closes (see step 5 below).
 *
 * Environment (all required unless noted):
 *   TWENTY_PUBLIC_URL      TEI's Twenty base URL, e.g. https://crm.tei.thinkwork.ai
 *   TWENTY_API_KEY         Workspace API key (Settings -> API & Webhooks)
 *   LASTMILE_DATABASE_URL  LastMile dispatch Postgres connection string (read access)
 *   TWENTY_REP_EMAIL_DOMAIN  Optional; domain for reps with no LastMile email
 *                          (default texasenterprises.com; <first-initial><lastname>@)
 *   AWS_PROFILE / AWS_REGION  Needed for attachment binaries (LastMile S3 bucket)
 *   NODE_EXTRA_CA_CERTS    RDS CA bundle, when the DB rejects the system trust store
 *
 * Members are NOT provisioned by this script: TEI's Twenty does not serve the auth
 * GraphQL schema, so `scripts/provision-twenty-members.ts` writes them directly to
 * Twenty's Postgres (see that file's header). Run it FIRST, then this script, so
 * every record resolves its owner. Reps without a member load ownerless and heal
 * on the next run once their member exists.
 *
 * Invocations (dry-run is the default; nothing is written without --apply):
 *   npx tsx scripts/migrate-lastmile.ts                        # dry-run + planned mutations
 *   npx tsx scripts/migrate-lastmile.ts --apply                # seed / delta re-sync
 *   npx tsx scripts/migrate-lastmile.ts --rollback             # list the sourceId-owned set
 *   npx tsx scripts/migrate-lastmile.ts --rollback --apply     # soft-delete it (restorable)
 *
 * To start over from an empty workspace: `scripts/purge-lastmile-import.ts --apply`
 * hard-deletes every sourceId-owned record plus workflow-created domain companies.
 *
 * Cutover day, in order:
 *   1. Confirm the person-to-company workflow is still deactivated.
 *   2. Freeze LastMile CRM edits.
 *   3. Re-run with --apply (delta re-sync; upserts by sourceId,
 *      mirrors deletions via an id-set diff -- LastMile has no dead-mark columns).
 *   4. Check the parity report + spot checks (this script's stdout JSON).
 *   5. ROTATE every rep password. The shared TWENTY_REP_PASSWORD is set on 89
 *      accounts and must not outlive the validation phase -- rotate on cutover, on
 *      abort, and on an over-long validation window alike (R5).
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
  ORGANIZATION,
  PERSON,
  PRODUCT,
  rollbackEntity,
  upsertNotes,
  upsertOpportunityProducts,
  upsertRecords,
  type EntityCounters,
} from "./lib/load-records";
import {
  buildOwnerIndex,
  dedupeContactEmails,
  deriveRepEmail,
  mapAccount,
  mapContact,
  mapCrmComment,
  mapCustomerNote,
  mapCrmTask,
  mapOrganization,
  mapProduct,
  mapTaskProducts,
  mapTaskStatusActivity,
  PRODUCT_CATALOG,
  productSourceId,
  sourceId,
} from "./lib/mappers";
import { ensureMembers, type RepToProvision } from "./lib/members-ensure";
import {
  applySchemaEnsure,
  ensureOpportunityProductObject,
  ensureOrganizationObject,
  fetchObjectMetadata,
  planSchemaEnsure,
} from "./lib/schema-ensure";
import { TwentyClient, normalizeBaseUrl } from "./lib/twenty-client";

interface CliArgs {
  apply: boolean;
  rollback: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, rollback: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--rollback") args.rollback = true;
    // Accepted and ignored: this script never provisions members, so the flag
    // that once suppressed it is a no-op. Kept so an old invocation still runs.
    else if (arg === "--skip-invites") continue;
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
    await runMigration({ client, reader, baseUrl, report, dryRun });
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
    { entity: ORGANIZATION, prefixes: ["organization:"] },
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
  report: Record<string, unknown>;
  dryRun: boolean;
}): Promise<void> {
  const { client, reader, baseUrl, report, dryRun } = options;

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
  const productObjectEnsure = await ensureOpportunityProductObject(
    client,
    objects,
    dryRun,
  );
  if (
    !dryRun &&
    (productObjectEnsure.created || productObjectEnsure.relationCreated)
  ) {
    objects = await fetchObjectMetadata(client);
  }
  const organizationObjectEnsure = await ensureOrganizationObject(
    client,
    objects,
    dryRun,
  );
  if (
    !dryRun &&
    (organizationObjectEnsure.created ||
      organizationObjectEnsure.relationCreated)
  ) {
    // Re-read metadata so the field plan addresses the real object ids.
    objects = await fetchObjectMetadata(client);
  }
  report.customObjects = {
    opportunityProduct: productObjectEnsure,
    organization: organizationObjectEnsure,
  };
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

  const members = await ensureMembers({
    dataClient: client,
    reps: repsToProvision,
  });
  if (members.missingMembers > 0) {
    log(
      `members: ${members.missingMembers} rep(s) have no Twenty member — run ` +
        `scripts/provision-twenty-members.ts, then re-run to attach their owners`,
    );
  }
  report.members = {
    report: members.report,
    resolved: members.ownerMap.size,
    missingMembers: members.missingMembers,
  };
  // Archived reps still resolve for historical ownership when a member with a
  // matching email already exists; unprovisioned owners map to null and are
  // flagged per record (U5 edge case).
  const ownerMap = members.ownerMap;

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
  const rawContacts = await reader.readContacts();
  // Twenty requires a unique person email; LastMile does not. Give the address
  // to the first contact by id and migrate the rest without one, rather than
  // losing them to a duplicate-key error (29 people failed this way on the
  // first seed).
  const contacts = dedupeContactEmails(rawContacts);
  const personCounters = emptyCounters();
  const keptById = new Map(contacts.map((contact) => [contact.id, contact]));
  for (const contact of rawContacts) {
    if (contact.email && !keptById.get(contact.id)?.email) {
      personCounters.warnings.push(
        `duplicate email ${contact.email} dropped from contact ${contact.id}`,
      );
    }
  }
  await upsertRecords({
    client,
    entity: PERSON,
    mapped: contacts.map((contact) => mapContact(contact, companyIdBySourceId)),
    dryRun,
    counters: personCounters,
  });
  report.people = "pending";

  // Organizations (LastMile branches, e.g. "GWO 300") — opportunities link to
  // them, so they load before the CRM tasks.
  log("records: loading organizations...");
  const organizations = await reader.readOrganizations();
  const organizationCounters = emptyCounters();
  const mappedOrganizations = organizations.map(mapOrganization);
  const organizationIdBySourceId = await upsertRecords({
    client,
    entity: ORGANIZATION,
    mapped: mappedOrganizations,
    dryRun,
    counters: organizationCounters,
  });
  if (dryRun) {
    for (const record of mappedOrganizations) {
      if (!organizationIdBySourceId.has(record.sourceId)) {
        organizationIdBySourceId.set(
          record.sourceId,
          `planned:${record.sourceId}`,
        );
      }
    }
  }
  report.organizations = summarizeCounters(organizationCounters);

  // The `task` table is the CRM: status, owner, organization, and products all
  // come from it. The `opportunity`/`lead` tables' own stage columns are stale
  // (they disagree with the task status on 889 of 950 opportunities).
  log("records: loading CRM tasks (leads + opportunities)...");
  const crmTasks = await reader.readCrmTasks();
  const opportunityCounters = emptyCounters();
  const mappedOpportunities = crmTasks.map((task) =>
    mapCrmTask(task, ownerIndex, companyIdBySourceId, organizationIdBySourceId),
  );
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

  // The product catalog (7 rows) must exist before the lines that point at it.
  log("records: ensuring the product catalog...");
  const catalogCounters = emptyCounters();
  const productIdBySourceId = await upsertRecords({
    client,
    entity: PRODUCT,
    mapped: PRODUCT_CATALOG.map(mapProduct),
    dryRun,
    counters: catalogCounters,
  });
  if (dryRun) {
    for (const name of PRODUCT_CATALOG) {
      const id = productSourceId(name);
      if (!productIdBySourceId.has(id)) {
        productIdBySourceId.set(id, `planned:${id}`);
      }
    }
  }
  report.productCatalog = summarizeCounters(catalogCounters);

  log("records: loading opportunity product lines...");
  const productCounters = emptyCounters();
  const mappedProducts = crmTasks.flatMap(mapTaskProducts);
  await upsertOpportunityProducts({
    client,
    products: mappedProducts,
    opportunityIdBySourceId,
    productIdBySourceId,
    dryRun,
    counters: productCounters,
  });
  report.opportunityProducts = summarizeCounters(productCounters);

  // Phase E: notes + attachments -------------------------------------------
  log("annexes: loading notes...");
  const [comments, customerNotes, statusChanges] = await Promise.all([
    reader.readCrmComments(),
    reader.readCustomerNotes(),
    reader.readTaskStatusChanges(),
  ]);
  const noteCounters = emptyCounters();
  const noteTargets = new Map<string, string>([
    ...opportunityIdBySourceId,
    ...companyIdBySourceId,
  ]);
  const mappedNotes = [
    ...comments.map(mapCrmComment),
    ...statusChanges.flatMap((change) => {
      const mapped = mapTaskStatusActivity(change);
      return mapped ? [mapped] : [];
    }),
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
    liveSourceIds: new Set(
      crmTasks.map((task) => sourceId(task.entityType, task.entityId)),
    ),
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
    liveSourceIds: new Set(mappedProducts.map((product) => product.sourceId)),
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

  const anyFailures = [
    organizationCounters,
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
