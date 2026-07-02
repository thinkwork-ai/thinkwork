/**
 * Harness ledger helper for scripts/deploy-harness.sh.
 *
 * Renders fingerprinted failure entries for the THINK-118 ledger. Entries are
 * deduped by fingerprint (layer + step + error class): a repeat failure updates
 * `last seen` on the existing record instead of creating a new one. Secret
 * values declared in the stage tfvars are scrubbed from log excerpts before
 * anything is written — excerpts leave the AWS account for a Linear ticket.
 *
 * Library usage (unit-tested):
 *   import { classifyError, extractSecretValues, fingerprint, renderEntry, upsertEntry }
 *
 * CLI usage (from the harness):
 *   node scripts/lib/harness-ledger.mjs entry \
 *     --layer terraform --step deploy --stage hprod-260701-042 \
 *     --log-file /tmp/deploy.log --tfvars <path> --ledger <path>/ledger.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SECRET_KEY_PATTERN = /(password|secret|token|api_key|private_key)/i;
const EXCERPT_LINES = 20;

/** Values of secret-shaped keys in a terraform.tfvars body. */
export function extractSecretValues(tfvarsContent) {
  const values = [];
  for (const line of tfvarsContent.split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"(.*)"\s*$/);
    if (match && SECRET_KEY_PATTERN.test(match[1]) && match[2].length >= 6) {
      values.push(match[2]);
    }
  }
  return values;
}

/** Replace every occurrence of each secret value with a scrub marker. */
export function scrubSecrets(text, secretValues) {
  let out = text;
  for (const value of secretValues) {
    out = out.split(value).join("«scrubbed»");
  }
  return out;
}

/** Coarse error classification used in the fingerprint. */
export function classifyError(logText) {
  const rules = [
    [/Error acquiring the state lock/i, "state-lock"],
    [/(AccessDenied|UnauthorizedOperation|not authorized)/i, "access-denied"],
    [
      /(ExpiredToken|expired credentials|security token.*expired)/i,
      "expired-credentials",
    ],
    [/(LimitExceeded|quota|TooManyRequests|Throttling)/i, "quota-or-throttle"],
    [/(certificate|ACM|DNS|delegation|NXDOMAIN)/i, "dns-or-cert"],
    [
      /(AlreadyExists|already exists|scheduled for deletion)/i,
      "already-exists",
    ],
    [
      /terraform (init|apply|destroy).*(exit|failed)|Error: /i,
      "terraform-error",
    ],
    [/(ECONNREFUSED|ETIMEDOUT|timed out|connection reset)/i, "connectivity"],
  ];
  for (const [pattern, cls] of rules) {
    if (pattern.test(logText)) return cls;
  }
  return "unclassified";
}

/** Stable fingerprint for dedupe: layer + step + error class. */
export function fingerprint({ layer, step, errorClass }) {
  return createHash("sha256")
    .update(`${layer}|${step}|${errorClass}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Upsert an entry into the ledger store (JSON object keyed by fingerprint).
 * Returns { entry, isNew }. `now` is an ISO timestamp supplied by the caller.
 */
export function upsertEntry(
  store,
  { layer, step, stage, errorClass, excerpt, now },
) {
  const fp = fingerprint({ layer, step, errorClass });
  const existing = store[fp];
  if (existing) {
    existing.lastSeen = now;
    existing.occurrences += 1;
    existing.stage = stage;
    // Refresh the excerpt: rendering a prior cycle's log tail under the
    // current cycle's stage misattributes the evidence (cycle-5 diagnosis
    // was briefly derailed by a cycle-4 excerpt naming a different stage).
    existing.excerpt = excerpt;
    return { entry: existing, isNew: false };
  }
  const entry = {
    fingerprint: fp,
    layer,
    step,
    errorClass,
    stage,
    firstSeen: now,
    lastSeen: now,
    occurrences: 1,
    excerpt,
    fixStatus: "open",
  };
  store[fp] = entry;
  return { entry, isNew: true };
}

/** Render one entry as a THINK-118-ready markdown block. */
export function renderEntry(entry) {
  return [
    `**Harness failure \`${entry.fingerprint}\`** — layer: **${entry.layer}**, step: \`${entry.step}\`, class: \`${entry.errorClass}\``,
    `- Stage: \`${entry.stage}\` · first seen: ${entry.firstSeen} · last seen: ${entry.lastSeen} · occurrences: ${entry.occurrences} · fix: ${entry.fixStatus}`,
    "```",
    entry.excerpt,
    "```",
  ].join("\n");
}

function lastLines(text, n) {
  const lines = text.trimEnd().split("\n");
  return lines.slice(-n).join("\n");
}

function argValue(args, name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

// CLI entrypoint: `node harness-ledger.mjs entry --layer ... --step ...`
if (process.argv[2] === "entry") {
  const args = process.argv.slice(3);
  const layer = argValue(args, "--layer") ?? "unknown";
  const step = argValue(args, "--step") ?? "unknown";
  const stage = argValue(args, "--stage") ?? "unknown";
  const logFile = argValue(args, "--log-file");
  const tfvarsPath = argValue(args, "--tfvars");
  const ledgerPath = argValue(args, "--ledger") ?? "harness-ledger.json";

  const logText =
    logFile && existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  const secrets =
    tfvarsPath && existsSync(tfvarsPath)
      ? extractSecretValues(readFileSync(tfvarsPath, "utf8"))
      : [];
  const excerpt = scrubSecrets(lastLines(logText, EXCERPT_LINES), secrets);
  const errorClass = classifyError(logText);

  const store = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, "utf8"))
    : {};
  const { entry, isNew } = upsertEntry(store, {
    layer,
    step,
    stage,
    errorClass,
    excerpt,
    now: new Date().toISOString(),
  });
  writeFileSync(ledgerPath, JSON.stringify(store, null, 2) + "\n");

  console.log(
    isNew
      ? "── new ledger entry ──"
      : "── repeat failure (last-seen updated) ──",
  );
  console.log(renderEntry(entry));
}
