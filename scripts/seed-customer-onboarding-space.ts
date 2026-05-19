import pg from "pg";

import {
  CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
  CUSTOMER_ONBOARDING_CHECKLIST_KEY,
  CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS,
  CUSTOMER_ONBOARDING_SPACE_PROMPT,
  CUSTOMER_ONBOARDING_SPACE_SLUG,
  buildCustomerOnboardingChecklistConfig,
  buildCustomerOnboardingSpaceConfig,
  buildLastMileIntegrationConfig,
  parseRoleAssigneesJson,
} from "../packages/api/src/lib/spaces/customer-onboarding-seed.js";

const { Pool } = pg;

interface SeedOptions {
  tenantId: string;
  coordinatorAgentId: string | null;
  coordinatorAgentSlug: string;
  ownerUserId: string | null;
  memberUserIds: string[];
  roleAssigneesJson: string | null;
  lastMileProjectId: string | null;
  lastMileWebhookConfigRef: string | null;
  writebackPolicy: "disabled" | "status_only" | "status_and_comments";
  dryRun: boolean;
}

interface SeedSummary {
  tenantId: string;
  spaceId: string | null;
  checklistTemplateId: string | null;
  coordinatorAgentId: string | null;
  memberCount: number;
  checklistItemCount: number;
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
      spaceId: null,
      checklistTemplateId: null,
      coordinatorAgentId: options.coordinatorAgentId,
      memberCount: configuredMemberUserIds.length,
      checklistItemCount: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.length,
      writebackPolicy: options.writebackPolicy,
      dryRun: true,
    });
    console.log(
      JSON.stringify(
        {
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
          integration: {
            provider: "lastmile_tasks",
            writebackPolicy: options.writebackPolicy,
            config: integrationConfig,
          },
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

    const coordinatorAgentId =
      options.coordinatorAgentId ??
      (await resolveCoordinatorAgentId(client, options));
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
    await upsertIntegration(client, options, spaceId, integrationConfig);
    await upsertMembers(client, options, spaceId, memberUserIds);
    await upsertCoordinatorAssignment(
      client,
      options,
      spaceId,
      coordinatorAgentId,
    );

    await client.query("COMMIT");
    printSummary({
      tenantId: options.tenantId,
      spaceId,
      checklistTemplateId,
      coordinatorAgentId,
      memberCount: memberUserIds.length,
      checklistItemCount: CUSTOMER_ONBOARDING_CHECKLIST_ITEMS.length,
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
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
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
    "status_only";
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
    coordinatorAgentId:
      first(values, "--coordinator-agent-id") ??
      envVars.COORDINATOR_AGENT_ID ??
      null,
    coordinatorAgentSlug:
      first(values, "--coordinator-agent-slug") ??
      envVars.COORDINATOR_AGENT_SLUG ??
      "coordinator",
    ownerUserId:
      first(values, "--owner-user-id") ?? envVars.OWNER_USER_ID ?? null,
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
    dryRun: flags.has("--dry-run"),
  };
}

async function resolveCoordinatorAgentId(
  client: pg.PoolClient,
  options: SeedOptions,
) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM agents
      WHERE tenant_id = $1 AND slug = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [options.tenantId, options.coordinatorAgentSlug],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(
      `coordinator agent not found; pass --coordinator-agent-id or create agent slug ${options.coordinatorAgentSlug}`,
    );
  }
  return id;
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
      "Closed-won customer onboarding cases, checklist coordination, and LastMile task links.",
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
      "Required onboarding tasks created in LastMile Tasks when a closed-won opportunity starts a Thread.",
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
        JSON.stringify(item.externalTaskTemplate),
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

async function upsertCoordinatorAssignment(
  client: pg.PoolClient,
  options: SeedOptions,
  spaceId: string,
  coordinatorAgentId: string,
) {
  await client.query(
    `
      INSERT INTO space_agent_assignments (
        tenant_id, space_id, agent_id, local_role, local_instructions,
        auto_subscribe, allowed_capabilities, allowed_tools, status
      )
      VALUES ($1, $2, $3, 'coordinator', $4, true, $5::jsonb, $6::jsonb, 'active')
      ON CONFLICT (tenant_id, space_id, agent_id)
      DO UPDATE SET
        local_role = EXCLUDED.local_role,
        local_instructions = EXCLUDED.local_instructions,
        auto_subscribe = EXCLUDED.auto_subscribe,
        allowed_capabilities = EXCLUDED.allowed_capabilities,
        allowed_tools = EXCLUDED.allowed_tools,
        status = 'active',
        updated_at = now()
    `,
    [
      options.tenantId,
      spaceId,
      coordinatorAgentId,
      CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS,
      JSON.stringify(["customer_onboarding", "linked_tasks", "thread_summary"]),
      JSON.stringify(["thread.read", "thread.message", "linked_tasks.read"]),
    ],
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
