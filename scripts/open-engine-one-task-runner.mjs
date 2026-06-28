#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_AGENT_ID = "codex";
const DEFAULT_QUEUE_KEY = "codex";
const DEFAULT_LEASE_SECONDS = 30 * 60;
const DEFAULT_MAX_DOCS = 5;
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
    leaseSeconds: numberOrDefault(
      env.OPEN_ENGINE_LEASE_SECONDS,
      DEFAULT_LEASE_SECONDS,
    ),
    maxDocs: numberOrDefault(env.OPEN_ENGINE_MAX_DOCS, DEFAULT_MAX_DOCS),
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
      case "lease-seconds":
        options.leaseSeconds = numberOrDefault(value, DEFAULT_LEASE_SECONDS);
        break;
      case "max-docs":
        options.maxDocs = numberOrDefault(value, DEFAULT_MAX_DOCS);
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
3. Fetch additional context only through ThinkWork OpenEngine MCP tools.
4. Execute only the scoped Work Item.
5. Record durable evidence before stopping.
6. Stop after this one Work Item.

Required first MCP calls:
1. Call \`open_engine_verify_connection\` with \`agentId: "${input.config.agentId}"\` and \`queueKey: "${input.config.queueKey}"\`.
2. Call \`open_engine_get_context\` for \`${workItem.id}\`.
3. Fetch only the documents you need with \`open_engine_fetch_document\`.
4. Call \`open_engine_update_status_ledger\` with status \`checking\` before work begins.

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

Fetched documents:
${documentSummaries || "No documents were fetched by the runner."}
`;
}

function formatDocumentForPrompt(document, index) {
  const title = document.title ?? document.id;
  if (document.content == null) {
    return `${index}. ${title}\n   Document ID: ${document.id}\n   Content unavailable inline; fetch or download through OpenEngine if needed.`;
  }
  return `${index}. ${title}\n   Document ID: ${document.id}\n\n${document.content}`;
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
