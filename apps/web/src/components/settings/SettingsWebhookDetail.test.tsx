import { describe, expect, it } from "vitest";
import {
  deliveryStatusPresentation,
  isAcceptedWithWarning,
} from "./SettingsWebhookDetail";

describe("SettingsWebhookDetail delivery presentation", () => {
  it("marks thread-created 2xx deliveries with warning details as accepted with warning", () => {
    const delivery = {
      threadCreated: true,
      statusCode: 202,
      resolutionStatus: "ok",
      errorMessage: "Customer Onboarding workflow failed to start.",
    };

    expect(isAcceptedWithWarning(delivery)).toBe(true);
    expect(deliveryStatusPresentation(delivery)).toMatchObject({
      label: "Accepted with warning",
      variant: "outline",
      issueLabel: "Warning",
    });
  });

  it("keeps older successful rows without warning details visually unchanged", () => {
    const delivery = {
      threadCreated: true,
      statusCode: 201,
      resolutionStatus: "ok",
      errorMessage: null,
    };

    expect(isAcceptedWithWarning(delivery)).toBe(false);
    const presentation = deliveryStatusPresentation(delivery);
    expect(presentation).toMatchObject({
      label: "ok",
      variant: "secondary",
    });
    expect(presentation).not.toHaveProperty("issueLabel");
  });

  it("keeps non-2xx error deliveries destructive even when they created no thread", () => {
    const delivery = {
      threadCreated: false,
      statusCode: 500,
      resolutionStatus: "error",
      errorMessage: "Target agent is disabled.",
    };

    expect(isAcceptedWithWarning(delivery)).toBe(false);
    expect(deliveryStatusPresentation(delivery)).toMatchObject({
      label: "error",
      variant: "destructive",
      issueLabel: "Error",
    });
  });
});
