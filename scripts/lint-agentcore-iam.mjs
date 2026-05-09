#!/usr/bin/env node
// Lints that every bedrock-agentcore boto3 method the Strands agent
// container calls is explicitly granted by the AgentCore runtime IAM
// role in terraform/modules/app/agentcore-runtime/main.tf.
//
// Motivating incident: PR #493 had to add StartCodeInterpreterSession /
// InvokeCodeInterpreter / StopCodeInterpreterSession to the runtime role
// because the substrate PRs wired up the boto3 calls but never touched
// the IAM policy. The AccessDeniedException only surfaced at the first
// user-triggered sandbox turn — a week after the code landed.
//
// Approach:
//   1. Walk the Strands agent-container source dirs (non-test files).
//   2. For each file that imports boto3 AND constructs a bedrock-agentcore
//      client, collect snake_case method calls that match a known
//      bedrock-agentcore operation.
//   3. Parse the terraform policy file for bedrock-agentcore:* actions
//      in Allow statements.
//   4. Fail the lint if any used operation maps to an action that isn't
//      granted. Warn on calls whose method name isn't in the registry
//      (prompts the developer to extend this script).
//
// Scope is deliberately narrow — one role, one service — because that's
// where we've been burned. Extending to lambda-api / eval-runner is a
// future copy-paste-and-edit job.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);

// Known bedrock-agentcore operation name map: boto3 snake_case → IAM
// CamelCase action. If a container calls a method not in this registry,
// the lint warns rather than failing — so an operation doesn't get
// silently skipped when boto3 adds a new one.
const OPERATION_MAP = {
  // Code Interpreter
  start_code_interpreter_session: "StartCodeInterpreterSession",
  invoke_code_interpreter: "InvokeCodeInterpreter",
  stop_code_interpreter_session: "StopCodeInterpreterSession",
  get_code_interpreter_session: "GetCodeInterpreterSession",
  list_code_interpreter_sessions: "ListCodeInterpreterSessions",
  get_code_interpreter: "GetCodeInterpreter",
  // Memory / Events
  create_event: "CreateEvent",
  list_events: "ListEvents",
  get_event: "GetEvent",
  retrieve_memory_records: "RetrieveMemoryRecords",
  list_memory_records: "ListMemoryRecords",
  get_memory_record: "GetMemoryRecord",
  batch_create_memory_records: "BatchCreateMemoryRecords",
  batch_update_memory_records: "BatchUpdateMemoryRecords",
  batch_delete_memory_records: "BatchDeleteMemoryRecords",
  delete_memory_record: "DeleteMemoryRecord",
  // Runtime invocation (only relevant to callers, not the container itself)
  invoke_agent_runtime: "InvokeAgentRuntime",
  // Evaluations
  evaluate: "Evaluate",
  get_evaluator: "GetEvaluator",
  list_evaluators: "ListEvaluators",
};

const SOURCE_DIRS = [
  "packages/agentcore-strands/agent-container",
  "packages/agentcore/agent-container",
];

const TERRAFORM_FILE = "terraform/modules/app/agentcore-runtime/main.tf";

const REQUIRED_ACTIONS = [
  {
    action: "StartBrowserSession",
    reason:
      "browser_automation_tool.py uses the bedrock_agentcore BrowserSession helper, whose boto3 calls live in the dependency package.",
  },
  {
    action: "StopBrowserSession",
    reason:
      "browser_automation_tool.py closes the managed browser session through the dependency helper context manager.",
  },
  {
    action: "GetBrowserSession",
    reason:
      "AgentCore Browser helpers may inspect the managed browser session while generating CDP headers.",
  },
  {
    action: "ListBrowserSessions",
    reason:
      "Keep the runtime role complete for AgentCore Browser session lifecycle helpers.",
  },
];

function listPythonFiles(dir) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    const full = path.join(abs, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) continue;
    if (!name.endsWith(".py")) continue;
    if (name.startsWith("test_") || name === "conftest.py") continue;
    out.push(full);
  }
  return out;
}

