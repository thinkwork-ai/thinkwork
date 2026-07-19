/**
 * Inventory and backfill Cognito principals into user_auth_identities.
 *
 * Dry-run is the default. `--apply` writes only exact active mappings or
 * explicit quarantines and records a durable cutover inventory fingerprint.
 * Output contains counts and digests, never emails, subjects, or raw profiles.
 */

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  authCutoverRuns,
  authProviderResources,
  userAuthIdentities,
  users,
} from "@thinkwork/database-pg/schema";
import { db } from "../src/lib/db.js";
import { emitAuthControlEvent } from "../src/lib/compliance/emit.js";

export interface DatabaseIdentityUser {
  id: string;
  tenantId: string | null;
  cognitoSub: string;
}

export interface CognitoInventoryUser {
  username: string;
  sub: string;
  identities: CognitoProviderIdentity[];
}

export interface CognitoProviderIdentity {
  providerName: string;
  providerType?: string;
  issuer?: string;
  userId: string;
  primary?: boolean;
}

export interface BackfillConnection {
  id: string;
  connectionKey: string;
  providerKind: string;
  cognitoIdentityProviderName: string;
  issuerUrl: string | null;
}

export interface BackfillPlanEntry {
  userId: string;
  tenantId: string;
  authProviderResourceId: string | null;
  cognitoIssuer: string;
  cognitoSub: string;
  providerIssuer: string;
  providerSubject: string;
  providerKind: string;
  proofKind: string;
  status: "active" | "quarantined";
  reasonCode: string | null;
}

export interface BackfillFinding {
  subjectDigest: string;
  reasonCode: string;
}

export interface WorkosDirectoryUser {
  id: string;
}

export interface WorkosSessionBinding {
  workosUserId: string;
  cognitoSub: string;
}

export interface WorkosDirectoryDisposition {
  userDigest: string;
  status: "mapped" | "quarantined" | "unresolved";
  reasonCode: string | null;
}

export interface IdentityBackfillPlan {
  entries: BackfillPlanEntry[];
  findings: BackfillFinding[];
  workosDirectoryComplete: boolean;
  workosDispositions: WorkosDirectoryDisposition[];
  inventoryFingerprint: string;
}

export function cutoverInventoryStatus(
  plan: IdentityBackfillPlan,
): "inventory" | "ready" {
  return plan.workosDirectoryComplete &&
    plan.findings.length === 0 &&
    plan.workosDispositions.every((entry) => entry.status === "mapped")
    ? "ready"
    : "inventory";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function attribute(user: UserType, name: string): string | undefined {
  return user.Attributes?.find((entry) => entry.Name === name)?.Value;
}

export function parseCognitoInventoryUser(
  user: UserType,
): CognitoInventoryUser | null {
  const sub = attribute(user, "sub");
  if (!user.Username || !sub) return null;
  const rawIdentities = attribute(user, "identities");
  let identities: CognitoProviderIdentity[] = [];
  if (rawIdentities) {
    try {
      const parsed = JSON.parse(rawIdentities) as unknown;
      if (Array.isArray(parsed)) {
        identities = parsed.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const value = entry as Record<string, unknown>;
          if (
            typeof value.providerName !== "string" ||
            typeof value.userId !== "string"
          ) {
            return [];
          }
          return [
            {
              providerName: value.providerName,
              providerType:
                typeof value.providerType === "string"
                  ? value.providerType
                  : undefined,
              issuer:
                typeof value.issuer === "string" ? value.issuer : undefined,
              userId: value.userId,
              primary:
                typeof value.primary === "boolean" ? value.primary : undefined,
            },
          ];
        });
      }
    } catch {
      // Malformed evidence is handled as an ambiguous quarantine below.
      identities = [
        {
          providerName: "__malformed__",
          userId: digest(rawIdentities),
        },
      ];
    }
  }
  return { username: user.Username, sub, identities };
}

