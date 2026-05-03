/**
 * AgentCore Code Interpreter connector for Flue.
 *
 * Wraps AWS Bedrock AgentCore Code Interpreter into Flue's SandboxFactory
 * interface. Maps SessionEnv operations onto InvokeCodeInterpreterCommand
 * tool names: executeCommand, readFiles, writeFiles, listFiles, plus shell
 * wrappers for stat/exists/mkdir/rm.
 *
 * Spike-only as of 2026-05-03 — see
 * docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md.
 *
 * @example
 * ```typescript
 * import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
 * import { agentcoreCodeInterpreter } from '@thinkwork/flue-aws/connectors/agentcore-codeinterpreter';
 *
 * const client = new BedrockAgentCoreClient({ region: 'us-east-1' });
 * const sandbox = agentcoreCodeInterpreter(client, {
 *   interpreterId: 'thinkwork_dev_0015953e_pub-5rETNEk2Vt',
 *   cleanup: true,
 * });
 * const agent = await init({ sandbox, model: 'anthropic/claude-sonnet-4-6' });
 * ```
 */
import {
	BedrockAgentCoreClient,
	InvokeCodeInterpreterCommand,
	StartCodeInterpreterSessionCommand,
	StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
	FileStat,
	SandboxApi,
	SandboxFactory,
	SessionEnv,
	ShellResult,
} from "@flue/sdk/sandbox";

// ─── Options ────────────────────────────────────────────────────────────────

export interface AgentcoreCodeInterpreterOptions {
	/** AgentCore Code Interpreter identifier (e.g., `thinkwork_dev_0015953e_pub-5rETNEk2Vt`). */
	interpreterId: string;
	/**
	 * Cleanup behavior on session destroy.
	 * - `false` (default): leave the AgentCore session running until its TTL.
	 * - `true`: stop the AgentCore session.
	 */
	cleanup?: boolean;
	/** Session timeout in seconds. AgentCore default is 300; max is 28800 (8h). */
	sessionTimeoutSeconds?: number;
	/** Default cwd applied when Flue does not pass one. */
	defaultCwd?: string;
}

// ─── Stream parsing ─────────────────────────────────────────────────────────

interface ParsedStreamResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	structured: Record<string, unknown> | undefined;
	textBlocks: string[];
}

async function consumeStream(
	stream: AsyncIterable<unknown> | undefined,
): Promise<ParsedStreamResult> {
	const out: ParsedStreamResult = {
		stdout: "",
		stderr: "",
		exitCode: 0,
		structured: undefined,
		textBlocks: [],
	};
	if (!stream) return out;

	for await (const event of stream) {
		const e = event as Record<string, unknown>;
		const result = e.result as Record<string, unknown> | undefined;
		if (!result) continue;

		const sc = result.structuredContent as Record<string, unknown> | undefined;
		if (sc) {
			out.structured = sc;
			if (typeof sc.stdout === "string") out.stdout += sc.stdout;
			if (typeof sc.stderr === "string") out.stderr += sc.stderr;
			if (typeof sc.exitCode === "number") out.exitCode = sc.exitCode;
		}

		const content = result.content as Array<Record<string, unknown>> | undefined;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (typeof block.text === "string") {
					out.textBlocks.push(block.text);
					if (!sc) out.stdout += block.text;
				}
			}
		}
	}
	return out;
}

// ─── SandboxApi implementation ──────────────────────────────────────────────

class AgentcoreCodeInterpreterApi implements SandboxApi {
	private sessionId: string | undefined;

	constructor(
		private client: BedrockAgentCoreClient,
		private interpreterId: string,
		private timeoutSeconds: number,
	) {}

	private async ensureSession(): Promise<string> {
		if (this.sessionId) return this.sessionId;
		const response = await this.client.send(
			new StartCodeInterpreterSessionCommand({
				codeInterpreterIdentifier: this.interpreterId,
				sessionTimeoutSeconds: this.timeoutSeconds,
			}),
		);
		if (!response.sessionId) {
			throw new Error(
				"AgentCore Code Interpreter did not return a sessionId from StartCodeInterpreterSession",
			);
		}
		this.sessionId = response.sessionId;
		return this.sessionId;
	}

	async stop(): Promise<void> {
		if (!this.sessionId) return;
		await this.client.send(
			new StopCodeInterpreterSessionCommand({
				codeInterpreterIdentifier: this.interpreterId,
				sessionId: this.sessionId,
			}),
		);
		this.sessionId = undefined;
	}

