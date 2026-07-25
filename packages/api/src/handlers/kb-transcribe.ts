/**
 * kb-transcribe Lambda (KB page transcription U2).
 *
 * Turns one source PDF into one markdown file per page in the workspace
 * bucket, so the manager can ingest page documents whose text actually
 * contains what the page shows. Invoked asynchronously per document by
 * knowledge-base-manager during an s3-connect sync when the source's
 * parsing_strategy is 'TRANSCRIBE'.
 *
 * Why this exists: the platform never sends a parsingConfiguration, so every
 * data source uses Bedrock's default parser, which "only parses text in text
 * files". Scanned pages index as nothing; screenshot-driven SOPs index only
 * their caption lines. Measured on McPherson's CX corpus, 71 of 80 PDFs (89%)
 * keep most of their substance inside images.
 *
 * Pages are read by sending the single-page PDF straight to a Claude vision
 * model as a `document` content block — no rasterizing, no OCR engine, no
 * container image. Conventional OCR was measured against this corpus and
 * produced unusable output on the handwritten pages while reporting itself
 * as FAIR quality, which is why nothing here trusts an OCR confidence score.
 *
 * Idempotent: output is keyed by (document key, etag, preprocessor version),
 * so a re-invocation for unchanged bytes short-circuits on the existing
 * report. retry-0 + DLQ — the next sync IS the retry.
 */

import { PDFDict, PDFName, type PDFPage } from "pdf-lib";
import { getConfig } from "@thinkwork/runtime-config";
import {
  PREPROCESSOR_VERSION,
  derivedPrefix,
  routePage,
  sanitizeForInlineIngestion,
  pageDocumentHeader,
  LOW_SIGNAL_CHAR_THRESHOLD,
  type PageResult,
  type TranscribeReport,
} from "../lib/knowledge/kb-transcribe-report";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";

/** Ordered model ladder. Availability is per-account: the Opus tiers are not
 * enabled on every account, so the worker probes down the ladder and records
 * which model actually ran rather than hard-pinning one. */
function modelLadder(): string[] {
  const configured = process.env.KB_TRANSCRIBE_MODEL_LADDER;
  if (configured?.trim()) {
    return configured
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [
    "us.anthropic.claude-opus-5",
    "us.anthropic.claude-opus-4-8",
    "us.anthropic.claude-sonnet-4-6",
  ];
}

/** Pages transcribed concurrently within one document.
 *
 * Deliberately small. The binding limit is the model's Bedrock
 * requests-per-minute quota, not this Lambda: an account can be provisioned
 * far below the AWS default (McPherson runs at 10 RPM against a 10,000
 * default), and past that ceiling extra width only buys throttle backoff.
 * Total in-flight model calls are this times the function's reserved
 * concurrency. Raise both together, and only with a verified quota. */
const PAGE_CONCURRENCY = Number(process.env.KB_TRANSCRIBE_CONCURRENCY || "2");

const TRANSCRIBE_PROMPT = [
  "Transcribe this page completely and literally into markdown.",
  "Include every handwritten or printed word, numbered steps in their original order,",
  "and any marginal or annotated notes.",
  "For any screenshot, state the screen or window name, the visible field labels and",
  "values, the menu path, and anything highlighted, circled, or arrowed.",
  "Do not summarize, correct, reorder, or infer content that is not visible.",
  "If the page is blank or unreadable, say exactly: (no readable content)",
  "Output only the transcription, with no preamble.",
].join(" ");

export interface KbTranscribeEvent {
  tenantSlug: string;
  knowledgeBaseId: string;
  /** Bucket holding the source document (customer bucket for s3-connect). */
  bucket: string;
  key: string;
  etag: string | null;
  bucketOwnerAccountId?: string | null;
  /** Human title used in each page's header; defaults to the file name. */
  title?: string;
}

export interface KbTranscribeResult {
  status: "ready" | "skipped";
  derivedPrefix: string;
  pageCount: number;
  reason?: string;
}

function workspaceBucket(): string {
  // WORKSPACE_BUCKET lives only in the SSM runtime-config document, not in the
  // Lambda environment — reading process.env for it returns undefined in
  // production. getConfig still prefers env when set, so tests can override.
  const bucket = getConfig("WORKSPACE_BUCKET", "");
  if (!bucket) throw new Error("WORKSPACE_BUCKET is not configured");
  return bucket;
}

function kbServiceRoleArn(): string {
  return process.env.KB_SERVICE_ROLE_ARN || "";
}

/**
 * S3 client for reading source documents. Connected customer buckets are
 * granted to the KB service role only — never to this Lambda's own role — so
 * reads go through an assumed session, the same identity Bedrock ingests
 * with. Falls back to the ambient role when no KB role is configured.
 */
async function sourceS3Client() {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const roleArn = kbServiceRoleArn();
  if (!roleArn) return new S3Client({ region: AWS_REGION });

  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({ region: AWS_REGION });
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: "kb-transcribe-read",
      DurationSeconds: 900,
    }),
  );
  const credentials = assumed.Credentials;
  if (!credentials?.AccessKeyId) {
    throw new Error(`No credentials returned assuming ${roleArn}`);
  }
  return new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: credentials.AccessKeyId,
      secretAccessKey: credentials.SecretAccessKey!,
      sessionToken: credentials.SessionToken!,
    },
  });
}

