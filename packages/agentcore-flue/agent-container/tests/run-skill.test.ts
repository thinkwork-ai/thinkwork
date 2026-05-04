/**
 * Plan §005 U5 — vitest coverage for the `run_skill` ToolDef.
 *
 * The Python skill-bridge has its own pytest suite at
 * `packages/agentcore-flue/agent-container/skill-bridge/test_run_skill.py`
 * that exercises the bridge end-to-end with a real subprocess. These
 * vitest tests do the same against the TS-side ToolDef: they spawn the
 * actual bridge against synthesised skill fixtures on a temp dir, so
 * the contract between TS envelope and Python harness is validated
 * end-to-end without mocks.
 *
 * Mocking `child_process.spawn` would let us test the TS dispatch
 * shape but skip the contract — the gap that bit U8's "interpreter id
 * reaches AWS" test. Better to spawn for real and rely on the small
 * surface area to keep the suite fast.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRunSkillTool,
  RunSkillError,
  type RunSkillManifestEntry,
} from "../src/runtime/tools/run-skill.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_SCRIPT_PATH = path.resolve(
  __dirname,
  "..",
  "skill-bridge",
  "run_skill.py",
);

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "run-skill-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeSkill(
  slug: string,
  source: string,
  scriptName = "main.py",
): string {
  const skillDir = path.join(workDir, slug);
  mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
  writeFileSync(path.join(skillDir, "scripts", scriptName), source, "utf8");
  return skillDir;
}

function manifest(
  overrides: Partial<RunSkillManifestEntry> = {},
): RunSkillManifestEntry {
  const skillDir = overrides.skillDir ?? workDir;
  return {
    skillId: "demo_skill",
    description: "Demo skill for tests.",
    skillDir,
    scripts: [
      {
        name: "main",
        path: "scripts/main.py",
        description: "Default script.",
      },
    ],
    ...overrides,
  };
}

describe("buildRunSkillTool — manifest handling", () => {
  it("returns null when the manifest is empty", () => {
    expect(buildRunSkillTool({ skills: [] })).toBeNull();
  });

  it("returns a Flue ToolDef when the manifest has one or more skills", () => {
    const tool = buildRunSkillTool({
      skills: [manifest()],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("run_skill");
    expect(tool?.label).toBe("Run Skill");
    expect(typeof tool?.execute).toBe("function");
    expect(tool?.executionMode).toBe("sequential");
  });

  it("description lists every skill_id and its scripts", () => {
    const skillDir = writeSkill(
      "alpha",
      "def first(): return 1\ndef second(): return 2\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "alpha",
          displayName: "Alpha",
          description: "First skill.",
          skillDir,
          scripts: [
            { name: "first", path: "scripts/main.py", description: "1" },
            { name: "second", path: "scripts/main.py", description: "2" },
          ],
        },
        {
          skillId: "beta",
          description: "Second skill.",
          skillDir: workDir,
          scripts: [
            { name: "go", path: "scripts/main.py", description: "go" },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    expect(tool?.description).toContain("alpha");
    expect(tool?.description).toContain("Alpha");
    expect(tool?.description).toContain("first, second");
    expect(tool?.description).toContain("beta");
    expect(tool?.description).toContain("go");
  });
});

describe("buildRunSkillTool — happy path execution", () => {
  it("invokes the named script function and returns its result", async () => {
    const skillDir = writeSkill(
      "calc",
      "def add(a, b):\n    return a + b\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "calc",
          description: "Calculator.",
          skillDir,
          scripts: [
            { name: "add", path: "scripts/main.py", description: "Add two numbers." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    const result = await tool!.execute(
      "call-1",
      { skill_id: "calc", kwargs: { a: 2, b: 3 } } as any,
    );
    expect(result.content).toEqual([{ type: "text", text: "5" }]);
    expect(result.details).toMatchObject({
      skillId: "calc",
      scriptName: "add",
      scriptPath: "scripts/main.py",
      skillDir,
    });
  });

  it("serialises object return values as JSON text", async () => {
    const skillDir = writeSkill(
      "lookup",
      'def fetch(key): return {"key": key, "value": 42}\n',
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "lookup",
          description: "Lookup.",
          skillDir,
          scripts: [
            { name: "fetch", path: "scripts/main.py", description: "Fetch." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    const result = await tool!.execute(
      "call-2",
      { skill_id: "lookup", kwargs: { key: "alpha" } } as any,
    );
    const block = result.content[0]! as { type: "text"; text: string };
    expect(JSON.parse(block.text)).toEqual({ key: "alpha", value: 42 });
  });

  it("treats missing kwargs as an empty object", async () => {
    const skillDir = writeSkill(
      "hello",
      'def greet(): return "hi"\n',
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "hello",
          description: "Hello.",
          skillDir,
          scripts: [
            { name: "greet", path: "scripts/main.py", description: "Greet." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    const result = await tool!.execute(
      "call-3",
      { skill_id: "hello" } as any,
    );
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("buildRunSkillTool — multi-script skills", () => {
  it("defaults to the first script when script_name is omitted", async () => {
    const skillDir = writeSkill(
      "multi",
      "def first():\n    return 'A'\ndef second():\n    return 'B'\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "multi",
          description: "Multi-script.",
          skillDir,
          scripts: [
            { name: "first", path: "scripts/main.py", description: "1" },
            { name: "second", path: "scripts/main.py", description: "2" },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    const result = await tool!.execute(
      "call-4",
      { skill_id: "multi" } as any,
    );
    expect(result.content).toEqual([{ type: "text", text: "A" }]);
  });

  it("dispatches by script_name when provided", async () => {
    const skillDir = writeSkill(
      "multi",
      "def first():\n    return 'A'\ndef second():\n    return 'B'\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "multi",
          description: "Multi-script.",
          skillDir,
          scripts: [
            { name: "first", path: "scripts/main.py", description: "1" },
            { name: "second", path: "scripts/main.py", description: "2" },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    const result = await tool!.execute(
      "call-5",
      { skill_id: "multi", script_name: "second" } as any,
    );
    expect(result.content).toEqual([{ type: "text", text: "B" }]);
  });
});

describe("buildRunSkillTool — fail-closed", () => {
  it("throws when skill_id is missing", async () => {
    const tool = buildRunSkillTool({
      skills: [manifest()],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(tool!.execute("call-6", {} as any)).rejects.toThrow(
      RunSkillError,
    );
  });

  it("throws when skill_id is empty string", async () => {
    const tool = buildRunSkillTool({
      skills: [manifest()],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-7", { skill_id: "   " } as any),
    ).rejects.toThrow(/skill_id/);
  });

  it("throws when skill_id is not in the manifest", async () => {
    const tool = buildRunSkillTool({
      skills: [manifest({ skillId: "alpha" })],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-8", { skill_id: "beta" } as any),
    ).rejects.toThrow(/Unknown skill 'beta'/);
  });

  it("throws when script_name does not match any script in the skill", async () => {
    const skillDir = writeSkill(
      "alpha",
      "def first(): return 1\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "alpha",
          description: "Alpha.",
          skillDir,
          scripts: [
            { name: "first", path: "scripts/main.py", description: "1" },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-9", {
        skill_id: "alpha",
        script_name: "ghost",
      } as any),
    ).rejects.toThrow(/no script named 'ghost'/);
  });

  it("throws when the manifest entry has no scripts", async () => {
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "empty",
          description: "Empty.",
          skillDir: workDir,
          scripts: [],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-10", { skill_id: "empty" } as any),
    ).rejects.toThrow(/declares no scripts/);
  });
});

describe("buildRunSkillTool — error propagation from bridge", () => {
  it("surfaces a Python exception as RunSkillError with traceback", async () => {
    const skillDir = writeSkill(
      "bad",
      'def boom(**_):\n    raise ValueError("kaboom")\n',
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "bad",
          description: "Bad.",
          skillDir,
          scripts: [
            { name: "boom", path: "scripts/main.py", description: "Boom." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    let captured: RunSkillError | null = null;
    try {
      await tool!.execute(
        "call-11",
        { skill_id: "bad", kwargs: {} } as any,
      );
    } catch (err) {
      captured = err as RunSkillError;
    }
    expect(captured).toBeInstanceOf(RunSkillError);
    expect(captured?.message).toContain("kaboom");
    expect(captured?.traceback).toContain("ValueError");
  });

  it("surfaces a missing script file as RunSkillError", async () => {
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "ghost",
          description: "Ghost.",
          skillDir: workDir,
          scripts: [
            {
              name: "nope",
              path: "scripts/missing.py",
              description: "Missing.",
            },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-12", { skill_id: "ghost" } as any),
    ).rejects.toThrow(/Script not found/);
  });

  it("surfaces a missing function-in-script as RunSkillError", async () => {
    const skillDir = writeSkill(
      "wrong_func",
      "def actually_present():\n    return None\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "wrong_func",
          description: "Wrong.",
          skillDir,
          scripts: [
            { name: "missing", path: "scripts/main.py", description: "Miss." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
    });
    await expect(
      tool!.execute("call-13", { skill_id: "wrong_func" } as any),
    ).rejects.toThrow(/missing/);
  });
});

describe("buildRunSkillTool — timeout + abort", () => {
  it("kills the subprocess and throws when timeoutMs elapses", async () => {
    const skillDir = writeSkill(
      "slow",
      "import time\ndef wait():\n    time.sleep(5)\n    return 'done'\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "slow",
          description: "Slow.",
          skillDir,
          scripts: [
            { name: "wait", path: "scripts/main.py", description: "Wait." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
      timeoutMs: 200,
    });
    const start = Date.now();
    await expect(
      tool!.execute("call-14", { skill_id: "slow" } as any),
    ).rejects.toThrow(/timed out after 200ms/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it("kills the subprocess when the abort signal fires", async () => {
    const skillDir = writeSkill(
      "abortable",
      "import time\ndef wait():\n    time.sleep(5)\n    return 'done'\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "abortable",
          description: "Abortable.",
          skillDir,
          scripts: [
            { name: "wait", path: "scripts/main.py", description: "Wait." },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
      timeoutMs: 30_000,
    });
    const controller = new AbortController();
    const promise = tool!.execute(
      "call-15",
      { skill_id: "abortable" } as any,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow();
  });
});

describe("buildRunSkillTool — env overrides", () => {
  it("passes per-skill envOverrides to the subprocess", async () => {
    const skillDir = writeSkill(
      "envcheck",
      "import os\ndef whoami():\n    return os.environ.get('SKILL_USER', 'unset')\n",
    );
    const tool = buildRunSkillTool({
      skills: [
        {
          skillId: "envcheck",
          description: "Env.",
          skillDir,
          scripts: [
            {
              name: "whoami",
              path: "scripts/main.py",
              description: "Who.",
            },
          ],
        },
      ],
      bridgeScriptPath: BRIDGE_SCRIPT_PATH,
      envOverrides: {
        envcheck: { SKILL_USER: "alice" },
      },
    });
    const result = await tool!.execute(
      "call-16",
      { skill_id: "envcheck" } as any,
    );
    expect(result.content).toEqual([{ type: "text", text: "alice" }]);
  });
});