	private async invoke(
		toolName: "executeCode" | "executeCommand" | "readFiles" | "writeFiles" | "listFiles" | "removeFiles",
		args: Record<string, unknown>,
	): Promise<ParsedStreamResult> {
		const sid = await this.ensureSession();
		const response = await this.client.send(
			new InvokeCodeInterpreterCommand({
				codeInterpreterIdentifier: this.interpreterId,
				sessionId: sid,
				name: toolName,
				// AWS SDK ToolArguments is a union; we cast since we vary fields per tool.
				arguments: args as never,
			}),
		);
		return consumeStream(response.stream as AsyncIterable<unknown> | undefined);
	}

	// ─── SessionEnv core ────────────────────────────────────────────────────

	async exec(
		command: string,
		options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
	): Promise<ShellResult> {
		// AgentCore CI executeCommand accepts only a `command` string. We layer
		// env exports via shell prefix; cwd is intentionally NOT prefixed because
		// AgentCore CI sessions ship with a non-customizable default cwd that may
		// not match the caller's expected path. Callers needing a specific cwd
		// should pass absolute paths in their commands directly.
		const envExports = options?.env
			? Object.entries(options.env)
					.map(([k, v]) => `export ${k}=${shellQuote(v)}`)
					.join(" && ")
			: "";
		const composed = [envExports, command].filter(Boolean).join(" && ");

		const result = await this.invoke("executeCommand", { command: composed });
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
		};
	}

	// ─── Direct AgentCore tool calls ────────────────────────────────────────

	async readFile(path: string): Promise<string> {
		const result = await this.invoke("readFiles", { paths: [path] });
		// readFiles structuredContent shape varies — try structured.files[0].text,
		// structured.content, then fall back to text blocks.
		const files = (result.structured?.files ?? result.structured?.content) as
			| Array<{ text?: string; content?: string }>
			| undefined;
		if (Array.isArray(files) && files[0]) {
			const first = files[0];
			if (typeof first.text === "string") return first.text;
			if (typeof first.content === "string") return first.content;
		}
		if (result.textBlocks.length > 0) return result.textBlocks.join("");
		// If exitCode != 0, the file likely doesn't exist; surface as an error.
		if (result.exitCode !== 0) {
			throw new Error(
				`readFile failed for ${path}: exitCode=${result.exitCode} stderr=${result.stderr}`,
			);
		}
		return result.stdout;
	}

	async readFileBuffer(path: string): Promise<Uint8Array> {
		// AgentCore CI readFiles returns text only; binary support is best-effort
		// via base64 in textBlocks (not exercised at spike tier).
		const text = await this.readFile(path);
		return new TextEncoder().encode(text);
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<void> {
		const text =
			typeof content === "string" ? content : new TextDecoder().decode(content);
		const result = await this.invoke("writeFiles", {
			content: [{ path, text }],
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`writeFile failed for ${path}: exitCode=${result.exitCode} stderr=${result.stderr}`,
			);
		}
	}

	async readdir(path: string): Promise<string[]> {
		const result = await this.invoke("listFiles", { directoryPath: path });
		const files = result.structured?.files as
			| Array<string | { name?: string; path?: string }>
			| undefined;
		if (Array.isArray(files)) {
			return files
				.map((f) =>
					typeof f === "string" ? f : f.name ?? f.path ?? "",
				)
				.filter(Boolean);
		}
		// Fall back to shell `ls -1`. Note: AgentCore CI may not expose listFiles
		// for arbitrary paths — fallback covers that case.
		const ls = await this.exec(`ls -1 ${shellQuote(path)}`);
		if (ls.exitCode !== 0) {
			throw new Error(`readdir failed for ${path}: ${ls.stderr}`);
		}
		return ls.stdout.split("\n").filter(Boolean);
	}

	// ─── Shell-wrapped operations (no direct AgentCore CI tool) ─────────────

	async stat(path: string): Promise<FileStat> {
		// `stat -c '%F|%s|%Y'` works on GNU coreutils (Linux). Output format:
		// "regular file|1024|1709504400" — type|size_bytes|mtime_unix.
		const result = await this.exec(
			`stat -c '%F|%s|%Y' ${shellQuote(path)} 2>/dev/null`,
		);
		if (result.exitCode !== 0) {
			throw new Error(`stat failed for ${path}: exitCode=${result.exitCode}`);
		}
		const parts = result.stdout.trim().split("|");
		const type = parts[0] ?? "";
		const size = Number(parts[1]) || 0;
		const mtimeSec = Number(parts[2]) || 0;
		return {
			isFile: type === "regular file" || type === "regular empty file",
			isDirectory: type === "directory",
			isSymbolicLink: type === "symbolic link",
			size,
			mtime: new Date(mtimeSec * 1000),
		};
	}

	async exists(path: string): Promise<boolean> {
		const result = await this.exec(`test -e ${shellQuote(path)}`);
		return result.exitCode === 0;
	}

	async mkdir(
		path: string,
		options?: { recursive?: boolean },
	): Promise<void> {
		const flag = options?.recursive ? "-p" : "";
		const cmd = `mkdir ${flag} ${shellQuote(path)}`.replace(/  +/g, " ");
		const result = await this.exec(cmd);
		if (result.exitCode !== 0) {
			throw new Error(`mkdir failed for ${path}: ${result.stderr}`);
		}
	}

	async rm(
		path: string,
		options?: { recursive?: boolean; force?: boolean },
	): Promise<void> {
		const flags = [
			options?.recursive ? "-r" : "",
			options?.force ? "-f" : "",
		]
			.filter(Boolean)
			.join("");
		const flagArg = flags ? `-${flags}` : "";
		const cmd = `rm ${flagArg} ${shellQuote(path)}`.replace(/  +/g, " ");
		const result = await this.exec(cmd);
		if (result.exitCode !== 0 && !options?.force) {
			throw new Error(`rm failed for ${path}: ${result.stderr}`);
		}
	}
}

