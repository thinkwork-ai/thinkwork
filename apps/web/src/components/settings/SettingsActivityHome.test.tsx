import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const source = read("src/components/settings/SettingsActivityHome.tsx");
const activityRoute = read("src/routes/_authed/settings.activity.tsx");
const threadsRoute = read("src/routes/_authed/settings.activity.threads.tsx");
const analyticsRoute = read("src/routes/_authed/settings.analytics.tsx");

describe("SettingsActivityHome", () => {
  it("owns a single stable Activity breadcrumb", () => {
    expect(source).toContain('title: "Activity"');
    expect(source).toContain('breadcrumbs: [{ label: "Activity" }]');
  });

  it("publishes Analytics and Threads tabs into the page header", () => {
    expect(source).toContain("tabs: [");
    expect(source).toContain('{ to: ANALYTICS, label: "Analytics" }');
    expect(source).toContain('{ to: THREADS, label: "Threads" }');
  });

  it("renders the active facet selected by the current route", () => {
    expect(source).toContain("tabForPath");
    expect(source).toContain("<SettingsAnalytics embedded");
    expect(source).toContain("<SettingsActivity");
    expect(source).toContain('activeTab === "threads"');
    // The tabs live in the header, not an in-body strip.
    expect(source).not.toContain("TabsList");
  });

  it("defaults the section root to the Analytics tab", () => {
    expect(source).toContain('const ANALYTICS = "/settings/activity"');
    expect(source).toContain('const THREADS = "/settings/activity/threads"');
    // tabForPath falls back to analytics for anything that isn't the threads path.
    expect(source).toContain('return "analytics"');
  });

  it("mounts the combined page across both Activity tab routes", () => {
    expect(activityRoute).toContain("SettingsActivityHome");
    expect(threadsRoute).toContain("SettingsActivityHome");
  });

  it("redirects the retired Analytics route into the Activity page", () => {
    expect(analyticsRoute).toContain('redirect({ to: "/settings/activity" })');
  });

  it("validates the day filter on the Threads route, not the section root", () => {
    expect(threadsRoute).toContain("validateSearch");
    expect(threadsRoute).toContain("isActivityDay");
    // The section root is the Analytics tab and no longer declares day search.
    expect(activityRoute).not.toContain("validateSearch");
  });
});
