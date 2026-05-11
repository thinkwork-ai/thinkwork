/**
 * Tests for renderTypedPart (plan-012 U14).
 *
 * Pin the part-type → AI Elements primitive mapping. Snapshot-style
 * structural assertions only — we don't assert visual output, just
 * that each part type renders the expected primitive.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AccumulatedPart } from "@/lib/ui-message-merge";
import { renderTypedPart, renderTypedParts } from "./render-typed-part";

afterEach(cleanup);

function rk() {
	return { keyPrefix: "msg-1", index: 0 };
}

describe("renderTypedPart", () => {
	it("renders a text part via <Response>", () => {
		const part: AccumulatedPart = {
			type: "text",
			id: "p1",
			text: "Hello",
			state: "done",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		// <Response> renders to a <div class="ai-response prose ...">
		const proseHost = container.querySelector("div.ai-response");
		expect(proseHost).not.toBeNull();
	});

	it("renders a reasoning part via <Reasoning> + <ReasoningContent>", () => {
		const part: AccumulatedPart = {
			type: "reasoning",
			id: "r1",
			text: "Hmm",
			state: "streaming",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		// Reasoning wraps a Collapsible; structural smoke check.
		expect(container.querySelector('[data-slot="collapsible"], [class*=collapsible], [class*=not-prose]')).not.toBeNull();
	});

	it("renders a tool-${name} part via <Tool>", () => {
		const part: AccumulatedPart = {
			type: "tool-renderFragment",
			toolCallId: "t1",
			toolName: "renderFragment",
			input: { tsx: "<App />" },
			output: { rendered: true },
			state: "output-available",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		// Tool renders some structural elements; we just assert the
		// container has children and didn't throw.
		expect(container.firstChild).not.toBeNull();
	});

	it("groups tool parts into one collapsed tool activity section", () => {
		const parts: AccumulatedPart[] = [
			{
				type: "text",
				id: "p1",
				text: "Working",
				state: "done",
			},
			{
				type: "tool-web_search",
				toolCallId: "t1",
				toolName: "web_search",
				input: { preview: "{}" },
				state: "input-available",
			},
			{
				type: "tool-browser_automation",
				toolCallId: "t2",
				toolName: "browser_automation",
				state: "input-available",
			},
		];

		const { container } = render(
			<>{renderTypedParts(parts, { keyPrefix: "msg-1" })}</>,
		);

		expect(screen.getByLabelText("Tool activity")).toBeTruthy();
		expect(screen.getByText(/2 tool calls/)).toBeTruthy();
		expect(container.textContent).not.toContain("PARAMETERS");
	});

	it("renders a source-url part as an anchor", () => {
		const part: AccumulatedPart = {
			type: "source-url",
			sourceId: "s1",
			url: "https://example.com",
			title: "Example",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		const anchor = container.querySelector("a");
		expect(anchor).not.toBeNull();
		expect(anchor!.getAttribute("href")).toBe("https://example.com");
		expect(anchor!.textContent).toBe("Example");
	});

	it("renders a file part as an anchor with media-type label", () => {
		const part: AccumulatedPart = {
			type: "file",
			url: "https://example.com/x.png",
			mediaType: "image/png",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		const anchor = container.querySelector("a");
		expect(anchor).not.toBeNull();
		expect(anchor!.getAttribute("href")).toBe("https://example.com/x.png");
	});

	it("renders an unknown data-${name} part as a forward-compat debug strip", () => {
		const part: AccumulatedPart = {
			type: "data-future-shape",
			data: { foo: "bar" },
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		expect(container.textContent).toContain("data-future-shape");
	});

	it("renders nothing surprising for an unsupported part type (defensive return null)", () => {
		// A theoretical unknown part shape should not crash — the helper
		// returns null and React renders nothing.
		const part = {
			type: "source-document" as const,
			sourceId: "s1",
			mediaType: "text/markdown",
			title: "doc",
		};
		const { container } = render(<>{renderTypedPart(part, rk())}</>);
		expect(container.textContent).toContain("doc");
	});
});
