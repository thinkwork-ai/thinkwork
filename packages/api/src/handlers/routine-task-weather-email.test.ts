import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSesSend } = vi.hoisted(() => ({
  mockSesSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = mockSesSend;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { handler } from "./routine-task-weather-email.js";

describe("routine-task-weather-email", () => {
  beforeEach(() => {
    mockSesSend.mockReset();
    mockSesSend.mockResolvedValue({ MessageId: "ses-123" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 72.4,
            relative_humidity_2m: 48,
            apparent_temperature: 71.9,
            precipitation: 0,
            weather_code: 1,
            wind_speed_10m: 8.2,
            wind_gusts_10m: 14.5,
          },
        }),
      }),
    );
  });

  it("fetches Austin weather and sends an email", async () => {
    const result = await handler({
      to: ["ericodom37@gmail.com"],
      location: "Austin, TX",
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(String((fetch as any).mock.calls[0][0])).toContain(
      "api.open-meteo.com",
    );
    expect(mockSesSend).toHaveBeenCalledOnce();
    const command = mockSesSend.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Source: "weather@agents.thinkwork.ai",
      Destination: { ToAddresses: ["ericodom37@gmail.com"] },
    });
    expect(command.input.Message.Body.Text.Data).toContain(
      "Temperature: 72.4 F",
    );
    expect(result).toMatchObject({
      messageId: "ses-123",
      location: "Austin, TX",
      to: ["ericodom37@gmail.com"],
    });
  });

  it("requires at least one recipient", async () => {
    await expect(handler({ to: [] })).rejects.toThrow(
      "Missing required field `to`.",
    );
  });
});
