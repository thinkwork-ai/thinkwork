import pg from "pg";
import { S3Client } from "@aws-sdk/client-s3";

import {
  CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
  CUSTOMER_ONBOARDING_CHECKLIST_KEY,
  CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES,
  CUSTOMER_ONBOARDING_SPACE_PROMPT,
  CUSTOMER_ONBOARDING_SPACE_SLUG,
  buildCustomerOnboardingChecklistConfig,
  buildCustomerOnboardingSpaceConfig,
  buildLastMileIntegrationConfig,
  parseRoleAssigneesJson,
} from "../packages/api/src/lib/spaces/customer-onboarding-seed.js";
import { ensureCustomerOnboardingSourceFiles } from "../packages/api/src/lib/spaces/customer-onboarding-source-files.js";

const { Pool } = pg;

const CUSTOMER_ONBOARDING_DEMO_SPACE_ID =
  "0b640386-05d7-4dbb-9585-e4c0b8c03f5f";

interface SeedOptions {
  tenantId: string;
  spaceId: string | null;
  ownerUserId: string | null;
  memberUserIds: string[];
  roleAssigneesJson: string | null;
  lastMileProjectId: string | null;
  lastMileWebhookConfigRef: string | null;
  writebackPolicy: "disabled" | "status_only" | "status_and_comments";
  includeLastMileIntegration: boolean;
  writeSpaceFiles: boolean;
  workspaceBucket: string | null;
  dryRun: boolean;
}

interface SeedSummary {
  tenantId: string;
  spaceId: string | null;
  checklistTemplateId: string | null;
  memberCount: number;
  checklistItemCount: number;
  spaceFileCount: number;
  spaceFilesWritten: boolean;
  nativeChecklist: {
    systemOfRecord: "thinkwork";
    requiredItemCount: number;
    conditionalItemKeys: string[];
    sourceFiles: string[];
    folderStructureIncludesIntakeDoc: boolean;
    folderStructureExpandsSkills: boolean;
  };
  includeLastMileIntegration: boolean;
  writebackPolicy: string;
  dryRun: boolean;
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  const roleAssignees = parseRoleAssigneesJson(options.roleAssigneesJson);
  const spaceConfig = buildCustomerOnboardingSpaceConfig({ roleAssignees });
  const checklistConfig = buildCustomerOnboardingChecklistConfig();
  const integrationConfig = buildLastMileIntegrationConfig({
    roleAssignees,
    externalProjectId: options.lastMileProjectId,
  });
  const configuredMemberUserIds = unique([
    ...options.memberUserIds,
    ...(options.ownerUserId ? [options.ownerUserId] : []),
  ]);

