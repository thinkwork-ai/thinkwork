/**
 * Analyst query in-loop cap + sandbox result-landing (THINK-228 U6).
 *
 * KTD3: the per-delegation query cap lives HERE, in the delegation loop,
 * in-process — no counter store, no run-id injection. The host-side loop
 * counts `query` invocations per child session in memory and, once
 * the cap is reached, refuses further calls; the runner then forces the
 * delegation to end with a structured `Verdict: fail`. The model cannot
 * mask or bypass it because the loop, not the model, owns the count —
 * the R6 verbatim-error self-repair loop still counts every attempt.
 *
 * KTD2 file facet (R7/AE2): when a query envelope carries a
 * `result_file` S3 reference, the wrapper downloads the staged CSV into
 * the child session's local data directory (mirroring the
 * message-attachment staging pattern) and rewrites the model-visible
 * path, so `execute_code`'s Python can read the full result while raw
 * rows stay out of model context.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { AgentTool } from "@earendil-works/pi-agent-core";

import {
  AnalystCostBudgetError,
  type AnalystCostBudgetState,
} from "./analyst-cost-budget.js";
import { getMcpAgentToolIdentity } from "./mcp.js";

export const ANALYST_QUERY_TOOL_NAME = "query";
export const DEFAULT_MAX_QUERIES_PER_RUN = 12;

/** Only keys under this prefix are ever fetched (broker staging area). */
const STAGING_KEY_PREFIX = "analyst-staging/";

export class AnalystQueryCapError extends Error {
  constructor(
    readonly cap: number,
    readonly attempted: number,
  ) {
    super(
      `Query cap reached: this delegation already ran ${cap} query ` +
        "calls (failed attempts count). No further queries are allowed in " +
        "this run — return your findings from the data you have.",
    );
    this.name = "AnalystQueryCapError";
  }
}

export interface AnalystQueryCapState {
  count: number;
  exceeded: boolean;
  cap: number;
}

export function createAnalystQueryCapState(cap: number): AnalystQueryCapState {
  return { count: 0, exceeded: false, cap };
}

function isRunQueryTool(tool: AgentTool<any>): boolean {
  return getMcpAgentToolIdentity(tool)?.toolName === ANALYST_QUERY_TOOL_NAME;
}

interface TextBlock {
  type: string;
  text?: string;
}

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) return null;
  return { bucket: match[1]!, key: match[2]! };
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const maybe = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybe.transformToByteArray === "function") {
    return Buffer.from(await maybe.transformToByteArray());
  }
  throw new Error("unsupported S3 body stream shape");
}

export interface AnalystResultLandingDeps {
  /** Directory files land in (created on demand). */
  dataDir: string;
  s3Client?: { send: (command: unknown) => Promise<unknown> };
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

async function defaultS3Client(): Promise<{
  send: (command: unknown) => Promise<unknown>;
}> {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  }) as { send: (command: unknown) => Promise<unknown> };
}

/**
 * Land a query envelope's staged result into the session data dir and
 * return the envelope with `result_file` rewritten to the local path.
 * Non-envelope text, envelopes without a result_file, and non-staging
 * keys pass through untouched.
 */
export async function landResultFile(
  text: string,
  deps: AnalystResultLandingDeps,
): Promise<string> {
  let envelope: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return text;
    }
    envelope = parsed as Record<string, unknown>;
  } catch {
    return text;
  }
  if (typeof envelope.result_file !== "string") return text;
  const location = parseS3Uri(envelope.result_file);
  if (!location) return text;
  if (!location.key.includes(STAGING_KEY_PREFIX)) {
    deps.logger?.("analyst_result_file_skipped", {
      reason: "non_staging_key",
      key: location.key,
    });
    return text;
  }

  const s3 = deps.s3Client ?? (await defaultS3Client());
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const object = (await s3.send(
    new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
  )) as { Body?: unknown };
  const body = await bodyToBuffer(object.Body);

  await mkdir(deps.dataDir, { recursive: true });
  const localPath = path.join(deps.dataDir, `${randomUUID()}.csv`);
  await writeFile(localPath, body);
  deps.logger?.("analyst_result_file_landed", {
    key: location.key,
    localPath,
    bytes: body.length,
  });
  return JSON.stringify({ ...envelope, result_file: localPath });
}

