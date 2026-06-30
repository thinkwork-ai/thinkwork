import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { ensureSpaceMdSourceFile } from "./space-md-source-file.js";

type CommandWithInput = {
  input: Record<string, unknown>;
};

describe("ensureSpaceMdSourceFile", () => {
  it("writes default SPACE.md content into the Space source folder", async () => {
    const send = vi.fn<(command: unknown) => Promise<unknown>>(
      async (command: unknown) => {
        if (command instanceof HeadObjectCommand) {
          const error = new Error("missing") as Error & {
            name: string;
            $metadata: { httpStatusCode: number };
          };
          error.name = "NoSuchKey";
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return {};
      },
    );

    const result = await ensureSpaceMdSourceFile({
      bucket: "workspace-bucket",
      tenantSlug: "acme",
      spaceSlug: "customer",
      spaceName: "Customer",
      description: "Customer onboarding work.",
      s3Client: { send } as any,
    });

    expect(result).toEqual({
      key: "tenants/acme/spaces/customer/SPACE.md",
      written: true,
    });

    const putCall = send.mock.calls.find(
      ([command]) => command instanceof PutObjectCommand,
    );
    const putCommand = putCall?.[0] as CommandWithInput | undefined;
    expect(putCommand?.input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/acme/spaces/customer/SPACE.md",
      ContentType: "text/markdown; charset=utf-8",
    });
    expect(String(putCommand?.input.Body)).toContain("# Customer");
    expect(String(putCommand?.input.Body)).toContain(
      "`CONTEXT.md` - main workflow/context file.",
    );
  });

  it("preserves an existing SPACE.md by default", async () => {
    const send = vi.fn<(command: unknown) => Promise<unknown>>(
      async () => ({}),
    );

    const result = await ensureSpaceMdSourceFile({
      bucket: "workspace-bucket",
      tenantSlug: "acme",
      spaceSlug: "customer",
      spaceName: "Customer",
      s3Client: { send } as any,
    });

    expect(result).toEqual({
      key: "tenants/acme/spaces/customer/SPACE.md",
      written: false,
    });
    expect(send.mock.calls).toHaveLength(1);
    const firstCall = send.mock.calls[0];
    expect(firstCall?.[0]).toBeInstanceOf(HeadObjectCommand);
  });
});
