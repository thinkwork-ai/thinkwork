import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentSlashQuery,
  filterSkillCatalog,
  SkillMenu,
  type SkillOption,
} from "./SkillMenu";

afterEach(cleanup);

const catalog: SkillOption[] = [
  { slug: "crm-dashboard", displayName: "CRM Dashboard", installed: true },
  {
    slug: "invoice-parser",
    displayName: "Invoice Parser",
    description: "Parse invoices",
    installed: false,
  },
];

describe("currentSlashQuery", () => {
  it("detects a slash command at the cursor", () => {
    expect(currentSlashQuery("/cr")).toBe("cr");
    expect(currentSlashQuery("hello /inv")).toBe("inv");
    expect(currentSlashQuery("/")).toBe("");
  });

  it("returns null when not in a slash context", () => {
    expect(currentSlashQuery("hello")).toBeNull();
    expect(currentSlashQuery("/cr more")).toBeNull(); // space ends the token
  });

  it("does not trigger on a slash mid-token (paths, urls)", () => {
    expect(currentSlashQuery("see /Users/eric/file")).toBeNull();
    expect(currentSlashQuery("https://x.com/path")).toBeNull();
  });
});

describe("filterSkillCatalog", () => {
  it("matches slug, display name, or description, case-insensitively", () => {
    expect(filterSkillCatalog(catalog, "crm").map((s) => s.slug)).toEqual([
      "crm-dashboard",
    ]);
    expect(filterSkillCatalog(catalog, "INVOICE").map((s) => s.slug)).toEqual([
      "invoice-parser",
    ]);
    expect(filterSkillCatalog(catalog, "parse").map((s) => s.slug)).toEqual([
      "invoice-parser",
    ]);
  });

  it("returns all (capped at 8) for an empty query", () => {
    expect(filterSkillCatalog(catalog, "")).toHaveLength(2);
  });
});

describe("SkillMenu", () => {
  it("renders matching skills and marks uninstalled catalog skills", () => {
    render(<SkillMenu options={catalog} query="" onSelect={() => {}} />);
    expect(screen.getByText("CRM Dashboard")).toBeTruthy();
    expect(screen.getByText("Invoice Parser")).toBeTruthy();
    // not-installed → "catalog" badge
    expect(screen.getByText("catalog")).toBeTruthy();
  });

  it("fires onSelect with the chosen skill", () => {
    const onSelect = vi.fn();
    render(<SkillMenu options={catalog} query="crm" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("CRM Dashboard"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "crm-dashboard" }),
    );
  });

  it("renders nothing when no skill matches", () => {
    const { container } = render(
      <SkillMenu options={catalog} query="zzz" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
