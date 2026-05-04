/**
 * Plan §005 U12 — Mocked-AWS unit tests for the AgentCore CI connector.
 *
 * Test scenarios are sourced verbatim from spike plan U2 at
 * docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md
 * (lines ~205-215). The connector itself was landed via PR #783; this file
 * adds the deferred-from-spike unit coverage that pins the wire contract
 * the connector emits to AgentCore Code Interpreter and the parsing path
 * `consumeStream` walks for the responses it returns.
 *
 * Strategy:
 *   - Use `aws-sdk-client-mock` to construct a typed mock of
 *     `BedrockAgentCoreClient`. The mock matches commands by SDK class so
 *     each scenario can answer `Start`, `Invoke`, and `Stop` differently
 *     without test interference.
 *   - The connector receives a streaming response with
 *     `output: { stream: AsyncIterable }`. Each scenario builds a small
 *     async generator that yields the events `consumeStream` is documented
 *     to parse: `{ result: { structuredContent: {...}, content: [...] } }`.
 *   - For shape assertions (test 3), use
 *     `acMock.commandCalls(InvokeCodeInterpreterCommand)` to capture the
 *     exact `input` the connector built.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
	BedrockAgentCoreClient,
	type InvokeCodeInterpreterCommandOutput,
	InvokeCodeInterpreterCommand,
	StartCodeInterpreterSessionCommand,
	StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
	agentcoreCodeInterpreter,
	AgentcoreCodeInterpreterApi,
} from "./agentcore-codeinterpreter.js";

const acMock = mockClient(BedrockAgentCoreClient);

const INTERPRETER_ID = "thinkwork_dev_test_pub-XXXXXXXXXX";

beforeEach(() => {
	acMock.reset();
	// Default: every Start returns a stable session id; every Stop is a no-op.
	// Per-scenario `acMock.on(InvokeCodeInterpreterCommand)` calls override the
	// default `resolves({})` for invoke; tests that need multiple invocations
	// in different shapes use `.callsFake(...)` to dispatch on `name`.
	acMock.on(StartCodeInterpreterSessionCommand).resolves({ sessionId: "sess-1" });
	acMock.on(StopCodeInterpreterSessionCommand).resolves({});
});

afterEach(() => {
	acMock.reset();
});

/**
 * Build a mocked `InvokeCodeInterpreterCommandOutput` whose `stream` yields the
 * events `consumeStream` parses.
 *
 * The connector reads `result.structuredContent.{stdout, stderr, exitCode}`
 * for shell-style returns, `result.content[].text` for text blocks, and
 * `result.structuredContent.files` for file/directory listings.
 *
 * The cast through `unknown` is intentional: the SDK's
 * `CodeInterpreterStreamOutput` is a discriminated union sized to AWS's
 * full event vocabulary (see U13 for the typed-parse follow-up). The
 * connector only reads the `result` discriminator, so the test fixture
 * stays minimal and focused on what `consumeStream` actually inspects.
 */
function streamEvents(
	events: Array<Record<string, unknown>>,
): Partial<InvokeCodeInterpreterCommandOutput> {
	return {
		stream: (async function* () {
			for (const ev of events) yield ev;
		})() as unknown as InvokeCodeInterpreterCommandOutput["stream"],
	};
}

describe("agentcoreCodeInterpreter — exec (R1, happy path)", () => {
	it('exec("echo hello") resolves to { stdout: "hello\\n", stderr: "", exitCode: 0 }', async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { stdout: "hello\n", stderr: "", exitCode: 0 },
						content: [{ text: "hello\n" }],
						isError: false,
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const result = await api.exec("echo hello");

		expect(result).toEqual({ stdout: "hello\n", stderr: "", exitCode: 0 });
	});

	it("the executeCommand wire format carries the command verbatim when no env is supplied", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { stdout: "", stderr: "", exitCode: 0 },
						content: [],
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.exec("echo hello");

		const calls = acMock.commandCalls(InvokeCodeInterpreterCommand);
		expect(calls).toHaveLength(1);
		const input = calls[0]!.args[0].input as {
			codeInterpreterIdentifier: string;
			sessionId: string;
			name: string;
			arguments: { command: string };
		};
		expect(input.codeInterpreterIdentifier).toBe(INTERPRETER_ID);
		expect(input.sessionId).toBe("sess-1");
		expect(input.name).toBe("executeCommand");
		expect(input.arguments).toEqual({ command: "echo hello" });
	});
});

