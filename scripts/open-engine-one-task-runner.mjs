#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_AGENT_ID = "codex";
const DEFAULT_QUEUE_KEY = "codex";
const DEFAULT_LEASE_SECONDS = 30 * 60;
const DEFAULT_MAX_DOCS = 5;
const DEFAULT_MAX_STANDING_CONTEXT_DOCS = 5;
const DEFAULT_RECEIPT_LIMIT = 25;

export class OpenEngineMcpClient {
  #nextId = 1;

  constructor(config) {
    this.endpoint = config.endpoint;
    this.bearer = config.bearer;
    this.tenantId = config.tenantId ?? null;
    this.agentHeader = config.agentHeader ?? null;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result.tools ?? [];
  }

  async callTool(name, args = {}) {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return result.structuredContent ?? result.content?.[0]?.text ?? result;
  }

  async request(method, params) {
    if (!this.fetchImpl) {
      throw new Error("global fetch is unavailable; use Node 22+");
    }
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.#nextId++,
        method,
        params,
      }),
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`OpenEngine MCP returned non-JSON response: ${text}`);
    }
    if (!response.ok) {
      throw new Error(
        `OpenEngine MCP HTTP ${response.status}: ${body.error ?? text}`,
      );
    }
    if (body.error) {
      throw new Error(body.error.message ?? JSON.stringify(body.error));
    }
    return body.result ?? {};
  }

  headers() {
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${this.bearer}`,
    };
    if (this.tenantId) headers["x-tenant-id"] = this.tenantId;
    if (this.agentHeader) headers["x-agent-id"] = this.agentHeader;
    return headers;
  }
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    mode: env.OPEN_ENGINE_RUNNER_MODE ?? "verify",
    endpoint: env.OPEN_ENGINE_MCP_URL,
    bearer: env.OPEN_ENGINE_BEARER,
    tenantId: env.THINKWORK_TENANT_ID,
    agentId: env.OPEN_ENGINE_AGENT_ID ?? DEFAULT_AGENT_ID,
    queueKey: env.OPEN_ENGINE_QUEUE_KEY ?? DEFAULT_QUEUE_KEY,
    spaceId: env.OPEN_ENGINE_SPACE_ID,
    labelSlugs: splitList(env.OPEN_ENGINE_LABEL_SLUGS),
    standingContextWorkItemId: env.OPEN_ENGINE_STANDING_CONTEXT_WORK_ITEM_ID,
    standingContextDocumentIds: splitList(
      env.OPEN_ENGINE_STANDING_CONTEXT_DOCUMENT_IDS,
    ),
    routingMapDocumentId: env.OPEN_ENGINE_ROUTING_MAP_DOCUMENT_ID,
    skillDirectoryDocumentId: env.OPEN_ENGINE_SKILL_DIRECTORY_DOCUMENT_ID,
    leaseSeconds: numberOrDefault(
      env.OPEN_ENGINE_LEASE_SECONDS,
      DEFAULT_LEASE_SECONDS,
    ),
    maxDocs: numberOrDefault(env.OPEN_ENGINE_MAX_DOCS, DEFAULT_MAX_DOCS),
    maxStandingContextDocs: numberOrDefault(
      env.OPEN_ENGINE_MAX_STANDING_CONTEXT_DOCS,
      DEFAULT_MAX_STANDING_CONTEXT_DOCS,
    ),
    receiptLimit: numberOrDefault(
      env.OPEN_ENGINE_RECEIPT_LIMIT,
      DEFAULT_RECEIPT_LIMIT,
    ),
    promptFile: env.OPEN_ENGINE_PROMPT_FILE,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    const [key, inlineValue] = arg.startsWith("--")
      ? arg.slice(2).split("=", 2)
      : [null, null];
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = inlineValue ?? argv[++index];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    switch (key) {
      case "mode":
        options.mode = value;
        break;
      case "endpoint":
        options.endpoint = value;
        break;
      case "bearer":
        options.bearer = value;
        break;
      case "tenant-id":
        options.tenantId = value;
        break;
      case "agent":
      case "agent-id":
        options.agentId = value;
        break;
      case "queue":
      case "queue-key":
        options.queueKey = value;
        break;
      case "space-id":
        options.spaceId = value;
        break;
      case "label":
      case "label-slugs":
        options.labelSlugs = [...options.labelSlugs, ...splitList(value)];
        break;
      case "standing-context-work-item":
      case "standing-context-work-item-id":
        options.standingContextWorkItemId = value;
        break;
      case "standing-context-document":
      case "standing-context-document-id":
      case "standing-context-document-ids":
        options.standingContextDocumentIds = [
          ...options.standingContextDocumentIds,
          ...splitList(value),
        ];
        break;
      case "routing-map-document":
      case "routing-map-document-id":
        options.routingMapDocumentId = value;
        break;
      case "skill-directory-document":
      case "skill-directory-document-id":
        options.skillDirectoryDocumentId = value;
        break;
      case "lease-seconds":
        options.leaseSeconds = numberOrDefault(value, DEFAULT_LEASE_SECONDS);
        break;
      case "max-docs":
        options.maxDocs = numberOrDefault(value, DEFAULT_MAX_DOCS);
        break;
      case "max-standing-context-docs":
        options.maxStandingContextDocs = numberOrDefault(
          value,
          DEFAULT_MAX_STANDING_CONTEXT_DOCS,
        );
        break;
      case "receipt-limit":
        options.receiptLimit = numberOrDefault(value, DEFAULT_RECEIPT_LIMIT);
        break;
      case "prompt-file":
        options.promptFile = value;
        break;
      default:
        throw new Error(`Unknown argument: --${key}`);
    }
  }

  options.mode = normalizeMode(options.mode);
  options.labelSlugs = [...new Set(options.labelSlugs)];
  options.standingContextDocumentIds = [
    ...new Set(options.standingContextDocumentIds),
  ];
  return options;
}

export function validateConfig(config) {
  const missing = [];
  if (!config.endpoint) missing.push("OPEN_ENGINE_MCP_URL or --endpoint");
  if (!config.bearer) missing.push("OPEN_ENGINE_BEARER or --bearer");
  if (!config.agentId) missing.push("OPEN_ENGINE_AGENT_ID or --agent");
  if (!config.queueKey) missing.push("OPEN_ENGINE_QUEUE_KEY or --queue");
  if (missing.length > 0) {
    throw new Error(`Missing OpenEngine runner config: ${missing.join(", ")}`);
  }
}

export async function runOpenEngineOneTask(input) {
  const now = input.now ?? new Date();
  const config = input.config;
  validateConfig(config);
  const client =
    input.client ??
    new OpenEngineMcpClient({
      endpoint: config.endpoint,
      bearer: config.bearer,
      tenantId: config.tenantId,
      agentHeader: config.agentId,
      fetchImpl: input.fetchImpl,
    });

  const tools = await client.listTools();
  const toolNames = tools.map((tool) => tool.name).filter(Boolean);
  requireTools(toolNames, ["open_engine_verify_connection"]);

  const verify = await client.callTool("open_engine_verify_connection", {
    agentId: config.agentId,
    queueKey: config.queueKey,
    limit: 25,
  });
  if (verify.agentResolution && verify.agentResolution !== "resolved") {
    throw new Error(
      `OpenEngine agent identity did not resolve: ${verify.agentResolution}`,
    );
  }

  if (config.mode === "verify") {
    return {
      status: "verified",
      toolCount: toolNames.length,
      verify,
      standingContext: describeStandingContextConfig(config),
    };
  }

  requireTools(toolNames, [
    "open_engine_queue_snapshot",
    "open_engine_list_work_items",
    "open_engine_claim_next",
    "open_engine_get_context",
    "open_engine_list_documents",
    "open_engine_fetch_document",
    "open_engine_update_status_ledger",
  ]);

  const standingContext = await fetchStandingContext(client, config);
  const queueArgs = queueScopeArgs(config);
  const snapshot = await client.callTool("open_engine_queue_snapshot", {
    ...queueArgs,
    agentId: config.agentId,
    limit: 100,
  });
  const list = await client.callTool("open_engine_list_work_items", {
    ...queueArgs,
    agentId: config.agentId,
    limit: 5,
  });
  if ((list.workItems ?? []).length === 0) {
    return {
      status: "no_work",
      verify,
      standingContext,
      snapshot: snapshot.snapshot ?? snapshot,
      workItems: [],
    };
  }

  const claim = await client.callTool("open_engine_claim_next", {
    ...queueArgs,
    agentId: config.agentId,
    leaseSeconds: config.leaseSeconds,
    message: `AGENT CLAIMED: ${config.agentId} claimed one Work Item through the one-task runner.`,
  });
  if (!claim.claimed) {
    return {
      status: "no_work",
      verify,
      standingContext,
      snapshot: snapshot.snapshot ?? snapshot,
      workItems: list.workItems ?? [],
      claim,
    };
  }

  const workItemId = claim.claimed.id;
  const context =
    claim.context ??
    (await client.callTool("open_engine_get_context", {
      workItemId,
      receiptLimit: config.receiptLimit,
    }));
  const documentIndex = await client.callTool("open_engine_list_documents", {
    workItemId,
    limit: Math.max(config.maxDocs, 1),
  });
  const documents = await fetchDocumentsProgressively(
    client,
    documentIndex.documents ?? [],
    config.maxDocs,
  );

  const prompt = buildCodexOneTaskPrompt({
    config,
    now,
    claim,
    context,
    documents,
    standingContext,
  });
  const ledger = await client.callTool("open_engine_update_status_ledger", {
    workItemId,
    agentId: config.agentId,
    status: "checking",
    message:
      "AGENT STATUS: one-task runner claimed the item and prepared a Codex execution prompt.",
    queueResult: {
      runner: "open-engine-one-task-runner",
      mode: config.mode,
      queueKey: config.queueKey,
      documentCount: documents.length,
      standingContext: {
        configured: standingContext.configured,
        workItemId: standingContext.workItemId ?? null,
        documentCount: standingContext.documents.length,
        roles: standingContext.documents.map(
          (document) => document.standingContextRole ?? "standing_context",
        ),
      },
      promptReady: true,
    },
    idempotencyKey: `open-engine-one-task-runner:${workItemId}:${config.agentId}:checking`,
  });

  if (config.promptFile) {
    await writeFile(config.promptFile, prompt, "utf8");
  }

  return {
    status: "claimed",
    verify,
    snapshot: snapshot.snapshot ?? snapshot,
    listedWorkItems: list.workItems ?? [],
    claim,
    context,
    documents,
    standingContext,
    ledger,
    prompt,
  };
}

export function buildCodexOneTaskPrompt(input) {
  const workItem = input.claim.claimed;
  const contextWorkItem = input.context.workItem ?? workItem;
  const queue = input.context.queue ?? workItem.openEngine ?? {};
  const documentSummaries = input.documents
    .map((doc, index) => formatDocumentForPrompt(doc, index + 1))
    .join("\n\n");
  const standingContext = input.standingContext ?? {
    configured: false,
    documents: [],
  };

  return `Use the ThinkWork OpenEngine MCP runtime queue for exactly one claimed Work Item.

Runtime:
- MCP endpoint: ${input.config.endpoint}
- Agent identity: ${input.config.agentId}
- Queue key: ${input.config.queueKey}
- Claimed Work Item: ${workItem.id}
- Title: ${workItem.title}
- Claim expires at: ${queue.claimExpiresAt ?? "unknown"}

Rules:
1. Do not use Linear as the runtime queue.
2. Do not claim another Work Item in this run.
3. Treat the Standing context section as the cold-start contract before acting.
4. Fetch additional context only through ThinkWork OpenEngine MCP tools.
5. Execute only the scoped Work Item.
6. Record durable evidence before stopping.
7. Stop after this one Work Item.

Standing context contract:
- Review standing context, routing maps, and optional skill directory material before task work.
- Use the routing map for handoffs; if a target queue or owner is not configured, record a human hold or blocker with the exact missing setup.
- Optional skills are discoverable context, not automatic installs.
- Install or update optional skills only when they are subscribed/approved for the same scope.
- For scope expansion or declined optional skills, record explicit evidence with \`skill_subscribed\`, \`skill_installed\`, \`skill_updated\`, or \`skill_declined\` receipts as appropriate.

Required first MCP calls:
1. Call \`open_engine_verify_connection\` with \`agentId: "${input.config.agentId}"\` and \`queueKey: "${input.config.queueKey}"\`.
2. Review the standing context fetched by the runner; if more standing context is needed, fetch it through \`open_engine_get_context\` and \`open_engine_fetch_document\` before task work.
3. Call \`open_engine_get_context\` for \`${workItem.id}\`.
4. Fetch only the task documents you need with \`open_engine_fetch_document\`.
5. Call \`open_engine_update_status_ledger\` with status \`checking\` before work begins.

Completion paths:
- If complete with no human review needed, call \`open_engine_update_state\` with state \`done\`, a clear AGENT DONE message, and verification evidence.
- If complete but review/approval is needed, call \`open_engine_update_state\` with state \`review\`.
- If blocked on a Work Item answer, ask one specific question and call \`open_engine_update_state\` with state \`blocked\`.
- If blocked on a human/app-side answer, call \`open_engine_update_state\` with state \`human_hold\`.
- If execution fails unexpectedly, call \`open_engine_update_state\` with state \`failed\`, including the last safe step and error.

Context snapshot:
${formatJsonForPrompt({
  workItem: contextWorkItem,
  queue,
  labels: input.context.labels ?? [],
  recentReceipts: input.context.receipts ?? [],
})}

Standing context:
${formatStandingContextForPrompt(standingContext)}

Fetched documents:
${documentSummaries || "No documents were fetched by the runner."}
`;
}

