import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  legacyDefaultsWorkspacePrefix,
  legacyTemplateWorkspacePrefix,
  migrateTemplateWorkspaceToSpaceSource,
  migratedTemplateSpaceSlug,
  spaceSourcePrefix,
} from "./template-migration.js";

const s3Mock = mockClient(S3Client);
const BUCKET = "workspace-bucket";
const TENANT = "acme";
const TEMPLATE = "exec-assistant";
const SPACE = "template-exec-assistant";

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

beforeEach(() => {
  s3Mock.reset();
});

describe("Template workspace to Space source migration", () => {
  it("normalizes legacy Template slugs into migrated Space slugs", () => {
    expect(migratedTemplateSpaceSlug("Exec Assistant")).toBe(
      "template-exec-assistant",
    );
    expect(migratedTemplateSpaceSlug("")).toBe("template-template");
  });

  it("copies defaults and lets Template files override collisions", async () => {
    const defaultsPrefix = legacyDefaultsWorkspacePrefix(TENANT);
    const templatePrefix = legacyTemplateWorkspacePrefix(TENANT, TEMPLATE);
    const targetPrefix = spaceSourcePrefix(TENANT, SPACE);

    s3Mock.on(ListObjectsV2Command, { Prefix: defaultsPrefix }).resolves({
      Contents: [
        { Key: defaultsPrefix + "AGENTS.md" },
        { Key: defaultsPrefix + "MEMORY_GUIDE.md" },
        { Key: defaultsPrefix + "manifest.json" },
      ],
    });
    s3Mock.on(ListObjectsV2Command, { Prefix: templatePrefix }).resolves({
      Contents: [
        { Key: templatePrefix + "AGENTS.md" },
        { Key: templatePrefix + "skills/sql/SKILL.md" },
      ],
    });
    s3Mock.on(HeadObjectCommand).rejects(noSuchKey());

    const result = await migrateTemplateWorkspaceToSpaceSource({
      tenantSlug: TENANT,
      templateSlug: TEMPLATE,
      spaceSlug: SPACE,
      bucket: BUCKET,
    });

    expect(result).toMatchObject({ copied: 3, skipped: 0, total: 3 });
    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies.map((call) => call.args[0].input.Key).sort()).toEqual([
      targetPrefix + "AGENTS.md",
      targetPrefix + "MEMORY_GUIDE.md",
      targetPrefix + "skills/sql/SKILL.md",
    ]);
    const agentsCopy = copies.find(
      (call) => call.args[0].input.Key === targetPrefix + "AGENTS.md",
    );
    expect(agentsCopy?.args[0].input.CopySource).toBe(
      `${BUCKET}/${templatePrefix}AGENTS.md`,
    );
  });

  it("preserves existing Space source files by default", async () => {
    const defaultsPrefix = legacyDefaultsWorkspacePrefix(TENANT);
    const targetPrefix = spaceSourcePrefix(TENANT, "default");

    s3Mock.on(ListObjectsV2Command, { Prefix: defaultsPrefix }).resolves({
      Contents: [{ Key: defaultsPrefix + "AGENTS.md" }],
    });
    s3Mock
      .on(HeadObjectCommand, { Key: targetPrefix + "AGENTS.md" })
      .resolves({ ContentLength: 5 });

    const result = await migrateTemplateWorkspaceToSpaceSource({
      tenantSlug: TENANT,
      spaceSlug: "default",
      bucket: BUCKET,
      templateSlug: null,
    });

    expect(result).toMatchObject({ copied: 0, skipped: 1, total: 1 });
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });
});
