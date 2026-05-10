/**
 * useComposerState tests + the U13 single-submit invariant regression.
 *
 * The single-submit invariant is a P0 release gate: composers MUST NOT
 * import `SendMessageMutation` directly. The transport adapter
 * (createAppSyncChatTransport.sendMessages, exposed to the route via
 * useChat) is the sole caller. Double-submit (composer + transport
 * both firing the mutation) silently issues two assistant turns per
 * click.
 *
 * The grep test below fails the build if any composer file ever
 * reintroduces `SendMessageMutation` as an import.
 */

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useComposerState } from "./use-composer-state";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSER_PATH = resolve(
	__dirname,
	"../components/computer/ComputerComposer.tsx",
);
const TASK_THREAD_VIEW_PATH = resolve(
	__dirname,
	"../components/computer/TaskThreadView.tsx",
);

describe("useComposerState — basic state machine", () => {
	it("starts empty", () => {
		const { result } = renderHook(() => useComposerState("thread-1"));
		expect(result.current.text).toBe("");
		expect(result.current.files).toEqual([]);
		expect(result.current.isSubmitting).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it("setText updates text", () => {
		const { result } = renderHook(() => useComposerState("thread-1"));
		act(() => result.current.setText("hello"));
		expect(result.current.text).toBe("hello");
	});

	it("addFile / removeFile / clearFiles maintain the file list", () => {
		const { result } = renderHook(() => useComposerState("thread-1"));
		const f1 = new File(["a"], "a.txt");
		const f2 = new File(["b"], "b.txt");
		act(() => {
			result.current.addFile(f1);
			result.current.addFile(f2);
		});
		expect(result.current.files).toEqual([f1, f2]);
		act(() => result.current.removeFile(f1));
		expect(result.current.files).toEqual([f2]);
		act(() => result.current.clearFiles());
		expect(result.current.files).toEqual([]);
	});

	it("clear() resets text + files + error", () => {
		const { result } = renderHook(() => useComposerState("thread-1"));
		act(() => {
			result.current.setText("draft");
			result.current.addFile(new File(["x"], "x.txt"));
			result.current.setError("oops");
		});
		expect(result.current.text).toBe("draft");
		expect(result.current.files.length).toBe(1);
		expect(result.current.error).toBe("oops");
		act(() => result.current.clear());
		expect(result.current.text).toBe("");
		expect(result.current.files).toEqual([]);
		expect(result.current.error).toBeNull();
	});

	it("setSubmitting toggles isSubmitting", () => {
		const { result } = renderHook(() => useComposerState("thread-1"));
		act(() => result.current.setSubmitting(true));
		expect(result.current.isSubmitting).toBe(true);
		act(() => result.current.setSubmitting(false));
		expect(result.current.isSubmitting).toBe(false);
	});
});

describe("U13 single-submit invariant — composers MUST NOT import SendMessageMutation (P0)", () => {
	it("ComputerComposer.tsx does not import SendMessageMutation", () => {
		const source = readFileSync(COMPOSER_PATH, "utf8");
		expect(source).not.toMatch(/SendMessageMutation/);
	});

	it("ComputerComposer.tsx does not import from graphql-queries", () => {
		const source = readFileSync(COMPOSER_PATH, "utf8");
		expect(source).not.toMatch(
			/from\s+["'](?:@\/lib\/graphql-queries|\.\.\/\.\.\/lib\/graphql-queries)["']/,
		);
	});

	it("TaskThreadView.tsx FollowUpComposer surface does not invoke SendMessageMutation directly", () => {
		// TaskThreadView.tsx as a whole imports SendMessageMutation is
		// allowed (the route does — but the route is the single-submit
		// owner via createAppSyncChatTransport). What we forbid: the
		// FollowUpComposer function itself reaching for the mutation.
		// Heuristic check: ensure the FollowUpComposer function body
		// never references SendMessageMutation.
		const source = readFileSync(TASK_THREAD_VIEW_PATH, "utf8");
		// Find the FollowUpComposer block.
		const match = source.match(/function FollowUpComposer\([\s\S]*?\n\}/);
		expect(match).not.toBeNull();
		expect(match![0]).not.toMatch(/SendMessageMutation/);
		expect(match![0]).not.toMatch(/useMutation/);
	});
});