function formatDocumentForPrompt(document, index) {
  const title = document.title ?? document.id;
  const role = document.standingContextRole
    ? `\n   Role: ${document.standingContextRole}`
    : "";
  if (document.content == null) {
    return `${index}. ${title}\n   Document ID: ${document.id}${role}\n   Content unavailable inline; fetch or download through OpenEngine if needed.`;
  }
  return `${index}. ${title}\n   Document ID: ${document.id}${role}\n\n${document.content}`;
}

async function fetchStandingContext(client, config) {
  const directSources = standingContextDocumentSources(config);
  const configured = Boolean(
    config.standingContextWorkItemId || directSources.length > 0,
  );
  const result = {
    configured,
    workItemId: config.standingContextWorkItemId ?? null,
    context: null,
    documents: [],
  };
  if (!configured) return result;

  if (config.standingContextWorkItemId) {
    result.context = await client.callTool("open_engine_get_context", {
      workItemId: config.standingContextWorkItemId,
      receiptLimit: Math.min(
        config.receiptLimit ?? DEFAULT_RECEIPT_LIMIT,
        10,
      ),
    });
    const documentIndex = await client.callTool("open_engine_list_documents", {
      workItemId: config.standingContextWorkItemId,
      limit: Math.max(
        config.maxStandingContextDocs ?? DEFAULT_MAX_STANDING_CONTEXT_DOCS,
        1,
      ),
    });
    const documents = await fetchDocumentsProgressively(
      client,
      documentIndex.documents ?? [],
      config.maxStandingContextDocs ?? DEFAULT_MAX_STANDING_CONTEXT_DOCS,
    );
    result.documents.push(
      ...documents.map((document) => ({
        ...document,
        standingContextRole: "standing_context",
      })),
    );
  }

  for (const source of directSources) {
    const fetched = await client.callTool("open_engine_fetch_document", {
      documentId: source.documentId,
    });
    result.documents.push({
      ...(fetched.document ?? { id: source.documentId }),
      standingContextRole: source.role,
    });
  }

  return result;
}

