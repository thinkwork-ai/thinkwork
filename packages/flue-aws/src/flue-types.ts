/**
 * Vendored type stubs from @flue/sdk/sandbox + @flue/sdk types.
 *
 * @flue/sdk is not yet published to npm. To keep this package self-checking,
 * the minimal interfaces we use are reproduced here verbatim. When @flue/sdk
 * lands on npm, this file is deleted and the connector imports from
 * `@flue/sdk/sandbox` directly.
 *
 * Source: github.com/withastro/flue@0.3.10
 *   - packages/sdk/src/sandbox.ts (SandboxApi)
 *   - packages/sdk/src/types.ts (SandboxFactory, SessionEnv, FileStat, ShellResult)
 */

/** Result of a shell command execution. */
export interface ShellResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** File metadata returned from `stat`. */
export interface FileStat {
	isFile: boolean;
	isDirectory: boolean;
	isSymbolicLink: boolean;
	size: number;
	mtime: Date;
}

/**
 * Implementation surface a sandbox connector provides. Wrapped by
 * `createSandboxSessionEnv` (in @flue/sdk) into a SessionEnv with cwd-resolved
 * path semantics. This connector inlines the wrapping (since @flue/sdk is not
 * runtime-available) — see `makeSessionEnv` in agentcore-codeinterpreter.ts.
 */
export interface SandboxApi {
	readFile(path: string): Promise<string>;
	readFileBuffer(path: string): Promise<Uint8Array>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	stat(path: string): Promise<FileStat>;
	readdir(path: string): Promise<string[]>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	exec(
		command: string,
		options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
	): Promise<ShellResult>;
}

/** Universal session environment Flue's harness consumes. */
export interface SessionEnv {
	exec(
		command: string,
		options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
	): Promise<ShellResult>;
	readFile(path: string): Promise<string>;
	readFileBuffer(path: string): Promise<Uint8Array>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	stat(path: string): Promise<FileStat>;
	readdir(path: string): Promise<string[]>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
	cwd: string;
	resolvePath(base: string, path: string): string;
	cleanup?(): Promise<void>;
}

/** Connector entry point — Flue calls `createSessionEnv` per invocation. */
export interface SandboxFactory {
	createSessionEnv(options: { id: string; cwd?: string }): Promise<SessionEnv>;
}
