import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

/**
 * Plan §005 U5 — Flue ToolDef wrapping the Python skill-bridge subprocess.
 *
 * The Flue agent loop runs in Node. Python script-skills from
 * `packages/skill-catalog/` execute via subprocess against
 * `skill-bridge/run_skill.py`, which imports the named script + calls
 * the named function with **kwargs.
 *
 * Single tool, multi-skill manifest:
 * - The agent calls `run_skill({ skill_id, kwargs, script_name? })`.
 * - The tool resolves `skill_id` against an in-memory manifest (built
 *   from S3 catalog at handler boot in U9) and dispatches to the
 *   matching script. Multi-script skills choose their script via
 *   `script_name`; if omitted, the first script is used.
 * - Subprocess emits a JSON envelope on stdout (`{ ok, result }` on
 *   success or `{ ok: false, error, traceback }` on failure). The
 *   ToolDef throws on failure so the agent loop surfaces it as a
 *   tool error.
 *
 * Inert-ship: this module exports `buildRunSkillTool` but nothing
 * imports it yet. U9's handler shell wires it into `init({ tools })`
 * alongside the rest of the Flue runtime construction.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default subprocess timeout (60s). Overridable per call via env. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Default location of the bridge script.
 *
 * Resolution finds the nearest enclosing `agent-container/` segment in
 * `__dirname` and joins `skill-bridge/run_skill.py` to it. This works
 * for both source-runtime (vitest at `agent-container/src/...`) and
 * dist-runtime (Lambda at `agent-container/dist/agent-container/src/...`
 * after `tsc --build` — note Bedrock AgentCore copies the worker into a
 * deeper path than plain `tsc` would produce). Callers (U9 wiring) may
 * still override via `bridgeScriptPath` to pin an absolute path.
 */
function defaultBridgeScriptPath(): string {
  const marker = `${path.sep}agent-container${path.sep}`;
  const idx = __dirname.lastIndexOf(marker);
  if (idx === -1) {
    return path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "skill-bridge",
      "run_skill.py",
    );
  }
  return path.join(
    __dirname.slice(0, idx + marker.length - 1),
    "skill-bridge",
    "run_skill.py",
  );
}

const DEFAULT_BRIDGE_SCRIPT_PATH = defaultBridgeScriptPath();

/** Default Python interpreter. */
const DEFAULT_PYTHON_BIN = "python3";

/**
 * One row in the skill manifest. Mirrors the SKILL.md frontmatter
 * `scripts:` array entries plus the resolved on-disk skill directory.
 */
export interface RunSkillScript {
  /** Function name exported by the script file. */
  name: string;
  /** Path to the script file, relative to `skillDir`. */
  path: string;
  /** Human-readable description shown to the agent. */
  description: string;
}

export interface RunSkillManifestEntry {
  /** Skill slug (matches the directory name under `packages/skill-catalog/`). */
  skillId: string;
  /** Display name for the agent's tool description. */
  displayName?: string;
  /** Human-readable description for the agent's tool description. */
  description: string;
  /** Absolute path to the skill's directory (root containing `scripts/`). */
  skillDir: string;
  /** Scripts the agent may invoke. First entry is the default. */
  scripts: RunSkillScript[];
}

export interface RunSkillToolOptions {
  /** Manifest of available skills. Tool description lists them. */
  skills: RunSkillManifestEntry[];
  /** Python interpreter binary (default: `python3`). */
  pythonBin?: string;
  /** Path to the bridge script (default: container-relative). */
  bridgeScriptPath?: string;
  /** Subprocess timeout in milliseconds (default: 60_000). */
  timeoutMs?: number;
  /**
   * Per-skill environment overrides applied via `spawn({ env })`.
   * Mirrors Strands' `register_skill_tools` env-override pattern.
   */
  envOverrides?: Record<string, Record<string, string>>;
}

export class RunSkillError extends Error {
  constructor(
    message: string,
    readonly traceback?: string,
  ) {
    super(message);
    this.name = "RunSkillError";
  }
}

interface BridgeEnvelope {
  skill_dir: string;
  script_path: string;
  func_name: string;
  kwargs: Record<string, unknown>;
}

interface BridgeResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  traceback?: string;
}

function resolveScript(
  manifest: RunSkillManifestEntry,
  scriptName: string | undefined,
): RunSkillScript {
  if (manifest.scripts.length === 0) {
    throw new RunSkillError(
      `Skill '${manifest.skillId}' declares no scripts; nothing to run.`,
    );
  }
  if (!scriptName) {
    return manifest.scripts[0]!;
  }
  const found = manifest.scripts.find((s) => s.name === scriptName);
  if (!found) {
    const available = manifest.scripts.map((s) => s.name).join(", ");
    throw new RunSkillError(
      `Skill '${manifest.skillId}' has no script named '${scriptName}'. ` +
        `Available: ${available}.`,
    );
  }
  return found;
}

function buildToolDescription(skills: RunSkillManifestEntry[]): string {
  if (skills.length === 0) {
    return [
      "Execute a Python script-skill from the workspace skill catalog.",
      "No skills are currently available in this session.",
    ].join("\n");
  }
  const lines: string[] = [
    "Execute a Python script-skill from the workspace skill catalog.",
    "Pass the skill_id, kwargs (as a JSON object), and optionally a",
    "script_name when the skill exposes more than one entry point.",
    "",
    "Available skills:",
  ];
  for (const skill of skills) {
    const scriptList = skill.scripts.map((s) => s.name).join(", ");
    const display = skill.displayName ?? skill.skillId;
    lines.push(
      `- ${skill.skillId} (${display}): ${skill.description}` +
        (scriptList ? ` — scripts: ${scriptList}` : ""),
    );
  }
  return lines.join("\n");
}