/** True when a tool result carries the broker's terminal policy error. */
export function resultCarriesTerminalPolicyError(
  content: Array<{ type: string; text?: string }> | undefined,
): boolean {
  for (const block of content ?? []) {
    if (block.type !== "text" || !block.text) continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as { terminal?: unknown }).terminal === true &&
        (parsed as { stage?: unknown }).stage === "policy"
      ) {
        return true;
      }
    } catch {
      // non-JSON text blocks are envelopes or errors — not terminal.
    }
  }
  return false;
}

/**
 * Read `row_count` and `approx_bytes` from the first envelope-shaped text
 * block of a query result, for the per-run cost accumulator (THINK-232).
 * Missing/non-envelope blocks yield zeros — a query that returns no envelope
 * simply charges nothing.
 */
export function envelopeCostFields(
  content: Array<{ type: string; text?: string }> | undefined,
): { rowCount: number; approxBytes: number } {
  for (const block of content ?? []) {
    if (block.type !== "text" || !block.text) continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.row_count !== "number") continue;
      const rowCount = record.row_count;
      const approxBytes =
        typeof record.approx_bytes === "number" ? record.approx_bytes : 0;
      return { rowCount, approxBytes };
    } catch {
      // non-JSON text blocks are errors, not envelopes — charge nothing.
    }
  }
  return { rowCount: 0, approxBytes: 0 };
}

/**
 * Wrap the child tool surface: every MCP `query` tool gets (a) the
 * in-loop cap, (b) the per-run cost budget (THINK-232), and (c) staged-result
 * landing. Other tools pass through unchanged. Wrapping happens AFTER the
 * childToolSurface allowlist filter, so identity-based filtering has already
 * run.
 */
export function wrapAnalystQueryTools(input: {
  tools: AgentTool<any>[];
  state: AnalystQueryCapState;
  /** THINK-232: per-run dollar accumulator. Inert when no budget is set. */
  costBudget?: AnalystCostBudgetState;
  landing: AnalystResultLandingDeps;
}): AgentTool<any>[] {
  return input.tools.map((tool) => {
    if (!isRunQueryTool(tool)) return tool;
    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        if (input.state.count >= input.state.cap) {
          input.state.exceeded = true;
          throw new AnalystQueryCapError(
            input.state.cap,
            input.state.count + 1,
          );
        }
        // THINK-232: once the accumulated DB cost has crossed the budget,
        // fail the NEXT query fast — same mechanism as the query cap. The
        // loop, not the model, owns the verdict.
        if (input.costBudget?.exceeded) {
          throw new AnalystCostBudgetError(
            input.costBudget.budgetUsd ?? 0,
            input.costBudget.spentUsd,
          );
        }
        input.state.count += 1;
        const result = await tool.execute(toolCallId, params, signal, onUpdate);
        // THINK-232: charge this query's DB cost from the envelope's
        // row_count + approx_bytes. Crossing the budget flips `exceeded`
        // so the NEXT query fast-fails above.
        if (input.costBudget) {
          const { rowCount, approxBytes } = envelopeCostFields(result.content);
          input.costBudget.addQueryCost(rowCount, approxBytes);
        }
        // THINK-229 U4 (R14): a terminal policy error from the broker
        // (budget exhausted / withheld) must not be retried — flip the
        // cap state to exceeded so every further query in this run
        // refuses in-loop, exactly like the per-run cap. The model still
        // sees the broker's anti-fabrication text from THIS result.
        if (resultCarriesTerminalPolicyError(result.content)) {
          input.state.exceeded = true;
        }
        const content = await Promise.all(
          (result.content ?? []).map(async (block) => {
            const text = (block as TextBlock).text;
            if ((block as TextBlock).type !== "text" || !text) return block;
            try {
              return {
                ...block,
                text: await landResultFile(text, input.landing),
              };
            } catch (err) {
              input.landing.logger?.("analyst_result_file_landing_failed", {
                error: err instanceof Error ? err.message : String(err),
              });
              return block;
            }
          }),
        );
        return { ...result, content };
      },
    } satisfies AgentTool<any>;
  });
}
