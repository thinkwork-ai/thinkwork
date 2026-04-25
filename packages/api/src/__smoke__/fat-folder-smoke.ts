import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseAgentsMd } from "../lib/agents-md-parser.js";

interface SmokeResult {
	name: string;
	ok: boolean;
	detail: string;
}

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const bucket = process.env.WORKSPACE_BUCKET || "";
const s3 = new S3Client({ region });

async function readText(key: string): Promise<string> {
	const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	return (await resp.Body?.transformToString("utf-8")) ?? "";
}

async function scenarioDefaultMapParses(): Promise<SmokeResult> {
	const content = await readText("workspace-defaults/AGENTS.md");
	const parsed = parseAgentsMd(content);
	return {
		name: "default-agents-map-parses",
		ok: parsed.warnings.length === 0,
		detail:
			parsed.warnings.length === 0
				? `routing_rows=${parsed.routing.length}`
				: parsed.warnings.join("; "),
	};
}

async function scenarioRouterNoLegacySkills(): Promise<SmokeResult> {
	const content = await readText("workspace-defaults/ROUTER.md");
	const legacy = content
		.split("\n")
		.filter((line) => /^-\s*skills:/i.test(line.trim()));
	return {
		name: "router-skills-directive-retired",
		ok: legacy.length === 0,
		detail: legacy.length === 0 ? "no legacy - skills: directives" : legacy.join("; "),
	};
}

async function scenarioCanonicalFilesPresent(): Promise<SmokeResult> {
	const keys = [
		"AGENTS.md",
		"CONTEXT.md",
		"GUARDRAILS.md",
		"PLATFORM.md",
		"CAPABILITIES.md",
		"ROUTER.md",
	];
	const missing: string[] = [];
	for (const key of keys) {
		try {
			await readText(`workspace-defaults/${key}`);
		} catch {
			missing.push(key);
		}
	}
	return {
		name: "canonical-defaults-present",
		ok: missing.length === 0,
		detail: missing.length === 0 ? `checked=${keys.length}` : `missing=${missing.join(",")}`,
	};
}

async function scenarioPinnedGraceDocumented(): Promise<SmokeResult> {
	const overlayDoc = await readText("workspace-defaults/AGENTS.md");
	const mentionsDepthCap = /depth is capped at 5/i.test(overlayDoc);
	const mentionsLocalSkills = /Local skills resolve nearest-folder-first/i.test(overlayDoc);
	return {
		name: "agent-map-runtime-invariants",
		ok: mentionsDepthCap && mentionsLocalSkills,
		detail: `depth_cap=${mentionsDepthCap} local_skill_resolution=${mentionsLocalSkills}`,
	};
}

async function main() {
	const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice("--stage=".length) ?? "dev";
	if (!bucket) throw new Error("WORKSPACE_BUCKET not configured");
	const scenarios = [
		scenarioCanonicalFilesPresent,
		scenarioDefaultMapParses,
		scenarioRouterNoLegacySkills,
		scenarioPinnedGraceDocumented,
	];
	const results: SmokeResult[] = [];
	for (const scenario of scenarios) {
		try {
			results.push(await scenario());
		} catch (err) {
			results.push({
				name: scenario.name,
				ok: false,
				detail: (err as { message?: string } | null)?.message || String(err),
			});
		}
	}
	console.log(JSON.stringify({ stage, bucket, results }, null, 2));
	const failed = results.filter((result) => !result.ok);
	if (failed.length > 0) {
		throw new Error(`fat-folder smoke failed: ${failed.map((f) => f.name).join(", ")}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