  if (options.dryRun) {
    printSummary({
      tenantId: options.tenantId,
      spaceId: options.spaceId,
      checklistTemplateId: null,
      memberCount: configuredMemberUserIds.length,
      checklistItemCount: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.length,
      spaceFileCount: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.length,
      spaceFilesWritten: false,
      nativeChecklist: nativeChecklistSummary(),
      includeLastMileIntegration: options.includeLastMileIntegration,
      writebackPolicy: options.writebackPolicy,
      dryRun: true,
    });
    console.log(
      JSON.stringify(
        {
          demoSpaceId: CUSTOMER_ONBOARDING_DEMO_SPACE_ID,
          space: {
            slug: CUSTOMER_ONBOARDING_SPACE_SLUG,
            prompt: CUSTOMER_ONBOARDING_SPACE_PROMPT,
            config: spaceConfig,
          },
          checklist: {
            key: CUSTOMER_ONBOARDING_CHECKLIST_KEY,
            config: checklistConfig,
            items: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
          },
          spaceFiles: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.map((file) => ({
            path: file.path,
            bytes: Buffer.byteLength(file.content, "utf8"),
          })),
          integration: options.includeLastMileIntegration
            ? {
                provider: "lastmile_tasks",
                writebackPolicy: options.writebackPolicy,
                config: integrationConfig,
              }
            : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  const databaseUrl = env("DATABASE_URL", process.env);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query<{ id: string }>(
      "SELECT id FROM tenants WHERE id = $1",
      [options.tenantId],
    );
    if (tenant.rowCount === 0) {
      throw new Error(`tenant not found: ${options.tenantId}`);
    }

    const memberUserIds =
      configuredMemberUserIds.length > 0
        ? configuredMemberUserIds
        : await listTenantUserIds(client, options.tenantId);

    const spaceId = await upsertSpace(client, options, spaceConfig);
    const checklistTemplateId = await upsertChecklistTemplate(
      client,
      options,
      spaceId,
      checklistConfig,
    );
    await upsertChecklistItems(client, options, spaceId, checklistTemplateId);
    if (options.includeLastMileIntegration) {
      await upsertIntegration(client, options, spaceId, integrationConfig);
    }
    await upsertMembers(client, options, spaceId, memberUserIds);
    const tenantSlug = await resolveTenantSlug(client, options.tenantId);

    await client.query("COMMIT");
    if (options.writeSpaceFiles) {
      await writeSpaceSourceFiles({
        bucket: options.workspaceBucket ?? env("WORKSPACE_BUCKET", process.env),
        tenantSlug,
        spaceSlug: CUSTOMER_ONBOARDING_SPACE_SLUG,
      });
    }
    printSummary({
      tenantId: options.tenantId,
      spaceId,
      checklistTemplateId,
      memberCount: memberUserIds.length,
      checklistItemCount: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.length,
      spaceFileCount: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.length,
      spaceFilesWritten: options.writeSpaceFiles,
      nativeChecklist: nativeChecklistSummary(),
      includeLastMileIntegration: options.includeLastMileIntegration,
      writebackPolicy: options.writebackPolicy,
      dryRun: false,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function parseArgs(args: string[], envVars: NodeJS.ProcessEnv): SeedOptions {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  const booleanFlags = new Set([
    "--dry-run",
    "--include-lastmile-integration",
    "--write-space-files",
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (booleanFlags.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`missing value for ${arg}`);
    }
    values.set(arg, [...(values.get(arg) ?? []), next]);
    i++;
  }

  const writebackPolicy =
    first(values, "--writeback-policy") ??
    envVars.LASTMILE_WRITEBACK_POLICY ??
    "disabled";
  if (
    writebackPolicy !== "disabled" &&
    writebackPolicy !== "status_only" &&
    writebackPolicy !== "status_and_comments"
  ) {
    throw new Error(
      "writeback policy must be disabled, status_only, or status_and_comments",
    );
  }

  return {
    tenantId: first(values, "--tenant-id") ?? env("TENANT_ID", envVars),
    ownerUserId:
      first(values, "--owner-user-id") ?? envVars.OWNER_USER_ID ?? null,
    spaceId: first(values, "--space-id") ?? envVars.SPACE_ID ?? null,
    memberUserIds: [
      ...many(values, "--member-user-id"),
      ...csv(envVars.MEMBER_USER_IDS),
    ],
    roleAssigneesJson:
      first(values, "--role-assignees-json") ??
      envVars.ROLE_ASSIGNEES_JSON ??
      null,
    lastMileProjectId:
      first(values, "--lastmile-project-id") ??
      envVars.LASTMILE_PROJECT_ID ??
      null,
    lastMileWebhookConfigRef:
      first(values, "--lastmile-webhook-config-ref") ??
      envVars.LASTMILE_WEBHOOK_CONFIG_REF ??
      null,
    writebackPolicy,
    includeLastMileIntegration:
      flags.has("--include-lastmile-integration") ||
      envVars.INCLUDE_LASTMILE_INTEGRATION === "true",
    writeSpaceFiles:
      flags.has("--write-space-files") || envVars.WRITE_SPACE_FILES === "true",
    workspaceBucket:
      first(values, "--workspace-bucket") ?? envVars.WORKSPACE_BUCKET ?? null,
    dryRun: flags.has("--dry-run"),
  };
}

function nativeChecklistSummary(): SeedSummary["nativeChecklist"] {
  const contextFile =
    CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.find(
      (file) => file.path === "CONTEXT.md",
    )?.content ?? "";
  return {
    systemOfRecord: "thinkwork",
    requiredItemCount: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.filter(
      (item) => item.required,
    ).length,
    conditionalItemKeys: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.filter(
      (item) => item.checklistTemplate.applicability !== "always",
    ).map((item) => item.key),
    sourceFiles: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.map(
      (file) => file.path,
    ),
    folderStructureIncludesIntakeDoc: contextFile.includes(
      "docs/customer-onboarding-intake.md",
    ),
    folderStructureExpandsSkills: /^\s*(?:[|` -]+)?skills\//im.test(
      contextFile,
    ),
  };
}

async function listTenantUserIds(client: pg.PoolClient, tenantId: string) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at",
    [tenantId],
  );
  return result.rows.map((row) => row.id);
}

async function upsertSpace(
  client: pg.PoolClient,
  options: SeedOptions,
  config: Record<string, unknown>,
) {
  if (options.spaceId) {
    const result = await client.query<{ id: string }>(
      `
        UPDATE spaces
        SET
          slug = $3,
          name = 'Customer Onboarding',
          description = $4,
          prompt = $5,
          status = 'active',
          kind = 'customer_onboarding',
          template_key = 'customer_onboarding',
          config = $6::jsonb,
          updated_at = now()
        WHERE tenant_id = $1 AND id = $2
        RETURNING id
      `,
      [
        options.tenantId,
        options.spaceId,
        CUSTOMER_ONBOARDING_SPACE_SLUG,
        "Customer onboarding cases, native checklist coordination, and ThinkWork Thread collaboration.",
        CUSTOMER_ONBOARDING_SPACE_PROMPT,
        JSON.stringify(config),
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`space not found: ${options.spaceId}`);
    return id;
  }

  const result = await client.query<{ id: string }>(
    `
      INSERT INTO spaces (
        tenant_id, slug, name, description, prompt, status, kind, template_key, config
      )
      VALUES ($1, $2, 'Customer Onboarding', $3, $4, 'active', 'customer_onboarding', 'customer_onboarding', $5::jsonb)
      ON CONFLICT (tenant_id, slug)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        prompt = EXCLUDED.prompt,
        status = 'active',
        kind = EXCLUDED.kind,
        template_key = EXCLUDED.template_key,
        config = EXCLUDED.config,
        updated_at = now()
      RETURNING id
    `,
    [
      options.tenantId,
      CUSTOMER_ONBOARDING_SPACE_SLUG,
      "Customer onboarding cases, native checklist coordination, and ThinkWork Thread collaboration.",
      CUSTOMER_ONBOARDING_SPACE_PROMPT,
      JSON.stringify(config),
    ],
  );
  return result.rows[0].id;
}

async function upsertChecklistTemplate(
  client: pg.PoolClient,
  options: SeedOptions,
  spaceId: string,
  config: Record<string, unknown>,
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO space_checklist_templates (
        tenant_id, space_id, key, name, description, config
      )
      VALUES ($1, $2, $3, 'Customer Onboarding v1', $4, $5::jsonb)
      ON CONFLICT (tenant_id, space_id, key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        config = EXCLUDED.config,
        updated_at = now()
      RETURNING id
    `,
    [
      options.tenantId,
      spaceId,
      CUSTOMER_ONBOARDING_CHECKLIST_KEY,
      "Required ThinkWork checklist items created when a customer onboarding Thread starts.",
      JSON.stringify(config),
    ],
  );
  return result.rows[0].id;
}

async function upsertChecklistItems(
  client: pg.PoolClient,
  options: SeedOptions,
  spaceId: string,
  templateId: string,
) {
  for (const item of CUSTOMER_ONBOARDING_CHECKLIST_ITEMS) {
    await client.query(
      `
        INSERT INTO space_checklist_items (
          tenant_id, space_id, template_id, key, title, description, role_key,
          required, sort_order, external_task_template
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT (tenant_id, template_id, key)
        DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          role_key = EXCLUDED.role_key,
          required = EXCLUDED.required,
          sort_order = EXCLUDED.sort_order,
          external_task_template = EXCLUDED.external_task_template,
          updated_at = now()
      `,
      [
        options.tenantId,
        spaceId,
        templateId,
        item.key,
        item.title,
        item.description,
        item.roleKey,
        item.required,
        item.sortOrder,
        JSON.stringify(item.checklistTemplate),
      ],
    );
  }
}

async function upsertIntegration(
  client: pg.PoolClient,
  options: SeedOptions,
  spaceId: string,
  config: Record<string, unknown>,
) {
  await client.query(
    `
      INSERT INTO space_integrations (
        tenant_id, space_id, provider, status, writeback_policy, config, webhook_config_ref
      )
      VALUES ($1, $2, 'lastmile_tasks', 'active', $3, $4::jsonb, $5)
      ON CONFLICT (tenant_id, space_id, provider)
      DO UPDATE SET
        status = 'active',
        writeback_policy = EXCLUDED.writeback_policy,
        config = EXCLUDED.config,
        webhook_config_ref = EXCLUDED.webhook_config_ref,
        updated_at = now()
    `,
    [
      options.tenantId,
      spaceId,
      options.writebackPolicy,
      JSON.stringify(config),
      options.lastMileWebhookConfigRef,
    ],
  );
}

async function upsertMembers(
  client: pg.PoolClient,
  options: SeedOptions,
  spaceId: string,
  userIds: string[],
) {
  for (const userId of userIds) {
    await client.query(
      `
        INSERT INTO space_members (
          tenant_id, space_id, user_id, role, notification_preference
        )
        VALUES ($1, $2, $3, $4, 'subscribed')
        ON CONFLICT (tenant_id, space_id, user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          notification_preference = EXCLUDED.notification_preference,
          updated_at = now()
      `,
      [
        options.tenantId,
        spaceId,
        userId,
        userId === options.ownerUserId ? "owner" : "member",
      ],
    );
  }
}

async function resolveTenantSlug(client: pg.PoolClient, tenantId: string) {
  const result = await client.query<{ slug: string }>(
    "SELECT slug FROM tenants WHERE id = $1",
    [tenantId],
  );
  const slug = result.rows[0]?.slug;
  if (!slug) throw new Error(`tenant slug not found: ${tenantId}`);
  return slug;
}

async function writeSpaceSourceFiles(input: {
  bucket: string;
  tenantSlug: string;
  spaceSlug: string;
}) {
  const s3Client = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  const result = await ensureCustomerOnboardingSourceFiles({
    bucket: input.bucket,
    tenantSlug: input.tenantSlug,
    spaceSlug: input.spaceSlug,
    overwrite: true,
    s3Client,
  });
  console.log(
    `[customer-onboarding-seed] wrote ${result.written.length}/${result.total} Space source file(s) to ${result.targetPrefix}`,
  );
}

function printSummary(summary: SeedSummary) {
  console.log(JSON.stringify(summary, null, 2));
}

function env(name: string, envVars: NodeJS.ProcessEnv) {
  const value = envVars[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function first(values: Map<string, string[]>, key: string) {
  return values.get(key)?.[0];
}

function many(values: Map<string, string[]>, key: string) {
  return values.get(key) ?? [];
}

function csv(value: string | undefined) {
  return value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
