import { describe, expect, it, vi } from "vitest";
import { buildExecuteCodeTool } from "../src/runtime/tools/execute-code.js";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://s3.example/presigned-put"),
}));

function fakeSession(): SessionEnv {
  return {
    cwd: "/home/user",
    resolvePath: (_base: string, path: string) => path,
    writeFile: vi.fn(),
    exec: vi.fn(async () => ({
      stdout: "uploaded 42 bytes status 200",
      stderr: "",
      exitCode: 0,
    })),
    rm: vi.fn(async () => {}),
    readFile: vi.fn(),
    readFileBuffer: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    cleanup: vi.fn(async () => {}),
  } as unknown as SessionEnv;
}

const exportContext = {
  workspaceBucket: "bucket",
  tenantId: "9a1a45aa-0000-0000-0000-000000000001",
  threadId: "9a1a45aa-0000-0000-0000-000000000002",
  apiUrl: "https://api.example",
  apiSecret: "secret",
};

describe("execute_code output_files", () => {
  it("uploads via in-sandbox presigned PUT and registers the attachment", async () => {
    const session = fakeSession();
    const sandboxFactory: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ attachmentId: "att-1", sizeBytes: 42 }), {
          status: 201,
        }),
    ) as unknown as typeof fetch;

    const tool = buildExecuteCodeTool({
      sandboxFactory,
      cleanup: [],
      exportContext: { ...exportContext, fetchImpl },
    });
    const result = await tool.execute("call-1", {
      code: "open('/home/user/report.xlsx','wb').write(b'PK')",
      output_files: ["/home/user/report.xlsx"],
    });

    // Second exec is the uploader: presigned URL travels into the sandbox,
    // bytes never travel through the host (binary-safe path).
    expect(vi.mocked(session.exec).mock.calls.length).toBe(2);
    const uploadCommand = vi.mocked(session.exec).mock.calls[1]?.[0] ?? "";
    expect(uploadCommand).toContain("python3 - <<'PY'");
    expect(decodeAll(uploadCommand)).toContain("urllib.request");

    const registerCall = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(registerCall[0])).toBe(
      `https://api.example/api/threads/${exportContext.threadId}/attachments/register`,
    );
    const registerBody = JSON.parse(
      String((registerCall[1] as RequestInit).body),
    );
    expect(registerBody.name).toBe("report.xlsx");
    expect(registerBody.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(registerBody.s3Key).toMatch(
      new RegExp(
        `^tenants/${exportContext.tenantId}/attachments/${exportContext.threadId}/[0-9a-f-]{36}/report\\.xlsx$`,
      ),
    );

    expect(result.details).toMatchObject({
      ok: true,
      output_files: [
        expect.objectContaining({
          attachment_id: "att-1",
          name: "report.xlsx",
        }),
      ],
      output_file_errors: [],
    });
    const text = (result.content?.[0] as { text?: string })?.text ?? "";
    expect(text).toContain("attachment_id: att-1");
  });

  it("refuses output_files without an export context", async () => {
    const session = fakeSession();
    const tool = buildExecuteCodeTool({
      sandboxFactory: { createSessionEnv: vi.fn(async () => session) },
      cleanup: [],
    });
    await expect(
      tool.execute("call-1", {
        code: "print(1)",
        output_files: ["/home/user/a.csv"],
      }),
    ).rejects.toThrow(/not available/);
  });

  it("skips export and reports when the code exits non-zero", async () => {
    const session = fakeSession();
    vi.mocked(session.exec).mockResolvedValueOnce({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const tool = buildExecuteCodeTool({
      sandboxFactory: { createSessionEnv: vi.fn(async () => session) },
      cleanup: [],
      exportContext: { ...exportContext, fetchImpl },
    });
    const result = await tool.execute("call-1", {
      code: "raise SystemExit(1)",
      output_files: ["/home/user/a.csv"],
    });
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(0);
    expect(result.details).toMatchObject({
      ok: false,
      output_files: [],
      output_file_errors: [expect.stringContaining("non-zero")],
    });
  });

  it("surfaces registration failures as export errors, not turn failures", async () => {
    const session = fakeSession();
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 403 }),
    ) as unknown as typeof fetch;
    const tool = buildExecuteCodeTool({
      sandboxFactory: { createSessionEnv: vi.fn(async () => session) },
      cleanup: [],
      exportContext: { ...exportContext, fetchImpl },
    });
    const result = await tool.execute("call-1", {
      code: "print(1)",
      output_files: ["/home/user/a.csv"],
    });
    expect(result.details).toMatchObject({
      ok: true,
      output_files: [],
      output_file_errors: [expect.stringContaining("HTTP 403")],
    });
  });
});

function decodeAll(command: string): string {
  return (command.match(/b64decode\("([^"]+)"\)/g) ?? [])
    .map((m) => Buffer.from(m.slice(11, -2), "base64").toString("utf8"))
    .join("\n");
}