export function buildIdentityBackfillPlan(args: {
  databaseUsers: DatabaseIdentityUser[];
  cognitoUsers: CognitoInventoryUser[];
  connections: BackfillConnection[];
  cognitoIssuer: string;
  workosDirectoryUsers?: WorkosDirectoryUser[];
  workosSessionBindings?: WorkosSessionBinding[];
  workosDirectoryComplete?: boolean;
}): IdentityBackfillPlan {
  const entries: BackfillPlanEntry[] = [];
  const findings: BackfillFinding[] = [];
  const databaseBySub = new Map<string, DatabaseIdentityUser[]>();
  for (const user of args.databaseUsers) {
    databaseBySub.set(user.cognitoSub, [
      ...(databaseBySub.get(user.cognitoSub) ?? []),
      user,
    ]);
  }
  const cognitoBySub = new Map(
    args.cognitoUsers.map((user) => [user.sub, user]),
  );
  const workosBridgeSubjects = new Set(
    (args.workosSessionBindings ?? []).map((binding) => binding.cognitoSub),
  );

  for (const cognitoUser of args.cognitoUsers) {
    const matches = databaseBySub.get(cognitoUser.sub) ?? [];
    if (matches.length !== 1) {
      findings.push({
        subjectDigest: digest(cognitoUser.sub),
        reasonCode:
          matches.length === 0
            ? "cognito_user_unbound"
            : "duplicate_database_sub",
      });
      continue;
    }
    const databaseUser = matches[0]!;
    if (!databaseUser.tenantId) {
      findings.push({
        subjectDigest: digest(cognitoUser.sub),
        reasonCode: "database_user_missing_tenant",
      });
      continue;
    }

    if (cognitoUser.identities.length > 1) {
      entries.push({
        userId: databaseUser.id,
        tenantId: databaseUser.tenantId,
        authProviderResourceId: null,
        cognitoIssuer: args.cognitoIssuer,
        cognitoSub: cognitoUser.sub,
        providerIssuer: args.cognitoIssuer,
        providerSubject: cognitoUser.sub,
        providerKind: "ambiguous",
        proofKind: "cognito_inventory_ambiguous",
        status: "quarantined",
        reasonCode: "multiple_provider_identities",
      });
      continue;
    }

    if (cognitoUser.identities.length === 0) {
      if (workosBridgeSubjects.has(cognitoUser.sub)) {
        entries.push({
          userId: databaseUser.id,
          tenantId: databaseUser.tenantId,
          authProviderResourceId: null,
          cognitoIssuer: args.cognitoIssuer,
          cognitoSub: cognitoUser.sub,
          providerIssuer: args.cognitoIssuer,
          providerSubject: cognitoUser.sub,
          providerKind: "legacy_workos",
          proofKind: "workos_bridge_inventory_only",
          status: "quarantined",
          reasonCode: "legacy_workos_requires_native_proof",
        });
        continue;
      }
      const local = args.connections.find(
        (connection) => connection.providerKind === "local",
      );
      entries.push({
        userId: databaseUser.id,
        tenantId: databaseUser.tenantId,
        authProviderResourceId: local?.id ?? null,
        cognitoIssuer: args.cognitoIssuer,
        cognitoSub: cognitoUser.sub,
        providerIssuer: args.cognitoIssuer,
        providerSubject: cognitoUser.sub,
        providerKind: "local",
        proofKind: local
          ? "cognito_inventory_exact"
          : "cognito_inventory_missing_connection",
        status: local ? "active" : "quarantined",
        reasonCode: local ? null : "local_connection_missing",
      });
      continue;
    }

    const providerIdentity = cognitoUser.identities[0]!;
    const connection = args.connections.find(
      (candidate) =>
        candidate.cognitoIdentityProviderName === providerIdentity.providerName,
    );
    entries.push({
      userId: databaseUser.id,
      tenantId: databaseUser.tenantId,
      authProviderResourceId: connection?.id ?? null,
      cognitoIssuer: args.cognitoIssuer,
      cognitoSub: cognitoUser.sub,
      providerIssuer:
        providerIdentity.issuer ?? connection?.issuerUrl ?? args.cognitoIssuer,
      providerSubject: providerIdentity.userId,
      providerKind: connection?.providerKind ?? "unknown",
      proofKind: connection
        ? "cognito_inventory_exact"
        : "cognito_inventory_missing_connection",
      status: connection ? "active" : "quarantined",
      reasonCode: connection ? null : "provider_connection_missing",
    });
  }

  for (const databaseUser of args.databaseUsers) {
    if (cognitoBySub.has(databaseUser.cognitoSub)) continue;
    if (!databaseUser.tenantId) {
      findings.push({
        subjectDigest: digest(databaseUser.cognitoSub),
        reasonCode: "database_user_missing_tenant_and_cognito_profile",
      });
      continue;
    }
    entries.push({
      userId: databaseUser.id,
      tenantId: databaseUser.tenantId,
      authProviderResourceId: null,
      cognitoIssuer: args.cognitoIssuer,
      cognitoSub: databaseUser.cognitoSub,
      providerIssuer: args.cognitoIssuer,
      providerSubject: databaseUser.cognitoSub,
      providerKind: "legacy_unknown",
      proofKind: "database_compatibility_only",
      status: "quarantined",
      reasonCode: "cognito_profile_missing",
    });
  }

  entries.sort((a, b) => a.cognitoSub.localeCompare(b.cognitoSub));
  findings.sort((a, b) => a.subjectDigest.localeCompare(b.subjectDigest));
  const entryBySub = new Map(entries.map((entry) => [entry.cognitoSub, entry]));
  const bindingsByWorkosUser = new Map<string, Set<string>>();
  for (const binding of args.workosSessionBindings ?? []) {
    const subjects =
      bindingsByWorkosUser.get(binding.workosUserId) ?? new Set();
    subjects.add(binding.cognitoSub);
    bindingsByWorkosUser.set(binding.workosUserId, subjects);
  }
  const workosDispositions = (args.workosDirectoryUsers ?? [])
    .map((user): WorkosDirectoryDisposition => {
      const subjects = [...(bindingsByWorkosUser.get(user.id) ?? [])];
      if (subjects.length === 0) {
        return {
          userDigest: digest(user.id),
          status: "unresolved",
          reasonCode: "workos_directory_user_without_session_binding",
        };
      }
      if (subjects.length !== 1) {
        return {
          userDigest: digest(user.id),
          status: "unresolved",
          reasonCode: "workos_directory_user_ambiguous_session_binding",
        };
      }
      const entry = entryBySub.get(subjects[0]!);
      if (!entry) {
        return {
          userDigest: digest(user.id),
          status: "unresolved",
          reasonCode: "workos_session_subject_missing_inventory_entry",
        };
      }
      return {
        userDigest: digest(user.id),
        status: entry.status === "active" ? "mapped" : "quarantined",
        reasonCode: entry.reasonCode,
      };
    })
    .sort((a, b) => a.userDigest.localeCompare(b.userDigest));
  const inventoryFingerprint = digest(
    JSON.stringify({
      entries: entries.map((entry) => ({
        subjectDigest: digest(entry.cognitoSub),
        providerKind: entry.providerKind,
        status: entry.status,
        reasonCode: entry.reasonCode,
      })),
      findings,
      workosDirectoryComplete: args.workosDirectoryComplete === true,
      workosDispositions,
    }),
  );
  return {
    entries,
    findings,
    workosDirectoryComplete: args.workosDirectoryComplete === true,
    workosDispositions,
    inventoryFingerprint,
  };
}