async function fetchDocumentsProgressively(client, documents, maxDocs) {
  const fetched = [];
  for (const doc of documents) {
    if (fetched.length >= maxDocs) break;
    if (doc.binary || doc.previewAvailable === false) {
      fetched.push(doc);
      continue;
    }
    const result = await client.callTool("open_engine_fetch_document", {
      documentId: doc.id,
    });
    fetched.push(result.document ?? doc);
  }
  return fetched;
}

function standingContextDocumentSources(config) {
  const sources = [
    ...(config.standingContextDocumentIds ?? []).map((documentId) => ({
      documentId,
      role: "standing_context",
    })),
    ...(config.routingMapDocumentId
      ? [
          {
            documentId: config.routingMapDocumentId,
            role: "routing_map",
          },
        ]
      : []),
    ...(config.skillDirectoryDocumentId
      ? [
          {
            documentId: config.skillDirectoryDocumentId,
            role: "skill_directory",
          },
        ]
      : []),
  ];
  const seen = new Set();
  return sources.filter((source) => {
    if (seen.has(source.documentId)) return false;
    seen.add(source.documentId);
    return true;
  });
}

function describeStandingContextConfig(config) {
  return {
    configured: Boolean(
      config.standingContextWorkItemId ||
        standingContextDocumentSources(config).length > 0,
    ),
    workItemId: config.standingContextWorkItemId ?? null,
    documentSources: standingContextDocumentSources(config),
  };
}

