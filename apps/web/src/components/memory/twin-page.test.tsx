import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@thinkwork/ui", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
  Badge: ({
    children,
    className,
    ...rest
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <span className={className} {...rest}>
      {children}
    </span>
  ),
}));

import {
  formatAge,
  parseTwinEntityPage,
  TwinSectionBody,
  TwinSectionStateChip,
  type ProjectedTwinSection,
} from "./twin-page";

afterEach(cleanup);

function section(
  overrides: Partial<ProjectedTwinSection>,
): ProjectedTwinSection {
  return {
    slug: "aging",
    heading: "Aging",
    kind: "facet_backed",
    state: "OK",
    ageSeconds: 3600,
    provenance: "source_backed",
    data: null,
    detail: null,
    ...overrides,
  };
}

describe("parseTwinEntityPage (AWSJSON payload)", () => {
  it("parses the wire string and passes objects through", () => {
    const payload = { projected: true, sections: [] };
    expect(parseTwinEntityPage(JSON.stringify(payload))).toEqual(payload);
    expect(parseTwinEntityPage(payload)).toEqual(payload);
  });

  it("rejects garbage and shapes without a boolean `projected` (AE8 safety)", () => {
    expect(parseTwinEntityPage("not json {")).toBeNull();
    expect(parseTwinEntityPage(null)).toBeNull();
    expect(parseTwinEntityPage({ sections: [] })).toBeNull();
    expect(parseTwinEntityPage({ projected: "yes" })).toBeNull();
  });
});

describe("formatAge", () => {
  it("buckets seconds into human ages", () => {
    expect(formatAge(30)).toBe("just now");
    expect(formatAge(90)).toBe("1m ago");
    expect(formatAge(3 * 3600)).toBe("3h ago");
    expect(formatAge(2 * 86_400)).toBe("2d ago");
    expect(formatAge(null)).toBeNull();
  });
});

describe("TwinSectionStateChip (KTD-8 per-section freshness)", () => {
  it("OK shows provenance + cache age", () => {
    render(<TwinSectionStateChip section={section({})} />);
    expect(screen.getByText("Synced · 1h ago")).toBeTruthy();
  });

  it("STALE / TIMEOUT / ERROR read as their own states", () => {
    render(
      <>
        <TwinSectionStateChip
          section={section({ state: "STALE", ageSeconds: null })}
        />
        <TwinSectionStateChip section={section({ state: "TIMEOUT" })} />
        <TwinSectionStateChip section={section({ state: "ERROR" })} />
      </>,
    );
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText("Timed out")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});

describe("TwinSectionBody", () => {
  it("facet sections render cloned values, hiding freshness bookkeeping", () => {
    render(
      <TwinSectionBody
        section={section({
          data: {
            facetState: "synced",
            values: { daysPastDue: 31, balance: "1200.50" },
            syncedAt: "2026-07-21T10:00:00Z",
            batchId: "b1",
          },
        })}
      />,
    );
    expect(screen.getByText("Days Past Due")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("1200.50")).toBeTruthy();
    expect(screen.queryByText("synced")).toBeNull();
    expect(screen.queryByText("b1")).toBeNull();
  });

  it("knowledge sections render prose with knowledge provenance", () => {
    render(
      <TwinSectionBody
        section={section({
          provenance: "knowledge",
          kind: "knowledge",
          data: { bodyMd: "What we know about this customer." },
        })}
      />,
    );
    expect(screen.getByText("What we know about this customer.")).toBeTruthy();
  });

  it("a failed section degrades in place — page stays intact (F4)", () => {
    render(
      <TwinSectionBody
        section={section({ state: "ERROR", detail: "section_timeout" })}
      />,
    );
    expect(screen.getByText(/rest of the page is unaffected/)).toBeTruthy();
  });
});

describe("WikiPageView dual-read wiring (AE2/AE8)", () => {
  const source = readFileSync(join(__dirname, "WikiPageView.tsx"), "utf-8");

  it("asks for the projected page only for entity pages with twin keys", () => {
    expect(source).toContain("TwinEntityPageQuery");
    expect(source).toContain("pause: !canAskTwin");
    expect(source).toContain('page?.type === "ENTITY"');
  });

  it("falls back to compiled sections when not projected (AE8)", () => {
    // Projected render is a ternary OVER the compiled block — never a
    // replacement, so an unflipped tenant renders exactly as before.
    expect(source).toContain("projectedSections ? (");
    expect(source).toContain("sortedSections.length > 0 ? (");
  });

  it("umbrella naming: breadcrumb reads Pages", () => {
    expect(source).toContain(
      '{ label: "Pages", href: "/settings/memory/wiki" }',
    );
  });
});
