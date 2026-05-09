#!/usr/bin/env node
/**
 * Smoke test the deployed Computer surface APIs used by apps/computer.
 *
 * This complements the live streaming smoke. It exercises the non-streaming
 * surfaces that make the UI useful after a turn completes:
 *   1. myComputer discovery resolves the caller's Computer,
 *   2. the Computer thread table can load real threads,
 *   3. a Computer approval can be created, listed, loaded, then cancelled,
 *   4. the Memory panel can query user-scoped memory records, and
 *   5. browser automation evidence events are observable when present.
 *
 * Required env:
 *   DATABASE_URL
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   VITE_GRAPHQL_API_KEY, APPSYNC_API_KEY, or GRAPHQL_API_KEY
 *
 * Optional:
 *   SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, SMOKE_USER_ID
 *   SMOKE_REQUIRE_BROWSER_EVIDENCE=1
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL;
const apiUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiKey = first(
  env.VITE_GRAPHQL_API_KEY,
  env.APPSYNC_API_KEY,
  env.GRAPHQL_API_KEY,
);
const requireBrowserEvidence = env.SMOKE_REQUIRE_BROWSER_EVIDENCE === "1";

if (!databaseUrl) fail("Missing DATABASE_URL.");
if (!apiUrl || !apiKey) {
  fail(
    "Missing GraphQL HTTP config. Set VITE_GRAPHQL_HTTP_URL and VITE_GRAPHQL_API_KEY.",
  );
}

const identity = resolveComputerIdentity(env);
let createdApprovalId = null;

try {
  const result = await runSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  if (createdApprovalId) {
    await cancelApproval(createdApprovalId).catch((error) => {
      console.error(
        `WARN: failed to cancel smoke approval ${createdApprovalId}: ${error.message}`,
      );
    });
  }
}

async function runSmoke() {
  const computer = await verifyMyComputer();
  const threads = await verifyThreadTable();
  const approval = await verifyApprovalRoundTrip();
  const memory = await verifyMemoryRecords();
  const browserEvidence = verifyBrowserEvidence();

  if (requireBrowserEvidence && browserEvidence.recentEventCount === 0) {
    fail(
      "No recent browser automation evidence events found. Disable SMOKE_REQUIRE_BROWSER_EVIDENCE or run a browser-backed Computer turn first.",
    );
  }

  return {
    tenantId: identity.tenantId,
    computerId: identity.computerId,
    userId: identity.userId,
    computer,
    threads,
    approval,
    memory,
    browserEvidence,
  };
}

async function verifyMyComputer() {
  const data = await gql(
    `
      query MyComputer {
        myComputer {
          id
          name
          tenantId
          ownerUserId
        }
      }
    `,
    {},
  );
  const computer = data.myComputer;
  if (!computer?.id) fail("myComputer returned no Computer.");
  if (computer.id !== identity.computerId) {
    fail(
      `myComputer returned ${computer.id}, expected ${identity.computerId}.`,
    );
  }
  if (computer.ownerUserId !== identity.userId) {
    fail(
      `myComputer ownerUserId was ${computer.ownerUserId}, expected ${identity.userId}.`,
    );
  }
  return {
    id: computer.id,
    name: computer.name,
    tenantId: computer.tenantId,
    ownerUserId: computer.ownerUserId,
  };
}

async function verifyThreadTable() {
  const data = await gql(
    `
      query ThreadsPaged($tenantId: ID!, $limit: Int, $offset: Int) {
        threadsPaged(tenantId: $tenantId, limit: $limit, offset: $offset) {
          totalCount
          items {
            id
            title
            computerId
            channel
            lifecycleStatus
          }
        }
      }
    `,
    {
      tenantId: identity.tenantId,
      limit: 5,
      offset: 0,
    },
  );
  const page = data.threadsPaged;
  if (!page || !Array.isArray(page.items)) {
    fail("threadsPaged did not return an item array.");
  }
  return {
    totalCount: page.totalCount,
    sampledCount: page.items.length,
    hasComputerThread: page.items.some(
      (thread) => thread.computerId === identity.computerId,
    ),
  };
}

async function verifyApprovalRoundTrip() {
  const title = `Computer smoke approval ${new Date().toISOString()}`;
  const config = {
    question: "Smoke approval: allow Computer to inspect the prepared draft?",
    action_type: "email_send",
    actionDescription: "Send a prepared smoke-test email draft.",
    emailDraft: {
      to: "smoke@example.com",
      subject: "Computer smoke approval",
      body: "This approval is created and cancelled by scripts/smoke-computer.sh.",
    },
  };

  const created = await gql(
    `
      mutation CreateSmokeApproval($input: CreateInboxItemInput!) {
        createInboxItem(input: $input) {
          id
          type
          status
          title
          config
        }
      }
    `,
    {
      input: {
        tenantId: identity.tenantId,
        requesterType: "computer",
        requesterId: identity.computerId,
        recipientId: identity.userId,
        type: "computer_approval",
        title,
        description: "Temporary deployed smoke approval.",
        entityType: "computer",
        entityId: identity.computerId,
        config: JSON.stringify(config),
      },
    },
  );

  const approval = created.createInboxItem;
  if (!approval?.id) fail("createInboxItem returned no approval id.");
  createdApprovalId = approval.id;
  if (approval.type !== "computer_approval") {
    fail(`Created approval had wrong type: ${approval.type}`);
  }
  if (approval.status !== "PENDING") {
    fail(`Created approval had wrong status: ${approval.status}`);
  }

  const listed = await gql(
    `
      query PendingApprovals($tenantId: ID!, $recipientId: ID!) {
        inboxItems(
          tenantId: $tenantId
          status: PENDING
          recipientId: $recipientId
        ) {
          id
          type
          status
          title
          config
        }
      }
    `,
    {
      tenantId: identity.tenantId,
      recipientId: identity.userId,
    },
  );
  const listedApproval = listed.inboxItems?.find(
    (item) => item.id === createdApprovalId,
  );
  if (!listedApproval) {
    fail(
      `Created approval ${createdApprovalId} was not returned by inboxItems.`,
    );
  }

  const detail = await gql(
    `
      query ApprovalDetail($id: ID!) {
        inboxItem(id: $id) {
          id
          type
          status
          title
          config
        }
      }
    `,
    { id: createdApprovalId },
  );
  if (detail.inboxItem?.id !== createdApprovalId) {
    fail(`inboxItem did not return created approval ${createdApprovalId}.`);
  }

  const cancelled = await cancelApproval(createdApprovalId);
  createdApprovalId = null;
  if (cancelled.status !== "CANCELLED") {
    fail(`cancelInboxItem returned ${cancelled.status}, expected CANCELLED.`);
  }

  return {
    id: cancelled.id,
    listed: true,
    detailLoaded: true,
    finalStatus: cancelled.status,
  };
}

async function cancelApproval(id) {
  const data = await gql(
    `
      mutation CancelSmokeApproval($id: ID!) {
        cancelInboxItem(id: $id) {
          id
          status
        }
      }
    `,
    { id },
  );
  return data.cancelInboxItem;
}

async function verifyMemoryRecords() {
  const namespace = `user_${identity.userId}`;
  const data = await gql(
    `
      query ComputerMemoryRecords(
        $tenantId: ID!
        $userId: ID!
        $namespace: String!
      ) {
        memoryRecords(
          tenantId: $tenantId
          userId: $userId
          namespace: $namespace
        ) {
          memoryRecordId
          namespace
          factType
          confidence
          content {
            text
          }
        }
      }
    `,
    {
      tenantId: identity.tenantId,
      userId: identity.userId,
      namespace,
    },
  );
  if (!Array.isArray(data.memoryRecords)) {
    fail("memoryRecords did not return an array.");
  }
  return {
    namespace,
    count: data.memoryRecords.length,
    sampleIds: data.memoryRecords
      .slice(0, 3)
      .map((record) => record.memoryRecordId),
  };
}

function verifyBrowserEvidence() {
  const recentEventCount = Number(
    psql(`
      select count(*)
      from computer_events
      where tenant_id = ${sqlLiteral(identity.tenantId)}::uuid
        and computer_id = ${sqlLiteral(identity.computerId)}::uuid
        and event_type like 'browser_automation_%'
        and created_at > now() - interval '7 days'
    `) || "0",
  );
  return {
    recentEventCount,
    required: requireBrowserEvidence,
  };
}

async function gql(query, variables) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-tenant-id": identity.tenantId,
      "x-principal-id": identity.userId,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    fail(`GraphQL HTTP ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    fail(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

function resolveComputerIdentity(source) {
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    computerId: first(source.SMOKE_COMPUTER_ID, source.COMPUTER_ID),
    userId: first(source.SMOKE_USER_ID, source.USER_ID),
  };
  if (supplied.tenantId && supplied.computerId && supplied.userId) {
    return supplied;
  }

  const row = psql(`
    select c.tenant_id::text || '|' || c.id::text || '|' || c.owner_user_id::text
    from computers c
    where c.owner_user_id is not null
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1
  `);
  const [tenantId, computerId, userId] = row.split("|");
  if (!tenantId || !computerId || !userId) {
    fail(
      "Could not resolve a Computer identity. Set SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, and SMOKE_USER_ID.",
    );
  }
  return { tenantId, computerId, userId };
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function loadEnvFile() {
  const configured = process.env.COMPUTER_ENV_FILE;
  if (configured === "none") return {};

  const envFile = configured || path.join("apps", "computer", ".env");
  if (!fs.existsSync(envFile)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 0) return [line, ""];
        return [line.slice(0, index), unquote(line.slice(index + 1))];
      }),
  );
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function first(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
