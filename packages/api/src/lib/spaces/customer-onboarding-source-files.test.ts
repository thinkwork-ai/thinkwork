import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import { CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES } from "./customer-onboarding-seed.js";
import { ensureCustomerOnboardingSourceFiles } from "./customer-onboarding-source-files.js";

const s3Mock = mockClient(S3Client);
const SOURCE_FILE_PATHS = CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.map(
  (file) => file.path,
);

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

describe("ensureCustomerOnboardingSourceFiles", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it("writes missing Customer Onboarding source files to the Space source prefix", async () => {
    s3Mock.on(HeadObjectCommand).rejects(noSuchKey());
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await ensureCustomerOnboardingSourceFiles({
      bucket: "workspace-bucket",
      tenantSlug: "acme",
      spaceSlug: "customer-onboarding",
      s3Client: new S3Client({}),
    });

    expect(result).toEqual({
      targetPrefix: "tenants/acme/spaces/customer-onboarding/source/",
      total: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.length,
      written: SOURCE_FILE_PATHS,
      skipped: [],
    });
    expect(
      s3Mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input),
    ).toEqual(
      SOURCE_FILE_PATHS.map((path) =>
        expect.objectContaining({
          Bucket: "workspace-bucket",
          Key: `tenants/acme/spaces/customer-onboarding/source/${path}`,
          ContentType: "text/markdown; charset=utf-8",
        }),
      ),
    );
  });

  it("preserves existing operator-authored source files by default", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await ensureCustomerOnboardingSourceFiles({
      bucket: "workspace-bucket",
      tenantSlug: "acme",
      spaceSlug: "customer-onboarding",
      s3Client: new S3Client({}),
    });

    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual(SOURCE_FILE_PATHS);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
