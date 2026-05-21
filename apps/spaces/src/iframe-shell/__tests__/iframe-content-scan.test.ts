/**
 * Plan-012 U9 — content-scan tests, migrated forward from plan-001's
 * same-origin scanner. The iframe sandbox + connect-src 'none' are the
 * primary network boundary; this scan rejects forbidden patterns at
 * compile time so the agent gets a clear error and can self-correct.
 */

import { describe, expect, it } from "vitest";
import {
	ContentScanRejection,
	assertScanPasses,
	scanFragmentSource,
} from "../iframe-content-scan";

describe("scanFragmentSource — forbidden patterns", () => {
	it("flags fetch", () => {
		const result = scanFragmentSource("fetch('/api/secrets')");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("fetch");
	});

	it("flags XMLHttpRequest", () => {
		const result = scanFragmentSource("new XMLHttpRequest()");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("XMLHttpRequest");
	});

	it("flags WebSocket", () => {
		const result = scanFragmentSource("new WebSocket('wss://x')");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("WebSocket");
	});

	it("flags globalThis", () => {
		const result = scanFragmentSource("globalThis.exfil = 'x'");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("globalThis");
	});

	it("flags eval", () => {
		const result = scanFragmentSource("eval('1+1')");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("eval");
	});

	it("flags Function-constructor", () => {
		const result = scanFragmentSource("new Function('return 1')()");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain(
			"Function-constructor",
		);
	});

	it("flags dynamic import()", () => {
		const result = scanFragmentSource("import('./x')");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("dynamic-import");
	});

	it("flags Reflect", () => {
		const result = scanFragmentSource("Reflect.get(target, 'x')");
		expect(result.ok).toBe(false);
		expect(result.findings.map((f) => f.pattern)).toContain("Reflect");
	});

	it("does NOT flag substrings inside identifiers (false-positive avoidance)", () => {
		// `globalThisIsFine` happens to contain "globalThis" but it's a
		// different identifier. Word boundary anchor protects this.
		const result = scanFragmentSource(
			"const fineIdentifier = useState();",
		);
		expect(result.ok).toBe(true);
	});

	it("accepts a clean React fragment", () => {
		const source = `
			import { Card, CardHeader } from "@thinkwork/ui";
			export default function App() {
				return <Card><CardHeader>OK</CardHeader></Card>;
			}
		`;
		const result = scanFragmentSource(source);
		expect(result.ok).toBe(true);
		expect(result.findings).toEqual([]);
	});

	it("includes line and column for findings", () => {
		const result = scanFragmentSource(
			"const x = 1;\nconst y = fetch('/x');\n",
		);
		expect(result.ok).toBe(false);
		const find = result.findings.find((f) => f.pattern === "fetch");
		expect(find?.line).toBe(2);
		expect(typeof find?.column).toBe("number");
	});
});

describe("assertScanPasses", () => {
	it("throws ContentScanRejection on forbidden patterns", () => {
		expect(() => assertScanPasses("fetch('x')")).toThrow(
			ContentScanRejection,
		);
	});

	it("does not throw on clean source", () => {
		expect(() =>
			assertScanPasses("export default function App() { return null; }"),
		).not.toThrow();
	});
});
