/**
 * Analyst run_query in-loop cap + sandbox result-landing (THINK-228 U6).
 *
 * KTD3: the per-delegation query cap lives HERE, in the delegation loop,
 * in-process — no counter store, no run-id injection. The host-side loop
 * counts `run_query` invocations per child session in memory and, once
 * the cap is reached, refuses further calls; the runner then forces the
 * delegation to end with a structured `Verdict: fail`. The model cannot
 * mask or bypass it because the loop, not the model, owns the count —
 * the R6 verbatim-error self-repair loop still counts every attempt.
 *
 * KTD2 file facet (R7/AE2): when a run_query envelope carries a
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

import { getMcpAgentToolIdentity } from "./mcp.js";

export const ANALYST_QUERY_TOOL_NAME = "run_query";
export const DEFAULT_MAX_QUERIES_PER_RUN = 12;

/** Only keys under this prefix are ever fetched (broker staging area). */
const STAGING_KEY_PREFIX = "analyst-staging/";

export class AnalystQueryCapError extends Error {
  constructor(
    readonly cap: number,
    readonly attempted: number,
  ) {
    super(
      `Query cap reached: this delegation already ran ${cap} run_query ` +
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
 * Land a run_query envelope's staged result into the session data dir and
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

/**
 * Wrap the child tool surface: every MCP `run_query` tool gets (a) the
 * in-loop cap and (b) staged-result landing. Other tools pass through
 * unchanged. Wrapping happens AFTER the childToolSurface allowlist filter,
 * so identity-based filtering has already run.
 */
export function wrapAnalystQueryTools(input: {
  tools: AgentTool<any>[];
  state: AnalystQueryCapState;
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
        input.state.count += 1;
        const result = await tool.execute(toolCallId, params, signal, onUpdate);
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