function findUsedOperations() {
  const uses = new Map(); // op snake_case -> [{file, line}]
  const unknown = new Map(); // method name -> [{file, line}]
  for (const dir of SOURCE_DIRS) {
    for (const file of listPythonFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      // Does this file touch the bedrock-agentcore client at all? If not,
      // skip — we don't want false positives from methods that happen to
      // share names with other AWS services (e.g. list_events exists on
      // multiple clients).
      if (!/\.client\(\s*["']bedrock-agentcore["']/.test(text)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // Match any `.some_snake_case_name(` that could be a boto3 call.
        // We only care about the operation registry, plus an unknown-warn
        // list for operations we've never seen.
        const methodCalls = [...lines[i].matchAll(/\.([a-z][a-z0-9_]+)\s*\(/g)];
        for (const m of methodCalls) {
          const name = m[1];
          if (Object.prototype.hasOwnProperty.call(OPERATION_MAP, name)) {
            const arr = uses.get(name) || [];
            arr.push({ file: path.relative(repoRoot, file), line: i + 1 });
            uses.set(name, arr);
          } else if (
            // Flag potential bedrock-agentcore-shaped calls we don't know.
            // Heuristic: caller variable contains "agentcore" / "sb" /
            // "interpreter" / "memory" AND the method name looks like a
            // boto3 snake_case op (3+ components). This is intentionally
            // conservative — false positives here just prompt the author
            // to extend OPERATION_MAP.
            /\b(agentcore|interpreter|memory|_sb_client|event)\b/.test(
              lines[i],
            ) &&
            /^(?:[a-z]+_){2,}[a-z]+$/.test(name)
          ) {
            const arr = unknown.get(name) || [];
            arr.push({ file: path.relative(repoRoot, file), line: i + 1 });
            unknown.set(name, arr);
          }
        }
      }
    }
  }
  return { uses, unknown };
}

function findGrantedActions() {
  const abs = path.join(repoRoot, TERRAFORM_FILE);
  if (!fs.existsSync(abs)) {
    throw new Error(`Terraform file not found: ${TERRAFORM_FILE}`);
  }
  const text = fs.readFileSync(abs, "utf8");
  // Match "bedrock-agentcore:SomeAction" occurrences. Deny statements
  // are vanishingly rare in this module; we treat any match as granted
  // for simplicity. If that changes, parse statements with an HCL library.
  const granted = new Set();
  for (const m of text.matchAll(/"bedrock-agentcore:([A-Z][A-Za-z0-9]+)"/g)) {
    granted.add(m[1]);
  }
  return granted;
}

function main() {
  const { uses, unknown } = findUsedOperations();
  const granted = findGrantedActions();

  const missing = [];
  for (const [op, citations] of uses) {
    const action = OPERATION_MAP[op];
    if (!granted.has(action)) {
      missing.push({ op, action, citations });
    }
  }

  for (const required of REQUIRED_ACTIONS) {
    if (!granted.has(required.action)) {
      missing.push({
        op: "(dependency helper)",
        action: required.action,
        citations: [
          {
            file: "packages/agentcore-strands/agent-container/container-sources/browser_automation_tool.py",
            line: 0,
            reason: required.reason,
          },
        ],
      });
    }
  }

  let hadWarn = false;
  if (unknown.size > 0) {
    hadWarn = true;
    console.warn(
      "[lint-agentcore-iam] Unknown bedrock-agentcore-shaped methods (extend OPERATION_MAP if these are real boto3 ops):",
    );
    for (const [name, cites] of unknown) {
      for (const c of cites) {
        console.warn(`  ${name}  at  ${c.file}:${c.line}`);
      }
    }
  }

  if (missing.length === 0) {
    const count = uses.size;
    console.log(
      `[lint-agentcore-iam] OK — ${count} bedrock-agentcore op(s) used, all granted by ${TERRAFORM_FILE}`,
    );
    process.exit(hadWarn ? 0 : 0);
  }

  console.error(
    `[lint-agentcore-iam] FAIL — ${missing.length} bedrock-agentcore action(s) used but not granted:`,
  );
  for (const { op, action, citations } of missing) {
    console.error(`\n  Missing IAM action: bedrock-agentcore:${action}`);
    console.error(`    (called as client.${op}(...) in:)`);
    for (const c of citations) {
      const suffix = c.line > 0 ? `:${c.line}` : "";
      const reason = c.reason ? ` — ${c.reason}` : "";
      console.error(`      - ${c.file}${suffix}${reason}`);
    }
  }
  console.error(
    `\n  Fix: add the missing action(s) to the policy in ${TERRAFORM_FILE}.`,
  );
  process.exit(1);
}

main();
