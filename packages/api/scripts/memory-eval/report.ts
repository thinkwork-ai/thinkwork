#!/usr/bin/env -S tsx
/**
 * THINK-198 memory-quality eval harness — step 4: aggregate one or more
 * judge-scored runs into a markdown comparison report.
 *
 * Exit criteria per THINK-198: a candidate wins the P2 swap only if
 * dangling-referent rate AND dup rate strictly improve vs the baseline
 * (`openai.gpt-oss-20b-1:0`), faithfulness/usefulness stay >= baseline, and
 * retain latency stays well under the ALB/Lambda budget (300s). This script
 * reports the numbers; the swap decision itself is manual (see README).
 *
 * Usage:
 *   npx tsx packages/api/scripts/memory-eval/report.ts \
 *     --runs /tmp/memory-eval/runs \
 *     --out /tmp/memory-eval/report.md
 */

import { pathToFileURL } from "node:url";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JudgeReport, JudgeVerdict } from "./judge.js";

export interface ReportArgs {
  runsDir?: string;
  files: string[];
  out: string;
}

export interface CandidateStats {
  candidate: string;
  judgeModelId: string;
  promptVersion: string;
  documents: number;
  units: number;
  unitsPerDoc: number;
  avgUnitLength: number;
  danglingReferentRate: number;
  dupRate: number;
  avgFaithful: number;
  avgUseful: number;
}

export interface WorstUnit {
  candidate: string;
  threadId: string;
  unitId: string;
  text: string;
  referentComplete: 0 | 1;
  danglingReferents: string[];
  faithful: number;
  useful: number;
  duplicateOf: string | null;
  composite: number;
}

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ReportArgs {
  const args: ReportArgs = {
    runsDir: env.MEMORY_EVAL_RUNS_DIR,
    files: [],
    out: "/tmp/memory-eval/report.md",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--runs":
        args.runsDir = requireValue(argv, ++i, arg);
        break;
      case "--file":
        args.files.push(requireValue(argv, ++i, arg));
        break;
      case "--out":
        args.out = requireValue(argv, ++i, arg);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.runsDir && args.files.length === 0) {
    throw new Error("--runs <dir> or at least one --file <path> is required");
  }

  return args;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp(): void {
  console.log(`Usage: report --runs <dir> --out <path.md>
       report --file <scores.json> [--file <scores.json> ...] --out <path.md>

Aggregates *.scores.json judge outputs (one per candidate) into a markdown
comparison table + a worst-10-units appendix per candidate. Refuses to
compare runs tagged with different judge prompt versions.`);
}

export async function resolveScoreFiles(args: ReportArgs): Promise<string[]> {
  const files = [...args.files];
  if (args.runsDir) {
    const entries = await readdir(args.runsDir);
    for (const entry of entries) {
      if (entry.endsWith(".scores.json")) files.push(join(args.runsDir, entry));
    }
  }
  return files;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregateCandidate(report: JudgeReport): CandidateStats {
  const allUnits: JudgeVerdict[] = report.documents.flatMap((d) => d.units);
  const unitCount = allUnits.length;
  const danglingCount = allUnits.filter((u) => u.referentComplete === 0).length;
  const dupCount = allUnits.filter((u) => u.duplicateOf !== null).length;

  return {
    candidate: report.candidate,
    judgeModelId: report.judgeModelId,
    promptVersion: report.promptVersion,
    documents: report.documents.length,
    units: unitCount,
    unitsPerDoc:
      report.documents.length > 0 ? unitCount / report.documents.length : 0,
    avgUnitLength: mean(allUnits.map((u) => u.text.length)),
    danglingReferentRate: unitCount > 0 ? danglingCount / unitCount : 0,
    dupRate: unitCount > 0 ? dupCount / unitCount : 0,
    avgFaithful: mean(allUnits.map((u) => u.faithful)),
    avgUseful: mean(allUnits.map((u) => u.useful)),
  };
}

function unitComposite(u: JudgeVerdict): number {
  // Lower is worse. Dangling referents and duplicates are the strongest
  // negative signals; faithfulness/usefulness weigh in linearly.
  return (
    u.referentComplete * 3 +
    u.faithful +
    u.useful -
    (u.duplicateOf !== null ? 2 : 0)
  );
}

export function worstUnits(report: JudgeReport, limit = 10): WorstUnit[] {
  const all: WorstUnit[] = report.documents.flatMap((d) =>
    d.units.map((u) => ({
      candidate: report.candidate,
      threadId: d.threadId,
      unitId: u.unitId,
      text: u.text,
      referentComplete: u.referentComplete,
      danglingReferents: u.danglingReferents,
      faithful: u.faithful,
      useful: u.useful,
      duplicateOf: u.duplicateOf,
      composite: unitComposite(u),
    })),
  );
  return all.sort((a, b) => a.composite - b.composite).slice(0, limit);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function buildMarkdownReport(reports: JudgeReport[]): string {
  if (reports.length === 0) {
    return "# Memory-Quality Eval Report\n\nNo scored runs found.\n";
  }

  const promptVersions = new Set(reports.map((r) => r.promptVersion));
  if (promptVersions.size > 1) {
    throw new Error(
      `Refusing to compare runs with mismatched judge prompt versions: ${[...promptVersions].join(", ")}`,
    );
  }

  const stats = reports.map(aggregateCandidate);
  const lines: string[] = [];
  lines.push("# Memory-Quality Eval Report (THINK-198)");
  lines.push("");
  lines.push(
    `Judge: ${reports[0].judgeModelId} / prompt ${reports[0].promptVersion}`,
  );
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "| Candidate | Docs | Units | Units/Doc | Avg Unit Len | Dangling-Referent % | Dup % | Faithfulness (0-2) | Usefulness (0-2) |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of stats) {
    lines.push(
      `| ${s.candidate} | ${s.documents} | ${s.units} | ${s.unitsPerDoc.toFixed(2)} | ${s.avgUnitLength.toFixed(0)} | ${pct(s.danglingReferentRate)} | ${pct(s.dupRate)} | ${s.avgFaithful.toFixed(2)} | ${s.avgUseful.toFixed(2)} |`,
    );
  }
  lines.push("");
  lines.push(
    "Exit criteria (THINK-198 P2 swap gate): a candidate wins only if dangling-referent rate AND dup rate strictly improve vs baseline, faithfulness/usefulness stay >= baseline, and retain latency stays well under the 300s ALB/Lambda budget (see run-retain output for per-thread wall time).",
  );
  lines.push("");

  for (const report of reports) {
    lines.push(`## ${report.candidate} — worst 10 units`);
    lines.push("");
    const worst = worstUnits(report, 10);
    if (worst.length === 0) {
      lines.push("_No units scored._");
      lines.push("");
      continue;
    }
    for (const u of worst) {
      lines.push(
        `- **thread ${u.threadId} / unit ${u.unitId}** (composite ${u.composite})`,
      );
      lines.push(`  - text: ${u.text.replace(/\n/g, " ")}`);
      lines.push(
        `  - referentComplete=${u.referentComplete} dangling=${JSON.stringify(u.danglingReferents)} faithful=${u.faithful} useful=${u.useful} duplicateOf=${u.duplicateOf ?? "null"}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = await resolveScoreFiles(args);
  const reports: JudgeReport[] = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(f, "utf8"))),
  );

  const markdown = buildMarkdownReport(reports);

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, markdown, "utf8");
  console.log(
    `[report] aggregated ${reports.length} candidate(s) -> ${args.out}`,
  );
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((err) => {
    console.error(`[report] fatal: ${(err as Error).stack ?? err}`);
    process.exit(1);
  });
}