export async function listEveryWorkosUser(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkosDirectoryUser[]> {
  const users: WorkosDirectoryUser[] = [];
  let after: string | undefined;
  do {
    const url = new URL("https://api.workos.com/user_management/users");
    url.searchParams.set("limit", "100");
    url.searchParams.set("order", "asc");
    if (after) url.searchParams.set("after", after);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `WorkOS user inventory failed with HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
      list_metadata?: { after?: unknown };
    };
    if (!Array.isArray(payload.data)) {
      throw new Error("WorkOS user inventory returned an invalid data list");
    }
    for (const user of payload.data) {
      if (typeof user.id !== "string" || user.id.length === 0) {
        throw new Error("WorkOS user inventory returned a user without an id");
      }
      users.push({ id: user.id });
    }
    after =
      typeof payload.list_metadata?.after === "string" &&
      payload.list_metadata.after.length > 0
        ? payload.list_metadata.after
        : undefined;
  } while (after);
  return users;
}

async function loadWorkosSessionBindings(): Promise<WorkosSessionBinding[]> {
  const result = await db.execute<{
    workos_user_id: string;
    cognito_principal_id: string;
  }>(sql`
    SELECT DISTINCT workos_user_id, cognito_principal_id
    FROM public.workos_auth_sessions
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{ workos_user_id: string; cognito_principal_id: string }>;
      }
    ).rows ?? [];
  return rows.map((row) => ({
    workosUserId: row.workos_user_id,
    cognitoSub: row.cognito_principal_id,
  }));
}