function queueScopeArgs(config) {
  return {
    queueKey: config.queueKey,
    ...(config.spaceId ? { spaceId: config.spaceId } : {}),
    ...(config.labelSlugs.length > 0 ? { labelSlugs: config.labelSlugs } : {}),
  };
}

function requireTools(toolNames, names) {
  const missing = names.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`OpenEngine MCP is missing tools: ${missing.join(", ")}`);
  }
}

function formatStandingContextForPrompt(standingContext) {
  if (!standingContext.configured) {
    return "No standing context sources were configured for this run.";
  }
  const contextSummary = standingContext.context
    ? formatJsonForPrompt({
        workItem: standingContext.context.workItem ?? null,
        labels: standingContext.context.labels ?? [],
        queue: standingContext.context.queue ?? null,
      })
    : "No standing context Work Item was configured.";
  const documents = standingContext.documents
    .map((document, index) => formatDocumentForPrompt(document, index + 1))
    .join("\n\n");
  return `Standing context Work Item: ${standingContext.workItemId ?? "none"}

Standing context snapshot:
${contextSummary}

Standing context documents:
${documents || "No standing context documents were fetched."}`;
}

function normalizeMode(value) {
  const mode = String(value ?? "verify")
    .trim()
    .toLowerCase();
  if (mode === "verify" || mode === "prepare") return mode;
  throw new Error("OpenEngine runner mode must be 'verify' or 'prepare'");
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.trunc(number);
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatJsonForPrompt(value) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export function helpText() {
  return `Usage:
  OPEN_ENGINE_MCP_URL=... OPEN_ENGINE_BEARER=... THINKWORK_TENANT_ID=... \\
    node scripts/open-engine-one-task-runner.mjs --mode verify

  OPEN_ENGINE_MCP_URL=... OPEN_ENGINE_BEARER=... THINKWORK_TENANT_ID=... \\
    node scripts/open-engine-one-task-runner.mjs --mode prepare --prompt-file /tmp/open-engine-task.md

Options:
  --mode verify|prepare      verify only, or claim one item and emit a prompt
  --endpoint URL             /mcp/open-engine endpoint
  --bearer TOKEN             bearer token, preferably via env
  --tenant-id UUID           tenant header for service bearer auth
  --agent codex              ThinkWork agent UUID/slug/name/workspace folder
  --queue codex              OpenEngine queue key
  --label slug[,slug]        optional label filters
  --space-id UUID            optional Space filter
  --standing-context-work-item-id UUID
                            Work Item that holds standing context documents
  --standing-context-document ID
                            standing context document ID; repeatable or comma-separated
  --routing-map-document ID  routing/owner map document ID
  --skill-directory-document ID
                            optional skills directory document ID
  --max-standing-context-docs N
                            max docs fetched from standing context Work Item
  --prompt-file PATH         write the generated Codex prompt to a file
  --json                     print JSON instead of the human summary
`;
}

function printHumanSummary(result) {
  if (result.status === "verified") {
    console.log(
      `OpenEngine verified for ${result.verify.agent?.slug ?? "agent"} on queue ${result.verify.queue?.key ?? "default"}.`,
    );
    return;
  }
  if (result.status === "no_work") {
    console.log("OpenEngine verified; no eligible Work Items found.");
    return;
  }
  console.log(
    `Claimed ${result.claim.claimed.id}: ${result.claim.claimed.title}`,
  );
  if (result.ledger?.document?.id) {
    console.log(`Updated status ledger document ${result.ledger.document.id}.`);
  }
  if (result.prompt) {
    console.log("\n--- Codex one-task prompt ---\n");
    console.log(result.prompt);
  }
}

async function main() {
  const config = parseArgs();
  if (config.help) {
    console.log(helpText());
    return;
  }
  const result = await runOpenEngineOneTask({ config });
  if (config.json) {
    console.log(JSON.stringify(redactResult(result), null, 2));
  } else {
    printHumanSummary(result);
  }
}

function redactResult(value) {
  return JSON.parse(
    JSON.stringify(value, (key, child) =>
      key.toLowerCase().includes("bearer") ? "[redacted]" : child,
    ),
  );
}

function isMain(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
