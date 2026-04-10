import { readFileSync } from "fs";

const results = JSON.parse(readFileSync("eval/results.json", "utf-8"));
const baseline = JSON.parse(
  readFileSync("eval/baselines/latest.json", "utf-8")
);

const REGRESSION_THRESHOLD = 0.05; // 5% drop tolerance

const currentPassRate = results.stats?.successes / results.stats?.total || 0;
const baselinePassRate = baseline.passRate || 0;

const delta = baselinePassRate - currentPassRate;

console.log(`Current pass rate: ${(currentPassRate * 100).toFixed(1)}%`);
console.log(`Baseline pass rate: ${(baselinePassRate * 100).toFixed(1)}%`);
console.log(`Delta: ${(delta * 100).toFixed(1)}%`);

if (delta > REGRESSION_THRESHOLD) {
  console.error(
    `REGRESSION: Pass rate dropped by ${(delta * 100).toFixed(1)}% (threshold: ${(REGRESSION_THRESHOLD * 100).toFixed(1)}%)`
  );
  process.exit(1);
}

console.log("No regression detected.");
