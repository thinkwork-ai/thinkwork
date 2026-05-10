import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	EmptyRenderGuard,
	hasVisibleAppletContent,
} from "../EmptyRenderGuard";

afterEach(() => cleanup());

describe("hasVisibleAppletContent", () => {
	it("treats text, charts, and embedded frames as visible content", () => {
		const element = document.createElement("div");
		element.innerHTML = "<iframe title=\"Map\"></iframe>";
		expect(hasVisibleAppletContent(element)).toBe(true);

		element.innerHTML = "<svg></svg>";
		expect(hasVisibleAppletContent(element)).toBe(true);

		element.textContent = "Summary";
		expect(hasVisibleAppletContent(element)).toBe(true);
	});

	it("treats empty markup as empty", () => {
		const element = document.createElement("div");
		element.innerHTML = "<div><span></span></div>";
		expect(hasVisibleAppletContent(element)).toBe(false);
	});
});

describe("EmptyRenderGuard", () => {
	it("shows an explicit fallback when a component renders null", async () => {
		function NullApplet() {
			return null;
		}

		render(<EmptyRenderGuard Component={NullApplet} />);

		await waitFor(() => {
			expect(
				screen.getByText("This applet rendered no visible content."),
			).not.toBeNull();
		});
	});

	it("does not show the fallback when a component renders content", async () => {
		function VisibleApplet() {
			return <section>Pipeline dashboard</section>;
		}

		render(<EmptyRenderGuard Component={VisibleApplet} />);

		expect(screen.getByText("Pipeline dashboard")).not.toBeNull();
		await waitFor(() => {
			expect(
				screen.queryByText("This applet rendered no visible content."),
			).toBeNull();
		});
	});
});
