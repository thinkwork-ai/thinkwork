import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutomationWebhookDeliveriesPanel,
  AutomationWebhookEndpointPanel,
} from "./AutomationWebhookPanel";
import type { AutomationWebhookDelivery } from "./agent-loop-types";

vi.mock("@thinkwork/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

afterEach(() => cleanup());

const delivery: AutomationWebhookDelivery = {
  id: "d1",
  receivedAt: "2026-07-04T12:00:00.000Z",
  resolutionStatus: "ok",
  signatureStatus: "not_required",
  statusCode: 201,
  providerName: "github",
  providerEventId: "evt_abc123",
  normalizedKind: "push",
  threadId: "t1",
  threadCreated: true,
  isReplay: false,
  retryCount: 0,
  durationMs: 42,
  errorMessage: null,
};

describe("AutomationWebhookDeliveriesPanel", () => {
  it("renders delivery metadata (status, resolution, event id)", () => {
    render(<AutomationWebhookDeliveriesPanel deliveries={[delivery]} />);
    expect(screen.getByText("Deliveries")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
    expect(screen.getByText("201")).toBeTruthy();
    expect(screen.getByText("evt_abc123")).toBeTruthy();
  });

  it("does NOT render any request body content (metadata-only, R8)", () => {
    // The delivery shape carries no body field; assert no body text leaks even
    // if a rogue field were present on the object.
    const withRogueBody = {
      ...delivery,
      bodyPreview: "SECRET_CUSTOMER_PII",
    } as AutomationWebhookDelivery & { bodyPreview: string };
    const { container } = render(
      <AutomationWebhookDeliveriesPanel deliveries={[withRogueBody]} />,
    );
    expect(container.textContent).not.toContain("SECRET_CUSTOMER_PII");
  });

  it("renders an empty state when there are no deliveries", () => {
    render(<AutomationWebhookDeliveriesPanel deliveries={[]} />);
    expect(screen.getByText(/No inbound deliveries/i)).toBeTruthy();
  });
});

describe("AutomationWebhookEndpointPanel", () => {
  it("shows the endpoint path and masks the token", () => {
    render(
      <AutomationWebhookEndpointPanel
        endpoint={{
          webhookId: "w1",
          token: "abcdefghijklmnop",
          path: "/webhooks/abcdefghijklmnop",
          enabled: true,
        }}
      />,
    );
    expect(screen.getByText("Webhook endpoint")).toBeTruthy();
    // Token is masked in the display (raw token only reaches the clipboard).
    const masked = screen.getByText(/abcd••••mnop/);
    expect(masked).toBeTruthy();
  });
});
