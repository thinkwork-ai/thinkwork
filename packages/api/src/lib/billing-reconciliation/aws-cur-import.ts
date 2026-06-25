import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";

export interface CurManifestLocation {
  bucket: string;
  key: string;
}

export interface CurManifestDataFile {
  bucket: string;
  key: string;
}

export interface ParsedCurManifest {
  bucket: string;
  key: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dataFiles: CurManifestDataFile[];
  raw: Record<string, unknown>;
}

export interface CurCsvParseError {
  rowNumber: number;
  message: string;
  raw: Record<string, string>;
}

export interface CurCsvParseResult {
  rows: CurRow[];
  errors: CurCsvParseError[];
}

export interface CurRow {
  rowNumber: number;
  raw: Record<string, string>;
}

export interface BillingLineItemImportContext {
  provider: string;
  importId: string;
  manifestBucket: string;
  manifestKey: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
}

export interface NormalizedBillingLineItem {
  importId: string;
  provider: string;
  tenantId: string | null;
  lineItemId: string;
  usageAccountId: string | null;
  serviceCode: string;
  operation: string;
  lineItemType: string | null;
  usageStart: string;
  usageEnd: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amountUsd: number;
  usageAmount: number | null;
  currency: string;
  model: string;
  region: string | null;
  resourceId: string | null;
  attributionLevel: "tenant" | "account" | "service_window";
  attributionKey: string;
  sourceUri: string;
  raw: Record<string, string>;
}

export interface LoadedCurExport {
  manifest: ParsedCurManifest;
  rows: CurRow[];
  errors: CurCsvParseError[];
  lineItems: NormalizedBillingLineItem[];
}

export interface CurS3ClientLike {
  send(command: GetObjectCommand): Promise<{ Body?: unknown }>;
}

const s3 = new S3Client({});

export function parseCurManifest(
  body: string,
  location: CurManifestLocation,
): ParsedCurManifest {
  const raw = parseJsonObject(body, "CUR manifest");
  const billingPeriod = readRecord(raw.billingPeriod ?? raw.billing_period);
  const start =
    stringValue(billingPeriod.start) ??
    stringValue(raw.billingPeriodStart) ??
    stringValue(raw.billing_period_start);
  const end =
    stringValue(billingPeriod.end) ??
    stringValue(raw.billingPeriodEnd) ??
    stringValue(raw.billing_period_end);
  const billingPeriodStart = isoDate(start, "manifest billing period start");
  const billingPeriodEnd = isoDate(end, "manifest billing period end");

  const dataFiles = extractManifestDataFiles(raw, location.bucket);
  if (dataFiles.length === 0) {
    throw new Error("CUR manifest does not reference any data files");
  }

  return {
    bucket: location.bucket,
    key: location.key,
    billingPeriodStart,
    billingPeriodEnd,
    dataFiles,
    raw,
  };
}

export function parseCurCsv(body: string): CurCsvParseResult {
  const records = parseCsvRecords(body);
  if (records.length === 0) return { rows: [], errors: [] };
  const headers = records[0].map((header) => header.trim());
  const rows: CurRow[] = [];
  const errors: CurCsvParseError[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const values = records[index];
    if (values.length === 1 && values[0].trim() === "") continue;
    const raw: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = values[headerIndex] ?? "";
    });
    const rowNumber = index + 1;
    const validationError = validateCurRow(raw);
    if (validationError) {
      errors.push({ rowNumber, message: validationError, raw });
      continue;
    }
    rows.push({ rowNumber, raw });
  }

  return { rows, errors };
}

export function toBillingLineItems(
  rows: CurRow[],
  context: BillingLineItemImportContext,
): NormalizedBillingLineItem[] {
  return rows.map((row) => {
    const raw = row.raw;
    const serviceCode =
      readColumn(raw, "line_item_product_code", "lineItem/ProductCode") ??
      readColumn(raw, "product_servicecode", "product/servicecode") ??
      "unknown";
    const operation =
      readColumn(raw, "line_item_operation", "lineItem/Operation") ?? "unknown";
    const usageAccountId =
      readColumn(
        raw,
        "line_item_usage_account_id",
        "lineItem/UsageAccountId",
        "bill_payer_account_id",
        "bill/PayerAccountId",
      ) ?? null;
    const tenantId = tenantIdFromRow(raw);
    const model = normalizeModel(
      readColumn(raw, "product_model", "product/model") ??
        readColumn(raw, "product_inference_type", "product/inferenceType") ??
        readColumn(raw, "line_item_usage_type", "lineItem/UsageType") ??
        "unknown",
    );
    const attributionLevel = tenantId
      ? "tenant"
      : usageAccountId
        ? "account"
        : "service_window";
    const attributionKey =
      attributionLevel === "tenant"
        ? tenantId!
        : [
            context.provider,
            usageAccountId ?? "unknown-account",
            serviceCode,
            operation,
            model,
          ].join(":");

    return {
      importId: context.importId,
      provider: context.provider,
      tenantId,
      lineItemId:
        readColumn(raw, "line_item_line_item_id", "lineItem/LineItemId") ??
        `row-${row.rowNumber}`,
      usageAccountId,
      serviceCode,
      operation,
      lineItemType:
        readColumn(raw, "line_item_line_item_type", "lineItem/LineItemType") ??
        null,
      usageStart: isoDate(
        readColumn(
          raw,
          "line_item_usage_start_date",
          "lineItem/UsageStartDate",
        ),
        "usage start",
      ),
      usageEnd: isoDate(
        readColumn(raw, "line_item_usage_end_date", "lineItem/UsageEndDate"),
        "usage end",
      ),
      billingPeriodStart: context.billingPeriodStart,
      billingPeriodEnd: context.billingPeriodEnd,
      amountUsd: roundUsd(
        numberFromColumn(
          raw,
          "line_item_net_unblended_cost",
          "lineItem/NetUnblendedCost",
          "line_item_unblended_cost",
          "lineItem/UnblendedCost",
        ) ?? 0,
      ),
      usageAmount: numberFromColumn(
        raw,
        "line_item_usage_amount",
        "lineItem/UsageAmount",
      ),
      currency:
        readColumn(raw, "line_item_currency_code", "lineItem/CurrencyCode") ??
        "USD",
      model,
      region:
        readColumn(
          raw,
          "product_region",
          "product/region",
          "availability_zone",
        ) ?? null,
      resourceId:
        readColumn(raw, "line_item_resource_id", "lineItem/ResourceId") ?? null,
      attributionLevel,
      attributionKey,
      sourceUri: `s3://${context.manifestBucket}/${context.manifestKey}`,
      raw,
    };
  });
}