describe("agentcoreCodeInterpreter — readFile (R2, happy path)", () => {
	it('readFile("/tmp/test.txt") returns the mocked content string', async () => {
		const content = "the quick brown fox\n";
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: {
							files: [{ path: "/tmp/test.txt", text: content }],
							exitCode: 0,
						},
						content: [{ text: content }],
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const text = await api.readFile("/tmp/test.txt");

		expect(text).toBe(content);
	});

	it("the readFiles wire format carries `paths: [path]`", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: {
							files: [{ path: "/tmp/test.txt", text: "x" }],
							exitCode: 0,
						},
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.readFile("/tmp/test.txt");

		const input = acMock.commandCalls(InvokeCodeInterpreterCommand)[0]!.args[0]
			.input as { name: string; arguments: { paths: string[] } };
		expect(input.name).toBe("readFiles");
		expect(input.arguments).toEqual({ paths: ["/tmp/test.txt"] });
	});
});

describe("agentcoreCodeInterpreter — writeFile (R2, happy path + wire shape)", () => {
	it("writeFile invokes InvokeCodeInterpreterCommand with name `writeFiles` and the right argument shape", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { exitCode: 0, stdout: "", stderr: "" },
						content: [],
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.writeFile("/tmp/test.txt", "data");

		const calls = acMock.commandCalls(InvokeCodeInterpreterCommand);
		expect(calls).toHaveLength(1);
		const input = calls[0]!.args[0].input as {
			name: string;
			arguments: { content: Array<{ path: string; text: string }> };
		};
		expect(input.name).toBe("writeFiles");
		expect(input.arguments).toEqual({
			content: [{ path: "/tmp/test.txt", text: "data" }],
		});
	});

	it("writeFile decodes Uint8Array payloads and forwards them as text", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { exitCode: 0, stdout: "", stderr: "" },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const bytes = new TextEncoder().encode("binary-as-text");
		await api.writeFile("/tmp/blob.txt", bytes);

		const input = acMock.commandCalls(InvokeCodeInterpreterCommand)[0]!.args[0]
			.input as { arguments: { content: Array<{ path: string; text: string }> } };
		expect(input.arguments.content[0]!.text).toBe("binary-as-text");
	});

	it("writeFile surfaces a failure when the response carries a non-zero exitCode", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: {
							exitCode: 1,
							stdout: "",
							stderr: "permission denied",
						},
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await expect(api.writeFile("/tmp/forbidden", "data")).rejects.toThrow(
			/writeFile failed.*permission denied/,
		);
	});
});

describe("agentcoreCodeInterpreter — readFile error (edge case)", () => {
	it("readFile surfaces an error to the caller when the AWS client rejects (does not silently return empty string)", async () => {
		const networkError = new Error("AWS service unavailable");
		acMock.on(InvokeCodeInterpreterCommand).rejects(networkError);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);

		await expect(api.readFile("/tmp/missing.txt")).rejects.toThrow(
			"AWS service unavailable",
		);
	});

	it("readFile surfaces an error when the response has no file payload AND non-zero exitCode (does not silently return empty string)", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: {
							exitCode: 1,
							stdout: "",
							stderr: "ENOENT: /tmp/missing.txt",
						},
						content: [],
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);

		await expect(api.readFile("/tmp/missing.txt")).rejects.toThrow(
			/readFile failed.*\/tmp\/missing\.txt.*exitCode=1/,
		);
	});
});

describe("agentcoreCodeInterpreter — readdir (edge case: empty directory)", () => {
	it("readdir on an empty directory returns []", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { files: [], exitCode: 0 },
						content: [],
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const entries = await api.readdir("/tmp/empty");

		expect(entries).toEqual([]);
	});

	it("the listFiles wire format carries `directoryPath: <path>`", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { files: [], exitCode: 0 },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.readdir("/tmp/empty");

		const input = acMock.commandCalls(InvokeCodeInterpreterCommand)[0]!.args[0]
			.input as { name: string; arguments: { directoryPath: string } };
		expect(input.name).toBe("listFiles");
		expect(input.arguments).toEqual({ directoryPath: "/tmp/empty" });
	});

	it("readdir returns string entries when the response shape is `files: string[]`", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { files: ["a.txt", "b.txt"], exitCode: 0 },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const entries = await api.readdir("/tmp/listing");

		expect(entries).toEqual(["a.txt", "b.txt"]);
	});

	it("readdir extracts `name` from object entries when the response shape is `files: [{name}]`", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: {
							files: [{ name: "alpha" }, { name: "beta" }],
							exitCode: 0,
						},
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		const entries = await api.readdir("/tmp/listing");

		expect(entries).toEqual(["alpha", "beta"]);
	});
});

