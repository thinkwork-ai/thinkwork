#!/usr/bin/env node
// thinkwork-managed: enterprise-deploy-template
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));

try {
  const stage = required("--stage");
  const terraformDir = required("--terraform-dir");
  const outputPath = required("--summary");
  const targets = [
    ["api_endpoint", "api"],
    ["admin_url", "admin"],
    ["computer_url", "computer"],
    ["docs_url", "docs"],
  ]
    .map(([output, name]) => ({
      name,
      url: terraformOutput(terraformDir, output),
    }))
    .filter((target) => target.url);

  const results = [];
  for (const target of targets) {
    results.push(await probe(target));
  }
  const failed = results.filter((result) => result.status !== "ok");
  const summary = {
    status: failed.length === 0 ? "ok" : "degraded",
    stage,
    checkedAt: new Date().toISOString(),
    results,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (failed.length > 0) {
    console.warn(
      `Smoke checks degraded: ${failed.map((item) => item.name).join(", ")}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function probe(target) {
  try {
    const response = await fetch(target.url, { method: "GET" });
    return {
      ...target,
      status: response.ok || response.status < 500 ? "ok" : "error",
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      ...target,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function terraformOutput(terraformDir, name) {
  try {
    return execFileSync(
      "terraform",
      ["-chdir=" + terraformDir, "output", "-raw", name],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg.startsWith("--") && value && !value.startsWith("--")) {
      parsed[arg] = value;
      index += 1;
    }
  }
  return parsed;
}

function required(flag) {
  const value = args[flag];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}
