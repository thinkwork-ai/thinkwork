import { describe, expect, it } from "vitest";

import { buildComputerApprovalPushMessage } from "../lib/push-notifications.js";

describe("buildComputerApprovalPushMessage", () => {
	it("builds a mobile push that deep-links to apps/computer approvals", () => {
		expect(
			buildComputerApprovalPushMessage({
				token: "ExponentPushToken[test]",
				approvalId: "approval-1",
				question: "Review the proposed Gmail metadata access before Computer continues.",
				computerBaseUrl: "https://computer.thinkwork.ai/",
			}),
		).toEqual({
			to: "ExponentPushToken[test]",
			sound: "default",
			title: "Approval needed",
			body: "Review the proposed Gmail metadata access before Computer continues.",
			data: {
				type: "computer_approval",
				approvalId: "approval-1",
				deepLinkUrl: "https://computer.thinkwork.ai/approvals/approval-1",
			},
		});
	});

	it("truncates long approval questions in the notification body", () => {
		const message = buildComputerApprovalPushMessage({
			token: "ExponentPushToken[test]",
			approvalId: "approval-1",
			question: "x".repeat(120),
		});

		expect(message.body).toHaveLength(100);
		expect(message.body.endsWith("...")).toBe(true);
	});
});