async function listEveryCognitoUser(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<CognitoInventoryUser[]> {
  const result: CognitoInventoryUser[] = [];
  let paginationToken: string | undefined;
  do {
    const page = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
      }),
    );
    for (const user of page.Users ?? []) {
      const parsed = parseCognitoInventoryUser(user);
      if (parsed) result.push(parsed);
    }
    paginationToken = page.PaginationToken;
  } while (paginationToken);
  return result;
}

async function main(): Promise<void> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const region = process.env.AWS_REGION;
  const stage = process.env.THINKWORK_STAGE;
  if (!userPoolId || !region || !stage) {
    throw new Error(
      "COGNITO_USER_POOL_ID, AWS_REGION, and THINKWORK_STAGE are required",
    );
  }
  const apply = process.argv.includes("--apply");
  const workosApiKey = process.env.WORKOS_API_KEY;
  if (apply && !workosApiKey) {
    throw new Error(
      "WORKOS_API_KEY is required with --apply so the inventory includes users absent from local sessions",
    );
  }
  const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const [
    databaseRows,
    connectionRows,
    cognitoUsers,
    workosDirectoryUsers,
    workosSessionBindings,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        tenantId: users.tenant_id,
        cognitoSub: users.cognito_sub,
      })
      .from(users),
    db
      .select({
        id: authProviderResources.id,
        connectionKey: authProviderResources.connection_key,
        providerKind: authProviderResources.provider_kind,
        cognitoIdentityProviderName:
          authProviderResources.cognito_identity_provider_name,
        issuerUrl: authProviderResources.issuer_url,
      })
      .from(authProviderResources),
    listEveryCognitoUser(
      new CognitoIdentityProviderClient({ region }),
      userPoolId,
    ),
    workosApiKey ? listEveryWorkosUser(workosApiKey) : Promise.resolve([]),
    workosApiKey ? loadWorkosSessionBindings() : Promise.resolve([]),
  ]);
  const databaseUsers = databaseRows.flatMap((row) =>
    row.cognitoSub
      ? [{ id: row.id, tenantId: row.tenantId, cognitoSub: row.cognitoSub }]
      : [],
  );
  const plan = buildIdentityBackfillPlan({
    databaseUsers,
    cognitoUsers,
    connections: connectionRows,
    cognitoIssuer,
    workosDirectoryUsers,
    workosSessionBindings,
    workosDirectoryComplete: Boolean(workosApiKey),
  });

  if (apply) {
    await db.transaction(async (tx) => {
      await tx
        .insert(authCutoverRuns)
        .values({
          stage,
          inventory_fingerprint: plan.inventoryFingerprint,
          status: cutoverInventoryStatus(plan),
          terminal_dispositions: {
            active: plan.entries.filter((entry) => entry.status === "active")
              .length,
            quarantined: plan.entries.filter(
              (entry) => entry.status === "quarantined",
            ).length,
            findings: plan.findings,
            workosDirectoryComplete: plan.workosDirectoryComplete,
            workosMapped: plan.workosDispositions.filter(
              (entry) => entry.status === "mapped",
            ).length,
            workosQuarantined: plan.workosDispositions.filter(
              (entry) => entry.status === "quarantined",
            ).length,
            workosUnresolved: plan.workosDispositions.filter(
              (entry) => entry.status === "unresolved",
            ).length,
            workosFindings: plan.workosDispositions.filter(
              (entry) => entry.status !== "mapped",
            ),
          },
        })
        .onConflictDoNothing();

      for (const entry of plan.entries) {
        const [existingIdentity] = await tx
          .select({
            id: userAuthIdentities.id,
            tenantId: userAuthIdentities.tenant_id,
            userId: userAuthIdentities.user_id,
            authProviderResourceId:
              userAuthIdentities.auth_provider_resource_id,
            providerIssuer: userAuthIdentities.provider_issuer,
            providerSubject: userAuthIdentities.provider_subject,
            status: userAuthIdentities.status,
          })
          .from(userAuthIdentities)
          .where(
            sql`${userAuthIdentities.cognito_issuer} = ${entry.cognitoIssuer} AND ${userAuthIdentities.cognito_sub} = ${entry.cognitoSub}`,
          )
          .limit(1);
        if (existingIdentity) {
          if (
            existingIdentity.tenantId !== entry.tenantId ||
            existingIdentity.userId !== entry.userId ||
            existingIdentity.authProviderResourceId !==
              entry.authProviderResourceId ||
            existingIdentity.providerIssuer !== entry.providerIssuer ||
            existingIdentity.providerSubject !== entry.providerSubject ||
            existingIdentity.status !== entry.status
          ) {
            throw new Error(
              `Existing identity ${existingIdentity.id} conflicts with the reviewed inventory plan`,
            );
          }
          continue;
        }
        const [identity] = await tx
          .insert(userAuthIdentities)
          .values({
            tenant_id: entry.tenantId,
            user_id: entry.userId,
            auth_provider_resource_id: entry.authProviderResourceId,
            cognito_issuer: entry.cognitoIssuer,
            cognito_sub: entry.cognitoSub,
            provider_issuer: entry.providerIssuer,
            provider_subject: entry.providerSubject,
            status: entry.status,
            proof_kind: entry.proofKind,
            evidence: {
              source: "cognito_inventory",
              inventoryFingerprint: plan.inventoryFingerprint,
              reasonCode: entry.reasonCode,
            },
            activated_at: entry.status === "active" ? new Date() : null,
            quarantined_at: entry.status === "quarantined" ? new Date() : null,
          })
          .returning({ id: userAuthIdentities.id });
        if (!identity) {
          throw new Error("Identity backfill insert returned no identity id");
        }
        await emitAuthControlEvent(tx, {
          tenantId: entry.tenantId,
          actorId: "cognito-auth-identity-backfill",
          eventType:
            entry.status === "active"
              ? "auth.identity_backfilled"
              : "auth.identity_quarantined",
          resourceType: "user_auth_identity",
          resourceId: identity.id,
          action: "backfill",
          outcome: entry.status,
          payload: {
            userId: entry.userId,
            identityId: identity.id,
            providerKind: entry.providerKind,
            proofKind: entry.proofKind,
            status: entry.status,
            reasonCode: entry.reasonCode,
            outcome: entry.status,
          },
        });
      }
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        inventoryFingerprint: plan.inventoryFingerprint,
        cognitoUsers: cognitoUsers.length,
        databaseUsers: databaseUsers.length,
        active: plan.entries.filter((entry) => entry.status === "active")
          .length,
        quarantined: plan.entries.filter(
          (entry) => entry.status === "quarantined",
        ).length,
        unresolved: plan.findings.length,
        workosDirectoryComplete: plan.workosDirectoryComplete,
        workosDirectoryUsers: plan.workosDispositions.length,
        workosMapped: plan.workosDispositions.filter(
          (entry) => entry.status === "mapped",
        ).length,
        workosQuarantined: plan.workosDispositions.filter(
          (entry) => entry.status === "quarantined",
        ).length,
        workosUnresolved: plan.workosDispositions.filter(
          (entry) => entry.status === "unresolved",
        ).length,
      },
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Cognito identity backfill failed: ${message}\n`);
    process.exitCode = 1;
  });
}
