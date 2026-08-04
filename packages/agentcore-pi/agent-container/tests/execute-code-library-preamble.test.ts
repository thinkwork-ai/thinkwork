import { describe, expect, it, vi } from "vitest";
import { buildExecuteCodeTool } from "../src/runtime/tools/execute-code.js";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";

function fakeSession(): SessionEnv {
  return {
    cwd: "/home/user",
    resolvePath: (_base: string, path: string) => path,
    writeFile: vi.fn(),
    exec: vi.fn(async () => ({ stdout: "ok", stderr: "", exitCode: 0 })),
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

function toolWith(session: SessionEnv) {
  const sandboxFactory: SandboxFactory = {
    createSessionEnv: vi.fn(async () => session),
  };
  return buildExecuteCodeTool({ sandboxFactory, cleanup: [] });
}

describe("execute_code on-demand library preamble", () => {
  it("prepends an openpyxl install guard when code references it", async () => {
    const session = fakeSession();
    await toolWith(session).execute("call-1", {
      code: "import openpyxl\nwb = openpyxl.Workbook()",
    });
    const command = vi.mocked(session.exec).mock.calls[0]?.[0] ?? "";
    expect(command).toContain(
      'python3 -c "import openpyxl" 2>/dev/null || pip install --quiet openpyxl',
    );
    // Guard runs before the user code heredoc.
    expect(command.indexOf("pip install")).toBeLessThan(
      command.indexOf("python3 - <<'PY'"),
    );
  });

  it("triggers on .xlsx references even without an explicit import", async () => {
    const session = fakeSession();
    await toolWith(session).execute("call-1", {
      code: "import pandas as pd\npd.DataFrame().to_excel('/home/user/report.xlsx')",
    });
    const command = vi.mocked(session.exec).mock.calls[0]?.[0] ?? "";
    expect(command).toContain("pip install --quiet openpyxl");
  });

  it("adds no preamble for unrelated code", async () => {
    const session = fakeSession();
    await toolWith(session).execute("call-1", { code: "print(2 + 2)" });
    const command = vi.mocked(session.exec).mock.calls[0]?.[0] ?? "";
    expect(command).not.toContain("pip install");
    expect(command.startsWith("python3 - <<'PY'")).toBe(true);
  });
});
