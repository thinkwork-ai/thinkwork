import { describe, expect, it } from "vitest";
import {
  parseCurCsv,
  parseCurManifest,
  toBillingLineItems,
} from "./aws-cur-import.js";

describe("parseCurManifest", () => {
  it("extracts billing period and data file locations from AWS export manifests", () => {
    const manifest = parseCurManifest(
      JSON.stringify({
        billingPeriod: {
          start: "2026-06-01T00:00:00Z",
          end: "2026-07-01T00:00:00Z",
        },
        reportKeys: ["exports/thinkwork/20260601-20260701/chunk-00001.csv.gz"],
      }),
      {
        bucket: "billing-exports",
        key: "exports/thinkwork/manifest.json",
      },
    );

    expect(manifest).toMatchObject({
      bucket: "billing-exports",
      key: "exports/thinkwork/manifest.json",
      billingPeriodStart: "2026-06-01T00:00:00.000Z",
      billingPeriodEnd: "2026-07-01T00:00:00.000Z",
      dataFiles: [
        {
          bucket: "billing-exports",
          key: "exports/thinkwork/20260601-20260701/chunk-00001.csv.gz",
        },
      ],
    });
  });

  it("reports missing manifest file pointers as an import error", () => {
    expect(() =>
      parseCurManifest(
        JSON.stringify({
          billingPeriod: {
            start: "2026-06-01",
            end: "2026-07-01",
          },
        }),
        { bucket: "billing-exports", key: "manifest.json" },
      ),
    ).toThrow(/manifest does not reference any data files/i);
  });
});

describe("toBillingLineItems", () => {
  it("normalizes CUR 2.0 Bedrock rows with tenant tag attribution", () => {
    const parsed =
      parseCurCsv(`line_item_line_item_id,line_item_usage_start_date,line_item_usage_end_date,line_item_usage_account_id,line_item_product_code,line_item_operation,line_item_line_item_type,line_item_unblended_cost,line_item_usage_amount,line_item_currency_code,product_region,product_model,resource_tags_user_thinkwork_tenant_id
li-1,2026-06-25T15:00:00Z,2026-06-25T16:00:00Z,123456789012,AmazonBedrock,Converse,Usage,0.420000,100,USD,us-east-1,anthropic.claude-sonnet-4-5,tenant-1`);

    const items = toBillingLineItems(parsed.rows, {
      provider: "aws",
      importId: "import-1",
      manifestBucket: "billing-exports",
      manifestKey: "exports/manifest.json",
      billingPeriodStart: "2026-06-01T00:00:00.000Z",
      billingPeriodEnd: "2026-07-01T00:00:00.000Z",
    });

    expect(parsed.errors).toEqual([]);
    expect(items).toEqual([
      expect.objectContaining({
        importId: "import-1",
        provider: "aws",
        tenantId: "tenant-1",
        serviceCode: "AmazonBedrock",
        operation: "Converse",
        model: "claude-sonnet-4-5",
        usageAccountId: "123456789012",
        amountUsd: 0.42,
        usageAmount: 100,
        attributionLevel: "tenant",
        sourceUri: "s3://billing-exports/exports/manifest.json",
      }),
    ]);
  });

  it("keeps account-level rows aggregate-only when no tenant attribution exists", () => {
    const parsed =
      parseCurCsv(`lineItem/LineItemId,lineItem/UsageStartDate,lineItem/UsageEndDate,lineItem/UsageAccountId,lineItem/ProductCode,lineItem/Operation,lineItem/UnblendedCost,lineItem/CurrencyCode,product/model
li-2,2026-06-25T15:00:00Z,2026-06-25T16:00:00Z,123456789012,AmazonBedrock,InvokeModel,0.190000,USD,anthropic.claude-haiku-4-5`);

    const [item] = toBillingLineItems(parsed.rows, {
      provider: "aws",
      importId: "import-1",
      manifestBucket: "billing-exports",
      manifestKey: "manifest.json",
      billingPeriodStart: "2026-06-01T00:00:00.000Z",
      billingPeriodEnd: "2026-07-01T00:00:00.000Z",
    });

    expect(item).toMatchObject({
      tenantId: null,
      attributionLevel: "account",
      attributionKey:
        "aws:123456789012:AmazonBedrock:InvokeModel:claude-haiku-4-5",
    });
  });

  it("surfaces malformed billing rows without dropping valid rows", () => {
    const parsed =
      parseCurCsv(`line_item_line_item_id,line_item_usage_start_date,line_item_usage_end_date,line_item_product_code,line_item_operation,line_item_unblended_cost
bad-row,not-a-date,2026-06-25T16:00:00Z,AmazonBedrock,Converse,0.1
good-row,2026-06-25T15:00:00Z,2026-06-25T16:00:00Z,AmazonBedrock,Converse,0.2`);

    const items = toBillingLineItems(parsed.rows, {
      provider: "aws",
      importId: "import-1",
      manifestBucket: "billing-exports",
      manifestKey: "manifest.json",
      billingPeriodStart: "2026-06-01T00:00:00.000Z",
      billingPeriodEnd: "2026-07-01T00:00:00.000Z",
    });

    expect(items).toHaveLength(1);
    expect(items[0].lineItemId).toBe("good-row");
    expect(parsed.errors).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        message: expect.stringMatching(/usage start/i),
      }),
    ]);
  });
});
