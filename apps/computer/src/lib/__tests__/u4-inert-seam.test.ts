/**
 * Body-swap forcing-function for U4 (plan 2026-05-09-012).
 *
 * U4 ships `createAppSyncChatTransport` inert — the adapter exists and is
 * tested, but no consumer mounts it. This test asserts the inert state at
 * the seam: `ComputerThreadDetailRoute.tsx` MUST NOT import
 * `createAppSyncChatTransport` until U8 wires it. When U8 lands, U8 deletes
 * this test in the same PR (the deletion is the body-swap signal that the
 * cutover is intentional, not accidental).
 *
 * Per `feedback_ship_inert_pattern`: new modules ship with tests but no
 * live wiring; integration waits for the plan's own dependency gate.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(
	__dirname,
	"../../components/computer/ComputerThreadDetailRoute.tsx",
);

describe("U4 inert seam — useChat AppSync transport", () => {
	it("ComputerThreadDetailRoute does not yet import createAppSyncChatTransport (U8 deletes this assertion)", () => {
		const source = readFileSync(ROUTE_PATH, "utf8");
		expect(source).not.toMatch(/createAppSyncChatTransport/);
		expect(source).not.toMatch(/use-chat-appsync-transport/);
	});

	it("ComputerThreadDetailRoute does not yet import useChat from ai (U8 deletes this assertion)", () => {
		const source = readFileSync(ROUTE_PATH, "utf8");
		// Allow the file to evolve in unrelated ways; only the specific U8
		// wiring is gated. Match the named import to avoid false positives
		// on substrings like "useChatPart" or "useChatStatus".
		expect(source).not.toMatch(/from\s+["']ai["']/);
		expect(source).not.toMatch(/from\s+["']ai\/react["']/);
	});
});