describe("agentcoreCodeInterpreter — factory + SessionEnv shape (integration)", () => {
	it("factory function returns an object whose createSessionEnv() produces a SessionEnv with the documented surface", async () => {
		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const factory = agentcoreCodeInterpreter(client, {
			interpreterId: INTERPRETER_ID,
		});
		expect(typeof factory.createSessionEnv).toBe("function");

		const env = await factory.createSessionEnv({ id: "session-test" });

		// Type-level + structural conformance: every documented SessionEnv
		// method must be present and callable. AgentCore CI is not invoked
		// at this point — `createSessionEnv` is lazy by design (the AWS
		// `Start` call defers until the first SessionEnv operation).
		expect(typeof env.exec).toBe("function");
		expect(typeof env.readFile).toBe("function");
		expect(typeof env.readFileBuffer).toBe("function");
		expect(typeof env.writeFile).toBe("function");
		expect(typeof env.readdir).toBe("function");
		expect(typeof env.stat).toBe("function");
		expect(typeof env.exists).toBe("function");
		expect(typeof env.mkdir).toBe("function");
		expect(typeof env.rm).toBe("function");
		expect(typeof env.resolvePath).toBe("function");
		expect(typeof env.cwd).toBe("string");
		expect(env.cwd).toBe("/home/user");
	});

	it("createSessionEnv honors a caller-supplied cwd", async () => {
		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const factory = agentcoreCodeInterpreter(client, {
			interpreterId: INTERPRETER_ID,
		});
		const env = await factory.createSessionEnv({ id: "sess", cwd: "/work" });

		expect(env.cwd).toBe("/work");
		expect(env.resolvePath("/work", "subdir/file.txt")).toBe(
			"/work/subdir/file.txt",
		);
		expect(env.resolvePath("/work", "/abs/path.txt")).toBe("/abs/path.txt");
	});

	it("cleanup option installs a SessionEnv.cleanup that triggers Stop on the session", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { exitCode: 0, stdout: "", stderr: "" },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const factory = agentcoreCodeInterpreter(client, {
			interpreterId: INTERPRETER_ID,
			cleanup: true,
		});
		const env = await factory.createSessionEnv({ id: "sess-cleanup" });

		// Force a Start by issuing one operation (cleanup of an unstarted
		// session is a no-op — see AgentcoreCodeInterpreterApi.stop).
		await env.exec("true");
		expect(env.cleanup).toBeDefined();
		await env.cleanup!();

		const stopCalls = acMock.commandCalls(StopCodeInterpreterSessionCommand);
		expect(stopCalls).toHaveLength(1);
		const stopInput = stopCalls[0]!.args[0].input as {
			codeInterpreterIdentifier: string;
			sessionId: string;
		};
		expect(stopInput.codeInterpreterIdentifier).toBe(INTERPRETER_ID);
		expect(stopInput.sessionId).toBe("sess-1");
	});

	it("default (no cleanup option) leaves SessionEnv.cleanup undefined", async () => {
		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const factory = agentcoreCodeInterpreter(client, {
			interpreterId: INTERPRETER_ID,
		});
		const env = await factory.createSessionEnv({ id: "sess-no-cleanup" });

		expect(env.cleanup).toBeUndefined();
	});
});

describe("agentcoreCodeInterpreter — session lifecycle (regression)", () => {
	it("only calls StartCodeInterpreterSession once across multiple operations on the same SessionEnv", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { exitCode: 0, stdout: "", stderr: "" },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.exec("true");
		await api.exec("true");
		await api.exec("true");

		const startCalls = acMock.commandCalls(StartCodeInterpreterSessionCommand);
		expect(startCalls).toHaveLength(1);
	});

	it("forwards env exports as a `export K=V && cmd` shell prefix on exec()", async () => {
		acMock.on(InvokeCodeInterpreterCommand).resolves(
			streamEvents([
				{
					result: {
						structuredContent: { exitCode: 0, stdout: "", stderr: "" },
					},
				},
			]),
		);

		const client = new BedrockAgentCoreClient({ region: "us-east-1" });
		const api = new AgentcoreCodeInterpreterApi(client, INTERPRETER_ID, 300);
		await api.exec("printenv FOO", { env: { FOO: "bar baz" } });

		const input = acMock.commandCalls(InvokeCodeInterpreterCommand)[0]!.args[0]
			.input as { arguments: { command: string } };
		expect(input.arguments.command).toBe(
			"export FOO='bar baz' && printenv FOO",
		);
	});
});