/**
 * Spawn the Python skill-bridge with the given envelope on stdin and
 * return the parsed result envelope from stdout.
 *
 * Throws `RunSkillError` on:
 * - subprocess timeout (process killed)
 * - subprocess exit with no parseable stdout
 * - bridge envelope `{ ok: false }` (skill failure or bridge validation error)
 *
 * Returns the bridge envelope's `result` value on success.
 */
async function runBridge(
  envelope: BridgeEnvelope,
  options: {
    pythonBin: string;
    bridgeScriptPath: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  const { pythonBin, bridgeScriptPath, timeoutMs, env, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RunSkillError("Skill subprocess aborted before spawn"));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(pythonBin, [bridgeScriptPath], {
      env: env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      action();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore — process may have already exited
      }
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore — process may have already exited
      }
    };
    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    // Swallow EPIPE / write-after-end on stdin: if the bridge dies fast
    // (SyntaxError on import, OOM, abort-before-write), the stdin write
    // below races the subprocess close. Without this listener, the EPIPE
    // becomes an uncaught exception and crashes the parent Lambda.
    child.stdin?.on("error", () => {
      // intentionally silent — close handler reports the actual cause
    });

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      settle(() =>
        reject(
          new RunSkillError(`Failed to spawn skill bridge: ${err.message}`),
        ),
      );
    });

    child.on("close", (code) => {
      settle(() => {
        if (timedOut) {
          reject(
            new RunSkillError(
              `Skill subprocess timed out after ${timeoutMs}ms`,
            ),
          );
          return;
        }

        if (aborted) {
          reject(new RunSkillError("Skill subprocess aborted by caller"));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          reject(
            new RunSkillError(
              `Skill bridge exited (code=${code}) with no stdout. stderr: ${stderr.trim() || "(empty)"}`,
            ),
          );
          return;
        }

        let parsed: BridgeResult;
        try {
          parsed = JSON.parse(trimmed) as BridgeResult;
        } catch (err) {
          reject(
            new RunSkillError(
              `Skill bridge returned non-JSON stdout: ${(err as Error).message}. ` +
                `stdout: ${trimmed.slice(0, 500)}`,
            ),
          );
          return;
        }

        if (parsed.ok !== true) {
          const errorMsg =
            parsed.error ?? "Skill execution failed without an error message";
          const stderrTail = stderr.trim();
          const fullMsg = stderrTail
            ? `${errorMsg} (stderr: ${stderrTail.slice(-500)})`
            : errorMsg;
          reject(new RunSkillError(fullMsg, parsed.traceback));
          return;
        }

        resolve(parsed.result);
      });
    });

    // Send envelope and close stdin so the bridge sees EOF. EPIPE on
    // the write/end is captured by the stdin error listener above.
    try {
      child.stdin?.write(JSON.stringify(envelope));
      child.stdin?.end();
    } catch {
      // synchronous throw on broken pipe — ignore; close handler reports cause
    }
  });
}

/**
 * Build the `run_skill` Flue ToolDef from a skill manifest.
 *
 * Returns `null` when the manifest is empty so callers can compose
 * tool lists conditionally:
 *   `[ ...other, ...(buildRunSkillTool({ skills }) ? [buildRunSkillTool({ skills })!] : []) ]`
 */
export function buildRunSkillTool(
  options: RunSkillToolOptions,
): AgentTool<any> | null {
  const skills = options.skills;
  if (skills.length === 0) return null;

  const bySkillId = new Map(skills.map((s) => [s.skillId, s]));
  const pythonBin = options.pythonBin ?? DEFAULT_PYTHON_BIN;
  const bridgeScriptPath =
    options.bridgeScriptPath ?? DEFAULT_BRIDGE_SCRIPT_PATH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const envOverrides = options.envOverrides ?? {};

  return {
    name: "run_skill",
    label: "Run Skill",
    description: buildToolDescription(skills),
    parameters: Type.Object({
      skill_id: Type.String({
        description: "Slug of the skill to invoke. Must match the catalog.",
      }),
      kwargs: Type.Optional(
        Type.Object(
          {},
          {
            additionalProperties: true,
            description:
              "JSON object passed as **kwargs to the script function.",
          },
        ),
      ),
      script_name: Type.Optional(
        Type.String({
          description:
            "Script function name when the skill exposes more than one entry point. Defaults to the first script.",
        }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal) => {
      const skillId = String(
        (params as { skill_id?: unknown }).skill_id ?? "",
      ).trim();
      if (!skillId) {
        throw new RunSkillError(
          "run_skill called without a skill_id parameter.",
        );
      }

      const manifest = bySkillId.get(skillId);
      if (!manifest) {
        const available = [...bySkillId.keys()].join(", ");
        throw new RunSkillError(
          `Unknown skill '${skillId}'. Available: ${available || "(none)"}`,
        );
      }

      const script = resolveScript(
        manifest,
        (params as { script_name?: unknown }).script_name as string | undefined,
      );

      const kwargs =
        ((params as { kwargs?: unknown }).kwargs as
          | Record<string, unknown>
          | undefined) ?? {};

      const envelope: BridgeEnvelope = {
        skill_dir: manifest.skillDir,
        script_path: script.path,
        func_name: script.name,
        kwargs,
      };

      const skillEnv = envOverrides[skillId];
      const env = skillEnv
        ? { ...process.env, ...skillEnv }
        : process.env;

      const result = await runBridge(envelope, {
        pythonBin,
        bridgeScriptPath,
        timeoutMs,
        env,
        signal,
      });

      const text =
        typeof result === "string" ? result : JSON.stringify(result);

      return {
        content: [{ type: "text", text }],
        details: {
          skillId,
          scriptName: script.name,
          scriptPath: script.path,
          skillDir: manifest.skillDir,
        },
      };
    },
  };
}
