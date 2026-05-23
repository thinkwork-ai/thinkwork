import { describe, expect, it, vi } from "vitest";
import { buildExecuteCodeTool } from "../src/runtime/tools/execute-code.js";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";

describe("buildExecuteCodeTool", () => {
  it("executes Python code through the Pi sandbox factory", async () => {
    const writes: Record<string, string> = {};
    const session: SessionEnv = {
      cwd: "/home/user",
      resolvePath: (_base: string, path: string) => path,
      writeFile: vi.fn(async (path, content) => {
        writes[path] = String(content);
      }),
      exec: vi.fn(async (command) => ({
        stdout: `ran: ${writes[command.match(/'([^']+)'/)?.[1] ?? ""]}`,
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
    expect(session.exec).toHaveBeenCalledWith(
      expect.stringContaining("python3"),
      expect.objectContaining({ cwd: "/home/user" }),
    );
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
});
