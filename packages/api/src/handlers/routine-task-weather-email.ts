/**
 * routine-task-weather-email
 *
 * Small routine task wrapper used by the routines Step Functions runtime
 * to fetch current weather and send it by email. It is intentionally a
 * Lambda task wrapper, not an admin API route: the routines execution role
 * is already scoped to invoke `thinkwork-<stage>-api-routine-task-*`.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

interface WeatherEmailEvent {
  to?: string[] | string;
  location?: string;
  subject?: string;
  source?: string;
}

interface OpenMeteoCurrent {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
  weather_code?: number;
}

const AUSTIN = {
  name: "Austin, Texas",
  latitude: 30.2672,
  longitude: -97.7431,
  timezone: "America/Chicago",
};

const ses = new SESClient({});

function recipients(to: WeatherEmailEvent["to"]): string[] {
  if (Array.isArray(to)) return to.map((item) => item.trim()).filter(Boolean);
  if (typeof to === "string") {
    return to
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function weatherLabel(code: number | undefined): string {
  if (code === undefined) return "conditions unavailable";
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "partly cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "thunderstorms";
  return `weather code ${code}`;
}

function formatBody(location: string, current: OpenMeteoCurrent): string {
  const temp = current.temperature_2m;
  const feelsLike = current.apparent_temperature;
  const humidity = current.relative_humidity_2m;
  const wind = current.wind_speed_10m;
  const gusts = current.wind_gusts_10m;
  const precipitation = current.precipitation;
  const conditions = weatherLabel(current.weather_code);

  return [
    `Current weather for ${location}:`,
    "",
    `Conditions: ${conditions}`,
    temp === undefined ? null : `Temperature: ${temp.toFixed(1)} F`,
    feelsLike === undefined ? null : `Feels like: ${feelsLike.toFixed(1)} F`,
    humidity === undefined ? null : `Humidity: ${Math.round(humidity)}%`,
    wind === undefined ? null : `Wind: ${wind.toFixed(1)} mph`,
    gusts === undefined ? null : `Wind gusts: ${gusts.toFixed(1)} mph`,
    precipitation === undefined
      ? null
      : `Current precipitation: ${precipitation.toFixed(2)} in`,
    "",
    "Source: Open-Meteo current weather API",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export async function handler(event: WeatherEmailEvent = {}) {
  const to = recipients(event.to);
  if (to.length === 0) {
    throw new Error("Missing required field `to`.");
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(AUSTIN.latitude));
  url.searchParams.set("longitude", String(AUSTIN.longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_gusts_10m",
    ].join(","),
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", AUSTIN.timezone);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { current?: OpenMeteoCurrent };
  if (!body.current) {
    throw new Error("Open-Meteo response did not include current weather.");
  }

  const location = event.location?.trim() || AUSTIN.name;
  const emailBody = formatBody(location, body.current);
  const subject = event.subject?.trim() || `Current weather for ${location}`;
  const source = event.source?.trim() || "weather@agents.thinkwork.ai";

  const result = await ses.send(
    new SendEmailCommand({
      Source: source,
      Destination: { ToAddresses: to },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: emailBody, Charset: "UTF-8" },
        },
      },
    }),
  );

  return {
    messageId: result.MessageId ?? null,
    location,
    subject,
    to,
    weatherSummary: emailBody,
  };
}