// ─── SessionEnv wrapping ────────────────────────────────────────────────────

function shellQuote(s: string): string {
	// Single-quote with embedded-quote escape — safe for arbitrary user input.
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function normalizePath(path: string): string {
	const isAbs = path.startsWith("/");
	const parts = path.split("/").filter((p) => p && p !== ".");
	const stack: string[] = [];
	for (const p of parts) {
		if (p === "..") stack.pop();
		else stack.push(p);
	}
	const joined = stack.join("/");
	return isAbs ? `/${joined}` : joined;
}

function makeSessionEnv(
	api: AgentcoreCodeInterpreterApi,
	cwd: string,
	cleanup?: () => Promise<void>,
): SessionEnv {
	const resolvePath = (p: string): string => {
		if (p.startsWith("/")) return normalizePath(p);
		if (cwd === "/") return normalizePath(`/${p}`);
		return normalizePath(`${cwd}/${p}`);
	};

	return {
		exec: (cmd, opts) =>
			api.exec(cmd, {
				cwd: opts?.cwd ?? cwd,
				env: opts?.env,
				timeout: opts?.timeout,
			}),
		readFile: (p) => api.readFile(resolvePath(p)),
		readFileBuffer: (p) => api.readFileBuffer(resolvePath(p)),
		writeFile: (p, c) => api.writeFile(resolvePath(p), c),
		stat: (p) => api.stat(resolvePath(p)),
		readdir: (p) => api.readdir(resolvePath(p)),
		exists: (p) => api.exists(resolvePath(p)),
		mkdir: (p, opts) => api.mkdir(resolvePath(p), opts),
		rm: (p, opts) => api.rm(resolvePath(p), opts),
		cwd,
		resolvePath: (base, p) =>
			p.startsWith("/") ? p : base === "/" ? `/${p}` : `${base}/${p}`,
		cleanup,
	};
}

// ─── Public factory ─────────────────────────────────────────────────────────

export function agentcoreCodeInterpreter(
	client: BedrockAgentCoreClient,
	options: AgentcoreCodeInterpreterOptions,
): SandboxFactory {
	const timeout = options.sessionTimeoutSeconds ?? 300;
	const defaultCwd = options.defaultCwd ?? "/home/user";

	return {
		async createSessionEnv({ cwd }): Promise<SessionEnv> {
			const api = new AgentcoreCodeInterpreterApi(
				client,
				options.interpreterId,
				timeout,
			);
			const cleanup = options.cleanup
				? () => api.stop()
				: undefined;
			return makeSessionEnv(api, cwd ?? defaultCwd, cleanup);
		},
	};
}

// Exported for testing.
export { AgentcoreCodeInterpreterApi };
