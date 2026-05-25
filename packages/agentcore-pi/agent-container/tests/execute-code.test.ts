import { describe, expect, it, vi } from "vitest";
import { buildExecuteCodeTool } from "../src/runtime/tools/execute-code.js";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";

describe("buildExecuteCodeTool", () => {
  it("executes Python code through the Pi sandbox factory", async () => {
    const session: SessionEnv = {
      cwd: "/home/user",
      resolvePath: (_base: string, path: string) => path,
      writeFile: vi.fn(),
      exec: vi.fn(async (command) => ({
        stdout: `ran: ${decodeEmbeddedPython(command)}`,
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
    const sandboxFactory: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };
    const cleanup: Array<() => Promise<void>> = [];
    const tool = buildExecuteCodeTool({ sandboxFactory, cleanup });

    const result = await tool.execute("call-1", { code: "print(2 + 2)" });

    expect(sandboxFactory.createSessionEnv).toHaveBeenCalledWith({
      id: "pi-execute-code",
      cwd: "/home/user",
    });
    expect(session.writeFile).not.toHaveBeenCalled();
    expect(session.rm).not.toHaveBeenCalled();
    expect(session.exec).toHaveBeenCalledWith(
      expect.stringContaining("python3 - <<'PY'"),
      expect.objectContaining({ cwd: "/home/user" }),
    );
    const command = vi.mocked(session.exec).mock.calls[0]?.[0] ?? "";
    expect(command).toContain("base64.b64decode");
    expect(command).not.toContain("/tmp/thinkwork-execute-code");
    expect(result.details).toMatchObject({
      ok: true,
      exit_code: 0,
      exit_status: "ok",
      stdout: expect.stringContaining("print(2 + 2)"),
      stderr: "",
      runtime: "pi",
    });
    const content = result.content.find((item) => item.type === "text");
    expect(content?.text).toContain("print(2 + 2)");
    expect(cleanup).toHaveLength(1);
  });

  it("preserves multiline Python source without sandbox file handoff", async () => {
    const source = [
      'message = "hello from sandbox"',
      "for index in range(2):",
      "    print(f'{index}: {message}')",
    ].join("\n");
    const session: SessionEnv = {
      cwd: "/home/user",
      resolvePath: (_base: string, path: string) => path,
      writeFile: vi.fn(),
      exec: vi.fn(async (command) => ({
        stdout: decodeEmbeddedPython(command),
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
    const sandboxFactory: SandboxFactory = {
      createSessionEnv: vi.fn(async () => session),
    };
    const tool = buildExecuteCodeTool({ sandboxFactory, cleanup: [] });

    const result = await tool.execute("call-1", { code: source });

    expect(result.details).toMatchObject({
      ok: true,
      stdout: source,
      stderr: "",
    });
  });
});

function decodeEmbeddedPython(command: string): string {
  const encoded = command.match(/b64decode\("([^"]+)"\)/)?.[1];
  if (!encoded) return "";
  return Buffer.from(encoded, "base64").toString("utf8");
}
