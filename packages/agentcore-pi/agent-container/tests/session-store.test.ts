import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SessionConflictError } from "@thinkwork/pi-runtime-core";
import { describe, expect, it } from "vitest";

import { createS3SessionStore } from "../src/runtime/session-store.js";

/** Minimal in-memory S3 stand-in implementing GetObject/PutObject with ETag
 *  conditional-write semantics (If-None-Match: *, If-Match: <etag>). */
function makeFakeS3() {
  const objects = new Map<string, { body: string; etag: string }>();
  let counter = 0;
  const notFound = () =>
    Object.assign(new Error("NoSuchKey"), {
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
  const precondition = () =>
    Object.assign(new Error("PreconditionFailed"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 },
    });
  return {
    raw: objects,
    async send(command: unknown) {
      if (command instanceof GetObjectCommand) {
        const found = objects.get(command.input.Key as string);
        if (!found) throw notFound();
        return {
          ETag: found.etag,
          Body: { transformToString: async () => found.body },
        };
      }
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key as string;
        const body = command.input.Body as string;
        const current = objects.get(key);
        if (command.input.IfNoneMatch === "*" && current) throw precondition();
        if (
          command.input.IfMatch !== undefined &&
          (!current || current.etag !== command.input.IfMatch)
        ) {
          throw precondition();
        }
        const etag = `"etag-${++counter}"`;
        objects.set(key, { body, etag });
        return { ETag: etag };
      }
      throw new Error("unexpected command");
    },
  };
}

const opts = (s3: ReturnType<typeof makeFakeS3>) => ({
  s3,
  bucket: "wsbucket",
  keyPrefix: "pi-sessions/acme/",
});

describe("createS3SessionStore", () => {
  it("returns null for a thread with no stored session", async () => {
    const store = createS3SessionStore(opts(makeFakeS3()));
    expect(await store.read("t1.jsonl")).toBeNull();
  });

  it("treats an existing-but-empty object as no session (returns null)", async () => {
    const s3 = makeFakeS3();
    s3.raw.set("pi-sessions/acme/t1.jsonl", { body: "  \n", etag: '"e"' });
    const store = createS3SessionStore(opts(s3));
    expect(await store.read("t1.jsonl")).toBeNull();
  });

  it("isolates sessions across tenant prefixes for the same logical key", async () => {
    const s3 = makeFakeS3();
    const acme = createS3SessionStore({
      s3,
      bucket: "wsbucket",
      keyPrefix: "pi-sessions/acme/",
    });
    const globex = createS3SessionStore({
      s3,
      bucket: "wsbucket",
      keyPrefix: "pi-sessions/globex/",
    });
    await acme.write("t1.jsonl", "acme-body\n", null);
    await globex.write("t1.jsonl", "globex-body\n", null);
    expect((await acme.read("t1.jsonl"))?.body).toBe("acme-body\n");
    expect((await globex.read("t1.jsonl"))?.body).toBe("globex-body\n");
  });

  it("creates a new session object under the tenant-isolated key", async () => {
    const s3 = makeFakeS3();
    const store = createS3SessionStore(opts(s3));
    const version = await store.write("t1.jsonl", "line1\n", null);
    expect(version).toBeTruthy();
    expect(s3.raw.has("pi-sessions/acme/t1.jsonl")).toBe(true);
    const read = await store.read("t1.jsonl");
    expect(read?.body).toBe("line1\n");
    expect(read?.version).toBe(version);
  });

  it("conflicts when creating a session that already exists", async () => {
    const s3 = makeFakeS3();
    const store = createS3SessionStore(opts(s3));
    await store.write("t1.jsonl", "a\n", null);
    await expect(store.write("t1.jsonl", "b\n", null)).rejects.toBeInstanceOf(
      SessionConflictError,
    );
  });

  it("updates with a matching version and bumps the token", async () => {
    const s3 = makeFakeS3();
    const store = createS3SessionStore(opts(s3));
    const v1 = await store.write("t1.jsonl", "a\n", null);
    const v2 = await store.write("t1.jsonl", "a\nb\n", v1);
    expect(v2).not.toBe(v1);
    expect((await store.read("t1.jsonl"))?.body).toBe("a\nb\n");
  });

  it("conflicts when updating with a stale version", async () => {
    const s3 = makeFakeS3();
    const store = createS3SessionStore(opts(s3));
    const v1 = await store.write("t1.jsonl", "a\n", null);
    await store.write("t1.jsonl", "a\nb\n", v1); // someone else advanced it
    await expect(store.write("t1.jsonl", "a\nx\n", v1)).rejects.toBeInstanceOf(
      SessionConflictError,
    );
  });
});