interface PageSignals {
  /** Native text layer. Empty for image-only pages. */
  text: string;
  /** Images painted on the page. Any image means the page may carry substance
   * the text layer does not — a caption of 400+ characters beside a screenshot
   * still needs the screenshot read. */
  imageCount: number;
}

/**
 * Count image XObjects referenced by a page's resource dictionary.
 *
 * Read from the raw PDF object graph rather than a render pass: rendering
 * needs a canvas, which needs a native module, which does not belong in a
 * bundled Lambda. The counts match a pdf.js operator-list scan on the
 * reference corpus.
 */
function countPageImages(page: PDFPage): number {
  const resources = page.node.Resources();
  if (!resources) return 0;
  const xObjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xObjects) return 0;

  let count = 0;
  for (const [, ref] of xObjects.entries()) {
    const target = page.doc.context.lookup(ref) as
      | { dict?: { get: (key: PDFName) => unknown } }
      | undefined;
    const subtype = target?.dict?.get(PDFName.of("Subtype"));
    if (String(subtype) === "/Image") count++;
  }
  return count;
}

/** Per-page text and image signals, 1-indexed by array position. */
async function extractPageSignals(pdf: Uint8Array): Promise<PageSignals[]> {
  // unpdf is a pdf.js build packaged for serverless: no separate worker
  // module to resolve at runtime, which is what breaks a bundled pdf.js.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const { PDFDocument } = await import("pdf-lib");

  // Both parsers take ownership of the buffer they are handed, so each gets
  // its own copy of the bytes.
  const proxy = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(proxy, { mergePages: false });
  const doc = await PDFDocument.load(new Uint8Array(pdf), {
    ignoreEncryption: true,
  });
  const pages = doc.getPages();

  return pages.map((page, index) => {
    let imageCount: number;
    try {
      imageCount = countPageImages(page);
    } catch (err) {
      // Never let a parse failure decide a page is text-only — routing has to
      // fail toward transcription, not away from it.
      imageCount = 1;
      console.warn(
        `[kb-transcribe] page ${index + 1} image scan failed, assuming images: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    return {
      text: (text[index] ?? "").replace(/\s+/g, " ").trim(),
      imageCount,
    };
  });
}

/** Extract page `n` (1-indexed) as a standalone single-page PDF. */
async function extractPagePdf(pdf: Uint8Array, n: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(source, [n - 1]);
  out.addPage(copied);
  return out.save();
}

/** Bedrock throttles hard when many pages are in flight across concurrent
 * document invocations. A throttle says nothing about the page — retry it. */
function isThrottle(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const message = err instanceof Error ? err.message : String(err);
  return (
    name === "ThrottlingException" ||
    name === "TooManyRequestsException" ||
    name === "ServiceQuotaExceededException" ||
    message.includes("Too many requests")
  );
}

/**
 * Retry a Bedrock call through throttling with exponential backoff and jitter.
 * Jitter matters: without it, every page throttled by the same burst retries
 * in lockstep and re-creates the burst.
 */
async function withThrottleRetry<T>(call: () => Promise<T>): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!isThrottle(err) || attempt >= maxAttempts - 1) throw err;
      const backoff = 2 ** attempt * 1_000 + Math.floor(Math.random() * 1_000);
      // Log every wait: a silent backoff loop is indistinguishable from a hang
      // when a large corpus is being transcribed.
      console.warn(
        `[kb-transcribe] throttled, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

/** The ladder ran out of models this account can call. Transient in the sense
 * that it is fixed by an account change, not by re-reading the page — but
 * retrying is right, because caching a degraded page would hide it. */
function isLadderExhausted(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("No model in the ladder is available") ||
    message.includes("is not available for this account")
  );
}

/** The model this account can actually call, resolved once per container.
 * Held as a promise so concurrent page workers share ONE probe — otherwise
 * every worker re-walks the blocked tiers and burns a round-trip each. */
let modelProbe: Promise<string> | null = null;

/**
 * Send one single-page PDF to Claude as a native document block. Walks the
 * ladder on access errors and caches the first model the account can call.
 */
async function transcribePage(
  pagePdf: Uint8Array,
  nativeText: string,
): Promise<{
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const { BedrockRuntimeClient, InvokeModelCommand } =
    await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({ region: AWS_REGION });

  // The page's own text layer is given to the model as ground truth so that
  // captions and field names are reproduced exactly rather than guessed from
  // the rendering — this is what makes screenshot steps come back verbatim.
  const grounding = nativeText
    ? `\n\nThe page's extracted text layer, which is authoritative for spelling ` +
      `and wording, is:\n${nativeText}`
    : "";

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: Buffer.from(pagePdf).toString("base64"),
            },
          },
          { type: "text", text: TRANSCRIBE_PROMPT + grounding },
        ],
      },
    ],
  });

  const invoke = async (modelId: string) => {
    const response = await withThrottleRetry(() =>
      client.send(new InvokeModelCommand({ modelId, body })),
    );
    const payload = JSON.parse(
      new TextDecoder().decode(response.body as Uint8Array),
    );
    return {
      text: payload.content?.[0]?.text ?? "",
      model: modelId,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  };

  if (modelProbe) return invoke(await modelProbe);

  // First page through: walk the ladder, and let every other worker wait on
  // this same probe rather than repeating it.
  let settle: (modelId: string) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  modelProbe = new Promise<string>((resolvePromise, rejectPromise) => {
    settle = resolvePromise;
    reject = rejectPromise;
  });
  // A rejected probe is awaited by siblings; attach a no-op catch so an
  // unhandled rejection can never take the container down.
  modelProbe.catch(() => {});

  let lastError: unknown;
  for (const modelId of modelLadder()) {
    try {
      const result = await invoke(modelId);
      settle(modelId);
      return result;
    } catch (err) {
      lastError = err;
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message : String(err);
      const unavailable =
        name === "AccessDeniedException" ||
        name === "ValidationException" ||
        name === "ResourceNotFoundException" ||
        message.includes("is not available for this account");
      if (!unavailable) {
        // A transient fault says nothing about availability — clear the probe
        // so the next page retries the ladder from the top.
        modelProbe = null;
        reject(err);
        throw err;
      }
      console.warn(`[kb-transcribe] model ${modelId} unavailable: ${message}`);
    }
  }

  modelProbe = null;
  const exhausted =
    lastError instanceof Error
      ? lastError
      : new Error("No model in the ladder is available for this account");
  reject(exhausted);
  throw exhausted;
}

