/**
 * audit-verifier CLI entry point.
 *
 * Thin wrapper around `verifyBucket` from src/verify.ts. Parses argv
 * via commander, calls the orchestrator, prints the JSON report to
 * stdout, and exits with the right code:
 *
 *     0 — verified (every claim cryptographically reproduced)
 *     1 — at least one mismatch / failure / drift recorded
 *     2 — unrecoverable error (S3 access denied, bucket missing)
 *
 * Per ce-doc-review SEC-U9-001, the database connection string for
 * `--check-chain` is read from an environment variable named via
 * `--db-url-env <VAR>` rather than passed on the argv. Putting the
 * connection string on the argv leaks it via `ps`, shell history, and
 * CI logs.
 */

import { Command } from "commander";
import { verifyBucket, type VerifyOptions } from "../verify";

interface CliOpts {
	bucket: string;
	region: string;
	since?: string;
	until?: string;
	tenantId?: string;
	concurrency: string;
	checkRetention: boolean;
	checkChain: boolean;
	dbUrlEnv?: string;
}

async function main(): Promise<void> {
	const program = new Command();
	program
		.name("audit-verifier")
		.description(
			"Verify the WORM-locked audit-evidence anchors written by Thinkwork's compliance-anchor Lambda. Re-derives every Merkle root from scratch (RFC 6962) — does NOT trust the writer.",
		)
		.version("0.1.0")
		.requiredOption(
			"--bucket <name>",
			"S3 bucket name (e.g., thinkwork-prod-compliance-anchors)",
		)
		.option("--region <region>", "AWS region", "us-east-1")
		.option("--since <iso>", "ISO8601 inclusive start of cadence window")
		.option("--until <iso>", "ISO8601 exclusive end of cadence window")
		.option(
			"--tenant-id <uuid>",
			"Restrict --check-chain to one tenant",
		)
		.option(
			"--concurrency <n>",
			"Max parallel S3 requests (default 8)",
			"8",
		)
		.option(
			"--check-retention",
			"Verify each anchor has Object Lock retention configured + non-expired",
		)
		.option(
			"--check-chain",
			"Walk audit_events and verify each tenant's prev_hash chain (requires --db-url-env)",
		)
		.option(
			"--db-url-env <var>",
			"Name of an environment variable containing the Postgres connection string for --check-chain",
		);

	program.parse(process.argv);
	const opts = program.opts<CliOpts>();

	if (opts.checkChain && !opts.dbUrlEnv) {
		console.error(
			"audit-verifier: --check-chain requires --db-url-env <VAR_NAME>. Set the connection string in that env var (do NOT put it on the command line; it leaks via ps + shell history).",
		);
		process.exit(2);
	}

	const dbUrl = opts.dbUrlEnv ? process.env[opts.dbUrlEnv] : undefined;
	if (opts.checkChain && opts.dbUrlEnv && !dbUrl) {
		console.error(
			`audit-verifier: env var '${opts.dbUrlEnv}' is unset or empty. Export it before invoking --check-chain.`,
		);
		process.exit(2);
	}

	const concurrency = Number.parseInt(opts.concurrency, 10);
	if (!Number.isFinite(concurrency) || concurrency < 1) {
		console.error(
			`audit-verifier: --concurrency must be a positive integer, got '${opts.concurrency}'`,
		);
		process.exit(2);
	}

	const since = opts.since ? new Date(opts.since) : undefined;
	const until = opts.until ? new Date(opts.until) : undefined;
	if (since && Number.isNaN(since.getTime())) {
		console.error(
			`audit-verifier: --since '${opts.since}' is not a valid ISO8601 timestamp`,
		);
		process.exit(2);
	}
	if (until && Number.isNaN(until.getTime())) {
		console.error(
			`audit-verifier: --until '${opts.until}' is not a valid ISO8601 timestamp`,
		);
		process.exit(2);
	}

	const verifyOpts: VerifyOptions = {
		bucket: opts.bucket,
		region: opts.region,
		since,
		until,
		tenantId: opts.tenantId,
		concurrency,
		checkRetention: opts.checkRetention === true,
		checkChain: opts.checkChain === true,
		dbUrl,
	};

	let report;
	try {
		report = await verifyBucket(verifyOpts);
	} catch (err) {
		console.error(
			`audit-verifier: unrecoverable error — ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
		process.exit(2);
	}

	process.stdout.write(JSON.stringify(report, null, 2) + "\n");
	process.exit(report.verified ? 0 : 1);
}

main().catch((err) => {
	console.error(
		`audit-verifier: unhandled exception — ${
			err instanceof Error ? err.message : String(err)
		}`,
	);
	process.exit(2);
});
