#!/usr/bin/env node
// Lints that every Bedrock AgentCore AWS SDK command the Pi runtime calls is
// explicitly granted by the Pi runtime IAM role in
// terraform/modules/app/agentcore-pi/main.tf.
//
// Motivating incident: PR #493 had to add StartCodeInterpreterSession /
// InvokeCodeInterpreter / StopCodeInterpreterSession to the runtime role
// because the substrate PRs wired up the boto3 calls but never touched
// the IAM policy. The AccessDeniedException only surfaced at the first
// user-triggered sandbox turn — a week after the code landed.
//
// Approach:
//   1. Walk Pi runtime source dirs (non-test files).
//   2. For each file that imports @aws-sdk/client-bedrock-agentcore, collect
//      known `*Command` class usages that map to IAM actions.
//   3. Parse the terraform policy file for bedrock-agentcore:* actions
//      in Allow statements.
//   4. Fail the lint if any used operation maps to an action that isn't
//      granted. Warn on calls whose method name isn't in the registry
//      (prompts the developer to extend this script).
//
// Scope is deliberately narrow — one role, one service — because that's
// where we've been burned. Extending to lambda-api / eval-runner is a future
// copy-paste-and-edit job.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const repoRoot = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);

// Known bedrock-agentcore operation name map: AWS SDK command class → IAM
// CamelCase action. If a runtime imports a Command not in this registry, the
// lint warns rather than failing so a newly introduced operation is visible.
const OPERATION_MAP = {
  // Code Interpreter
  StartCodeInterpreterSessionCommand: "StartCodeInterpreterSession",
  InvokeCodeInterpreterCommand: "InvokeCodeInterpreter",
  StopCodeInterpreterSessionCommand: "StopCodeInterpreterSession",
  GetCodeInterpreterSessionCommand: "GetCodeInterpreterSession",
  ListCodeInterpreterSessionsCommand: "ListCodeInterpreterSessions",
  GetCodeInterpreterCommand: "GetCodeInterpreter",
  // Browser
  StartBrowserSessionCommand: "StartBrowserSession",
  StopBrowserSessionCommand: "StopBrowserSession",
  GetBrowserSessionCommand: "GetBrowserSession",
  ListBrowserSessionsCommand: "ListBrowserSessions",
  InvokeBrowserCommand: "InvokeBrowser",
  UpdateBrowserStreamCommand: "UpdateBrowserStream",
  // Memory / Events
  CreateEventCommand: "CreateEvent",
  ListEventsCommand: "ListEvents",
  GetEventCommand: "GetEvent",
  RetrieveMemoryRecordsCommand: "RetrieveMemoryRecords",
  ListMemoryRecordsCommand: "ListMemoryRecords",
  GetMemoryRecordCommand: "GetMemoryRecord",
  BatchCreateMemoryRecordsCommand: "BatchCreateMemoryRecords",
  BatchUpdateMemoryRecordsCommand: "BatchUpdateMemoryRecords",
  BatchDeleteMemoryRecordsCommand: "BatchDeleteMemoryRecords",
  DeleteMemoryRecordCommand: "DeleteMemoryRecord",
  // Runtime invocation (only relevant to callers, not the container itself)
  InvokeAgentRuntimeCommand: "InvokeAgentRuntime",
  // Evaluations
  EvaluateCommand: "Evaluate",
  GetEvaluatorCommand: "GetEvaluator",
  ListEvaluatorsCommand: "ListEvaluators",
};

const SOURCE_DIRS = [
  "packages/agentcore-pi/agent-container/src",
  "packages/pi-aws",
];

const TERRAFORM_FILE = "terraform/modules/app/agentcore-pi/main.tf";

const REQUIRED_ACTIONS = [
  {
    action: "StartBrowserSession",
    reason:
      "Pi browser automation starts managed Browser sessions through the Bedrock AgentCore client.",
  },
  {
    action: "StopBrowserSession",
    reason:
      "Keep the Pi runtime role complete for AgentCore Browser session lifecycle helpers.",
  },
  {
    action: "GetBrowserSession",
    reason:
      "Keep the Pi runtime role complete for AgentCore Browser session lifecycle helpers.",
  },
  {
    action: "ListBrowserSessions",
    reason:
      "Keep the Pi runtime role complete for AgentCore Browser session lifecycle helpers.",
  },
];

function listSourceFiles(dir) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    const full = path.join(abs, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (
        name === "node_modules" ||
        name === "dist" ||
        name === "build" ||
        name.startsWith(".")
      ) {
        continue;
      }
      out.push(...listSourceFiles(path.relative(repoRoot, full)));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
    if (name.includes(".test.") || name.includes(".spec.")) continue;
    out.push(full);
  }
  return out;
}

function findUsedOperations() {
  const uses = new Map(); // Command class -> [{file, line}]
  const unknown = new Map(); // Command class -> [{file, line}]
  for (const dir of SOURCE_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      if (!/@aws-sdk\/client-bedrock-agentcore/.test(text)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const commandRefs = [
          ...lines[i].matchAll(/\b([A-Z][A-Za-z0-9]+Command)\b/g),
        ];
        for (const m of commandRefs) {
          const name = m[1];
          if (Object.prototype.hasOwnProperty.call(OPERATION_MAP, name)) {
            const arr = uses.get(name) || [];
            arr.push({ file: path.relative(repoRoot, file), line: i + 1 });
            uses.set(name, arr);
          } else {
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
            file: "packages/agentcore-pi/agent-container/src/runtime/browser-automation-runner.ts",
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
      "[lint-agentcore-iam] Unknown bedrock-agentcore Command classes (extend OPERATION_MAP if these are real AWS SDK commands):",
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
      `[lint-agentcore-iam] OK — ${count} bedrock-agentcore command(s) used, all granted by ${TERRAFORM_FILE}`,
    );
    process.exit(hadWarn ? 0 : 0);
  }

  console.error(
    `[lint-agentcore-iam] FAIL — ${missing.length} bedrock-agentcore action(s) used but not granted:`,
  );
  for (const { op, action, citations } of missing) {
    console.error(`\n  Missing IAM action: bedrock-agentcore:${action}`);
    console.error(`    (used as ${op} in:)`);
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