/** Run `work` over `items` with bounded concurrency, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await work(items[index], index);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
}

export async function handler(
  event: KbTranscribeEvent,
): Promise<KbTranscribeResult> {
  const prefix = derivedPrefix({
    tenantSlug: event.tenantSlug,
    knowledgeBaseId: event.knowledgeBaseId,
    documentKey: event.key,
    etag: event.etag,
  });

  if (!event.key.toLowerCase().endsWith(".pdf")) {
    return {
      status: "skipped",
      derivedPrefix: prefix,
      pageCount: 0,
      reason: "not a PDF",
    };
  }

  const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } =
    await import("@aws-sdk/client-s3");
  const workspace = new S3Client({ region: AWS_REGION });

  // Idempotency: the prefix already encodes etag + pipeline version, so an
  // existing report means these exact bytes were already transcribed.
  try {
    await workspace.send(
      new HeadObjectCommand({
        Bucket: workspaceBucket(),
        Key: `${prefix}/report.json`,
      }),
    );
    console.log(`[kb-transcribe] ${event.key}: already transcribed`);
    const existing = await workspace.send(
      new GetObjectCommand({
        Bucket: workspaceBucket(),
        Key: `${prefix}/report.json`,
      }),
    );
    const report = JSON.parse(
      await existing.Body!.transformToString(),
    ) as TranscribeReport;
    return {
      status: "ready",
      derivedPrefix: prefix,
      pageCount: report.pageCount,
    };
  } catch (err) {
    if ((err as { name?: string })?.name !== "NotFound") {
      // A real S3 error here (403, throttle) should surface, not be swallowed
      // into a redundant re-transcription.
      const name = (err as { name?: string })?.name;
      if (name && name !== "NoSuchKey") {
        console.warn(`[kb-transcribe] report probe: ${name}`);
      }
    }
  }

  const source = await sourceS3Client();
  const object = await source.send(
    new GetObjectCommand({
      Bucket: event.bucket,
      Key: event.key,
      ...(event.bucketOwnerAccountId
        ? { ExpectedBucketOwner: event.bucketOwnerAccountId }
        : {}),
    }),
  );
  const pdf = new Uint8Array(await object.Body!.transformToByteArray());

  const signals = await extractPageSignals(pdf);
  const pageCount = signals.length;
  const title = event.title ?? event.key.split("/").pop() ?? event.key;
  console.log(
    `[kb-transcribe] ${event.key}: ${pageCount} pages, ladder=${modelLadder()[0]}…`,
  );

  // Shared across the concurrent page workers; JS runs them on one thread, so
  // the increments below cannot interleave.
  const tokens = { input: 0, output: 0 };

  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);
  const results = await mapLimit(
    pageNumbers,
    PAGE_CONCURRENCY,
    async (
      page,
    ): Promise<{
      result: PageResult;
      markdown: string;
      retryable: boolean;
    }> => {
      const { text: native, imageCount } = signals[page - 1];
      const route = routePage({ nativeChars: native.length, imageCount });

      let body = native;
      let model: string | null = null;
      let error: string | undefined;
      let retryable = false;

      if (route === "transcribed") {
        try {
          const transcription = await transcribePage(
            await extractPagePdf(pdf, page),
            native,
          );
          model = transcription.model;
          tokens.input += transcription.inputTokens;
          tokens.output += transcription.outputTokens;
          const text = transcription.text.trim();
          // Never let a model's refusal REPLACE text we already had — fall
          // back to the native layer so a bad page degrades, not regresses.
          body = text && text !== "(no readable content)" ? text : native;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          // Throttling and an exhausted model ladder are conditions of the
          // ACCOUNT, not the page — they will pass. A malformed page will not.
          retryable = isThrottle(err) || isLadderExhausted(err);
          console.error(
            `[kb-transcribe] ${event.key} p${page} (${retryable ? "retryable" : "permanent"}): ${error}`,
          );
        }
      }

      const markdown = sanitizeForInlineIngestion(
        pageDocumentHeader({
          title,
          page,
          pageCount,
          transcribed: route === "transcribed" && !!model && !error,
        }) + body,
      );

      return {
        retryable,
        result: {
          page,
          route,
          model,
          nativeChars: native.length,
          imageCount,
          chars: body.length,
          lowSignal: body.trim().length < LOW_SIGNAL_CHAR_THRESHOLD,
          ...(error ? { error } : {}),
        },
        markdown,
      };
    },
  );

  await mapLimit(results, 8, async ({ result, markdown }) =>
    workspace.send(
      new PutObjectCommand({
        Bucket: workspaceBucket(),
        Key: `${prefix}/pages/${result.page}.md`,
        Body: markdown,
        ContentType: "text/markdown",
      }),
    ),
  );

  // A page that failed for a TRANSIENT reason must not be frozen into the
  // report. The report is the idempotency record: writing one now would cache
  // "this page is just its caption line" forever, and no later sync would ever
  // retry it — a momentary throttle would become permanent data loss, visible
  // only as a suspiciously thin page. Fail the invocation instead and let the
  // next sync re-enqueue the whole document (retry-0 + DLQ: the next sync IS
  // the retry). Pages that succeeded are already on disk and short-circuit.
  const transientFailures = results.filter((entry) => entry.retryable);
  if (transientFailures.length > 0) {
    throw new Error(
      `${transientFailures.length}/${pageCount} pages failed to transcribe for ` +
        `${event.key}; not writing a report so the next sync retries. ` +
        `First error: ${transientFailures[0].result.error}`,
    );
  }

  const report: TranscribeReport = {
    preprocessorVersion: PREPROCESSOR_VERSION,
    documentKey: event.key,
    etag: event.etag,
    pageCount,
    pages: results.map((entry) => entry.result),
    needsReview: results.some((entry) => entry.result.lowSignal),
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    completedAt: new Date().toISOString(),
  };

  // report.json is written LAST and is the readiness signal the manager polls
  // — a partially written page set must never look ready.
  await workspace.send(
    new PutObjectCommand({
      Bucket: workspaceBucket(),
      Key: `${prefix}/report.json`,
      Body: JSON.stringify(report, null, 2),
      ContentType: "application/json",
    }),
  );

  console.log(
    `[kb-transcribe] ${event.key}: ${pageCount} pages written to ${prefix} ` +
      `(transcribed=${report.pages.filter((p) => p.route === "transcribed").length} ` +
      `needsReview=${report.needsReview} tokens=${tokens.input}/${tokens.output})`,
  );

  return { status: "ready", derivedPrefix: prefix, pageCount };
}