export async function loadCurExportFromS3(input: {
  manifestBucket: string;
  manifestKey: string;
  provider?: string;
  importId?: string;
  s3Client?: CurS3ClientLike;
}): Promise<LoadedCurExport> {
  const client = input.s3Client ?? s3;
  const manifestBody = await getObjectText(client, {
    bucket: input.manifestBucket,
    key: input.manifestKey,
  });
  const manifest = parseCurManifest(manifestBody, {
    bucket: input.manifestBucket,
    key: input.manifestKey,
  });
  const parsedFiles = await Promise.all(
    manifest.dataFiles.map(async (file) =>
      parseCurCsv(
        await getObjectText(client, { bucket: file.bucket, key: file.key }),
      ),
    ),
  );
  const rows = parsedFiles.flatMap((file) => file.rows);
  const errors = parsedFiles.flatMap((file) => file.errors);
  const lineItems = toBillingLineItems(rows, {
    provider: input.provider ?? "aws",
    importId: input.importId ?? `${input.manifestBucket}/${input.manifestKey}`,
    manifestBucket: input.manifestBucket,
    manifestKey: input.manifestKey,
    billingPeriodStart: manifest.billingPeriodStart,
    billingPeriodEnd: manifest.billingPeriodEnd,
  });
  return { manifest, rows, errors, lineItems };
}

function extractManifestDataFiles(
  raw: Record<string, unknown>,
  fallbackBucket: string,
): CurManifestDataFile[] {
  const candidates = [
    ...readArray(raw.reportKeys),
    ...readArray(raw.report_keys),
    ...readArray(raw.dataFileS3Paths),
    ...readArray(raw.data_file_s3_paths),
    ...readArray(raw.dataFiles).map((file) => readRecord(file).key),
  ];
  return candidates.flatMap((candidate) => {
    const value = stringValue(candidate);
    if (!value) return [];
    if (value.startsWith("s3://")) {
      const url = new URL(value);
      return [{ bucket: url.hostname, key: url.pathname.replace(/^\//, "") }];
    }
    return [{ bucket: fallbackBucket, key: value }];
  });
}

function validateCurRow(raw: Record<string, string>): string | null {
  try {
    isoDate(
      readColumn(raw, "line_item_usage_start_date", "lineItem/UsageStartDate"),
      "usage start",
    );
    isoDate(
      readColumn(raw, "line_item_usage_end_date", "lineItem/UsageEndDate"),
      "usage end",
    );
  } catch (error) {
    return error instanceof Error ? error.message : "invalid usage window";
  }
  if (
    numberFromColumn(
      raw,
      "line_item_net_unblended_cost",
      "lineItem/NetUnblendedCost",
      "line_item_unblended_cost",
      "lineItem/UnblendedCost",
    ) === null
  ) {
    return "billing row is missing a numeric unblended cost";
  }
  return null;
}

function tenantIdFromRow(raw: Record<string, string>): string | null {
  return (
    readColumn(
      raw,
      "resource_tags_user_thinkwork_tenant_id",
      "resourceTags/user:thinkwork:tenant_id",
      "resource_tags_user_tenant_id",
      "cost_category_tenant_id",
      "costCategory/tenant_id",
    ) ?? null
  );
}

function normalizeModel(value: string): string {
  const last = value.split("/").pop() ?? value;
  return last
    .replace(/^us\./, "")
    .replace(/^anthropic\./, "")
    .replace(/^amazon\./, "")
    .replace(/-v\d+:\d+$/, "");
}

function parseCsvRecords(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readColumn(
  row: Record<string, string>,
  ...candidates: string[]
): string | null {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [columnKey(key), value]),
  );
  for (const candidate of candidates) {
    const value = normalized.get(columnKey(candidate));
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return null;
}

function numberFromColumn(
  row: Record<string, string>,
  ...candidates: string[]
): number | null {
  const value = readColumn(row, ...candidates);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function columnKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isoDate(value: unknown, label: string): string {
  const string = stringValue(value);
  const parsed = string ? Date.parse(string) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${label}`);
  return new Date(parsed).toISOString();
}

function parseJsonObject(body: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }
  throw new Error(`${label} is not a JSON object`);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function getObjectText(
  client: CurS3ClientLike,
  location: CurManifestLocation,
): Promise<string> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
  );
  const buffer = await bodyToBuffer(response.Body);
  const uncompressed = location.key.endsWith(".gz")
    ? gunzipSync(buffer)
    : buffer;
  return uncompressed.toString("utf8");
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.from("");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return Buffer.from(await body.transformToByteArray());
  }
  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported S3 object body type");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Buffer> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in (value as Record<symbol, unknown>),
  );
}
